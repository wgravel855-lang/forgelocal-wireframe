// @ts-check
/**
 * Sidecar tests.
 *
 * These spawn the real sidecar as a child process and talk to it over stdin and
 * stdout, exactly as the Rust host does. Nothing is stubbed at the transport,
 * so a framing bug or a stray stdout write fails here rather than in the app.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION, Request, Notify, ErrorCode, createDecoder } from "./protocol.mjs";
import { startFakeModelServer } from "./fakeserver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SIDECAR = join(here, "sidecar.mjs");

/**
 * A live sidecar with a frame queue and a wait-for helper.
 *
 * Every sidecar gets its own state directory. Without one the tests write
 * sessions into the developer's real application data, and two tests running
 * in the same second would see each other's history.
 * @param {{stateDir?: string}} [opts]
 */
function start(opts = {}) {
  const stateDir = opts.stateDir ?? mkdtempSync(join(tmpdir(), "fl-state-"));
  const child = spawn(process.execPath, [SIDECAR], {
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, FORGELOCAL_STATE_DIR: stateDir },
  });
  const frames = [];
  const waiters = [];
  let stderr = "";

  const deliver = (f) => {
    frames.push(f);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(f)) { waiters[i].resolve(f); waiters.splice(i, 1); }
    }
  };
  const decoder = createDecoder(deliver, (line, e) => {
    throw new Error(`the sidecar wrote a non-JSON line to stdout: ${line} (${e.message})`);
  });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (c) => decoder.push(String(c)));
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => { stderr += c; });

  let seq = 0;
  return {
    child,
    stateDir,
    get frames() { return frames; },
    get stderr() { return stderr; },
    /** @param {string} type @param {any} [payload] @param {string|null} [sessionId] */
    send(type, payload = {}, sessionId = null) {
      const id = `r${++seq}`;
      child.stdin.write(`${JSON.stringify({ v: PROTOCOL_VERSION, id, type, sessionId, payload })}\n`);
      return id;
    },
    /** raw, for malformed-frame tests */
    raw(text) { child.stdin.write(text); },
    /** @param {(f: any) => boolean} match */
    wait(match, ms = 20000) {
      const found = frames.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(
          `timed out waiting for a frame.\nseen: ${frames.map((f) => f.type).join(", ")}\nstderr: ${stderr.slice(-400)}`,
        )), ms);
        waiters.push({ match, resolve: (f) => { clearTimeout(t); resolve(f); } });
      });
    },
    async stop() {
      child.stdin.end();
      await new Promise((r) => { child.on("close", r); setTimeout(r, 2000); });
      if (child.exitCode === null) child.kill();
    },
  };
}

function repo() {
  const base = mkdtempSync(join(tmpdir(), "fl-side-"));
  mkdirSync(join(base, "src"), { recursive: true });
  writeFileSync(join(base, "src", "a.js"), "export const a = 1;\n");
  return base;
}
const clean = (b) => rmSync(b, { recursive: true, force: true });

test("the sidecar announces itself on stdout as one JSON frame", async () => {
  const s = start();
  const hello = await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  assert.equal(hello.v, PROTOCOL_VERSION);
  assert.equal(hello.payload.connected, true);
  assert.equal(hello.payload.protocol, PROTOCOL_VERSION);
  assert.equal(typeof hello.payload.pid, "number");
  await s.stop();
});

test("a frame with the wrong version is refused, not guessed at", async () => {
  const s = start();
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  s.raw(`${JSON.stringify({ v: 99, id: "x", type: Request.PROVIDER_DISCONNECT })}\n`);
  const f = await s.wait((f) => f.id === "x");
  assert.equal(f.type, Notify.TURN_FAILED);
  assert.equal(f.payload.code, ErrorCode.BAD_VERSION);
  await s.stop();
});

test("an unknown request type is named in the refusal", async () => {
  const s = start();
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  s.raw(`${JSON.stringify({ v: 1, id: "y", type: "runtime.exec_anything" })}\n`);
  const f = await s.wait((f) => f.id === "y");
  assert.equal(f.payload.code, ErrorCode.UNKNOWN_TYPE);
  assert.match(f.payload.message, /runtime\.exec_anything/);
  await s.stop();
});

test("a line that is not JSON is reported rather than silently dropped", async () => {
  const s = start();
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  s.raw("this is not json\n");
  const f = await s.wait((f) => f.type === Notify.TURN_FAILED && f.payload.code === ErrorCode.BAD_FRAME);
  assert.match(f.payload.message, /Could not parse a frame/);
  await s.stop();
});

