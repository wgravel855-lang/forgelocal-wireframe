// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectEnvironment, initialRuntime, reduceRuntime, isConnected, loadedModel,
  runtimeLabel, runtimeTone, runtimeDetails, contextDisplay, sendBlockedReason,
} from "./runtime.mjs";

/** Every string any surface can print for a disconnected runtime. */
const surfaceText = (r) => {
  const d = runtimeDetails(r);
  return [
    runtimeLabel(r), d.title, d.body,
    ...d.rows.flat(),
    contextDisplay(r).text, contextDisplay(r).label,
    sendBlockedReason(r, false),
  ].join(" | ");
};

/* The exact fixture strings that were on screen at the same time as
   "No model loaded". None may survive anywhere a disconnected runtime renders. */
const FIXTURE_CLAIMS = [
  /Runtime healthy/i,
  /llama\.cpp/i,
  /b4021/,
  /11\.1 GB/,
  /13\.7 GB/,
  /Qwen/i,
  /\b34%/,
  /RTX/i,
];

test("the web preview is detected without any component asking", () => {
  assert.equal(detectEnvironment({}), "web-preview");
  assert.equal(detectEnvironment({ forgelocalDesktop: true }), "desktop");
});

test("a disconnected runtime gives every surface the same answer", () => {
  const r = initialRuntime("web-preview");
  assert.equal(r.status, "disconnected");
  assert.equal(isConnected(r), false);
  assert.equal(loadedModel(r), null);
  assert.equal(runtimeLabel(r), "Desktop not connected");
  assert.equal(runtimeTone(r), "", "no green dot without a handshake");

  const text = surfaceText(r);
  for (const claim of FIXTURE_CLAIMS) {
    assert.doesNotMatch(text, claim, `a disconnected runtime rendered ${claim}`);
  }
});

test("no version, device or model can be printed from a disconnected state", () => {
  const d = runtimeDetails(initialRuntime("web-preview"));
  assert.deepEqual(d.rows, [], "there is no field to print a sample value from");
  assert.match(d.body, /desktop app/i);
});

test("context has no percentage until a model supplies a window", () => {
  const off = contextDisplay(initialRuntime("web-preview"));
  assert.equal(off.text, "—");
  assert.equal(off.percent, null);
  assert.match(off.label, /unavailable until a model is loaded/);
});

test("a web preview cannot be talked into a connected state", () => {
  let r = initialRuntime("web-preview");
  for (const event of /** @type {any[]} */ ([
    { type: "runtime.connecting" },
    { type: "runtime.ready", version: "llama.cpp b4021", device: { name: "RTX 4070" } },
    { type: "runtime.model.loaded", model: { modelId: "m1", displayName: "Qwen", contextTokens: 8192 } },
  ])) {
    r = reduceRuntime(r, event);
    assert.equal(r.status, "disconnected", `${event.type} upgraded a web preview`);
  }
  assert.doesNotMatch(surfaceText(r), /b4021|RTX|Qwen/);
});

test("the desktop handshake is the only thing that produces a version", () => {
  const device = { name: "RTX 4070", vramBytes: 12 * 1024 ** 3 };
  let r = reduceRuntime(initialRuntime("desktop"), { type: "runtime.connecting" });
  assert.equal(r.status, "connecting");

  r = reduceRuntime(r, { type: "runtime.ready", version: "llama.cpp b4021", device });
  assert.equal(r.status, "ready");
  assert.equal(isConnected(r), true);
  assert.deepEqual(runtimeDetails(r).rows, [["Runtime", "llama.cpp b4021"], ["Runs on", "RTX 4070"]]);
  // Ready is not loaded: there is still nothing to send to.
  assert.equal(loadedModel(r), null);
  assert.match(sendBlockedReason(r, false), /No model is loaded/);
});

test("load, run and eject move one state, and each surface reads it", () => {
  const device = { name: "RTX 4070" };
  const model = { modelId: "m1", displayName: "Qwen2.5 Coder 14B", contextTokens: 8192, vramBytes: 9 * 1024 ** 3 };
  let r = reduceRuntime(initialRuntime("desktop"), { type: "runtime.ready", version: "v1", device });

  r = reduceRuntime(r, { type: "runtime.model.loading", modelId: "m1" });
  assert.equal(r.status, "loading");
  assert.equal(loadedModel(r), null, "loading is not loaded");

  r = reduceRuntime(r, { type: "runtime.model.loaded", model });
  assert.equal(r.status, "loaded");
  assert.equal(contextDisplay(r, { usedTokens: 4096 }).text, "50%");
  assert.equal(sendBlockedReason(r, true), "", "nothing blocks send once a model is loaded");

  r = reduceRuntime(r, { type: "runtime.run.started", runId: "run-1" });
  assert.equal(r.status, "busy");
  assert.equal(runtimeLabel(r), "Running");

  r = reduceRuntime(r, { type: "runtime.run.ended" });
  assert.equal(r.status, "loaded");

  r = reduceRuntime(r, { type: "runtime.model.unloaded" });
  assert.equal(r.status, "ready");
  assert.equal(loadedModel(r), null);
  assert.equal(contextDisplay(r).text, "—", "ejecting takes the percentage away with the model");
});

test("a failure keeps its message and drops every claim", () => {
  const device = { name: "RTX 4070" };
  let r = reduceRuntime(initialRuntime("desktop"), { type: "runtime.ready", version: "v1", device });
  r = reduceRuntime(r, { type: "runtime.failed", message: "The runtime exited while loading." });
  assert.equal(r.status, "error");
  assert.equal(runtimeTone(r), "bad");
  assert.match(runtimeDetails(r).body, /exited while loading/);
  assert.deepEqual(runtimeDetails(r).rows, [], "an error state carries no device or version");
});

test("disconnecting is idempotent by identity", () => {
  const r = initialRuntime("web-preview");
  assert.equal(reduceRuntime(r, { type: "runtime.disconnected" }), r);
});
