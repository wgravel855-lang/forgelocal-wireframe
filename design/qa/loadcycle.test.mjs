// @ts-check
/**
 * The load cycle across both stores, in the order a user drives it.
 *
 * The audit found Load on My models produced no state change and no dialog,
 * while the composer's picker opened the loader correctly. Both entry points
 * now dispatch the same action, and the states below are what every surface
 * reads afterwards: there is no separate path for one page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createState, reduceModels, clearLoaded, isLoaded, canSend,
  installedModels, unloadedInstalled, loadedModels, selectedModel,
} from "../core/modelstore.mjs";
import {
  initialRuntime, reduceRuntime, isConnected, loadedModel, runtimeLabel,
} from "../core/runtime.mjs";
import { composerModelLabel, installedList, pickerHtml } from "../core/modelviews.mjs";
import { THIS_PC } from "../core/machine.mjs";

/** @param {Partial<import("../core/models.mjs").ModelRecord>} [over] */
const model = (over = {}) => ({
  id: "m1", displayName: "Qwen2.5 Coder 14B", publisher: "Qwen", family: "qwen2",
  architecture: "llama", format: /** @type {'GGUF'} */ ("GGUF"), quantization: "Q4_K_M",
  fileSizeBytes: 9 * 1024 ** 3, maxContextTokens: 32768,
  capabilities: /** @type {any} */ (["chat"]), installed: true, loadedInstances: [], ...over,
});

const device = { name: "RTX 4070" };
const instance = { modelId: "m1", displayName: "Qwen2.5 Coder 14B", contextTokens: 8192 };

test("on disk to loading to loaded to ejected and back to on disk", () => {
  let models = createState([model()]);
  let runtime = reduceRuntime(initialRuntime("desktop"), { type: "runtime.ready", version: "v1", device });

  // on disk
  assert.deepEqual(unloadedInstalled(models).map((m) => m.id), ["m1"]);
  assert.equal(canSend(models), false);
  assert.equal(composerModelLabel(models), "No model loaded");
  assert.match(installedList(models, THIS_PC), /data-load-model="m1"/, "the row offers Load");

  // loading: requested is not loaded, on either side
  models = reduceModels(models, { type: "model.load.requested", modelId: "m1" });
  runtime = reduceRuntime(runtime, { type: "runtime.model.loading", modelId: "m1" });
  assert.equal(isLoaded(models.byId.m1), false, "a request does not load a model");
  assert.equal(loadedModel(runtime), null);
  assert.equal(runtimeLabel(runtime), "Loading model");
  assert.equal(composerModelLabel(models), "No model loaded");

  // loaded: only an adapter event gets here
  models = reduceModels(models, {
    type: "model.load.completed", modelId: "m1", instanceId: "i1", contextTokens: 8192,
  });
  runtime = reduceRuntime(runtime, { type: "runtime.model.loaded", model: instance });
  assert.deepEqual(loadedModels(models).map((m) => m.id), ["m1"]);
  assert.equal(canSend(models), true);
  assert.equal(composerModelLabel(models), "Qwen2.5 Coder 14B");
  assert.equal(selectedModel(models)?.id, "m1");
  assert.match(installedList(models, THIS_PC), /model\.unloaded/, "the row now offers Eject");
  assert.doesNotMatch(installedList(models, THIS_PC), /data-load-model/, "and no longer Load");
  assert.match(pickerHtml(models, THIS_PC), /data-model-row/, "the picker can select it");

  // ejected
  models = reduceModels(models, { type: "model.unloaded", modelId: "m1" });
  runtime = reduceRuntime(runtime, { type: "runtime.model.unloaded" });
  assert.equal(isLoaded(models.byId.m1), false);
  assert.equal(canSend(models), false);
  assert.equal(composerModelLabel(models), "No model loaded");
  assert.equal(runtimeLabel(runtime), "Runtime ready");

  // back on disk, still installed
  assert.deepEqual(installedModels(models).map((m) => m.id), ["m1"]);
  assert.match(installedList(models, THIS_PC), /data-load-model="m1"/);
});

test("with no runtime, a load request changes nothing a surface can read", () => {
  const runtime = initialRuntime("web-preview");
  let models = clearLoaded(createState([model()]));
  const before = models;

  models = reduceModels(models, { type: "model.load.requested", modelId: "m1" });
  assert.equal(models, before, "the request is inert until an adapter answers");
  assert.equal(isConnected(runtime), false);
  assert.equal(composerModelLabel(models), "No model loaded");
  // and the entry point is still there: the row must never look inert
  assert.match(installedList(models, THIS_PC), /data-load-model="m1"/);
});

test("both entry points name the same action for the same model", () => {
  const models = clearLoaded(createState([model()]));
  const fromInstalled = installedList(models, THIS_PC).match(/data-load-model="([^"]+)"/);
  const fromPicker = pickerHtml(models, THIS_PC).match(/data-load-model="([^"]+)"/);
  assert.ok(fromInstalled && fromPicker, "both surfaces expose a load entry point");
  assert.equal(fromInstalled[1], fromPicker[1], "and both address the same model");
});

test("a failed load leaves the model on disk and says so", () => {
  let models = createState([model()]);
  let runtime = reduceRuntime(initialRuntime("desktop"), { type: "runtime.ready", version: "v1", device });
  runtime = reduceRuntime(runtime, { type: "runtime.model.loading", modelId: "m1" });

  models = reduceModels(models, { type: "model.load.failed", modelId: "m1", reason: "Out of video memory." });
  runtime = reduceRuntime(runtime, { type: "runtime.failed", message: "Out of video memory." });

  assert.equal(isLoaded(models.byId.m1), false, "a failure never marks a model loaded");
  assert.equal(models.byId.m1.installed, true, "and never removes it from disk");
  assert.equal(canSend(models), false);
  assert.equal(runtimeLabel(runtime), "Runtime error");
});

test("losing the runtime cannot leave a model looking loaded", () => {
  let models = reduceModels(createState([model()]), {
    type: "model.load.completed", modelId: "m1", instanceId: "i1", contextTokens: 8192,
  });
  assert.equal(canSend(models), true);

  // the runtime goes away; the model store must follow, not contradict it
  const runtime = reduceRuntime(
    reduceRuntime(initialRuntime("desktop"), { type: "runtime.ready", version: "v1", device }),
    { type: "runtime.disconnected" });
  assert.equal(isConnected(runtime), false);

  models = clearLoaded(models);
  assert.equal(canSend(models), false);
  assert.equal(composerModelLabel(models), "No model loaded");
  assert.equal(models.byId.m1.installed, true);
});