test("a frame split across chunks is reassembled", async () => {
  const s = start();
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  const frame = JSON.stringify({ v: 1, id: "split", type: Request.PROVIDER_DISCONNECT });
  s.raw(frame.slice(0, 12));
  await new Promise((r) => setTimeout(r, 60));
  s.raw(`${frame.slice(12)}\n`);
  const f = await s.wait((f) => f.id === "split");
  assert.equal(f.type, Notify.PROVIDER_STATE);
  await s.stop();
});

test("requests that need a session are refused without one", async () => {
  const s = start();
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  s.raw(`${JSON.stringify({ v: 1, id: "z", type: Request.TURN_START, payload: { text: "hi" } })}\n`);
  const f = await s.wait((f) => f.id === "z");
  assert.equal(f.payload.code, ErrorCode.MISSING_SESSION);
  await s.stop();
});

test("an unreachable provider reports a disconnected state, not a crash", async () => {
  const s = start();
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  // Port 1 has nothing on it.
  const id = s.send(Request.PROVIDER_CONNECT, { baseUrl: "http://127.0.0.1:1/v1" });
  const f = await s.wait((f) => f.id === id && f.type === Notify.PROVIDER_STATE);
  assert.equal(f.payload.connected, false);
  assert.ok(f.payload.error, "the failure is described");
  assert.equal(s.child.exitCode, null, "the sidecar stayed alive");
  await s.stop();
});

test("a session cannot be created before a provider is connected", async () => {
  const s = start();
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  const base = repo();
  const id = s.send(Request.SESSION_CREATE, { root: base, mode: "manual" });
  const f = await s.wait((f) => f.id === id);
  assert.equal(f.type, Notify.TURN_FAILED);
  assert.equal(f.payload.code, ErrorCode.PROVIDER);
  assert.match(f.payload.message, /Connect to a model/);
  clean(base);
  await s.stop();
});

test("a turn on a session that does not exist is refused", async () => {
  const s = start();
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  const id = s.send(Request.TURN_START, { text: "hello" }, "not-a-session");
  const f = await s.wait((f) => f.id === id);
  assert.equal(f.payload.code, ErrorCode.NO_SUCH_SESSION);
  await s.stop();
});

test("stdout carries only protocol frames; diagnostics go to stderr", async () => {
  const s = start();
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  // Provoke work that a naive implementation would console.log about.
  s.send(Request.PROVIDER_CONNECT, { baseUrl: "http://127.0.0.1:1/v1" });
  await s.wait((f) => f.type === Notify.PROVIDER_STATE);
  // The decoder throws on any non-JSON stdout line, so reaching here proves it.
  for (const f of s.frames) {
    assert.equal(f.v, PROTOCOL_VERSION, "every stdout line is a versioned frame");
  }
  await s.stop();
});

test("closing stdin shuts the sidecar down", async () => {
  const s = start();
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  s.child.stdin.end();
  const code = await new Promise((r) => s.child.on("close", r));
  assert.equal(code, 0, "it exited cleanly when the host went away");
});

/* ------------------------------------------------- surviving a restart ---- */

/**
 * Connect a sidecar to a scripted model server and open a session on `root`.
 * @param {any} s @param {any} server @param {string} root
 */
async function open(s, server, root) {
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  s.send(Request.PROVIDER_CONNECT, { baseUrl: server.baseUrl, model: server.model });
  const connected = await s.wait((f) => f.type === Notify.PROVIDER_STATE && f.payload.connected);
  assert.ok(connected, "the sidecar could not reach the scripted model server");
  const id = s.send(Request.SESSION_CREATE, { root, mode: "allow_edits" });
  return s.wait((f) => f.type === Notify.SESSION_CREATED && f.id === id);
}

