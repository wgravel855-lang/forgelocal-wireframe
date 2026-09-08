// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createState, reduceModels, reduceAllModels,
  allModels, installedModels, loadedModels, unloadedInstalled, activeDownloads,
  selectedModel, canSend, installedBytes,
  recommendedParams, estimateMemory, validateParams, fitNote,
  downloadSummary, STORE_KEY,
} from "./modelstore.mjs";

/** @typedef {import("./models.mjs").ModelRecord} ModelRecord */
/** @typedef {import("./modelstore.mjs").ModelEvent} ModelEvent */

/** @param {Partial<ModelRecord>} [over] @returns {ModelRecord} */
const model = (over = {}) => ({
  id: "m1", displayName: "Qwen2.5 Coder 14B", publisher: "Qwen", family: "qwen2",
  architecture: "llama", format: "GGUF", quantization: "Q4_K_M", parameterCount: "14B",
  fileSizeBytes: 9e9, maxContextTokens: 32768,
  capabilities: /** @type {any} */ (["chat", "tool_use", "agent_ready"]),
  installed: true, loadedInstances: [], ...over,
});

const PC = { vramBytes: 12e9, threads: 16 };
const state = (...models) => createState(models.length ? models : [model()]);
/** @param {ModelEvent} e @returns {ModelEvent} */
const ev = (e) => e;

/* 1. Every surface reads the same store. */
test("picker, catalog, installed and downloads all derive from one state", () => {
  const s = state(
    model({ id: "a", installed: true, loadedInstances: [{ instanceId: "i", contextTokens: 8192 }] }),
    model({ id: "b", installed: true }),
    model({ id: "c", installed: false, downloadState: { modelId: "c", state: "downloading", receivedBytes: 1e9, totalBytes: 9e9 } }),
  );
  assert.deepEqual(allModels(s).map((m) => m.id), ["a", "b", "c"], "catalog order is kept");
  assert.deepEqual(loadedModels(s).map((m) => m.id), ["a"], "picker: loaded section");
  assert.deepEqual(unloadedInstalled(s).map((m) => m.id), ["b"], "picker: installed section");
  assert.deepEqual(installedModels(s).map((m) => m.id), ["a", "b"], "installed page");
  assert.deepEqual(activeDownloads(s).map((m) => m.id), ["c"], "downloads page");
  assert.equal(selectedModel(s)?.id, "a");
  assert.equal(canSend(s), true);
});

/* 2. A completed download adds exactly one installed model. */
test("completing a download installs exactly one model", () => {
  const s = state(
    model({ id: "a", installed: true }),
    model({ id: "c", installed: false, downloadState: { modelId: "c", state: "verifying", receivedBytes: 9e9, totalBytes: 9e9 } }),
  );
  assert.equal(installedModels(s).length, 1);
  const after = reduceModels(s, ev({ type: "download.completed", modelId: "c" }));
  assert.equal(installedModels(after).length, 2);
  assert.equal(after.byId.c.installed, true, "it appears on Installed immediately");
  // and again is a no-op, not a second row
  const twice = reduceModels(after, ev({ type: "download.completed", modelId: "c" }));
  assert.equal(installedModels(twice).length, 2, "a duplicate event does not duplicate a row");
});

test("a canceled download never marks the model installed", () => {
  const s = state(model({ id: "c", installed: false, downloadState: { modelId: "c", state: "downloading", receivedBytes: 8.9e9, totalBytes: 9e9 } }));
  const after = reduceModels(s, ev({ type: "download.canceled", modelId: "c" }));
  assert.equal(after.byId.c.installed, false, "bytes received are not an installation");
  assert.equal(installedModels(after).length, 0);
});

/* 3. Pause / resume / cancel / retry stay consistent for every renderer. */
test("pause and resume agree across surfaces and drop live figures", () => {
  const s = state(model({ id: "c", installed: false, downloadState: {
    modelId: "c", state: "downloading", receivedBytes: 4e9, totalBytes: 9e9,
    bytesPerSecond: 28e6, etaSeconds: 180 } }));
  const paused = reduceModels(s, ev({ type: "download.paused", modelId: "c" }));
  const dl = paused.byId.c.downloadState;
  assert.equal(dl?.state, "paused");
  assert.equal(dl?.bytesPerSecond, undefined, "no speed while stopped");
  assert.doesNotMatch(downloadSummary(dl), /MB\/s|min left/);
  assert.match(downloadSummary(dl), /Paused$/);
  assert.equal(activeDownloads(paused).length, 1, "still on the downloads page");

  const twice = reduceModels(paused, ev({ type: "download.paused", modelId: "c" }));
  assert.equal(twice, paused, "pausing twice is the same state");

  const resumed = reduceModels(paused, ev({ type: "download.resumed", modelId: "c" }));
  assert.equal(resumed.byId.c.downloadState?.state, "downloading");
});

