// Round-two scale fixes, part 2: the token layer plus a sweep of the inline
// font-size and height overrides that were defeating the tokens.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/* ------------------------------------------------------------- tokens --- */
{
  const p = "design/head.part";
  let s = readFileSync(p, "utf8");
  const swap = (a, b) => { if (!s.includes(a)) throw new Error("no match: " + a.slice(0, 60)); s = s.split(a).join(b); };

  // A status badge carries functional text, so it may not sit below 13px.
  swap(
    `    .pill { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px;
      border-radius: 12px; border: 1px solid var(--line); background: transparent;
      font-size: 12.5px; color: var(--mut); white-space: nowrap; }`,
    `    .pill { display: inline-flex; align-items: center; gap: 6px; min-height: 26px; padding: 2px 10px;
      border-radius: 13px; border: 1px solid var(--line); background: transparent;
      font-size: 13px; line-height: 19px; color: var(--mut); white-space: nowrap; }`,
  );

  // Labelled controls are 36px. Only icon-only controls may drop to 32, and
  // they never shrink below it.
  swap(
    `    /* dense variant: 32px, never 28 */
    .btns { height: 32px; padding: 0 12px; font-size: 13px; border-radius: 7px; }`,
    `    /* dense variant keeps the 36px standard height, trading padding not size */
    .btns { height: 36px; padding: 0 12px; font-size: 13px; border-radius: 7px; }`,
  );
  swap(
    `    .ico { width: 36px; padding: 0; }
    .ico.btns { width: 32px; }`,
    `    .ico { width: 36px; min-width: 36px; padding: 0; flex-shrink: 0; }
    .ico.btns { width: 36px; min-width: 36px; }`,
  );

  // Any bare button that acts as a control gets a floor, so a page cannot
  // shrink one with inline padding.
  swap(
    `    .sep { height: 1px; background: var(--line-soft); }`,
    `    /* floor for controls that are not one of the named primitives */
    .hit { display: inline-flex; align-items: center; min-height: 36px; }

    .sep { height: 1px; background: var(--line-soft); }`,
  );

  writeFileSync(p, s);
  console.log("tokens: pill 13px, .btns 36px, icons 36x36 with a floor");
}

/* ------------------------------- inline overrides across every template --- */
const dirs = ["design/parts", "design/partials"];
let files = 0, fontBumps = 0, pillStrips = 0;

for (const dir of dirs) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".html"))) {
    const p = join(dir, f);
    let s = readFileSync(p, "utf8");
    const before = s;

    // 1. a pill's size comes from the class, never from an inline override
    s = s.replace(/<(\w+)([^>]*class="[^"]*\bpill\b[^"]*"[^>]*)>/g, (m) => {
      const cleaned = m
        .replace(/height:\s*[\d.]+px;?\s*/g, "")
        .replace(/font-size:\s*[\d.]+px;?\s*/g, "")
        .replace(/style="\s*"/g, "")
        .replace(/;\s*"/g, '"');
      if (cleaned !== m) pillStrips++;
      return cleaned;
    });

    // 2. nothing customer-facing below 12.5px
    s = s.replace(/font-size:\s*(\d+(?:\.\d+)?)px/g, (m, n) => {
      const v = parseFloat(n);
      if (v >= 12.5) return m;
      fontBumps++;
      return "font-size:12.5px";
    });

    if (s !== before) { writeFileSync(p, s); files++; }
  }
}
console.log(`inline sweep: ${files} files, ${fontBumps} font sizes raised, ${pillStrips} pill overrides stripped`);