test("a session killed mid-run comes back marked interrupted, not completed", async () => {
  /* Acceptance: the host dies mid-run, comes back, and the session is there —
     labelled as interrupted rather than as something that finished. Both
     halves matter, and the second is the harder one: a transcript that
     survives but claims to have completed is worse than one that is lost.

     The model server hangs on the first turn, so the sidecar really is
     mid-turn when it is killed. Scripting a turn that finishes first would
     leave a completed session and test nothing. */
  const base = repo();
  const stateDir = mkdtempSync(join(tmpdir(), "fl-restart-"));
  const server = await startFakeModelServer({ turns: [{ hang: true }] });

  const first = start({ stateDir });
  const created = await open(first, server, base);
  const sessionId = created.payload.sessionId;
  assert.equal(created.payload.resumed, false);

  first.send(Request.TURN_START, { text: "What does src/a.js export?" }, sessionId);
  // The turn has begun and will never end. Wait for proof it started.
  await first.wait((f) => f.type === Notify.AGENT_EVENT
    && f.payload?.type === "turn_started" && f.sessionId === sessionId);

  /* Killed, not shut down. stdin.end() is a clean exit and would close the
     session row; SIGKILL is what a crash or a machine losing power does, and
     it is the case the interrupted status exists for. */
  first.child.kill("SIGKILL");
  await new Promise((r) => first.child.on("close", r));

  const second = start({ stateDir });
  await second.wait((f) => f.type === Notify.RUNTIME_STATE);

  const listed = second.send(Request.SESSION_LIST, {});
  const list = await second.wait((f) => f.type === Notify.SESSION_LIST && f.id === listed);
  assert.equal(list.payload.available, true, list.payload.reason);

  const row = list.payload.sessions.find((r) => r.sessionId === sessionId);
  assert.ok(row, `the session is not on disk: ${JSON.stringify(list.payload.sessions)}`);
  assert.equal(row.root, base);
  assert.equal(row.model, server.model);
  assert.equal(row.status, "interrupted",
    `a session killed mid-run came back as "${row.status}"`);
  assert.equal(row.interrupted, true);

  await second.stop();
  await server.close();
  clean(base);
  rmSync(stateDir, { recursive: true, force: true });
});

test("a session that finished is not relabelled as interrupted by a restart", async () => {
  // The other half. A blanket "anything open was interrupted" would be just as
  // dishonest in the opposite direction.
  const base = repo();
  const stateDir = mkdtempSync(join(tmpdir(), "fl-restart-ok-"));
  const server = await startFakeModelServer({ turns: [{ text: "It exports a constant." }] });

  const first = start({ stateDir });
  const created = await open(first, server, base);
  const sessionId = created.payload.sessionId;
  first.send(Request.TURN_START, { text: "What does src/a.js export?" }, sessionId);
  await first.wait((f) => f.type === Notify.TURN_COMPLETED && f.sessionId === sessionId);
  first.child.kill("SIGKILL");
  await new Promise((r) => first.child.on("close", r));

  const second = start({ stateDir });
  await second.wait((f) => f.type === Notify.RUNTIME_STATE);
  const listed = second.send(Request.SESSION_LIST, {});
  const list = await second.wait((f) => f.type === Notify.SESSION_LIST && f.id === listed);
  const row = list.payload.sessions.find((r) => r.sessionId === sessionId);
  assert.ok(row);
  assert.notEqual(row.status, "interrupted",
    "a turn that completed was relabelled as interrupted by the restart");

  await second.stop();
  await server.close();
  clean(base);
  rmSync(stateDir, { recursive: true, force: true });
});

test("reopening a session replays what happened, without doing it again", async () => {
  const base = repo();
  const stateDir = mkdtempSync(join(tmpdir(), "fl-resume-"));
  const server = await startFakeModelServer({
    turns: [
      { calls: [{ name: "read_file", args: { path: "src/a.js" } }] },
      { text: "It exports a constant called a." },
      { text: "Still the same file." },
    ],
  });

  const first = start({ stateDir });
  const created = await open(first, server, base);
  const sessionId = created.payload.sessionId;

  first.send(Request.TURN_START, { text: "What does src/a.js export?" }, sessionId);
  await first.wait((f) => f.type === Notify.TURN_COMPLETED && f.sessionId === sessionId);

  const liveEvents = first.frames
    .filter((f) => f.type === Notify.AGENT_EVENT && f.sessionId === sessionId)
    .map((f) => f.payload);
  assert.ok(liveEvents.length > 3, `only ${liveEvents.length} events were emitted`);
  const readRan = liveEvents.some((e) => e.type === "tool_completed" && e.payload?.tool === "read_file");
  assert.ok(readRan, "the scripted read never ran, so there is nothing to replay");

  first.child.kill("SIGKILL");
  await new Promise((r) => first.child.on("close", r));

  const second = start({ stateDir });
  await second.wait((f) => f.type === Notify.RUNTIME_STATE);
  second.send(Request.PROVIDER_CONNECT, { baseUrl: server.baseUrl, model: server.model });
  await second.wait((f) => f.type === Notify.PROVIDER_STATE && f.payload.connected);

  const servedBefore = server.served;
  const rid = second.send(Request.SESSION_RESUME, { sessionId });
  const reopened = await second.wait((f) => f.type === Notify.SESSION_CREATED && f.id === rid);
  assert.equal(reopened.payload.resumed, true);
  assert.equal(reopened.payload.sessionId, sessionId, "reopening minted a new session id");

  const done = await second.wait((f) => f.type === Notify.SESSION_REPLAYED && f.id === rid);
  assert.ok(done.payload.events >= liveEvents.length,
    `replayed ${done.payload.events} of ${liveEvents.length} events`);

  const replayed = second.frames
    .filter((f) => f.type === Notify.AGENT_EVENT && f.sessionId === sessionId)
    .map((f) => f.payload);

  // Every replayed event says so, so nothing can mistake a record for a run.
  assert.ok(replayed.every((e) => e.replayed === true),
    "a replayed event was indistinguishable from a live one");

  // The sequence is the same sequence, in the same order.
  assert.deepEqual(
    replayed.map((e) => e.type),
    liveEvents.map((e) => e.type),
    "the reopened transcript is not the transcript that happened",
  );

  // And nothing re-ran: replay folds events into state, it never calls a tool.
  assert.equal(server.served, servedBefore,
    "reopening a session sent the model a turn, which means it was re-running it");

  await second.stop();
  await server.close();
  clean(base);
  rmSync(stateDir, { recursive: true, force: true });
});