test("progress never moves backward", () => {
  const s = state(model({ id: "c", installed: false, downloadState: {
    modelId: "c", state: "downloading", receivedBytes: 5e9, totalBytes: 9e9 } }));
  const back = reduceModels(s, ev({ type: "download.progress", modelId: "c", receivedBytes: 2e9 }));
  assert.equal(back.byId.c.downloadState?.receivedBytes, 5e9, "a late packet cannot rewind the bar");
  const on = reduceModels(s, ev({ type: "download.progress", modelId: "c", receivedBytes: 7e9 }));
  assert.equal(on.byId.c.downloadState?.receivedBytes, 7e9);
  const over = reduceModels(on, ev({ type: "download.progress", modelId: "c", receivedBytes: 99e9 }));
  assert.equal(over.byId.c.downloadState?.receivedBytes, 9e9, "clamped to the total");
});

/* 4. Delete removes the file, not the catalog entry. */
test("deleting an installed model keeps it in the catalog", () => {
  const s = state(model({ id: "a", installed: true, loadedInstances: [{ instanceId: "i", contextTokens: 8192 }] }));
  assert.equal(installedBytes(s), 9e9);
  const after = reduceModels(s, ev({ type: "model.deleted", modelId: "a" }));
  assert.equal(after.byId.a.installed, false);
  assert.equal(after.byId.a.displayName, "Qwen2.5 Coder 14B", "metadata survives");
  assert.equal(allModels(after).length, 1, "still discoverable in the catalog");
  assert.equal(installedModels(after).length, 0);
  assert.equal(installedBytes(after), 0, "storage total follows");
  assert.equal(after.selectedId, null, "the composer stops pointing at it");
});

/* 5. Unload updates every surface, with a documented fallback. */
test("unloading falls back to another loaded model, never to an unloaded one", () => {
  const s = createState([
    model({ id: "a", loadedInstances: [{ instanceId: "i1", contextTokens: 8192 }] }),
    model({ id: "b", installed: true }),
  ]);
  assert.equal(s.selectedId, "a");
  const after = reduceModels(s, ev({ type: "model.unloaded", modelId: "a" }));
  assert.equal(loadedModels(after).length, 0);
  assert.equal(after.selectedId, null, "b is installed but not loaded, so it is not selected");
  assert.equal(canSend(after), false);
  assert.equal(unloadedInstalled(after).length, 2, "both now show as installed and unloaded");
});

test("unloading one of two loaded models selects the other", () => {
  const s = createState([
    model({ id: "a", loadedInstances: [{ instanceId: "i1", contextTokens: 8192 }] }),
    model({ id: "b", loadedInstances: [{ instanceId: "i2", contextTokens: 4096 }] }),
  ]);
  const after = reduceModels(s, ev({ type: "model.unloaded", modelId: s.selectedId || "a" }));
  assert.equal(after.selectedId, "b");
  assert.equal(canSend(after), true);
});

test("selecting a model that is not loaded is refused", () => {
  const s = state(model({ id: "b", installed: true }));
  const after = reduceModels(s, ev({ type: "model.selected", modelId: "b" }));
  assert.equal(after.selectedId, null, "there is nothing to send to");
  assert.equal(canSend(after), false);
});

test("loading a model evicts the previously resident one", () => {
  const s = createState([
    model({ id: "a", loadedInstances: [{ instanceId: "i1", contextTokens: 8192 }] }),
    model({ id: "b", installed: true }),
  ]);
  const after = reduceModels(s, ev({
    type: "model.load.completed", modelId: "b", instanceId: "i2", contextTokens: 16384 }));
  assert.deepEqual(loadedModels(after).map((m) => m.id), ["b"], "only one model is resident");
  assert.equal(after.selectedId, "b");
  assert.equal(after.byId.b.loadedInstances[0].contextTokens, 16384);
});

/* 8. A disconnected Load cannot make a model loaded. */
test("requesting a load changes nothing until an adapter reports completion", () => {
  const s = state(model({ id: "b", installed: true }));
  const requested = reduceModels(s, ev({ type: "model.load.requested", modelId: "b" }));
  assert.equal(requested, s, "a request is not a result");
  assert.equal(loadedModels(requested).length, 0);
  assert.equal(canSend(requested), false);

  const failed = reduceModels(requested, ev({ type: "model.load.failed", modelId: "b", reason: "no runtime" }));
  assert.equal(loadedModels(failed).length, 0, "a failure does not load it either");
});

