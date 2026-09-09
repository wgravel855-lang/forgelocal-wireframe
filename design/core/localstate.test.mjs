// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readDemoFlag, desktopState, catalogOnly, applyDesktopState,
  canJudgeFit, DEMO_HARDWARE, NO_HARDWARE_NOTE, DEMO_KEY,
} from "./localstate.mjs";
import { initialRuntime, reduceRuntime } from "./runtime.mjs";
import { createState, installedModels, activeDownloads, loadedModels, canSend } from "./modelstore.mjs";

/** @param {Partial<import("./models.mjs").ModelRecord>} [over] */
const model = (over = {}) => ({
  id: "m1", displayName: "Qwen2.5 Coder 14B", publisher: "Qwen", family: "qwen2",
  architecture: "llama", format: /** @type {'GGUF'} */ ("GGUF"), quantization: "Q4_K_M",
  fileSizeBytes: 9e9, maxContextTokens: 32768,
  capabilities: /** @type {any} */ (["chat", "tool_use"]),
  installed: true, loadedInstances: [{ instanceId: "i", contextTokens: 8192 }],
  downloadState: /** @type {any} */ ({ modelId: "m1", state: "downloading", receivedBytes: 4e9, totalBytes: 9e9, bytesPerSecond: 28.6e6, etaSeconds: 180 }),
  ...over,
});

const web = initialRuntime("web-preview");

test("a disconnected preview has no hardware to judge anything against", () => {
  const d = desktopState(web, false);
  assert.equal(d.connection, "disconnected");
  assert.equal(d.hardware, null);
  assert.equal(canJudgeFit(d), false);
  assert.match(NO_HARDWARE_NOTE, /Connect the desktop app/);
});

test("catalogOnly keeps the catalog facts and drops every local claim", () => {
  const c = catalogOnly(model());
  // kept: what the catalog knows
  assert.equal(c.displayName, "Qwen2.5 Coder 14B");
  assert.equal(c.publisher, "Qwen");
  assert.equal(c.fileSizeBytes, 9e9);
  assert.deepEqual(c.capabilities, ["chat", "tool_use"]);
  // dropped: what only a machine knows
  assert.equal(c.installed, false);
  assert.deepEqual(c.loadedInstances, []);
  assert.equal(c.downloadState, undefined);
});

test("the normal web state consumes no local fixture", () => {
  const d = desktopState(web, false);
  const s = createState(applyDesktopState([model()], d));
  assert.deepEqual(installedModels(s), [], "nothing is installed");
  assert.deepEqual(loadedModels(s), [], "nothing is loaded");
  assert.deepEqual(activeDownloads(s), [], "nothing is downloading");
  assert.equal(canSend(s), false);
  // and no speed or estimate survives anywhere in the state
  assert.doesNotMatch(JSON.stringify(s), /bytesPerSecond|etaSeconds/);
});

test("demo mode restores the fixtures and carries one labelled machine", () => {
  const d = desktopState(web, true);
  assert.equal(d.demo, true);
  assert.equal(d.hardware, DEMO_HARDWARE);
  assert.equal(canJudgeFit(d), true);
  assert.match(DEMO_HARDWARE.label, /RTX 4070/);

  const s = createState(applyDesktopState([model()], d));
  assert.equal(installedModels(s).length, 1);
  assert.equal(activeDownloads(s).length, 1);
});

test("demo is opt-in per visit and never the default", () => {
  const none = { getItem: () => null };
  assert.equal(readDemoFlag({ search: "" }, none), false);
  assert.equal(readDemoFlag({ search: "?model=a" }, none), false);
  assert.equal(readDemoFlag({ search: "?demo=1" }, none), true);
  // an explicit 0 beats a stored yes, so the flag can always be turned off
  assert.equal(readDemoFlag({ search: "?demo=0" }, { getItem: () => "1" }), false);
  assert.equal(readDemoFlag({ search: "" }, { getItem: (k) => (k === DEMO_KEY ? "1" : null) }), true);
});

test("a real handshake, not the demo flag, is what makes the connection ready", () => {
  let r = reduceRuntime(initialRuntime("desktop"), { type: "runtime.connecting" });
  assert.equal(desktopState(r, false).connection, "connecting");
  r = reduceRuntime(r, { type: "runtime.ready", version: "v1", device: { name: "RTX 4070" } });
  assert.equal(desktopState(r, false).connection, "ready");
  // demo mode never claims a connection it does not have
  assert.equal(desktopState(web, true).connection, "disconnected");
});

test("an errored runtime is not treated as connected", () => {
  const r = reduceRuntime(initialRuntime("desktop"), { type: "runtime.failed", message: "gone" });
  const d = desktopState(r, false);
  assert.equal(d.connection, "error");
  assert.equal(canJudgeFit(d), false);
});