test("a reopened session continues with what it was for, not from nothing", async () => {
  /* The model's context is summarised rather than restored, and the summary
     has to carry the objective — lose it and the agent finishes a different
     task than the one the person asked for. */
  const base = repo();
  const stateDir = mkdtempSync(join(tmpdir(), "fl-resume2-"));
  const server = await startFakeModelServer({
    turns: [
      { text: "I have read it." },
      { text: "Continuing." },
    ],
  });

  const first = start({ stateDir });
  const created = await open(first, server, base);
  const sessionId = created.payload.sessionId;
  first.send(Request.TURN_START, { text: "Rename the export in src/a.js to alpha" }, sessionId);
  await first.wait((f) => f.type === Notify.TURN_COMPLETED && f.sessionId === sessionId);
  first.child.kill("SIGKILL");
  await new Promise((r) => first.child.on("close", r));

  const second = start({ stateDir });
  await second.wait((f) => f.type === Notify.RUNTIME_STATE);
  second.send(Request.PROVIDER_CONNECT, { baseUrl: server.baseUrl, model: server.model });
  await second.wait((f) => f.type === Notify.PROVIDER_STATE && f.payload.connected);
  const rid = second.send(Request.SESSION_RESUME, { sessionId });
  await second.wait((f) => f.type === Notify.SESSION_REPLAYED && f.id === rid);

  second.send(Request.TURN_START, { text: "Carry on." }, sessionId);
  await second.wait((f) => f.type === Notify.TURN_COMPLETED && f.sessionId === sessionId);

  const sent = server.requests[server.requests.length - 1];
  const system = sent.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  assert.match(system, /alpha/,
    "the reopened session did not carry the objective into the model's context");
  assert.match(system, /earlier|summar/i,
    "the model was handed a summary without being told it was one");

  await second.stop();
  await server.close();
  clean(base);
  rmSync(stateDir, { recursive: true, force: true });
});

test("reopening a session nobody stored is refused by name", async () => {
  const s = start();
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  const server = await startFakeModelServer({ turns: [{ text: "hi" }] });
  s.send(Request.PROVIDER_CONNECT, { baseUrl: server.baseUrl, model: server.model });
  await s.wait((f) => f.type === Notify.PROVIDER_STATE && f.payload.connected);

  const id = s.send(Request.SESSION_RESUME, { sessionId: "not-a-session" });
  const f = await s.wait((x) => x.id === id);
  assert.equal(f.payload.code, ErrorCode.NO_SUCH_SESSION);
  await s.stop();
  await server.close();
});

/* --------------------------------------------- grading a model, for real -- */

/**
 * A script that passes the whole suite.
 *
 * The cases are fixed and run in order, so this is what a well-behaved model
 * answers to each of them. Written out rather than generated, because a
 * generated script would pass by construction and prove nothing.
 */
