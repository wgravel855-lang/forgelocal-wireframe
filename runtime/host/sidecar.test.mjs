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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION, Request, Notify, ErrorCode, createDecoder } from "./protocol.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SIDECAR = join(here, "sidecar.mjs");

/** A live sidecar with a frame queue and a wait-for helper. */
function start() {
  const child = spawn(process.execPath, [SIDECAR], {
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
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
    get frames() { return frames; },
    get stderr() { return stderr; },
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
