// ForgeLocal site generator.
//
//   node design/build.mjs
//
// Emits real routes (not a folder of disconnected screens), one shared
// stylesheet and script, and every model surface rendered from the single
// profile source of truth in design/data/models.mjs.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expand } from "./lib/assemble.mjs";
import { models } from "./data/models.mjs";
import * as F from "./lib/fit.mjs";
import { pickerHtml } from "./lib/picker.mjs";
import { recommendationBlock, installBlock, exploreList, myModelsList } from "./lib/appviews.mjs";

F.registerModels(models);

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const partsDir = join(here, "parts");
// Vercel serves the build output directory, not the repo, so nothing under
// design/ or refs/ is published.
const out = (p) => join(root, "public", p);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const write = (rel, html) => { mkdirSync(dirname(out(rel)), { recursive: true }); writeFileSync(out(rel), html); };
const SELECTED = "qwen25-coder-14b-q4km";
const inst = installBlock();
const mine = myModelsList(models);
const BIND = {
  "<!--MODEL_PICKER-->": () => pickerHtml(models, SELECTED),
  "<!--RECOMMENDATION-->": () => recommendationBlock(models),
  "<!--EXPLORE_LIST-->": () => exploreList(models),
  "<!--MINE_LIST-->": () => mine.rows,
  "<!--MINE_TOTAL-->": () => mine.totalGB,
  "<!--MINE_FREE-->": () => mine.freeGB,
  "<!--REC_NAME-->": () => inst.name,
  "<!--REC_TOTAL-->": () => inst.total,
  "<!--REC_DONE-->": () => inst.done,
  "<!--REC_FREE-->": () => inst.freeAfter,
};
const part = (name) => {
  let html = expand(readFileSync(join(partsDir, `${name}.body.html`), "utf8"));
  for (const [marker, render] of Object.entries(BIND)) {
    if (html.includes(marker)) html = html.split(marker).join(render());
  }
  return html;
};
const inc = (s) => expand(s);

// ---------------------------------------------------------------- assets ---
const css = readFileSync(join(here, "head.part"), "utf8").match(/<style>([\s\S]*?)<\/style>/)[1];
mkdirSync(out("assets"), { recursive: true });
writeFileSync(out("assets/forgelocal.css"), css.replace(/^ {4}/gm, ""));
copyFileSync(join(here, "assets/forgelocal.js"), out("assets/forgelocal.js"));
writeFileSync(out("assets/models.json"), JSON.stringify(
  models.map((m) => {
    const fit = F.fitFor(m);
    return { id: m.id, name: m.displayName, publisher: m.publisher, tasks: m.tasks,
      quantization: m.quantization, downloadGB: +F.gb(m.downloadBytes, 2),
      license: m.licenseId, fit: fit.state, fitLabel: fit.label, installed: m.installed };
  }), null, 2));

const MARK_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="6" fill="#0E0F10"/><rect x="2.4" y="2.4" width="19.2" height="19.2" rx="5.6" stroke="#EDEDEB" stroke-width="1.7"/><path d="M8.6 8.9 11.7 12l-3.1 3.1" stroke="#EDEDEB" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.6 15.1h3.3" stroke="#EDEDEB" stroke-width="1.9" stroke-linecap="round"/></svg>`;
writeFileSync(out("assets/mark.svg"), MARK_SVG);
// browsers ask for /favicon.ico whatever the page declares
writeFileSync(out("favicon.ico"), MARK_SVG);