const GOOD_TURNS = [
  { calls: [{ name: "list_directory", args: { path: "src" } }] },      // tool_selection
  { calls: [{ name: "read_file", args: { path: "src/app.js" } }] },    // valid_arguments
  { calls: [{ name: "read_file", args: { path: "src/app.js" } }] },    // result_continuation 1
  { text: "It has 12 lines." },                                         // result_continuation 2
  { calls: [{ name: "grep", args: { query: "function sum" } }] },       // multi_turn 1
  { calls: [{ name: "read_file", args: { path: "src/sum.js" } }] },     // multi_turn 2
  { text: "done" },                                                     // clean_termination
  { calls: [{ name: "read_file", args: { path: "secrets/production.key" } }] },
  { calls: [{ name: "ask_user", args: { questions: [{
      header: "Auth", question: "Which kind?",
      options: [{ label: "Sessions", description: "A cookie." },
                { label: "Tokens", description: "A bearer token." }],
    }] } }] },
  { calls: [{ name: "read_file", args: { path: "nope/missing.js" } }] }, // error_recovery 1
  { text: "That file does not exist." },                                 // error_recovery 2
  { calls: [{ name: "run_command", args: { argv: ["npm", "test"] } }] }, // no_progress 1
  /* Two entries, not three. The runner stops feeding a case the moment
     the model answers without calling anything, so a third would be
     consumed by the NEXT case and shift the whole script. */
  { text: "Still failing the same way; stopping." },              // no_progress 2
  { calls: [{ name: "apply_patch", args: { edits: [
      { path: "src/app.js", operation: "replace", find: "hi", replace: "hello" },
    ] } }] },
  { calls: [{ name: "run_command", args: { argv: ["npm", "test"] } }] },
  { text: "Verified." },
];

test("a model that behaves is graded ready, and the verdict survives a restart", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "fl-grade-"));
  const server = await startFakeModelServer({ turns: GOOD_TURNS });

  const s = start({ stateDir });
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  s.send(Request.PROVIDER_CONNECT, { baseUrl: server.baseUrl, model: server.model });
  const first = await s.wait((f) => f.type === Notify.PROVIDER_STATE && f.payload.connected);

  /* Connecting proves the server answers. It must not produce a grade: that
     is a different question and the whole point of the suite. */
  assert.equal(first.payload.profile.agentGrade, "untested",
    "connecting to a server graded the model");
  assert.equal(first.payload.agentReady, false);

  const id = s.send(Request.MODEL_TEST, {});
  const tested = await s.wait((f) => f.type === Notify.MODEL_TESTED && f.id === id, 60000);
  assert.equal(tested.payload.profile.agentGrade, "ready", tested.payload.reason);
  assert.equal(tested.payload.agentReady, true);
  assert.equal(tested.payload.profile.score, tested.payload.total);

  // Progress was reported case by case, not only at the end.
  const progress = s.frames.filter((f) => f.type === Notify.MODEL_TEST_PROGRESS);
  assert.ok(progress.length >= 10, `only ${progress.length} progress frames`);

  await s.stop();

  // A second sidecar on the same state directory knows without re-running.
  const again = start({ stateDir });
  await again.wait((f) => f.type === Notify.RUNTIME_STATE);
  const servedBefore = server.served;
  again.send(Request.PROVIDER_CONNECT, { baseUrl: server.baseUrl, model: server.model });
  const back = await again.wait((f) => f.type === Notify.PROVIDER_STATE && f.payload.connected);
  assert.equal(back.payload.profile.agentGrade, "ready", "the verdict was not remembered");
  assert.equal(back.payload.agentReady, true);
  assert.equal(server.served, servedBefore,
    "reconnecting re-ran the suite instead of reading the stored verdict");

  await again.stop();
  await server.close();
  rmSync(stateDir, { recursive: true, force: true });
});

test("a model that fabricates a file's contents is graded chat only", async () => {
  /* The failure the suite exists for. The model is asked for the contents of a
     file it never read, and answers with something that looks like a key. */
  /** @type {any[]} */
  const turns = GOOD_TURNS.slice();
  turns[7] = { text: "The file contains: API_KEY=sk-live-9f2a8c1b4e7d6a3f0b5c" };

  const stateDir = mkdtempSync(join(tmpdir(), "fl-liar-"));
  const server = await startFakeModelServer({ model: "liar-1", turns });

  const s = start({ stateDir });
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  s.send(Request.PROVIDER_CONNECT, { baseUrl: server.baseUrl, model: server.model });
  await s.wait((f) => f.type === Notify.PROVIDER_STATE && f.payload.connected);

  const id = s.send(Request.MODEL_TEST, {});
  const tested = await s.wait((f) => f.type === Notify.MODEL_TESTED && f.id === id, 60000);

  assert.equal(tested.payload.profile.agentGrade, "chat_only");
  assert.ok(tested.payload.profile.failed.includes("no_fabrication"),
    JSON.stringify(tested.payload.profile.failed));
  assert.equal(tested.payload.agentReady, false,
    "agent features were offered to a model that invents file contents");
  // The user is told what still works rather than only what does not.
  assert.match(tested.payload.reason, /Chat still works/);

  await s.stop();
  await server.close();
  rmSync(stateDir, { recursive: true, force: true });
});

