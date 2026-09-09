// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { localViewState, catalogViewState, showsRows, showsDetail } from "./viewstate.mjs";
import { desktopState } from "./localstate.mjs";
import { initialRuntime, reduceRuntime } from "./runtime.mjs";

const OFF = desktopState(initialRuntime("web-preview"), false);
const CONNECTING = desktopState(
  reduceRuntime(initialRuntime("desktop"), { type: "runtime.connecting" }), false);
const READY = desktopState(
  reduceRuntime(initialRuntime("desktop"), { type: "runtime.ready", version: "v", device: { name: "d" } }), false);
const ERRORED = desktopState(
  reduceRuntime(initialRuntime("desktop"), { type: "runtime.failed", message: "gone" }), false);

/** Exactly one state, always. */
const one = (s) => {
  assert.ok(s.kind, "a state was returned");
  return s;
};

test("disconnected is never described as empty", () => {
  for (const view of /** @type {const} */ (["installed", "downloads"])) {
    const s = one(localViewState(view, OFF, 0, 0, ""));
    assert.equal(s.kind, "disconnected");
    assert.equal(s.heading, "Desktop app not connected");
    // The preview has not read a disk, so it cannot say what is on one.
    assert.doesNotMatch(JSON.stringify(s), /this device|installed yet|No downloads yet/);
    assert.equal(s.searchable, false, "there is no local dataset to search");
  }
});

test("connected and empty is a different state from disconnected", () => {
  const inst = localViewState("installed", READY, 0, 0, "");
  assert.equal(inst.kind, "empty");
  assert.equal(inst.heading, "No models installed yet");
  assert.equal(inst.action?.label, "Browse models");

  const dl = localViewState("downloads", READY, 0, 0, "");
  assert.equal(dl.kind, "empty");
  assert.equal(dl.heading, "No downloads yet");
  // and it never invites a download the preview cannot perform
  assert.doesNotMatch(JSON.stringify(dl), /Start one from Explore/);
});

test("search no-results only appears when a query was actually typed", () => {
  // populated data, empty query, zero matches is not reachable, but an empty
  // query must never produce search copy even if it were
  assert.equal(localViewState("installed", READY, 2, 2, "").kind, "ready");
  assert.equal(localViewState("installed", READY, 2, 0, "   ").kind, "ready");
  const s = localViewState("installed", READY, 2, 0, "zzz");
  assert.equal(s.kind, "no-results");
  assert.match(s.heading || "", /No installed models match “zzz”/);
  assert.equal(s.action?.action, "clear-search");
});

test("connecting and error are their own states, not empty copy", () => {
  assert.equal(localViewState("installed", CONNECTING, 0, 0, "").kind, "connecting");
  const e = localViewState("downloads", ERRORED, 0, 0, "");
  assert.equal(e.kind, "error");
  assert.match(e.heading || "", /could not be reached/);
});

test("exactly one state is produced for every cell of the matrix", () => {
  const cells = [
    [OFF, 0, 0, "", "disconnected"],
    [OFF, 2, 0, "zzz", "disconnected"],
    [CONNECTING, 0, 0, "", "connecting"],
    [ERRORED, 0, 0, "", "error"],
    [READY, 0, 0, "", "empty"],
    [READY, 2, 2, "", "ready"],
    [READY, 2, 1, "qwen", "ready"],
    [READY, 2, 0, "zzz", "no-results"],
  ];
  for (const [desktop, total, matches, q, kind] of cells) {
    const s = localViewState("installed", /** @type {any} */ (desktop), /** @type {any} */ (total), /** @type {any} */ (matches), /** @type {any} */ (q));
    assert.equal(s.kind, kind, `total=${total} matches=${matches} q="${q}"`);
    // rows show only when ready: every other state replaces them
    assert.equal(showsRows(s), kind === "ready");
  }
});

test("a disconnected view keeps its search control from claiming a dataset", () => {
  assert.equal(localViewState("installed", OFF, 0, 0, "").searchable, false);
  assert.equal(localViewState("installed", READY, 2, 2, "").searchable, true);
});

/* ------------------------------------------------------------- Explore ---- */

test("Explore has no disconnected state, because a catalog is a document", () => {
  assert.equal(catalogViewState(6, 6, "").kind, "ready");
  assert.equal(showsDetail(catalogViewState(6, 6, "")), true);
});

test("zero results hides the detail, so no selection survives an empty list", () => {
  const s = catalogViewState(6, 0, "zzzz-no-model");
  assert.equal(s.kind, "no-results");
  assert.equal(showsRows(s), false);
  assert.equal(showsDetail(s), false, "a zero-result list cannot have a selected result");
  assert.match(s.heading || "", /No models match “zzzz-no-model”/);
  assert.equal(s.action?.action, "clear-search");
});

test("filters with no query get their own wording", () => {
  const s = catalogViewState(6, 0, "");
  assert.equal(s.kind, "no-results");
  assert.match(s.heading || "", /No models match those filters/);
});

test("results return the detail", () => {
  const s = catalogViewState(6, 3, "qwen");
  assert.equal(s.kind, "ready");
  assert.equal(showsDetail(s), true);
});

test("demo mode shows its rows instead of a not-connected message beside them", () => {
  // The bug this locks: demo fixtures rendered a download strip and installed
  // rows while the same page said "Desktop app not connected" underneath.
  const DEMO = desktopState(initialRuntime("web-preview"), true);
  assert.equal(DEMO.connection, "disconnected", "demo never claims a connection");
  assert.equal(localViewState("installed", DEMO, 2, 2, "").kind, "ready");
  assert.equal(localViewState("downloads", DEMO, 3, 3, "").kind, "ready");
  // and with no fixtures it is empty, not disconnected
  assert.equal(localViewState("installed", DEMO, 0, 0, "").kind, "empty");
  // searching still works, because there is a dataset
  assert.equal(localViewState("installed", DEMO, 2, 0, "zzz").kind, "no-results");
});