// ----------------------------------------------------------------- shell ---
function doc({ title, desc = "", body, cls = "", bodyStyle = "", nav = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<link rel="icon" href="/assets/mark.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<link rel="stylesheet" href="/assets/forgelocal.css">
</head>
<body class="${cls}" style="${bodyStyle}">
<a class="vh" href="#main">Skip to content</a>
${body}
<script src="/assets/forgelocal.js" defer></script>
</body>
</html>
`;
}

const header = (current) =>
  inc(readFileSync(join(here, "partials/site-header.html"), "utf8"))
    .replace(`href="${current}"`, `href="${current}" aria-current="page"`);
const footer = () => inc(readFileSync(join(here, "partials/site-footer.html"), "utf8"));

const marketing = ({ path, title, desc, main }) =>
  doc({ title, desc, cls: "site", body: `${header(path)}\n<main id="main">\n${main}\n</main>\n${footer()}` });

const appPage = ({ title, body }) =>
  doc({ title, cls: "app", bodyStyle: "height:100%;overflow:hidden", body: `<main id="main" style="height:100%">${body}</main>` });

// ------------------------------------------------------------ model views ---
const fmtParams = (n) => `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, "")}B`;
const toneClass = { ok: "ok", warn: "warn", bad: "bad", mut: "" };

function fitPill(fit) {
  return `<span class="pill ${toneClass[fit.tone] || ""}">${esc(fit.label)}</span>`;
}

function modelRow(m, { href = `/models/${m.id}/`, action = "" } = {}) {
  const fit = F.fitFor(m);
  const speed = F.speedFor(m);
  return `<li class="box" data-filter-item data-name="${esc(m.displayName + " " + m.publisher)}"
    data-tags="${m.tasks.join(" ")} ${m.installed ? "installed" : ""} ${fit.state === "great" || fit.state === "tradeoffs" ? "fits" : ""}"
    style="padding:16px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
  <div style="flex:1;min-width:240px;display:flex;flex-direction:column;gap:7px">
    <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
      <a class="h2" href="${href}" style="color:var(--fg)">${esc(m.displayName)}</a>
      ${fitPill(fit)}
      ${m.installed ? '<span class="pill">Installed</span>' : ""}
      ${m.loaded ? '<span class="pill ok">Loaded</span>' : ""}
    </div>
    <p class="mut" style="margin:0;font-size:13.5px;line-height:20px">${esc(m.strength)}</p>
    <p class="faint" style="margin:0;font-size:12.5px;line-height:18px">${esc(fit.reason)}</p>
    <div style="display:flex;gap:16px;flex-wrap:wrap;padding-top:2px">
      <span class="lab num">${esc(m.publisher)}</span>
      <span class="lab num">${esc(m.quantization)} &middot; ${fmtParams(m.parameterCount)}</span>
      <span class="lab num">${F.gb(m.downloadBytes, 1)} GB download</span>
      <span class="lab">${esc(m.licenseId)}</span>
      <span class="lab">${speed.measured ? esc(speed.text) : "Speed not measured"}</span>
    </div>
  </div>
  <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
    ${action || `<a class="btn btns" href="${href}">View details</a>`}
  </div>
</li>`;
}

// --------------------------------------------------------------- routes -----

/* / ------------------------------------------------------------------- */
write("index.html", marketing({
  path: "/", title: "ForgeLocal — a coding agent that runs on your PC",
  desc: "ForgeLocal reads your hardware, installs a coding model that will actually run on it, and gives that model reviewable tools for files, commands and tests.",
  main: part("Homepage"),
}));

/* /models/ ----------------------------------------------------------- */
const catalogRows = models.map((m) => modelRow(m)).join("\n");
write("models/index.html", marketing({
  path: "/models/", title: "Models — ForgeLocal",
  desc: "Open coding models with the memory arithmetic shown, so you can tell what will run on your machine before you download it.",
  main: `
<section class="mwrap msec" style="padding-top:64px;padding-bottom:32px">
  <div class="stack" style="gap:16px;max-width:720px">
    <span class="lab">Model catalog</span>
    <h1 class="mh2">Models that work on your machine</h1>
    <p class="mlede">Every fit below is arithmetic, not a claim: quantized weights, plus the
      key-value cache for a given context, plus runtime overhead, against the memory a machine
      actually has. Install ForgeLocal and it does this against your hardware instead of the
      reference PC used here.</p>
    <p class="faint" style="margin:0;font-size:13px">Reference machine for this page:
      <strong>${esc(F.thisPC.label)}</strong>.</p>
  </div>
</section>

<section class="mwrap msec" style="padding-bottom:96px" data-filter-root>
  <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
    <label class="field" style="flex:1;min-width:220px;max-width:320px">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="flex-shrink:0"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
      <span class="vh">Search models</span>
      <input data-filter-search type="search" placeholder="Search models"
        style="border:0;background:transparent;outline:none;flex:1;min-width:0;color:var(--fg);font-size:13px">
    </label>
    <div style="display:flex;gap:7px;flex-wrap:wrap">
      <button class="pill" type="button" data-filter="coding" aria-pressed="false">Coding</button>
      <button class="pill" type="button" data-filter="general" aria-pressed="false">General</button>
      <button class="pill" type="button" data-filter="tool-use" aria-pressed="false">Tool use</button>
      <button class="pill" type="button" data-filter="fits" aria-pressed="false">Fits this reference PC</button>
    </div>
    <span class="grow"></span>
    <span class="lab num" data-filter-count>${models.length} models</span>
    <button class="btn btnq btns" type="button" data-filter-clear hidden>Clear all</button>
  </div>

  <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px">
