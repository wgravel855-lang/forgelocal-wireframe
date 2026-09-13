// @ts-check
/**
 * Visual checks for the model browser, at the sizes it is designed for.
 *
 * A real browser, at an exact viewport, measuring the boxes rather than
 * eyeballing them. The assertions are the ones a screenshot comparison cannot
 * make reliably and a person reviewing a PNG will not make at all: that the
 * modal is the size the specification says, that it is centred, that the panes
 * really are 40/60, that nothing overflows its container, and that both panes
 * scroll independently.
 *
 * It also writes the screenshots, so the same run that checks the geometry
 * produces the pictures somebody looks at.
 *
 *   node design/qa/visual.mjs            check, and write screenshots
 *   node design/qa/visual.mjs --out DIR  put them somewhere else
 *
 * Skips rather than fails when no Chromium-family browser is installed: this
 * runs on machines that have one and machines that do not, and a missing Edge
 * is not a broken layout.
 */

import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const pub = join(root, "public");

/** The three the brief names, and the one the responsive rule turns on. */
export const SIZES = Object.freeze([
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "860x900", width: 860, height: 900, narrow: true },
]);

const BINARIES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml",
};

/** Serve `public/` so the page loads its real stylesheet over http. */
function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      let path = decodeURIComponent(url.pathname);
      if (path.endsWith("/")) path += "index.html";
      const file = join(pub, path);
      if (!file.startsWith(pub)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      const ext = path.slice(path.lastIndexOf("."));
      res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404).end("not found"); }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = /** @type {any} */ (server.address());
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

/**
 * What the page reports about itself, measured in the page.
 *
 * Returned as numbers rather than asserted here, so a failure says what the
 * value was instead of only that it was wrong.
 */
const MEASURE = `(() => {
  const q = (s) => document.querySelector(s);
  const modal = q('.mb-modal');
  if (!modal) return { error: 'no modal rendered' };
  const m = modal.getBoundingClientRect();
  const list = q('.mb-list')?.getBoundingClientRect();
  const detail = q('.mb-detail')?.getBoundingClientRect();
  const rows = q('.mb-rows');
  const detailEl = q('.mb-detail');
  const narrow = innerWidth < 900;

  /* Anything whose content is wider than its box is clipped or spilling. */
  const overflowing = [...document.querySelectorAll('.mb-modal *')]
    .filter((el) => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'visible')
    .map((el) => el.className + ' ' + el.scrollWidth + '>' + el.clientWidth)
    .slice(0, 6);

  /* Body text must not fall below the floor the brief sets. */
  const small = [...document.querySelectorAll('.mb-detail p, .mb-detail li, .mb-row-desc')]
    .map((el) => ({ c: el.className, px: parseFloat(getComputedStyle(el).fontSize) }))
    .filter((x) => x.px < 12.4)
    .slice(0, 6);

  return {
    viewport: [innerWidth, innerHeight],
    modal: [Math.round(m.width), Math.round(m.height)],
    centreOffset: [
      Math.round((m.left + m.right) / 2 - innerWidth / 2),
      Math.round((m.top + m.bottom) / 2 - innerHeight / 2),
    ],
    listPct: list ? Math.round((list.width / m.width) * 100) : null,
    detailPct: detail ? Math.round((detail.width / m.width) * 100) : null,
    narrow,
    listScrolls: rows ? rows.scrollHeight > rows.clientHeight + 1 : false,
    detailScrolls: detailEl ? detailEl.scrollHeight > detailEl.clientHeight + 1 : false,
    readmeChars: (q('.mb-readme')?.textContent || '').trim().length,
    rowCount: document.querySelectorAll('.mb-row[data-mb-row]').length,
    selected: document.querySelectorAll('.mb-row.is-on').length,
    overflowing,
    small,
  };
})()`;

