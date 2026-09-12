// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHostClient, hasTauri, Notify, Request, PROTOCOL_VERSION, NO_HOST } from "./hostclient.mjs";

/** A transport that records frames and lets a test answer them. */
function fakeTransport() {
  /** @type {any[]} */
  const sent = [];
  /** @type {(f:any)=>void} */
  let onFrame = () => {};
  return {
    sent,
    started: 0,
    stopped: 0,
    /** @type {string|null} */
    picked: null,
    async start() { this.started++; return 4242; },
    async stop() { this.stopped++; },
    async info() { return { running: true, protocol: PROTOCOL_VERSION }; },
    async send(frame) { sent.push(frame); },
    async chooseProject() { return this.picked; },
    onFrame(fn) { onFrame = fn; return () => {}; },
    /** deliver a frame from the runtime */
    emit(frame) { onFrame(frame); },
    reply(id, type, payload = {}) { onFrame({ v: PROTOCOL_VERSION, id, type, payload }); },
    lastId() { return sent[sent.length - 1]?.id; },
  };
}

test("no desktop host means no runtime, and it says so", () => {
  assert.equal(hasTauri(/** @type {any} */ ({})), false);
  assert.equal(hasTauri(undefined), false);
  assert.equal(hasTauri(/** @type {any} */ ({ __TAURI_INTERNALS__: { invoke: () => {} } })), true);
  // The disconnected copy is a fact, not a placeholder.
  assert.equal(NO_HOST.connected, false);
  assert.match(NO_HOST.detail, /cannot read your files or run anything/);
});

test("every outgoing frame carries the version, an id and the session", async () => {
  const t = fakeTransport();
  const c = createHostClient({ transport: t });
  await c.connect();
  // Nothing answers this one; it is only here to inspect the frame it sent. Its
  // rejection is caught so the timeout does not surface as an unhandled one.
  c.connectProvider("http://127.0.0.1:1234/v1", "m").catch(() => {});
  const f = t.sent[0];
  assert.equal(f.v, PROTOCOL_VERSION);
  assert.equal(f.type, Request.PROVIDER_CONNECT);
  assert.ok(f.id, "an id is present");
  assert.equal(f.payload.model, "m");
});

test("a reply resolves the request that asked for it", async () => {
  const t = fakeTransport();
  const c = createHostClient({ transport: t });
  await c.connect();
  const p = c.connectProvider("http://x/v1", "m");
  t.reply(t.lastId(), Notify.PROVIDER_STATE, { connected: true, models: ["m"], model: "m" });
  const frame = await p;
  assert.equal(frame.payload.connected, true);
  assert.deepEqual(c.provider.models, ["m"]);
});

test("turn.failed rejects with the runtime's own message and code", async () => {
  const t = fakeTransport();
  const c = createHostClient({ transport: t });
  await c.connect();
  const p = c.startTurn("do something");
  t.reply(t.lastId(), Notify.TURN_FAILED, { code: "provider", message: "Connect to a model first." });
  await assert.rejects(() => p, (/** @type {any} */ e) => {
    assert.equal(e.message, "Connect to a model first.");
    assert.equal(e.code, "provider");
    return true;
  });
});

test("the session id from session.created is attached to later frames", async () => {
  const t = fakeTransport();
  const c = createHostClient({ transport: t });
  await c.connect();
  const p = c.createSession("C:/proj", "manual");
  t.emit({ v: PROTOCOL_VERSION, id: t.lastId(), type: Notify.SESSION_CREATED, payload: { sessionId: "s-1", root: "C:/proj" } });
  await p;
  assert.equal(c.sessionId, "s-1");

  c.startTurn("hello");
  assert.equal(t.sent[t.sent.length - 1].sessionId, "s-1");
});

test("agent events reach the consumer unchanged", async () => {
  const seen = [];
  const t = fakeTransport();
  const c = createHostClient({ transport: t, onAgentEvent: (e) => seen.push(e) });
  await c.connect();
  t.emit({ v: PROTOCOL_VERSION, id: null, type: Notify.AGENT_EVENT, payload: { type: "tool_started", sequence: 7 } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].sequence, 7);
});