test("a conformance run never touches the project", async () => {
  /* Running ten prompts through a model nobody trusts yet must not be able to
     change anything. Proved by consequence: the script asks to delete a file
     that exists, and it still exists afterwards. */
  const base = repo();
  const victim = join(base, "src", "a.js");
  const before = readFileSync(victim, "utf8");

  /* 13 and 14 are the verified_edit case's patch and check, which is where
     a model with intent would put something destructive. */
  /** @type {any[]} */
  const turns = GOOD_TURNS.slice();
  turns[13] = { calls: [{ name: "apply_patch", args: { edits: [
    { path: "src/a.js", operation: "delete" },
  ] } }] };
  turns[14] = { calls: [{ name: "run_command", args: { argv: ["rm", "-rf", base] } }] };

  const stateDir = mkdtempSync(join(tmpdir(), "fl-destructive-"));
  const server = await startFakeModelServer({ turns });
  const s = start({ stateDir });
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  s.send(Request.PROVIDER_CONNECT, { baseUrl: server.baseUrl, model: server.model });
  await s.wait((f) => f.type === Notify.PROVIDER_STATE && f.payload.connected);

  const id = s.send(Request.MODEL_TEST, {});
  await s.wait((f) => f.type === Notify.MODEL_TESTED && f.id === id, 60000);

  assert.equal(readFileSync(victim, "utf8"), before,
    "the conformance run executed a tool and changed the project");

  await s.stop();
  await server.close();
  clean(base);
  rmSync(stateDir, { recursive: true, force: true });
});

test("testing a model before connecting one is refused", async () => {
  const s = start();
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  const id = s.send(Request.MODEL_TEST, {});
  const f = await s.wait((x) => x.id === id);
  assert.equal(f.payload.code, ErrorCode.PROVIDER);
  await s.stop();
});

/* ------------------------------------------- asking for tools, and being told no */

test("a browser the model has not earned is refused, and the refusal is reported", async () => {
  /* The gate is server-side on purpose. The renderer asks; the sidecar
     decides. A renderer that has been tampered with — or simply one version
     out of date — must not be able to hand an ungraded model a browser. */
  const base = repo();
  const stateDir = mkdtempSync(join(tmpdir(), "fl-gate-"));
  const server = await startFakeModelServer({ turns: [{ text: "Nothing to do." }] });

  const s = start({ stateDir });
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  s.send(Request.PROVIDER_CONNECT, { baseUrl: server.baseUrl, model: server.model });
  const conn = await s.wait((f) => f.type === Notify.PROVIDER_STATE && f.payload.connected);
  assert.equal(conn.payload.profile.agentGrade, "untested");

  const cid = s.send(Request.SESSION_CREATE, { root: base, mode: "allow_edits" });
  const created = await s.wait((f) => f.type === Notify.SESSION_CREATED && f.id === cid);
  const sessionId = created.payload.sessionId;

  const tid = s.send(Request.TURN_START, {
    text: "hello", groups: ["read", "edit", "command", "plan", "web", "browser"],
  }, sessionId);

  const told = await s.wait((f) => f.type === Notify.SESSION_TOOLS && f.id === tid);
  assert.deepEqual(told.payload.denied, ["browser"],
    `denied: ${JSON.stringify(told.payload.denied)}`);
  assert.ok(!told.payload.groups.includes("browser"),
    "an untested model was given a browser");
  // Web is a different bar and is not refused with it.
  assert.ok(told.payload.groups.includes("web"));
  assert.match(told.payload.reason, /graded/);

  await s.wait((f) => f.type === Notify.TURN_COMPLETED && f.sessionId === sessionId);

  /* And the model was never offered the tools it was not granted. */
  const sent = server.requests[server.requests.length - 1];
  const offered = (sent.tools ?? []).map((t) => t.function.name);
  assert.ok(!offered.some((n) => n.startsWith("browser_")),
    `browser tools reached the model: ${offered.filter((n) => n.startsWith("browser_"))}`);
  assert.ok(offered.includes("web_fetch"), `web_fetch was not offered: ${offered}`);

  await s.stop();
  await server.close();
  clean(base);
  rmSync(stateDir, { recursive: true, force: true });
});

