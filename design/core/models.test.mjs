// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDownloadAction, canTransition, downloadSummary, downloadPercent,
  createStore, loadedModels, installedUnloaded, selectedModel, canSend,
  downloadAction, deleteInstalled, isAgentReady, isLoaded,
} from "./models.mjs";

/** @typedef {import("./models.mjs").DownloadView} DownloadView */
/** @typedef {import("./models.mjs").ModelRecord} ModelRecord */

/** @param {Partial<DownloadView>} [over] @returns {DownloadView} */
const dl = (over = {}) => ({
  modelId: "m1", state: "downloading", receivedBytes: 4.13e9, totalBytes: 9.4e9,
  bytesPerSecond: 28.6e6, etaSeconds: 180, ...over,
});

/** @param {Partial<ModelRecord>} [over] @returns {ModelRecord} */
const model = (over = {}) => ({
  id: "m1", displayName: "Qwen2.5 Coder 14B", publisher: "Qwen", family: "qwen2",
  architecture: "llama", format: "GGUF", quantization: "Q4_K_M",
  fileSizeBytes: 8.99e9, maxContextTokens: 32768,
  capabilities: /** @type {import("./events.mjs").ModelCapability[]} */ (["chat", "tool_use", "agent_ready"]),
  installed: true, loadedInstances: [], ...over,
});

/* 6. Download pause / resume / cancel / retry transitions. */
test("pause stops reporting a speed and an estimate", () => {
  const paused = applyDownloadAction(dl(), "pause");
  assert.equal(paused.state, "paused");
  assert.equal(paused.bytesPerSecond, undefined);
  assert.equal(paused.etaSeconds, undefined);
  assert.equal(paused.receivedBytes, 4.13e9, "paused keeps the bytes already on disk");
  assert.match(downloadSummary(paused), /Paused$/);
  assert.doesNotMatch(downloadSummary(paused), /MB\/s|min left/);
});

test("resume restores downloading and pause is idempotent", () => {
  const paused = applyDownloadAction(dl(), "pause");
  const again = applyDownloadAction(paused, "pause");
  assert.equal(again, paused, "a second pause returns the identical object");
  assert.equal(applyDownloadAction(paused, "resume").state, "downloading");
});

test("cancel discards progress and cannot be resumed", () => {
  const canceled = applyDownloadAction(dl(), "cancel");
  assert.equal(canceled.state, "canceled");
  assert.equal(canceled.receivedBytes, 0);
  assert.equal(applyDownloadAction(canceled, "resume"), canceled, "resume is not legal from canceled");
  assert.equal(applyDownloadAction(canceled, "retry").state, "queued");
});

test("retry from failed requeues, and illegal transitions are refused", () => {
  const failed = applyDownloadAction(dl(), "fail", { failure: "Not enough disk" });
  assert.equal(failed.state, "failed");
  assert.match(downloadSummary(failed), /Not enough disk/);
  assert.equal(applyDownloadAction(failed, "retry").state, "queued");
  assert.equal(applyDownloadAction(failed, "pause"), failed);
  assert.equal(canTransition("completed", "downloading"), false);
});

test("verifying is a distinct state before completed", () => {
  const verifying = applyDownloadAction(dl(), "verify");
  assert.equal(verifying.state, "verifying");
  assert.match(downloadSummary(verifying), /Verifying/);
  const done = applyDownloadAction(verifying, "finish");
  assert.equal(done.state, "completed");
  assert.equal(done.receivedBytes, done.totalBytes);
  assert.equal(downloadPercent(done), 100);
});

/* 9. One store shared by picker, catalog, installed and downloads. */
test("a completed download immediately marks the model installed", () => {
  const store = createStore([model({ installed: false, downloadState: dl({ state: "verifying" }) })]);
  assert.equal(store.byId.m1.installed, false);
  const after = downloadAction(store, "m1", "finish");
  assert.equal(after.byId.m1.installed, true, "installed page and downloads page read the same record");
  assert.equal(installedUnloaded(after).length, 1);
});

test("deleting an installed file keeps the catalog entry", () => {
  const store = createStore([model({ loadedInstances: [{ instanceId: "i1", contextTokens: 16384 }] })]);
  assert.equal(loadedModels(store).length, 1);
  assert.equal(store.selectedId, "m1");
  const after = deleteInstalled(store, "m1");
  assert.equal(after.byId.m1.installed, false);
  assert.equal(after.byId.m1.loadedInstances.length, 0);
  assert.ok(after.byId.m1.displayName, "the catalog record survives");
  assert.equal(after.selectedId, null, "the composer stops pointing at a deleted model");
});

test("send is disabled until a model is actually loaded", () => {
  const unloaded = createStore([model()]);
  assert.equal(unloaded.selectedId, null);
  assert.equal(canSend(unloaded), false);

  const loaded = createStore([model({ loadedInstances: [{ instanceId: "i1", contextTokens: 16384 }] })]);
  assert.equal(canSend(loaded), true);
  const sel = selectedModel(loaded);
  assert.ok(sel);
  assert.equal(sel.id, "m1");
  assert.equal(isLoaded(sel), true);
});

test("agent_ready is a capability, not every model", () => {
  assert.equal(isAgentReady(model()), true);
  assert.equal(isAgentReady(model({ capabilities: ["chat"] })), false);
});

test("download actions on an unknown or non-downloading model are no-ops", () => {
  const store = createStore([model()]);
  assert.equal(downloadAction(store, "m1", "pause"), store, "no download to pause");
  assert.equal(downloadAction(store, "nope", "pause"), store);
});
