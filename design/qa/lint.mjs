// @ts-check
/**
 * A zero-dependency lint for this repository's actual failure modes.
 *
 * It is not a style checker. Every rule here corresponds to a bug that has
 * already shipped at least once in this project, so the check earns its place
 * rather than adding ceremony.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const SKIP = new Set(["node_modules", ".git", "public", ".vercel"]);

/** @type {string[]} */
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if ([".mjs", ".js"].includes(extname(name))) files.push(p);
  }
})(join(root, "design"));

/** @type {string[]} */
const problems = [];
const report = (file, msg) => problems.push(`${relative(root, file).replace(/\\/g, "/")}: ${msg}`);

// This file states the patterns it looks for, so scanning it finds itself.
const SELF = new Set(["design/qa/lint.mjs"]);
// build.mjs owns the marker table; its keys are declarations, not stray markers.
const DECLARES_MARKERS = new Set(["design/build.mjs"]);

for (const file of files) {
  const rel = relative(root, file).replace(/\\/g, "/");
  if (SELF.has(rel)) continue;
  const src = readFileSync(file, "utf8");

  // 1. It must parse. This has caught truncated splices more than once.
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (e) {
    report(file, "does not parse");
    continue;
  }

  // 2. A character class that lost its backslash. The waitlist email check
  //    shipped as [^s@] instead of [^\s@] and silently rejected every address
  //    containing the letter s.
  for (const m of src.matchAll(/\[\^([sdwbSDWB])@?\]/g)) {
    report(file, `suspicious character class [^${m[1]}] - did it lose a backslash?`);
  }

  // 3. $ in a replacement string is an escape, so "$(x)" in a template that
  //    was meant to be "${x}" produces a literal and a runtime TypeError.
  if (/\$\([a-zA-Z_$][\w$]*\)\s*\./.test(src)) {
    report(file, "looks like $(...) where ${...} was intended");
  }

  // 4. Native confirm/alert/prompt block the whole session and cannot explain
  //    what a choice does. This project uses flConfirm instead.
  for (const m of src.matchAll(/(^|[^.\w])(confirm|alert|prompt)\s*\(/g)) {
    const before = src.slice(Math.max(0, m.index - 60), m.index);
    if (/\/\/|\*|flConfirm|showPrompt/.test(before.split("\n").pop() || "")) continue;
    report(file, `native ${m[2]}() - use flConfirm`);
  }

  // 5. An unbound build marker that reached a shipped module.
  if (!DECLARES_MARKERS.has(rel)) {
    for (const m of src.matchAll(/<!--([A-Z_]{3,})-->/g)) {
      report(file, `unbound build marker ${m[1]}`);
    }
  }
}

// 6. No built page may contain an unbound marker either.
try {
  const pub = join(root, "public");
  /** @type {string[]} */
  const pages = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".html")) pages.push(p);
    }
  })(pub);
  for (const page of pages) {
    const html = readFileSync(page, "utf8");
    const m = html.match(/<!--[A-Z_]{3,}-->/);
    if (m) report(page, `unbound marker ${m[0]} reached the page`);
  }
} catch { /* no build output yet */ }

if (problems.length) {
  console.error(`lint: ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log(`lint: ${files.length} modules, no problems`);
