// @ts-check
/**
 * The five surfaces that disagreed, rendered from one disconnected store.
 *
 * The deployed build showed all of these at the same time: the composer said
 * "No model loaded", the loader said no runtime was connected, and the runtime
 * popover and Models & runtime settings both reported a healthy llama.cpp
 * b4021 with 11.1 GB of video memory in use and Qwen2.5 Coder 14B loaded.
 * Permissions listed two remembered npm approvals that nothing had ever asked
 * for. This test renders every one of them from the same state and fails if any
 * of that language comes back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath as toPath } from "node:url";

import {
  initialRuntime, runtimeLabel, runtimeDetails, runtimeSettings,
  contextDisplay, sendBlockedReason,
} from "../core/runtime.mjs";
import { createState, canSend, selectedModel } from "../core/modelstore.mjs";
import { composerModelLabel, pickerHtml } from "../core/modelviews.mjs";
import { THIS_PC } from "../core/machine.mjs";

const root = join(toPath(new URL(".", import.meta.url)), "..", "..");

/** Everything that was on screen at once and could not all be true. */
const CLAIMS = [
  /Runtime healthy/i,
  /llama\.cpp/i,
  /b4021/,
  /11\.1 GB/,
  /13\.7 GB/,
  /30 minutes/,
  /ForgeLocal\\models/,
  /Always allowed in/i,
  /\b34%/,
];

/** A store with models on disk but none loaded: the real preview situation. */
const seed = [
  { id: "a", displayName: "Qwen2.5 Coder 14B", publisher: "Qwen", family: "qwen2",
    architecture: "llama", format: /** @type {'GGUF'} */ ("GGUF"), quantization: "Q4_K_M",
    fileSizeBytes: 9e9, maxContextTokens: 32768,
    capabilities: /** @type {any} */ (["chat"]), installed: true, loadedInstances: [] },
];

test("every surface renders the same disconnected answer", () => {
  const runtime = initialRuntime("web-preview");
  const models = createState(seed);

  const surfaces = {
    "composer runtime chip": runtimeLabel(runtime),
    "composer model label": composerModelLabel(models),
    "composer context": contextDisplay(runtime).text + " " + contextDisplay(runtime).label,
    "composer send": sendBlockedReason(runtime, canSend(models)),
    "runtime popover": JSON.stringify(runtimeDetails(runtime)),
    "models and runtime settings": JSON.stringify(runtimeSettings(runtime)),
    "model picker": pickerHtml(models, THIS_PC),
  };

  for (const [name, text] of Object.entries(surfaces)) {
    for (const claim of CLAIMS) {
      assert.doesNotMatch(text, claim, `${name} still claims ${claim}`);
    }
  }

  // And each says the true thing, rather than merely omitting the false one.
  assert.equal(surfaces["composer runtime chip"], "Desktop not connected");
  assert.equal(surfaces["composer model label"], "No model loaded");
  assert.match(surfaces["composer context"], /^—/);
  assert.match(surfaces["composer send"], /desktop app/i);
  assert.match(surfaces["runtime popover"], /web preview/i);
  assert.match(surfaces["models and runtime settings"], /desktop app/i);
  assert.match(surfaces["model picker"], /No model is loaded/);
  assert.equal(canSend(models), false);
  assert.equal(selectedModel(models), null);
});

test("the shipped markup carries no runtime fixture of its own", () => {
  // A surface can only stay truthful if the value is not sitting in the HTML.
  const pub = join(root, "public");
  /** @type {string[]} */
  const pages = [];
  (function walk(dir) {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else if (name.name.endsWith(".html")) pages.push(p);
    }
  })(join(pub, "app"));

  for (const page of pages) {
    const html = readFileSync(page, "utf8");
    const where = page.slice(pub.length).replace(/\\/g, "/");
    assert.doesNotMatch(html, /Runtime healthy/, `${where} ships a healthy runtime claim`);
    assert.doesNotMatch(html, /b4021/, `${where} ships a runtime version`);
    assert.doesNotMatch(html, /11\.1 GB of 12 GB/, `${where} ships a video memory figure`);
    assert.doesNotMatch(html, /Always allowed in/, `${where} ships a remembered approval`);
    assert.doesNotMatch(html, /data-ctx-pct>34%/, `${where} ships the fixture context figure`);
  }
});

test("no app page renders a raw permission-mode value", () => {
  const pub = join(root, "public", "app");
  /** @type {string[]} */
  const pages = [];
  (function walk(dir) {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else if (name.name.endsWith(".html")) pages.push(p);
    }
  })(pub);

  for (const page of pages) {
    const html = readFileSync(page, "utf8");
    const m = html.match(/data-mode-label[^>]*>([^<]*)</);
    if (!m) continue;
    assert.match(m[1], /^(Plan|Manual|Allow edits|Auto)$/,
      `${page} renders "${m[1]}" as the permission mode`);
  }
});