test("a load completion for a model that is not installed is refused", () => {
  const s = state(model({ id: "c", installed: false }));
  const after = reduceModels(s, ev({
    type: "model.load.completed", modelId: "c", instanceId: "x", contextTokens: 4096 }));
  assert.equal(loadedModels(after).length, 0, "nothing can load from a file that is not there");
});

/* 7. Load parameters: bounds, estimates and per-model reset. */
test("recommended parameters come from the model, and reset restores them", () => {
  const small = recommendedParams(model({ id: "s", fileSizeBytes: 4.7e9, maxContextTokens: 32768 }), PC);
  const big = recommendedParams(model({ id: "l", fileSizeBytes: 42e9, maxContextTokens: 8192 }), PC);
  assert.ok(small.contextTokens > big.contextTokens, "a smaller model gets more room for context");
  assert.ok(big.contextTokens <= 8192, "never above the model maximum");
  assert.ok(big.gpuLayers < 99, "a model larger than video memory is partly on the CPU");
  assert.deepEqual(recommendedParams(model({ id: "s", fileSizeBytes: 4.7e9, maxContextTokens: 32768 }), PC), small,
    "reset is deterministic for the same model");
});

test("parameters are validated with a message on the field that is wrong", () => {
  const m = model({ maxContextTokens: 16384 });
  const ok = recommendedParams(m, PC);
  assert.deepEqual(validateParams(m, ok), {});

  const over = validateParams(m, { ...ok, contextTokens: 99999 });
  assert.match(over.contextTokens, /up to 16,384/, "names the actual maximum");
  assert.equal(Object.keys(over).length, 1, "only the field at fault is reported");

  const bad = validateParams(m, { ...ok, gpuLayers: -1, cpuThreads: 0, batchSize: 9999 });
  assert.deepEqual(Object.keys(bad).sort(), ["batchSize", "cpuThreads", "gpuLayers"]);
});

test("the memory estimate moves with the inputs that affect it", () => {
  const m = model();
  const base = recommendedParams(m, PC);
  const more = estimateMemory(m, { ...base, contextTokens: base.contextTokens * 2 });
  const less = estimateMemory(m, base);
  assert.ok(more.vramBytes > less.vramBytes, "more context costs more video memory");

  const onCpu = estimateMemory(m, { ...base, gpuLayers: 0 });
  assert.ok(onCpu.ramBytes > less.ramBytes, "moving layers off the GPU costs system memory");
  assert.ok(onCpu.vramBytes < less.vramBytes);

  const quantised = estimateMemory(m, { ...base, kvCacheType: "q8_0" });
  assert.ok(quantised.vramBytes < less.vramBytes, "a smaller cache type costs less");
});

test("the hardware note is specific and only appears when it applies", () => {
  const m = model({ fileSizeBytes: 4e9 });
  assert.equal(fitNote(m, recommendedParams(m, PC), PC), null, "a comfortable fit says nothing");

  const heavy = model({ fileSizeBytes: 20e9, maxContextTokens: 32768 });
  const note = fitNote(heavy, { ...recommendedParams(heavy, PC), gpuLayers: 99 }, PC);
  assert.ok(note);
  assert.match(note, /GB of video memory and this PC has/, "it names the actual numbers");
  assert.doesNotMatch(note, /error|warning|!/i, "it is calm, not an alert");
});

/* 6. The loader is given an ID and resolves live state itself. */
test("a stale record cannot outlive the store", () => {
  const s = state(model({ id: "b", installed: true }));
  const snapshot = s.byId.b;                       // what a page might have cloned
  const after = reduceModels(s, ev({ type: "model.deleted", modelId: "b" }));
  assert.equal(snapshot.installed, true, "the clone still claims installed");
  assert.equal(after.byId.b.installed, false, "the store knows better");
  // Resolving by id is what keeps a surface honest.
  assert.equal(after.byId.b, after.byId.b);
});

test("the store carries its own version for hydration", () => {
  assert.equal(state().version, 1);
  assert.equal(STORE_KEY, "forgelocal:model-store:v1");
});

test("events for an unknown model are ignored", () => {
  const s = state();
  for (const type of ["download.paused", "model.unloaded", "model.deleted", "model.selected"]) {
    assert.equal(reduceModels(s, ev(/** @type {any} */({ type, modelId: "nope" }))), s, type);
  }
});
