// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogHtml, modelDetail, modelRow, monogram, fitStatement, primaryAction } from "./catalog.mjs";
import { createState } from "./modelstore.mjs";
import { desktopState, applyDesktopState, DEMO_HARDWARE } from "./localstate.mjs";
import { initialRuntime, reduceRuntime } from "./runtime.mjs";

/** @param {Partial<import("./models.mjs").ModelRecord>} [over] */
const model = (over = {}) => ({
  id: "m1", displayName: "Qwen2.5 Coder 7B", publisher: "Alibaba Qwen", family: "qwen2",
  architecture: "llama", format: /** @type {'GGUF'} */ ("GGUF"), quantization: "Q4_K_M",
  fileSizeBytes: 5 * 1024 ** 3, maxContextTokens: 32768, parameterCount: "7.6B",
  capabilities: /** @type {any} */ (["chat", "tool_use", "agent_ready"]),
  installed: false, loadedInstances: [], bestFor: "Quick single-file edits.", ...over,
});

const web = initialRuntime("web-preview");
const OFF = desktopState(web, false);
const DEMO = desktopState(web, true);
const ready = reduceRuntime(initialRuntime("desktop"),
  { type: "runtime.ready", version: "v1", device: { name: "RTX 4070" } });
const ON = { ...desktopState(ready, false), hardware: DEMO_HARDWARE };

test("a publisher mark is generated, never a fetched logo", () => {
  assert.equal(monogram("Alibaba Qwen"), "AQ");
  assert.equal(monogram("Meta"), "ME");
  assert.equal(monogram(""), "?");
});

test("compatibility is suppressed entirely without a hardware profile", () => {
  assert.equal(fitStatement(model(), OFF), null);
  const row = modelRow(model(), null, OFF);
  assert.doesNotMatch(row, /Fits in GPU memory|GPU \+ CPU|Exceeds available memory/);
  // and the detail explains the absence once rather than guessing
  const detail = modelDetail(model(), OFF);
  assert.match(detail, /Connect the desktop app to estimate/);
  assert.doesNotMatch(detail, /On this PC/);
  assert.doesNotMatch(detail, /12 GB of/);
});

test("compatibility appears only when there is a machine to compare against", () => {
  const fit = fitStatement(model(), ON);
  assert.ok(fit);
  assert.match(fit.text, /Fits in GPU memory|GPU \+ CPU|Exceeds available memory/);
  const big = fitStatement(model({ fileSizeBytes: 40 * 1024 ** 3 }), ON);
  assert.equal(big && big.state, "over");
});

test("a row states compatibility once, with no dot beside the same word", () => {
  const row = modelRow(model(), null, ON);
  const matches = row.match(/Fits in GPU memory/g) || [];
  assert.equal(matches.length, 1);
  assert.doesNotMatch(row, /class="dot/, "no coloured dot repeats the state");
  assert.doesNotMatch(row, /badge-agent/, "Agent-ready is not a repeated row badge");
});

test("Agent-ready is a detail capability, not a row badge", () => {
  assert.doesNotMatch(modelRow(model(), null, OFF), /Agent-ready/);
  assert.match(modelDetail(model(), OFF), /Agent-ready/);
});

test("the primary action never promises what the runtime cannot do", () => {
  assert.equal(primaryAction(model(), OFF).kind, "unavailable");
  assert.equal(primaryAction(model(), OFF).label, "Desktop app required");
  // disabled, and not a saturated primary
  assert.match(modelDetail(model(), OFF), /disabled aria-disabled="true"/);
  assert.doesNotMatch(modelDetail(model(), OFF), /btnp[^"]*"[^>]*disabled/);

  assert.equal(primaryAction(model(), ON).kind, "download");
  assert.equal(primaryAction(model({ installed: true }), ON).kind, "load");
  assert.equal(primaryAction(model({ installed: true }), OFF).kind, "state");
  assert.equal(primaryAction(model({ installed: true }), OFF).label, "Installed");
});

test("an installed model offers Open in My models, not a primary In My models", () => {
  const d = modelDetail(model({ installed: true }), OFF);
  assert.match(d, /Open in My models/);
  assert.doesNotMatch(d, /In My models</);
});

test("desktop opens on the first result when the URL names nothing", () => {
  const s = createState([model({ id: "a" }), model({ id: "b" })]);
  const html = catalogHtml([s.byId.a, s.byId.b], null, OFF);
  assert.match(html, /aria-selected="true"[^>]*data-cat-row="a"|data-cat-row="a"[^>]*aria-selected="true"/);
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1, "exactly one selection");
  assert.doesNotMatch(html, /Select a model/, "no instruction placeholder pane");
});

test("a named model in the URL wins over the default", () => {
  const s = createState([model({ id: "a" }), model({ id: "b" })]);
  const html = catalogHtml([s.byId.a, s.byId.b], "b", OFF);
  assert.match(html, /data-cat-row="b"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-cat-row="b"/);
});

test("selection is exposed programmatically, not by colour alone", () => {
  const html = catalogHtml([model()], null, OFF);
  assert.match(html, /role="listbox"/);
  assert.match(html, /role="option"/);
  assert.match(html, /aria-selected=/);
});

test("the normal web state renders no installed or downloading claim", () => {
  const seeded = [model({
    id: "a", installed: true,
    downloadState: /** @type {any} */ ({ modelId: "a", state: "downloading", receivedBytes: 1e9, totalBytes: 5e9, bytesPerSecond: 28.6e6 }),
  })];
  const html = catalogHtml(applyDesktopState(seeded, OFF), null, OFF);
  // The state claims, not the word: "Downloading and loading need the desktop
  // app" is the disabled control explaining itself, which is the honest case.
  assert.doesNotMatch(html, /mrow2-inst/, "no row claims the model is installed");
  assert.doesNotMatch(html, /Downloading ·/, "no row claims a download is running");
  assert.doesNotMatch(html, /MB\/s/, "no row claims a transfer rate");
  assert.match(html, /Desktop app required/, "and the action says why");

  // demo mode is where those states are visible, and it is opt-in
  const demo = catalogHtml(applyDesktopState(seeded, DEMO), null, DEMO);
  assert.match(demo, /Downloading · 20%/);
});

test("an empty result set renders no detail and no selected option", () => {
  const html = catalogHtml([], null, OFF);
  assert.doesNotMatch(html, /mdet-name/, "no model detail survives an empty list");
  assert.doesNotMatch(html, /aria-selected="true"/, "and nothing stays selected");
});

test("specification omits a row whose value the catalog does not have", () => {
  const known = modelDetail(model({ architecture: "llama" }), OFF);
  assert.match(known, /Architecture/);
  const unknown = modelDetail(model({ architecture: "", family: "" }), OFF);
  assert.doesNotMatch(unknown, /Architecture/, "an unknown value is omitted, not printed as a dash");
  assert.doesNotMatch(unknown, /<dd>—<\/dd>/);
});

test("exactly one source model-card link appears, and it says it is external", () => {
  const d = modelDetail(model({ sourceUrl: "https://example.com/card" }), OFF);
  assert.equal((d.match(/target="_blank"/g) || []).length, 1);
  assert.match(d, /opens the publisher page in a new tab/);
  assert.doesNotMatch(d, /does not copy publishers/, "the bottom disclaimer is gone");
});

test("the Agent-ready definition is a disclosure, not a paragraph on every model", () => {
  const d = modelDetail(model(), OFF);
  assert.match(d, /<details class="mdet-help">/);
  assert.match(d, /What Agent-ready means/);
  assert.doesNotMatch(d, /One artifact is published/);
});