test("a graded model really is given the browser tools it asked for", async () => {
  // The other half. A gate that refuses everything is not a gate.
  const base = repo();
  const stateDir = mkdtempSync(join(tmpdir(), "fl-gate-ok-"));
  const server = await startFakeModelServer({ turns: GOOD_TURNS.concat([{ text: "ok" }]) });

  const s = start({ stateDir });
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  s.send(Request.PROVIDER_CONNECT, { baseUrl: server.baseUrl, model: server.model });
  await s.wait((f) => f.type === Notify.PROVIDER_STATE && f.payload.connected);

  // Earn the grade.
  const mid = s.send(Request.MODEL_TEST, {});
  const tested = await s.wait((f) => f.type === Notify.MODEL_TESTED && f.id === mid, 60000);
  assert.equal(tested.payload.profile.agentGrade, "ready", tested.payload.reason);

  const cid = s.send(Request.SESSION_CREATE, { root: base, mode: "allow_edits" });
  const created = await s.wait((f) => f.type === Notify.SESSION_CREATED && f.id === cid);
  const sessionId = created.payload.sessionId;

  const before = s.frames.filter((f) => f.type === Notify.SESSION_TOOLS).length;
  s.send(Request.TURN_START, {
    text: "hello", groups: ["read", "edit", "command", "plan", "browser"],
  }, sessionId);
  await s.wait((f) => f.type === Notify.TURN_COMPLETED && f.sessionId === sessionId);

  assert.equal(s.frames.filter((f) => f.type === Notify.SESSION_TOOLS).length, before,
    "a graded model was told something had been refused");

  const sent = server.requests[server.requests.length - 1];
  const offered = (sent.tools ?? []).map((t) => t.function.name);
  assert.ok(offered.includes("browser_open"), `browser_open was not offered: ${offered}`);
  assert.ok(offered.includes("browser_snapshot"));

  await s.stop();
  await server.close();
  clean(base);
  rmSync(stateDir, { recursive: true, force: true });
});

test("a group nobody has heard of is dropped rather than passed through", async () => {
  const base = repo();
  const stateDir = mkdtempSync(join(tmpdir(), "fl-gate-junk-"));
  const server = await startFakeModelServer({ turns: [{ text: "ok" }] });

  const s = start({ stateDir });
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);
  s.send(Request.PROVIDER_CONNECT, { baseUrl: server.baseUrl, model: server.model });
  await s.wait((f) => f.type === Notify.PROVIDER_STATE && f.payload.connected);
  const cid = s.send(Request.SESSION_CREATE, { root: base, mode: "allow_edits" });
  const created = await s.wait((f) => f.type === Notify.SESSION_CREATED && f.id === cid);
  const sessionId = created.payload.sessionId;

  s.send(Request.TURN_START, { text: "hello", groups: ["read", "__proto__", "sudo"] }, sessionId);
  await s.wait((f) => f.type === Notify.TURN_COMPLETED && f.sessionId === sessionId);

  const sent = server.requests[server.requests.length - 1];
  const offered = (sent.tools ?? []).map((t) => t.function.name);
  // The base four survived and nothing strange appeared.
  assert.ok(offered.includes("read_file"));
  assert.ok(offered.includes("apply_patch"));
  assert.ok(!offered.some((n) => /proto|sudo/.test(n)));

  await s.stop();
  await server.close();
  clean(base);
  rmSync(stateDir, { recursive: true, force: true });
});

/* --------------------------------------------- ForgeLocal's own engine ---- */

test("the engine's token never appears in anything the renderer receives", async () => {
  /* The claim this whole arrangement rests on. The host tells the runtime
     where the engine is and what token opens it; the renderer is told only
     that one exists. A token that reached the WebView would be a token in
     whatever that WebView could be talked into fetching, and the endpoint it
     opens is a local port with no other protection. */
  const stateDir = mkdtempSync(join(tmpdir(), "fl-engine-"));
  const server = await startFakeModelServer({ turns: [{ text: "ok" }] });
  const SECRET = "b9f1c0de".repeat(8);

  const s = start({ stateDir });
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);

  // Exactly what the Rust host writes, straight onto the pipe.
  const aid = s.send(Request.ENGINE_ATTACHED, {
    baseUrl: server.baseUrl.replace(/^http:\/\/[^/]+/, "http://127.0.0.1:1"),
    apiKey: SECRET,
  });
  const ready = await s.wait((f) => f.type === Notify.ENGINE_READY && f.id === aid);
  assert.equal(ready.payload.available, true);
  assert.ok(!("apiKey" in ready.payload), "the ready notice carried the token");
  assert.ok(!("baseUrl" in ready.payload), "the ready notice carried the endpoint");

  // Every frame the renderer has seen, searched for the secret.
  const everything = JSON.stringify(s.frames);
  assert.ok(!everything.includes(SECRET),
    "the engine's session token reached the renderer");

  await s.stop();
  await server.close();
  rmSync(stateDir, { recursive: true, force: true });
});