export async function runVisual({ out = join(root, "docs", "shots"), page: pagePath = "/_mbpreview.html" } = {}) {
  const exe = BINARIES.find((p) => existsSync(p)) ?? process.env.FORGELOCAL_BROWSER;
  if (!exe) {
    return { skipped: "No Chromium-family browser is installed, so nothing could be rendered." };
  }
  if (!existsSync(join(pub, pagePath.replace(/^\//, "")))) {
    return { skipped: `${pagePath} has not been built. Run the preview generator first.` };
  }

  const { chromium } = await import("playwright-core");
  const server = await serve();
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  /** @type {any[]} */
  const results = [];

  try {
    for (const size of SIZES) {
      const ctx = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 1,
        colorScheme: "dark",
      });
      const page = await ctx.newPage();
      await page.goto(server.url + pagePath, { waitUntil: "load" });
      await page.waitForSelector(".mb-modal", { timeout: 10000 });
      const m = await page.evaluate(MEASURE);
      const shot = join(out, `model-browser-${size.name}.png`);
      await page.screenshot({ path: shot });
      results.push({ ...size, ...m, shot });
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  return { results };
}

/** The assertions, separated so the test file and the CLI share them. */
export function checkVisual(r) {
  /** @type {string[]} */
  const problems = [];
  const say = (ok, msg) => { if (!ok) problems.push(`${r.name}: ${msg}`); };

  say(!r.error, r.error ?? "");
  if (r.error) return problems;

  const wantW = Math.min(1160, r.viewport[0] - 64);
  const wantH = Math.min(780, r.viewport[1] - 56);

  if (!r.narrow) {
    say(Math.abs(r.modal[0] - wantW) <= 2, `modal width ${r.modal[0]}, expected ${wantW}`);
    say(Math.abs(r.modal[1] - Math.max(600, wantH)) <= 2,
      `modal height ${r.modal[1]}, expected ${Math.max(600, wantH)}`);
    say(r.listPct >= 38 && r.listPct <= 42, `list pane is ${r.listPct}% of the modal, wanted 39-41`);
    say(r.detailPct >= 58 && r.detailPct <= 62, `detail pane is ${r.detailPct}%, wanted 59-61`);
  } else {
    /* Below 900px the panes stack, so a 40% list would be wrong. */
    say(r.listPct > 90 || r.detailPct > 90, `narrow layout did not stack: list ${r.listPct}%`);
  }

  say(Math.abs(r.centreOffset[0]) <= 1 && Math.abs(r.centreOffset[1]) <= 1,
    `modal is off centre by ${r.centreOffset.join(", ")}px`);
  say(r.rowCount > 0, "no model rows rendered");
  say(r.selected === 1, `${r.selected} rows are marked selected, expected exactly 1`);
  say(r.readmeChars > 400, `the README pane holds ${r.readmeChars} characters; the lower pane is empty`);
  say(r.detailScrolls, "the detail pane does not scroll, so the README is not reachable");
  say(!r.overflowing.length, `content overflows its box: ${r.overflowing.join("; ")}`);
  say(!r.small.length,
    `text below the 13px floor: ${r.small.map((x) => `${x.c} ${x.px}px`).join("; ")}`);

  return problems;
}

/* Run directly, rather than imported by the test file.
 *
 * Compared as resolved URLs: on Windows import.meta.url is `file:///C:/...`
 * with three slashes and a drive letter whose case is not guaranteed to match
 * argv, so string-building the comparison silently never matches and the CLI
 * does nothing at all. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outFlag = process.argv.indexOf("--out");
  const out = outFlag > 0 ? process.argv[outFlag + 1] : undefined;
  const { results, skipped } = await runVisual({ out });
  if (skipped) { console.log(`visual: skipped — ${skipped}`); process.exit(0); }
  let bad = 0;
  for (const r of results) {
    const problems = checkVisual(r);
    bad += problems.length;
    console.log(`${problems.length ? "FAIL" : "ok  "}  ${r.name.padEnd(10)} `
      + `modal ${r.modal.join("x").padEnd(9)} panes ${r.listPct}/${r.detailPct} `
      + `rows ${r.rowCount} readme ${r.readmeChars}ch -> ${r.shot}`);
    for (const p of problems) console.log(`      ${p}`);
  }
  console.log(bad ? `\nvisual: ${bad} problem(s)` : `\nvisual: ${results.length} sizes, no problems`);
  process.exit(bad ? 1 : 0);
}
