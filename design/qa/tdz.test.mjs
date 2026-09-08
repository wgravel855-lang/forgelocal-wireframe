// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { findTemporalDeadZones } from "./tdz.mjs";

/* The rule has to catch the exact shape that shipped and broke the catalog,
   and stay quiet about the shape that replaced it. */

test("catches a const built by calling a helper declared later", () => {
  const src = [
    "(() => {",
    '  const CAPICON = {',
    '    chat: svg("<path/>", "currentColor"),',
    "  };",
    "",
    '  const svg = (d, stroke) => `<svg>${d}</svg>`;',
    "})();",
  ].join("\n");
  const found = findTemporalDeadZones(src);
  assert.equal(found.length, 1, "the original CAPICON bug is reported");
  assert.match(found[0], /const CAPICON on line 2 calls svg\(\)/);
  assert.match(found[0], /declared on line 6/);
});

test("stays quiet when the helper is captured in an arrow body", () => {
  const src = [
    "(() => {",
    '  const capIcon = (k) => svg(PATHS[k], "currentColor");',
    '  const svg = (d, stroke) => `<svg>${d}</svg>`;',
    "})();",
  ].join("\n");
  assert.deepEqual(findTemporalDeadZones(src), [], "an arrow body is not evaluated at load");
});

test("stays quiet when the helper is declared first", () => {
  const src = [
    "(() => {",
    '  const svg = (d) => `<svg>${d}</svg>`;',
    '  const ICON = { chat: svg("<path/>") };',
    "})();",
  ].join("\n");
  assert.deepEqual(findTemporalDeadZones(src), []);
});

test("follows an initialiser across several lines", () => {
  const src = [
    "(() => {",
    "  const TABLE = {",
    "    a: 1,",
    "    b: helper(2),",
    "    c: 3,",
    "  };",
    "  const helper = (n) => n * 2;",
    "})();",
  ].join("\n");
  const found = findTemporalDeadZones(src);
  assert.equal(found.length, 1);
  assert.match(found[0], /calls helper\(\)/);
});

test("ignores calls to things this scope never declares", () => {
  const src = [
    "(() => {",
    '  const NOW = Date.now();',
    '  const IDS = Object.keys({ a: 1 });',
    "})();",
  ].join("\n");
  assert.deepEqual(findTemporalDeadZones(src), []);
});

test("the real controller is clean", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = fileURLToPath(new URL(".", import.meta.url));
  const src = readFileSync(join(here, "..", "assets", "forgelocal.js"), "utf8");
  assert.deepEqual(findTemporalDeadZones(src), []);
});