${catalogRows}
  </ul>
  <p class="box" data-filter-empty hidden style="padding:24px;text-align:center;color:var(--mut);margin:12px 0 0">
    No models match those filters.
  </p>

  <p class="faint" style="margin:24px 0 0;font-size:12.5px;max-width:70ch">
    No throughput figures are published here. Nothing in this catalog has been benchmarked yet,
    and a tokens-per-second number is meaningless without stating the exact quantization, context,
    runtime build and offload split it was measured with. ForgeLocal measures throughput on your
    own machine after install and records it against that exact profile.
  </p>
</section>`,
}));

/* /models/<id>/ ------------------------------------------------------- */
for (const m of models) {
  const fit = F.fitFor(m);
  const speed = F.speedFor(m);
  const kv = F.kvCacheBytes(m, fit.context);
  const contexts = m.contextOptions.map((c) => {
    const f = F.fitFor(m, F.thisPC, c);
    return `<tr>
      <td class="num">${F.fmtCtx(c)}</td>
      <td class="num">${F.gb(F.kvCacheBytes(m, c), 2)} GB</td>
      <td class="num">${F.gb(F.requiredBytes(m, c), 1)} GB</td>
      <td>${fitPill(f)}</td>
    </tr>`;
  }).join("\n");

  write(`models/${m.id}/index.html`, marketing({
    path: "/models/", title: `${m.displayName} — ForgeLocal`,
    desc: `${m.displayName} ${m.quantization}: ${m.strength}`,
    main: `
<section class="mwrap msec" style="padding-top:56px;padding-bottom:24px">
  <a href="/models/" style="font-size:13px">&larr; All models</a>
  <div class="stack" style="gap:14px;max-width:760px;margin-top:16px">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <h1 class="mh2" style="font-size:34px">${esc(m.displayName)}</h1>
      ${fitPill(fit)}
    </div>
    <p class="mlede">${esc(m.strength)}</p>
    <p class="mut" style="margin:0;font-size:14px;line-height:21px">${esc(m.limitation)}</p>
  </div>
</section>

<section class="mwrap msec" style="padding-bottom:40px">
  <div class="box" style="padding:20px;display:flex;gap:32px;flex-wrap:wrap;align-items:center">
    <div class="stack" style="gap:4px"><span class="lab">Publisher</span><span>${esc(m.publisher)}</span></div>
    <div class="stack" style="gap:4px"><span class="lab">Parameters</span><span class="num">${fmtParams(m.parameterCount)}</span></div>
    <div class="stack" style="gap:4px"><span class="lab">Quantization</span><span class="num">${esc(m.quantization)} &middot; ${esc(m.format)}</span></div>
    <div class="stack" style="gap:4px"><span class="lab">Download</span><span class="num">${F.gb(m.downloadBytes, 2)} GB</span></div>
    <div class="stack" style="gap:4px"><span class="lab">On disk</span><span class="num">${F.gb(m.installedBytes, 2)} GB</span></div>
    <div class="stack" style="gap:4px"><span class="lab">License</span><span>${esc(m.licenseId)}</span></div>
    <span class="grow"></span>
    <a class="btn btnp" href="/download/">Get ForgeLocal to install this</a>
  </div>
</section>