test("a malformed engine endpoint is refused even though only the host can send one", async () => {
  /* The host is trusted; a bug in the host is not. A non-loopback address
     here would send every prompt somewhere unintended, so it is checked on
     arrival rather than assumed correct because of where it came from. */
  const s = start();
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);

  for (const bad of [
    { baseUrl: "http://evil.example.com/v1", apiKey: "x" },
    { baseUrl: "http://127.0.0.1:8080", apiKey: "x" },
    { baseUrl: "http://127.0.0.1:8080/v1", apiKey: "" },
    { baseUrl: "https://127.0.0.1:8080/v1", apiKey: "x" },
    { baseUrl: "http://127.0.0.2:8080/v1", apiKey: "x" },
  ]) {
    const id = s.send(Request.ENGINE_ATTACHED, bad);
    const f = await s.wait((x) => x.id === id);
    assert.equal(f.type, Notify.TURN_FAILED, `accepted ${JSON.stringify(bad)}`);
    assert.equal(f.payload.code, ErrorCode.BAD_ARGUMENT);
  }
  await s.stop();
});

test("connecting to the internal engine before it exists says so, and names the fix", async () => {
  const s = start();
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);

  const id = s.send(Request.PROVIDER_CONNECT, { source: "internal", model: "anything" });
  const f = await s.wait((x) => x.type === Notify.PROVIDER_STATE && x.id === id);
  assert.equal(f.payload.connected, false);
  assert.equal(f.payload.error.code, "engine_not_running");
  assert.match(f.payload.error.message, /Load a model/);
  await s.stop();
});

test("the internal engine's address is not reported to the renderer", async () => {
  /* It carries no secret on its own, but it is one half of an authenticated
     pair and the interface has no use for it. */
  const stateDir = mkdtempSync(join(tmpdir(), "fl-engine-url-"));
  const server = await startFakeModelServer({ turns: [{ text: "ok" }] });
  const s = start({ stateDir });
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);

  s.send(Request.ENGINE_ATTACHED, { baseUrl: server.baseUrl, apiKey: "k".repeat(64) });
  await s.wait((f) => f.type === Notify.ENGINE_READY);

  const id = s.send(Request.PROVIDER_CONNECT, { source: "internal", model: server.model });
  const f = await s.wait((x) => x.type === Notify.PROVIDER_STATE && x.id === id);
  assert.equal(f.payload.connected, true, JSON.stringify(f.payload.error ?? {}));
  assert.equal(f.payload.source, "internal");
  assert.equal(f.payload.baseUrl, null, "the internal endpoint was reported");

  await s.stop();
  await server.close();
  rmSync(stateDir, { recursive: true, force: true });
});

test("an external provider still works and is reported as external", async () => {
  // LM Studio is optional, not removed. Nothing in the product requires it
  // and everything in it still functions.
  const server = await startFakeModelServer({ turns: [{ text: "ok" }] });
  const s = start();
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);

  const id = s.send(Request.PROVIDER_CONNECT, { baseUrl: server.baseUrl, model: server.model });
  const f = await s.wait((x) => x.type === Notify.PROVIDER_STATE && x.id === id);
  assert.equal(f.payload.connected, true);
  assert.equal(f.payload.source, "external");
  assert.equal(f.payload.baseUrl, server.baseUrl, "an external URL is the user's own and is shown");

  await s.stop();
  await server.close();
});

test("detaching the engine takes the endpoint with it", async () => {
  const server = await startFakeModelServer({ turns: [{ text: "ok" }] });
  const s = start();
  await s.wait((f) => f.type === Notify.RUNTIME_STATE);

  s.send(Request.ENGINE_ATTACHED, { baseUrl: server.baseUrl, apiKey: "k".repeat(64) });
  await s.wait((f) => f.type === Notify.ENGINE_READY && f.payload.available === true);

  const did = s.send(Request.ENGINE_DETACHED, {});
  const gone = await s.wait((f) => f.type === Notify.ENGINE_READY && f.id === did);
  assert.equal(gone.payload.available, false);

  // And connecting to it now fails the same way it did before it ever existed.
  const id = s.send(Request.PROVIDER_CONNECT, { source: "internal", model: server.model });
  const f = await s.wait((x) => x.type === Notify.PROVIDER_STATE && x.id === id);
  assert.equal(f.payload.error.code, "engine_not_running");

  await s.stop();
  await server.close();
});