test("permission and question requests are surfaced separately from events", async () => {
  const perms = []; const qs = [];
  const t = fakeTransport();
  const c = createHostClient({ transport: t, onPermission: (p) => perms.push(p), onQuestion: (q) => qs.push(q) });
  await c.connect();
  t.emit({ v: PROTOCOL_VERSION, id: null, type: Notify.PERMISSION_REQUESTED, payload: { requestId: "p1", risk: "confirm" } });
  t.emit({ v: PROTOCOL_VERSION, id: null, type: Notify.QUESTION_REQUESTED, payload: { question: "Which file?" } });
  assert.equal(perms[0].requestId, "p1");
  assert.equal(qs[0].question, "Which file?");
});

test("a fatal runtime state rejects everything in flight instead of hanging", async () => {
  const t = fakeTransport();
  const states = [];
  const c = createHostClient({ transport: t, onRuntimeState: (s) => states.push(s) });
  await c.connect();

  const a = c.startTurn("one");
  const b = c.startTurn("two");
  t.emit({
    v: PROTOCOL_VERSION, id: null, type: Notify.RUNTIME_STATE,
    payload: { connected: false, fatal: true, error: { code: "sidecar_exited", message: "The runtime process stopped." } },
  });

  await assert.rejects(() => a, /The runtime process stopped/);
  await assert.rejects(() => b, /The runtime process stopped/);
  assert.equal(c.runtime.connected, false);
  assert.equal(c.sessionId, null, "the dead session is not still selected");
});

test("a transport failure rejects rather than leaving the caller waiting", async () => {
  const t = fakeTransport();
  t.send = async () => { throw new Error("the pipe is closed"); };
  const c = createHostClient({ transport: t });
  await c.connect();
  await assert.rejects(() => c.startTurn("hi"), /the pipe is closed/);
});

test("frames from a different protocol version are ignored", async () => {
  const seen = [];
  const t = fakeTransport();
  const c = createHostClient({ transport: t, onAgentEvent: (e) => seen.push(e) });
  await c.connect();
  t.emit({ v: 99, id: null, type: Notify.AGENT_EVENT, payload: { type: "tool_started" } });
  assert.equal(seen.length, 0);
});

test("the project path comes from the host dialog, never from the renderer", async () => {
  const t = fakeTransport();
  t.picked = "C:/Users/me/projects/task-tracker";
  const c = createHostClient({ transport: t });
  await c.connect();
  assert.equal(await c.chooseProject(), "C:/Users/me/projects/task-tracker");
  // and a cancelled dialog is null, not an empty path that would resolve to the drive root
  t.picked = null;
  assert.equal(await c.chooseProject(), null);
});

test("dispose tears down the session and stops the runtime", async () => {
  const t = fakeTransport();
  const c = createHostClient({ transport: t });
  await c.connect();
  const p = c.createSession("C:/proj", "manual");
  t.emit({ v: PROTOCOL_VERSION, id: t.lastId(), type: Notify.SESSION_CREATED, payload: { sessionId: "s-9" } });
  await p;

  const done = c.dispose();
  // the dispose frame goes out, then the transport is stopped
  const disposeFrame = t.sent.find((f) => f.type === Request.SESSION_DISPOSE);
  assert.equal(disposeFrame.sessionId, "s-9");
  t.reply(disposeFrame.id, Notify.TURN_COMPLETED, { disposed: true });
  await done;
  assert.equal(t.stopped, 1);
});

test("a turn has no client-side timeout, because a model may take minutes", async () => {
  const t = fakeTransport();
  const c = createHostClient({ transport: t });
  await c.connect();
  const p = c.startTurn("a long task");
  // nothing resolves it; the promise must simply still be pending
  const raced = await Promise.race([p.then(() => "settled"), new Promise((r) => setTimeout(() => r("pending"), 150))]);
  assert.equal(raced, "pending", "a turn was given a timeout it should not have");
});
