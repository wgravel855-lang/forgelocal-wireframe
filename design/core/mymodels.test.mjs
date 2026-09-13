import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CATEGORIES, LoadState, MM_ICON, Tab, TableState,
  displayName, footer, infoTab, initialMyModels, tableRow, myModelsPage,
  navPane, paramBadge, quantOf, rowMenu, sizeLabel, tablePane, whenLabel,
} from "./mymodels.mjs";
import { ADVANCED, SAMPLING, estimate, inferenceTab, loadTab } from "./mymodels-tabs.mjs";

/* A file as model.list reports one, and the meta the sidecar reads from it. */
const FILE = {
  name: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
  path: "C:\\Users\\a\\AppData\\Local\\ForgeLocal\\models\\qwen2.5-coder-7b-instruct-q4_k_m.gguf",
  bytes: 4_683_073_248,
  modifiedMs: Date.parse("2026-09-12T22:00:00Z"),
  usable: true,
};
const META = {
  ok: true,
  version: 3,
  summary: {
    name: "Qwen2.5 Coder 7B Instruct GGUF",
    architecture: "qwen2",
    sizeLabel: "7B",
    contextLength: 131072,
    blockCount: 28,
    toolUse: { present: true, evidence: "the chat template branches on tools" },
    repo: null,
  },
};

const state = (over = {}) => initialMyModels({
  desktop: true,
  tableState: TableState.READY,
  rows: [FILE],
  total: 1,
  totalBytes: FILE.bytes,
  selected: FILE.name,
  meta: { [FILE.name]: META },
  dir: "C:\\Users\\a\\AppData\\Local\\ForgeLocal\\models",
  ...over,
});

/* ------------------------------------------------------------ the labels */

test("sizeLabel switches unit and precision at the sizes files actually are", () => {
  assert.equal(sizeLabel(4_683_073_248), "4.36 GB");
  assert.equal(sizeLabel(3_015_940_000), "2.81 GB");
  assert.equal(sizeLabel(45_000_000_000), "41.91 GB");
  assert.equal(sizeLabel(140_000_000), "134 MB");
  /* Nothing is not zero. */
  assert.equal(sizeLabel(0), null);
  assert.equal(sizeLabel(null), null);
  assert.equal(sizeLabel(undefined), null);
});

test("whenLabel reads as a gap in time, not a timestamp", () => {
  const now = Date.parse("2026-09-13T09:00:00Z");
  const ago = (ms) => whenLabel(now - ms, now);
  assert.equal(ago(60_000), "just now");
  assert.equal(ago(3_600_000), "an hour ago");
  assert.equal(ago(9 * 3_600_000), "9 hours ago");
  assert.equal(ago(30 * 3_600_000), "yesterday");
  assert.equal(ago(9 * 86_400_000), "9 days ago");
  assert.equal(ago(120 * 86_400_000), "4 months ago");
  assert.equal(ago(800 * 86_400_000), "2 years ago");
  assert.equal(whenLabel(null, now), null);
  assert.equal(whenLabel(Number.NaN, now), null);
});

test("quantOf reads the quantisation out of the file name and nothing else", () => {
  assert.equal(quantOf("qwen2.5-coder-7b-instruct-q4_k_m.gguf"), "Q4_K_M");
  assert.equal(quantOf("model.Q2_K.gguf"), "Q2_K");
  assert.equal(quantOf("model-IQ3_XXS.gguf"), "IQ3_XXS");
  assert.equal(quantOf("model-f16.gguf"), "F16");
  /* "7b" is a parameter count, not a quantisation. */
  /* Undefined, not null: the shared reader in liveModels.mjs says "no
     match" that way and every caller treats it as unknown. */
  assert.equal(quantOf("some-7b-model.gguf"), undefined);
  assert.equal(quantOf("plain.gguf"), undefined);
});

