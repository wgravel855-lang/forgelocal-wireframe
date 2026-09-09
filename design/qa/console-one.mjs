// @ts-check
/**
 * Loads ONE built route in a DOM, runs the real controller module against it,
 * and exits non-zero if ForgeLocal's own code reported anything: a thrown
 * error, an unhandled rejection, console.error or console.warn.
 *
 * Two errors reached production in the previous pass — a temporal dead zone and
 * an identifier used outside its scope. Neither was catchable by `node --check`,
 * because both only exist once the module evaluates against a document. This is
 * the check that would have caught them.
 *
 * jsdom has no layout engine, so geometry is still verified in a real browser.
 * What it does have is a document, an execution context and an error channel,
 * which is everything this class of bug needs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const route = process.argv[2];
if (!route) {
  console.error("usage: console-one.mjs /app/");
  process.exit(2);
}

const pub = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "public");

/**
 * jsdom does not implement every browser API this page legitimately uses. Each
 * entry below is a missing implementation in the test environment, matched
 * narrowly, never scoped to ForgeLocal's own symbols. Where an API can be
 * supplied instead of ignored, it is supplied — see installEnvironmentShims.
 */
const ENVIRONMENT_GAPS = [
  // No CSS engine: @property, mask-composite, conic-gradient and :focus-visible
  // are all unparseable, and jsdom reports one error per unknown rule.
  /Could not parse CSS stylesheet/,
  // Setting location inside a test document is not implemented.
  /Not implemented: navigation/,
];
const isEnvironmentGap = (text) => ENVIRONMENT_GAPS.some((re) => re.test(text));

/** @type {string[]} */
const problems = [];

const vc = new VirtualConsole();
vc.on("jsdomError", (e) => {
  const text = `${e.message}${e.detail ? " :: " + e.detail : ""}`;
  if (!isEnvironmentGap(text)) problems.push("pageerror: " + text);
});
vc.on("error", (...a) => {
  const text = a.map(String).join(" ");
  if (!isEnvironmentGap(text)) problems.push("console.error: " + text);
});
vc.on("warn", (...a) => {
  const text = a.map(String).join(" ");
  if (!isEnvironmentGap(text)) problems.push("console.warn: " + text);
});

const html = readFileSync(join(pub, route, "index.html"), "utf8");
const dom = new JSDOM(html, {
  url: "http://localhost" + route,
  runScripts: "dangerously",
  virtualConsole: vc,
  pretendToBeVisual: true,
});
const { window } = dom;

/**
 * Supply the APIs jsdom lacks rather than ignoring the errors their absence
 * causes. Suppressing "matchMedia is not defined" would also suppress a real
 * error thrown from the same call.
 */
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    media: query, matches: false, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  });
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
if (!window.navigator.clipboard) {
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText: () => Promise.resolve() }, configurable: true,
  });
}
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = function () {};
}
if (!window.Element.prototype.scrollTo) {
  window.Element.prototype.scrollTo = function () {};
  window.Element.prototype.scrollBy = function () {};
}

window.addEventListener("unhandledrejection", (e) =>
  problems.push("unhandledrejection: " + (e.reason && e.reason.message || e.reason)));
window.addEventListener("error", (e) => {
  const text = e.message || (e.error && e.error.message) || "";
  if (text && !isEnvironmentGap(text)) problems.push("pageerror: " + text);
});

/**
 * Flattens the module graph into one script in dependency order. The controller
 * and core are plain ES modules with no cycles, so this reproduces the browser's
 * evaluation order — which is what a temporal dead zone depends on.
 * @param {string} src @param {string} dir
 */
function inlineModules(src, dir) {
  /** @type {Set<string>} */ const seen = new Set();
  /** @type {string[]} */ const parts = [];
  // A Set, because two modules importing the same helper under the same alias
  // need that binding once, not twice.
  /** @type {Set<string>} */ const aliases = new Set();

  const strip = (code) => code
    .replace(/^import\s+\{[\s\S]*?\}\s+from\s+"[^"]+";?$/gm, "")
    .replace(/^export\s+(const|let|function|class)\s/gm, "$1 ")
    .replace(/^export\s+\{[^}]*\};?$/gm, "");

  const walk = (code, from) => {
    for (const m of code.matchAll(/^import\s+\{([\s\S]*?)\}\s+from\s+"([^"]+)";?$/gm)) {
      // a renamed import needs a real binding or the alias is undefined
      for (const spec of m[1].split(",")) {
        const as = spec.trim().match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
        if (as) aliases.add(`const ${as[2]} = ${as[1]};`);
      }
      const target = join(from, m[2]);
      if (seen.has(target)) continue;
      seen.add(target);
      const dep = readFileSync(target, "utf8");
      walk(dep, join(target, ".."));
      parts.push(strip(dep));
    }
  };

  walk(src, dir);
  parts.push([...aliases].join("\n"));
  parts.push(strip(src));
  const bundle = parts.join("\n;\n");

  // Flattening puts every module in one scope, so two modules that each keep a
  // private helper of the same name collide. The browser would not care, so
  // this must not read as a page error: name the duplicate instead, and treat
  // it as a signal that the helper belongs in a shared module.
  /** @type {Map<string, number>} */
  const declared = new Map();
  for (const m of bundle.matchAll(/^(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    declared.set(m[1], (declared.get(m[1]) || 0) + 1);
  }
  const clashes = [...declared].filter(([, n]) => n > 1).map(([name]) => name);
  if (clashes.length) {
    throw new Error(`two core modules both declare ${clashes.join(", ")} at module scope. `
      + "The browser scopes them separately, but this gate flattens them: move the "
      + "helper into a shared module rather than duplicating it.");
  }
  return bundle;
}

const entry = join(pub, "assets/forgelocal.js");
try {
  window.eval(inlineModules(readFileSync(entry, "utf8"), join(pub, "assets")));
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
} catch (e) {
  problems.push("pageerror: " + (e && /** @type {Error} */ (e).message));
}

// Outlive every callback the page scheduled, including the 220ms reading-position
// re-assert, so a straggler is measured rather than cut off.
await new Promise((r) => setTimeout(r, 500));

for (const p of problems) console.log(p);
process.exit(problems.length ? 1 : 0);
