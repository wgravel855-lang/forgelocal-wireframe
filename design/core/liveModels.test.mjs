// @ts-check
/**
 * Tests for turning real files into model records.
 *
 * Almost all of these are about the same thing: the difference between what was
 * measured and what would look plausible. A file name is not a publisher, a
 * size is not a fit, and a model being on disk is not a model being loaded.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { displayNameOf, fitVerdict, liveModelState, quantOf, recordFor } from "./liveModels.mjs";
import { createState } from "./modelstore.mjs";

const row = (over = {}) => ({ name: "qwen3-8b-Q4_K_M.gguf", bytes: 4_900_000_000, usable: true, ...over });

/* ------------------------------------------------------- 1. what is read */

test("the quantisation is read, because the name really does carry it", () => {
  assert.equal(quantOf("qwen3-8b-Q4_K_M.gguf"), "Q4_K_M");
  assert.equal(quantOf("llama-3.1-8b-instruct.IQ3_XS.gguf"), "IQ3_XS");
  assert.equal(quantOf("something-F16.gguf"), "F16");
});

test("a name with no quantisation gets none, rather than a guess", () => {
  assert.equal(quantOf("model.gguf"), undefined);
  assert.equal(quantOf("my-finetune.gguf"), undefined);
});

test("the display name drops the extension and the quantisation", () => {
  assert.equal(displayNameOf("qwen3-8b-Q4_K_M.gguf"), "qwen3-8b");
  assert.equal(displayNameOf("model.gguf"), "model");
});

/* --------------------------------------------------- 2. what is not read */

test("a publisher is never invented from a file name", () => {
  /* The whole point. "qwen3-8b-Q4_K_M.gguf" might be Qwen's, a fine-tune of
     it, or somebody's re-quantisation of that fine-tune, and on screen a
     guessed publisher looks exactly like a known one. */
  const m = recordFor(row());
  assert.equal(m.publisher, "");
  assert.equal(m.family, "");
  assert.equal(m.architecture, "");
  assert.equal(m.license, undefined);
  assert.equal(m.downloadCount, undefined);
  assert.equal(m.likeCount, undefined);
  assert.equal(m.parameterCount, undefined,
    "a parameter count was read out of a file name");
});

test("a size is real and a fit is not invented from it", () => {
  const m = recordFor(row({ fit: null }));
  assert.equal(m.fileSizeBytes, 4_900_000_000);
  assert.equal(m.hardwareFit, "unknown",
    "a fit verdict was produced with nothing measured");
});

test("every runtime verdict maps to something, and unknown stays unknown", () => {
  assert.equal(fitVerdict({ verdict: "fits" }), "excellent");
  assert.equal(fitVerdict({ verdict: "tight" }), "tight");
  assert.equal(fitVerdict({ verdict: "no" }), "unsupported");
  assert.equal(fitVerdict({ verdict: "unknown" }), "unknown");
  assert.equal(fitVerdict(null), "unknown");
  assert.equal(fitVerdict({ verdict: "something new upstream" }), "unknown",
    "an unrecognised verdict became a positive one");
});

/* ------------------------------------------------------ 3. loaded, tested */

test("a model on disk is not a model that is loaded", () => {
  const m = recordFor(row());
  assert.deepEqual(m.loadedInstances, [],
    "a file being present was treated as weights being in memory");
  assert.equal(m.installed, true);
});

test("only the model the provider reports is loaded", () => {
  const a = recordFor(row({ name: "a.gguf" }), { loaded: "b.gguf" });
  const b = recordFor(row({ name: "b.gguf" }), { loaded: "b.gguf" });
  assert.deepEqual(a.loadedInstances, []);
  assert.equal(b.loadedInstances.length, 1);
});

test("agent_ready comes from the suite, never from a file", () => {
  /* A claim about tool reliability. It is only true of a model the conformance
     suite graded, and only while that model is the one loaded. */
  assert.deepEqual(recordFor(row()).capabilities, []);
  assert.deepEqual(recordFor(row(), { agentReady: true }).capabilities, [],
    "a model that is not loaded was called agent ready");
  assert.deepEqual(
    recordFor(row({ name: "x.gguf" }), { loaded: "x.gguf", agentReady: true }).capabilities,
    ["agent_ready"]);
});

/* ----------------------------------------------------- 4. the broken file */

test("a file that is not a model is listed, and says so", () => {
  /* Hiding it means someone watches a download succeed and then cannot find
     what it produced. */
  const m = recordFor(row({ usable: false, problem: "This is an HTML error page, not a model." }));
  assert.equal(m.format, "other");
  assert.match(m.problem, /HTML error page/);
});

test("an unusable file with no stated reason still gets one", () => {
  const m = recordFor(row({ usable: false, problem: undefined }));
  assert.ok(m.problem, "a broken file was listed with no explanation");
});

/* --------------------------------------------------------- 5. the store */

test("an empty folder produces an empty store, not a seeded one", () => {
  /* The bug this replaces: the pages showed a catalogue of models that were
     not on the machine, on a machine with none. */
  const s = liveModelState({ models: [] });
  assert.deepEqual(s.order, []);
  assert.deepEqual(s.byId, {});
  assert.equal(s.selectedId, null);
});

test("a missing or malformed payload is empty rather than thrown", () => {
  for (const bad of [null, {}, { models: null }, { models: "nope" }]) {
    const s = liveModelState(/** @type {any} */ (bad));
    assert.deepEqual(s.order, [], `${JSON.stringify(bad)} did not produce an empty store`);
  }
});

test("the state is the shape the existing pages already read", () => {
  /* The reason this file exists rather than a rewrite of the model pages:
     they take this shape, and they keep taking it. */
  const s = liveModelState({ models: [row({ name: "a.gguf" }), row({ name: "b.gguf" })] });
  /* Compared against the real store rather than against a copied constant, so
     a version bump in modelstore fails here instead of silently producing a
     store the pages discard as stale. */
  assert.equal(s.version, createState([]).version,
    "the store version drifted from modelstore's");
  assert.deepEqual(Object.keys(s).sort(), Object.keys(createState([])).sort(),
    "the live store has different fields from the one the pages read");
  assert.deepEqual(s.order, ["a.gguf", "b.gguf"]);
  assert.equal(s.byId["a.gguf"].id, "a.gguf");
});

test("the loaded model is the selected one", () => {
  const s = liveModelState(
    { models: [row({ name: "a.gguf" }), row({ name: "b.gguf" })] },
    { loaded: "b.gguf" });
  assert.equal(s.selectedId, "b.gguf");
});