test("paramBadge comes from the header, never from the file name", () => {
  assert.equal(paramBadge(META), "7B");
  assert.equal(paramBadge({ summary: { sizeLabel: "13b" } }), "13B");
  /* A file called 7b whose header says nothing gets no badge. */
  assert.equal(paramBadge({ summary: {} }), null);
  assert.equal(paramBadge(undefined), null);
  /* A label with no digit in it is not a size. */
  assert.equal(paramBadge({ summary: { sizeLabel: "unknown" } }), null);
});

test("displayName drops only the extension", () => {
  assert.equal(displayName("a.b.c-q4_k_m.gguf"), "a.b.c-q4_k_m");
  assert.equal(displayName("noext"), "noext");
});

/* -------------------------------------------------------------- the icons */

test("every icon is one set: 24-unit box, 1.75 stroke, no filled shapes", () => {
  const names = Object.keys(MM_ICON);
  assert.ok(names.length >= 10, "expected the whole set");
  for (const [name, svg] of Object.entries(MM_ICON)) {
    assert.match(svg, /viewBox="0 0 24 24"/, name + " is not in a 24 box");
    assert.match(svg, /stroke-width="1\.75"/, name + " is a different weight");
    assert.match(svg, /fill="none"/, name + " is filled");
    assert.match(svg, /aria-hidden="true"/, name + " is announced twice");
  }
});

/* ------------------------------------------------------------- the table */

test("a row shows the whole name and spends no width repeating it", () => {
  const html = tableRow(FILE, state());
  assert.ok(html.includes("qwen2.5-coder-7b-instruct-q4_k_m<"), "the name is shown in full");
  assert.ok(html.includes('title="qwen2.5-coder-7b-instruct-q4_k_m.gguf"'));
  /* The quantisation is the tail of the name beside it and a row in the
     inspector. A third copy cost the name column 38px. */
  assert.ok(!html.includes("mm-quant"), "no quant chip in the row");
  /* The capability is the icon alone here, but still has a name. */
  assert.ok(html.includes('aria-label="Supports tool use"'));
  assert.ok(!/>Tool use</.test(html), "no 'Tool use' text in the row");
  assert.ok(html.includes("the chat template branches on tools"), "the evidence is the title");
  assert.ok(html.includes(">7B<"));
  assert.ok(html.includes("4.36 GB"));
});

test("a row with no header data says so instead of guessing", () => {
  const html = tableRow(FILE, state({ meta: {} }));
  assert.ok(html.includes("mm-badge is-none"));
  assert.ok(html.includes("does not state a parameter count"));
  assert.ok(!html.includes("mm-cap-i"), "no capability claim without evidence");
});

test("an unreadable file is marked, not hidden", () => {
  const bad = { ...FILE, usable: false, problem: "the header is truncated" };
  const html = tableRow(bad, state({ rows: [bad] }));
  assert.ok(html.includes("is-bad"));
  assert.ok(html.includes("Unreadable"));
  assert.ok(html.includes("the header is truncated"));
});

test("the table's empty states each explain themselves", () => {
  /** @type {Array<[string, RegExp]>} */
  const cases = [
    [TableState.EMPTY, /no models|nothing|empty/i],
    [TableState.DISCONNECTED, /desktop|runtime/i],
    [TableState.NO_MATCH, /match/i],
  ];
  for (const [st, phrase] of cases) {
    const html = tablePane(state({ tableState: st, rows: [], total: 0, query: "zzz" }));
    assert.match(html, phrase, st + " should say why it is empty");
    assert.ok(!html.includes("mm-row"), st + " should not draw rows");
  }
});

/* -------------------------------------------------------------- the nav */

test("the categories we cannot identify are disabled and say why", () => {
  const html = navPane(state({ counts: { all: 1, llm: 1 } }));
  for (const c of CATEGORIES.filter((x) => !x.enabled)) {
    assert.ok(c.why && /not supported yet/i.test(c.why), c.id + " needs an honest reason");
    assert.ok(html.includes(c.why.slice(0, 30)), c.id + "'s reason should reach the tooltip");
  }
  assert.equal((html.match(/disabled aria-disabled/g) ?? []).length, 2);
  /* A count is only shown for a category that can be counted. */
  assert.ok(html.includes('class="mm-nav-n">1<'));
});