<section class="mwrap msec" style="padding-bottom:40px">
  <h2 class="h2" style="font-size:20px;margin-bottom:10px">Hardware fit on ${esc(F.thisPC.label)}</h2>
  <p class="mut" style="margin:0 0 16px;font-size:14px;line-height:21px;max-width:70ch">${esc(fit.reason)}</p>
  <div style="overflow-x:auto">
    <table class="tbl" style="min-width:520px">
      <caption class="vh">Memory required at each context length</caption>
      <thead><tr><th>Context</th><th>KV cache</th><th>Total needed</th><th>Fit</th></tr></thead>
      <tbody>${contexts}</tbody>
    </table>
  </div>
  <details class="box" style="margin-top:14px">
    <summary style="padding:12px 16px;cursor:pointer;font-size:13.5px">How this is calculated</summary>
    <div style="padding:0 16px 16px" class="mut">
      <p style="margin:0 0 8px;font-size:13.5px;line-height:20px">
        Total = quantized weights + KV cache + runtime overhead.
      </p>
      <p class="m" style="margin:0 0 8px;font-size:12.5px;line-height:19px">
        KV = 2 &times; layers(${m.attention.layers}) &times; kv_heads(${m.attention.kvHeads}) &times;
        head_dim(${m.attention.headDim}) &times; context &times; 2 bytes (f16)
      </p>
      <p style="margin:0;font-size:13px;line-height:19px">
        Runtime overhead is taken as a flat ${F.gb(F.RUNTIME_OVERHEAD_BYTES, 1)} GB for ${esc(m.runtime)}.
        These are planning figures. Real usage varies with the runtime build, batch size and
        offload split, which is why ForgeLocal re-measures on your machine.
      </p>
    </div>
  </details>
</section>

<section class="mwrap msec" style="padding-bottom:40px">
  <h2 class="h2" style="font-size:20px;margin-bottom:10px">Measured performance</h2>
  <div class="box" style="padding:20px;display:flex;gap:14px;align-items:flex-start">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="8.5"/><path d="M12 16v-4.5M12 8.2h.01"/></svg>
    <div>
      <p style="margin:0 0 6px;font-size:14px;font-weight:600">${esc(speed.text)}</p>
      <p class="mut" style="margin:0;font-size:13.5px;line-height:20px;max-width:66ch">${esc(speed.detail)}
        Publishing a tokens-per-second figure without the hardware, runtime build, context and
        offload split it came from would not be useful, so this page shows nothing until there is
        a real measurement to show.</p>
    </div>
  </div>
</section>

<section class="mwrap msec" style="padding-bottom:40px">
  <h2 class="h2" style="font-size:20px;margin-bottom:10px">Test evidence</h2>
  <div class="box" style="padding:20px">
    <p class="mut" style="margin:0 0 12px;font-size:13.5px;line-height:20px;max-width:70ch">
      ForgeLocal runs an agent check suite against each profile: streaming, typed tool calls,
      schema-guided repair, a bounded write, a patch, a command and its output. A profile is
      only marked verified once that suite has passed on a named machine class.
    </p>
    <p style="margin:0;display:flex;align-items:center;gap:9px;font-size:13.5px">
      <span class="pill">Not yet verified</span>
      <span class="mut">No suite run has been recorded for this profile.</span>
    </p>
  </div>
</section>

<section class="mwrap msec" style="padding-bottom:40px">
  <h2 class="h2" style="font-size:20px;margin-bottom:10px">Source and license</h2>
  <div class="box" style="padding:20px;display:flex;flex-direction:column;gap:10px">
    <div style="display:flex;gap:14px;flex-wrap:wrap"><span class="lab" style="width:110px">Source</span>
      <a href="${esc(m.sourceUrl)}" rel="noreferrer noopener" target="_blank">${esc(m.sourceUrl)}</a></div>
    <div style="display:flex;gap:14px;flex-wrap:wrap"><span class="lab" style="width:110px">Revision</span><span class="m">${esc(m.sourceRevision)}</span></div>
    <div style="display:flex;gap:14px;flex-wrap:wrap"><span class="lab" style="width:110px">License</span><span>${esc(m.licenseId)}</span></div>
    <div style="display:flex;gap:14px;flex-wrap:wrap"><span class="lab" style="width:110px">Checksum</span>
      <span class="mut">Recorded at download time and re-verified on load.</span></div>
    <p class="faint" style="margin:4px 0 0;font-size:12.5px">
      Weights are fetched from the publisher. ForgeLocal distributes a signed profile manifest, not the model.
    </p>
  </div>
</section>`,
  }));
}

console.log(`routes: / /models/ + ${models.length} model details`);

// --------------------------------------------------------- extra routes ---
import { extraRoutes } from "./routes-extra.mjs";
const extra = extraRoutes({ write, marketing, appPage, part, esc, models, F, gb: F.gb });
console.log(`app routes: ${extra.appRoutes.length}, setup steps: ${extra.setup.length}`);