/* ------------------------------------------------------------ the footer */

test("the footer counts what is there, and admits when it has not counted", () => {
  assert.ok(footer(state()).includes("You have 1 local model, taking up 4.36 GB of disk space"));
  assert.ok(footer(state({ total: 2, totalBytes: 7_699_013_248 }))
    .includes("You have 2 local models, taking up 7.17 GB of disk space"));
  const off = footer(state({ tableState: TableState.DISCONNECTED }));
  assert.ok(off.includes("nothing has been counted"));
  assert.ok(!off.includes("You have"));
});

/* ------------------------------------------------------------ the actions */

test("Open on Hugging Face appears only when the file names a repository", () => {
  assert.ok(!rowMenu(FILE, state()).includes("Open on Hugging Face"),
    "no link built from a file name");
  const withRepo = state({
    meta: {
      [FILE.name]: {
        ...META,
        summary: { ...META.summary, repo: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF" },
      },
    },
  });
  assert.ok(rowMenu(FILE, withRepo).includes("Open on Hugging Face"));
});

test("the native actions are disabled outside the desktop host", () => {
  const web = rowMenu(FILE, state({ desktop: false }));
  assert.match(web, /data-mm-do="reveal"[^>]*disabled/);
  assert.ok(web.includes("Needs the desktop app."));
  assert.ok(!/data-mm-do="reveal"[^>]*disabled/.test(rowMenu(FILE, state())));
});

test("the menu carries every action the page claims", () => {
  const html = rowMenu(FILE, state());
  for (const a of ["reveal", "pin", "copy-id", "copy-path", "raw", "verify", "delete"]) {
    assert.ok(html.includes('data-mm-do="' + a + '"'), "missing " + a);
  }
  assert.ok(rowMenu(FILE, state({ pinned: [FILE.name] })).includes("Unpin"));
});

/* -------------------------------------------------------------- the info */

test("Info reports the header, and says where the numbers came from", () => {
  const html = infoTab(state());
  assert.ok(html.includes("GGUF v3"));
  assert.ok(html.includes("qwen2"));
  assert.ok(html.includes("128k tokens"));
  assert.ok(html.includes(">28<"));
  assert.ok(html.includes("Read from the file's own GGUF header, not from a repository."));
  /* The two values worth reading character by character are not ellipsised. */
  assert.ok(/mm-kv is-long[\s\S]*Qwen2\.5 Coder 7B Instruct GGUF/.test(html));
  assert.ok(/mm-kv is-long[\s\S]*qwen2\.5-coder-7b-instruct-q4_k_m\.gguf/.test(html));
});

test("an unverifiable file says unknown rather than claiming a check", () => {
  assert.ok(infoTab(state()).includes("unknown"));
  assert.ok(infoTab(state()).includes("only known for a file ForgeLocal downloaded"));
});

test("a file that could not be read offers the folder, not a blank pane", () => {
  const html = infoTab(state({ meta: { [FILE.name]: { ok: false, reason: "not a GGUF file" } } }));
  assert.ok(html.includes("This file could not be read"));
  assert.ok(html.includes("not a GGUF file"));
  assert.ok(html.includes('data-mm-do="reveal"'));
});

/* -------------------------------------------------------------- the load */

test("estimate returns nothing rather than a number it cannot support", () => {
  const e = estimate({ bytes: null, layers: 28 }, { context: 4096, gpuLayers: 28 });
  assert.deepEqual(e, { weights: null, kv: null, vram: null, ram: null, approximate: true });
  assert.equal(estimate({ bytes: 1, layers: 0 }, { context: 4096, gpuLayers: 0 }).vram, null);
});

test("estimate moves the weights onto the card in proportion to the offload", () => {
  const model = { bytes: FILE.bytes, layers: 28 };
  const all = estimate(model, { context: 4096, gpuLayers: 28 });
  const none = estimate(model, { context: 4096, gpuLayers: 0 });
  const half = estimate(model, { context: 4096, gpuLayers: 14 });

  /* A figure the page will print, so it is a number here or the test is
     asserting nothing. */
  const num = (v, what) => {
    assert.equal(typeof v, "number", what + " should be a number");
    return Number(v);
  };

  assert.equal(none.vram, 0);
  assert.equal(all.ram, 0);
  assert.ok(num(all.vram, "vram") > FILE.bytes, "the KV cache is on the card too");
  /* Whatever the split, the total is the same. */
  const total = num(all.vram, "vram") + num(all.ram, "ram");
  for (const e of [all, none, half]) {
    assert.equal(num(e.vram, "vram") + num(e.ram, "ram"), total);
    assert.equal(e.approximate, true, "never presented as a measurement");
  }
  /* Asking for more layers than the model has does not inflate the figure. */
  assert.equal(estimate(model, { context: 4096, gpuLayers: 999 }).vram, all.vram);
  /* A longer context costs more. */
  assert.ok(num(estimate(model, { context: 32768, gpuLayers: 28 }).kv, "kv")
    > num(estimate(model, { context: 4096, gpuLayers: 28 }).kv, "kv"));
});

test("the Load tab clamps to what the file says it can do", () => {
  const html = loadTab(state());
  const ctx = /id="mm-context"[^>]*max="(\d+)"/.exec(html);
  assert.ok(ctx, "the context slider is there");
  assert.equal(ctx[1], "131072", "clamped to the header's ceiling, not a round number");
  const gpu = /id="mm-gpuLayers"[^>]*max="(\d+)"/.exec(html);
  assert.ok(gpu, "the offload slider is there");
  assert.equal(gpu[1], "28", "clamped to the layer count");
  assert.match(html, /estimate|approximate/i);
});

test("the Load tab hides settings the engine does not take", () => {
  const html = loadTab(state());
  for (const a of ADVANCED) {
    if (a.supported) {
      assert.ok(html.includes('data-mm-set="' + a.id + '"'), a.id + " should be offered");
    } else {
      assert.ok(!html.includes('data-mm-set="' + a.id + '"'),
        a.id + " is inert and must not render");
    }
  }
  assert.ok(ADVANCED.some((a) => a.supported), "something is supported");
  assert.ok(ADVANCED.some((a) => !a.supported), "and something is not");
});

/* --------------------------------------------------------- the inference */

test("the Inference tab carries the eight sections, collapsed", () => {
  const html = inferenceTab(state());
  const titles = ["System Prompt", "Reasoning", "Settings", "Reasoning Parsing",
    "Sampling", "Structured Output", "Speculative Decoding", "Prompt Template"];
  for (const t of titles) assert.ok(html.includes(t), "missing " + t);
  assert.equal((html.match(/<details/g) ?? []).length, 8);
});

test("every sampling control has a range and a default inside it", () => {
  const html = inferenceTab(state());
  for (const p of SAMPLING) {
    assert.ok(html.includes('data-mm-set="' + p.id + '"'), p.id + " is not wired");
    assert.equal(typeof p.min, "number");
    assert.equal(typeof p.max, "number");
    assert.equal(typeof p.def, "number");
    assert.ok(p.def >= p.min && p.def <= p.max, p.id + "'s default is outside its range");
    /* The control opens on that default, and both halves of it agree — the
       number box and the slider are one value, not two. */
    const rendered = [...html.matchAll(
      new RegExp('data-mm-set="' + p.id + '"[\\s\\S]{0,120}?value="([^"]*)"', "g"))]
      .map((m) => Number(m[1]));
    assert.equal(rendered.length, 2, p.id + " should render a number box and a slider");
    assert.deepEqual(rendered, [p.def, p.def], p.id + " does not open on its default");
  }
});

test("a saved sampling value is what the control shows next time", () => {
  const html = inferenceTab(state({ settings: { [FILE.name]: { temperature: 0.15 } } }));
  const shown = [...html.matchAll(
    /data-mm-set="temperature"[\s\S]{0,120}?value="([^"]*)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(shown, [0.15, 0.15]);
  /* One saved value does not disturb the others. */
  assert.ok(html.includes('value="0.95"'), "Top P keeps its default");
});

/* -------------------------------------------------------------- the page */

test("the page renders its three panes and nothing before the runtime answers", () => {
  const fresh = initialMyModels();
  assert.equal(fresh.tableState, TableState.LOADING);
  assert.equal(fresh.rows.length, 0);
  assert.equal(fresh.total, 0);
  assert.equal(fresh.load.state, LoadState.IDLE);
  assert.equal(fresh.tab, Tab.INFO);

  const html = myModelsPage(state());
  for (const cls of ["mm-nav", "mm-centre", "mm-side", "mm-foot", "mm-table"]) {
    assert.ok(html.includes(cls), "missing " + cls);
  }
});

test("a disconnected page still draws its panes and explains the blank", () => {
  const html = myModelsPage(initialMyModels({ tableState: TableState.DISCONNECTED }));
  assert.ok(html.includes("mm-nav") && html.includes("mm-side"));
  assert.ok(!html.includes("mm-row"));
  assert.ok(/desktop|runtime/i.test(html));
});

test("zero memory and unmeasurable memory are not given the same word", () => {
  /* Everything on the card: nothing in system RAM is a figure, not a gap. */
  const all = loadTab(state({ settings: { [FILE.name]: { gpuLayers: 28, context: 4096 } } }));
  assert.match(all, /In system RAM[\s\S]{0,120}?>none</);
  assert.ok(!/In system RAM[\s\S]{0,120}?>unknown</.test(all),
    "a computed zero must not read as unknown");

  /* A file whose header states no layer count supports no projection at all,
     and that is the case the word "unknown" is for. */
  const bare = loadTab(state({
    meta: { [FILE.name]: { ok: true, version: 3, summary: { architecture: "qwen2" } } },
  }));
  assert.match(bare, />unknown</);
});

test("an empty pane still puts its footer at the bottom", () => {
  /* The footer was floating in the middle of the window with a third of the
     page blank below it, because a state card was returned where the table's
     own growing container would have been. */
  for (const st of [TableState.EMPTY, TableState.NO_MATCH,
    TableState.DISCONNECTED, TableState.ERROR]) {
    const html = tablePane(state({ tableState: st, rows: [], total: 0, query: "zzz" }));
    assert.ok(html.includes("mm-fill"), st + " does not fill the pane");
    /* And the footer is still the last thing in the section. */
    assert.ok(html.lastIndexOf("mm-foot") > html.lastIndexOf("mm-fill"),
      st + " puts the footer above its own body");
  }
  /* The table itself already had one. */
  const rows = tablePane(state());
  assert.ok(rows.includes("mm-rows"));
});

test("a slider states its ceiling next to the value, above the slider", () => {
  /* The reference puts the limit in a sentence between the number box and
     the slider. It used to sit under the slider as "max 131,072" in the
     right-hand corner — furthest from the number it constrains, and at a
     narrow width it wrapped into the caption beside it. */
  const html = loadTab(state());
  assert.ok(html.includes("Model supports up to"), "the context ceiling is stated in words");
  assert.ok(html.includes(">131,072<"), "and carries the file's real ceiling");
  assert.ok(html.includes("This model has"), "the layer count is stated in words");
  assert.ok(!html.includes("max_note") && !html.includes("mm-ctl-f"),
    "the old corner captions are gone");

  /* Order on the page: value, then ceiling, then slider. */
  const num = html.indexOf('id="mm-context-n"');
  const ceiling = html.indexOf("Model supports up to");
  const range = html.indexOf('id="mm-context"');
  assert.ok(num < ceiling && ceiling < range,
    `expected value < ceiling < slider, got ${num}, ${ceiling}, ${range}`);
});

test("a recommendation is only printed when something measured the machine", () => {
  const guessed = loadTab(state());
  assert.ok(guessed.includes("Nothing has measured this computer"),
    "with no hardware reading, say so rather than print a number");
  assert.ok(!/\d+ recommended for this computer/.test(guessed));

  const measured = loadTab(state({ recommended: { [FILE.name]: 21 } }));
  assert.ok(measured.includes("21 recommended for this computer"));
});
