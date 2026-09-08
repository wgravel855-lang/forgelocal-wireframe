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
import { catalogHtml } from "./lib/catalog.mjs";
import { recommendationBlock, installBlock, exploreList, myModelsList, scanVerdict } from "./lib/appviews.mjs";
import { chatList, projectOptions, moveOptions, sessionData } from "./lib/chatlist.mjs";

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
  "<!--SCAN_ICON-->": () => scanVerdict().svg,
  "<!--SCAN_HEAD-->": () => scanVerdict().head,
  "<!--SCAN_SUB-->": () => scanVerdict().sub,
  "<!--EXPLORE_LIST-->": () => exploreList(models),
  "<!--CATALOG-->": () => catalogHtml(models, null),
  "<!--MINE_LIST-->": () => mine.rows,
  "<!--MINE_TOTAL-->": () => mine.totalGB,
  "<!--MINE_FREE-->": () => mine.freeGB,
  "<!--CHAT_LIST-->": () => chatList(),
  "<!--PROJECT_OPTIONS-->": () => projectOptions(),
  "<!--MOVE_OPTIONS-->": () => moveOptions(),
  "<!--SESSION_DATA-->": () => sessionData(),
  "<!--MINE_COUNT-->": () => `${mine.count} model${mine.count === 1 ? "" : "s"}`,
  "<!--EXPLORE_COUNT-->": () => `${models.length} model${models.length === 1 ? "" : "s"}`,
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

// One workspace shell for every conversation route.
const workspace = ({ active, title, thread }) => {
  let html = readFileSync(join(partsDir, "Workspace.body.html"), "utf8")
    .split("{{active}}").join(active)
    .split("{{title}}").join(title)
    .split("{{thread}}").join(thread);
  html = expand(html);
  for (const [marker, render] of Object.entries(BIND)) {
    if (html.includes(marker)) html = html.split(marker).join(render());
  }
  return html;
};

// ---------------------------------------------------------------- assets ---
const css = readFileSync(join(here, "head.part"), "utf8").match(/<style>([\s\S]*?)<\/style>/)[1];
mkdirSync(out("assets"), { recursive: true });
writeFileSync(out("assets/forgelocal.css"), css.replace(/^ {4}/gm, ""));
copyFileSync(join(here, "assets/forgelocal.js"), out("assets/forgelocal.js"));
// the controller is an ES module now, so its imports ship next to it
mkdirSync(out("core"), { recursive: true });
for (const f of ["events.mjs", "models.mjs", "adapters.mjs", "context.mjs", "reading.mjs"]) {
  copyFileSync(join(here, "core", f), out("core/" + f));
}
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

const OG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#0E0F10"/>
<g transform="translate(88,232) scale(3.4)"><rect x="2.4" y="2.4" width="19.2" height="19.2" rx="5.6" stroke="#EDEDEB" stroke-width="1.7" fill="none"/><path d="M8.6 8.9 11.7 12l-3.1 3.1" stroke="#EDEDEB" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M13.6 15.1h3.3" stroke="#EDEDEB" stroke-width="1.9" stroke-linecap="round" fill="none"/></g>
<text x="88" y="360" font-family="Inter,Segoe UI,system-ui,sans-serif" font-size="68" font-weight="600" fill="#EDEDEB" letter-spacing="-1.6">Build on your PC.</text>
<text x="88" y="440" font-family="Inter,Segoe UI,system-ui,sans-serif" font-size="68" font-weight="600" fill="#EDEDEB" letter-spacing="-1.6">Skip the model setup.</text>
<text x="88" y="512" font-family="Inter,Segoe UI,system-ui,sans-serif" font-size="27" fill="#A2A39F">A coding agent that runs on your own hardware.</text>
</svg>`;
writeFileSync(out("assets/og.svg"), OG_SVG);

// ----------------------------------------------------------------- shell ---
const SITE = "https://forgelocal-wireframe.vercel.app";

function doc({ title, desc = "", body, cls = "", bodyStyle = "", canonical = "", jsonld = null }) {
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
<meta property="og:site_name" content="ForgeLocal">
<meta property="og:image" content="${SITE}/assets/og.svg">
<meta property="og:url" content="${SITE}${canonical || "/"}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${SITE}/assets/og.svg">
<link rel="canonical" href="${SITE}${canonical || "/"}">
<link rel="icon" href="/assets/mark.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<link rel="stylesheet" href="/assets/forgelocal.css">${jsonld ? `
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ""}
</head>
<body class="${cls}" style="${bodyStyle}">
<a class="vh" href="#main">Skip to content</a>
${body}
<script type="module" src="/assets/forgelocal.js"></script>
</body>
</html>
`;
}

const header = (current) =>
  inc(readFileSync(join(here, "partials/site-header.html"), "utf8"))
    .replace(`href="${current}"`, `href="${current}" aria-current="page"`);
const footer = () => inc(readFileSync(join(here, "partials/site-footer.html"), "utf8"));

// A one-field task, an error page or a legal document does not need the full
// marketing CTA footer under it.
const utilityFooter = () => inc(`
<footer class="mfoot mfoot-slim">
  <div class="mwrap mfoot-legal">
    <a class="brand small" href="/"><!--#include mark.html {"size":"16"} --> ForgeLocal</a>
    <span class="grow"></span>
    <a href="/privacy/">Privacy</a>
    <a href="/terms/">Terms</a>
    <a href="/security/">Security</a>
  </div>
</footer>`);

const marketing = ({ path, title, desc, main, canonical, jsonld, compact }) =>
  doc({
    title, desc, cls: "site", canonical: canonical ?? path, jsonld,
    body: `${header(path)}\n<main id="main">\n${main}\n</main>\n${
      compact ? utilityFooter() : footer()}`,
  });

const appPage = ({ title, body }) =>
  doc({ title, cls: "app", bodyStyle: "height:100%;overflow:hidden", body: `<main id="main" style="height:100%">${body}</main>` });

// ------------------------------------------------------------ model views ---
const fmtParams = (n) => `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, "")}B`;
const toneClass = { ok: "ok", warn: "warn", bad: "bad", mut: "" };

function fitDot(fit) {
  const cls = { ok: "ok", warn: "warn", bad: "bad", mut: "" }[fit.tone] || "";
  return `<span class="rfit"><span class="dot ${cls}" aria-hidden="true"></span>${esc(fit.label)}</span>`;
}

// One registry row. Name and use case lead, then fit, then the three numbers
// that decide whether it will run. The title link is stretched over the row so
// the whole row is the target without wrapping the metadata in an anchor.
function modelRow(m, { href = `/models/${m.id}/`, action = "" } = {}) {
  const fit = F.fitFor(m);
  const current = m.loaded || m.recommended;
  return `<li data-filter-item data-name="${esc(m.displayName + " " + m.publisher)}"
    data-tags="${m.tasks.join(" ")} ${m.installed ? "installed" : ""} ${fit.state === "great" || fit.state === "tradeoffs" ? "fits" : ""}"${current ? ' class="is-current"' : ""}>
  <div class="rrow" data-row-target>
    <div style="min-width:0">
      <a class="rname" href="${href}">${esc(m.displayName)}</a>
      <p class="ruse">${esc(m.strength)}</p>
    </div>
    ${fitDot(fit)}
    <div class="rnums">
      <span class="rnum"><b>${F.gb(fit.required, 1)} GB</b><span>video memory</span></span>
      <span class="rnum"><b>${F.gb(m.downloadBytes, 1)} GB</b><span>download</span></span>
      <span class="rnum"><b>${esc(F.fmtCtx(fit.context))}</b><span>context</span></span>
    </div>
    <p class="rmeta">${esc(m.publisher)}<br>${esc(m.licenseId)}${m.installed ? " &middot; Installed" : ""}${m.loaded ? " &middot; In use" : ""}</p>
    ${action || `<svg class="rchev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`}
  </div>
</li>`;
}

// --------------------------------------------------------------- routes -----

/* / ------------------------------------------------------------------- */
write("index.html", marketing({
  path: "/", title: "ForgeLocal — a coding agent that runs on your PC",
  desc: "ForgeLocal reads your hardware, installs a coding model that will actually run on it, and gives that model reviewable tools for files, commands and tests.",
  main: part("Homepage"),
  jsonld: {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ForgeLocal",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Windows 10, Windows 11",
    description: "A coding agent that runs a local model on your own hardware, with reviewable file, command and test tools.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    url: SITE,
  },
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

<section class="mwrap msec" style="padding-bottom:56px" data-filter-root>
  <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
    <label class="field" style="flex:1;min-width:220px;max-width:320px">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="flex-shrink:0"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
      <span class="vh">Search models</span>
      <input data-filter-search type="search" placeholder="Search models"
        style="border:0;background:transparent;outline:none;flex:1;min-width:0;color:var(--fg);font-size:13px">
    </label>
    <div class="seg" role="group" aria-label="Filter by capability">
      <button type="button" data-filter="coding" aria-pressed="false">Coding</button>
      <button type="button" data-filter="general" aria-pressed="false">General</button>
      <button type="button" data-filter="tool-use" aria-pressed="false">Tool use</button>
      <button type="button" data-filter="fits" aria-pressed="false">Fits this PC</button>
    </div>
    <span class="grow"></span>
    <span class="msmall num" style="color:var(--faint)" data-filter-count>${models.length} models</span>
    <button class="btn btnq btns" type="button" data-filter-clear hidden>Clear</button>
  </div>

  <ul class="reg">
${catalogRows}
  </ul>
  <p data-filter-empty hidden style="padding:36px 16px;text-align:center;color:var(--mut);margin:0;border-bottom:1px solid var(--line)">
    No model matches those filters.
  </p>

  <p class="faint" style="margin:22px 0 0;font-size:13px;line-height:20px;max-width:72ch">
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
    const f = F.fitAtContext(m, F.thisPC, c);
    return `<tr>
      <td class="num">${F.fmtCtx(c)}</td>
      <td class="num">${F.gb(F.kvCacheBytes(m, c), 2)} GB</td>
      <td class="num">${F.gb(F.requiredBytes(m, c), 1)} GB</td>
      <td><span class="rfit"><span class="dot ${toneClass[f.tone] || ''}" aria-hidden="true"></span>${esc(f.label)}</span></td>
    </tr>`;
  }).join("\n");

  write(`models/${m.id}/index.html`, marketing({
    path: "/models/", canonical: `/models/${m.id}/`,
    title: `${m.displayName} — ForgeLocal`,
    desc: `${m.displayName} ${m.quantization}: ${m.strength}`,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: m.displayName,
      applicationCategory: "DeveloperApplication",
      author: { "@type": "Organization", name: m.publisher },
      license: m.licenseId,
      softwareVersion: m.quantization,
      fileSize: `${F.gb(m.downloadBytes, 2)} GB`,
      url: `${SITE}/models/${m.id}/`,
    },
    main: `
<section class="mwrap msec" style="padding-top:48px;padding-bottom:56px">
  <a href="/models/" style="font-size:14px">&larr; All models</a>

  <div class="stack" style="gap:12px;max-width:780px;margin-top:10px">
    <h1 class="mh2" style="font-size:34px">${esc(m.displayName)}</h1>
    <p style="margin:0;display:flex;align-items:center;gap:8px;font-size:15px;line-height:23px">
      <span class="dot ${toneClass[fit.tone] || ""}" aria-hidden="true"></span>${esc(fit.label)}
      <span class="mut">on ${esc(F.thisPC.label)}</span>
    </p>
    <p class="mlede">${esc(m.strength)}</p>
    <p class="mut" style="margin:0;font-size:15px;line-height:24px">${esc(m.limitation)}</p>
  </div>

  <dl class="specs">
    <div><dt>Publisher</dt><dd>${esc(m.publisher)}</dd></div>
    <div><dt>Parameters</dt><dd>${fmtParams(m.parameterCount)}</dd></div>
    <div><dt>Quantization</dt><dd>${esc(m.quantization)} &middot; ${esc(m.format)}</dd></div>
    <div><dt>Download</dt><dd>${F.gb(m.downloadBytes, 2)} GB</dd></div>
    <div><dt>On disk</dt><dd>${F.gb(m.installedBytes, 2)} GB</dd></div>
    <div><dt>License</dt><dd>${esc(m.licenseId)}</dd></div>
  </dl>
  <div style="margin-top:20px"><a class="btn btnp btnl" href="/download/">Get ForgeLocal to install this</a></div>

  <section class="docsec">
    <h2>Hardware fit</h2>
    <p>${esc(fit.reason)}</p>
    <div style="overflow-x:auto">
      <table class="tbl flat" style="min-width:520px">
        <caption class="vh">Memory required at each context length</caption>
        <thead><tr><th>Context</th><th>KV cache</th><th>Total needed</th><th>Fit</th></tr></thead>
        <tbody>${contexts}</tbody>
      </table>
    </div>
    <div class="faq" style="margin-top:4px;max-width:76ch">
      <details>
        <summary>How this is calculated<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9.5 6 6 6-6"/></svg></summary>
        <p>Total = quantized weights + KV cache + runtime overhead.</p>
        <p class="m" style="padding-top:0;font-size:13px;line-height:20px">KV = 2 &times; layers(${m.attention.layers}) &times; kv_heads(${m.attention.kvHeads}) &times; head_dim(${m.attention.headDim}) &times; context &times; 2 bytes (f16)</p>
        <p style="padding-top:0">Runtime overhead is taken as a flat ${F.gb(F.RUNTIME_OVERHEAD_BYTES, 1)} GB for ${esc(m.runtime)}. These are planning figures. Real usage varies with the runtime build, batch size and offload split, which is why ForgeLocal re-measures on your machine.</p>
      </details>
    </div>
  </section>

  <section class="docsec">
    <h2>Measured performance</h2>
    <div class="callout">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 16v-4.5M12 8.2h.01"/></svg>
      <div>
        <p style="margin:0 0 6px;font-size:15px;line-height:23px;font-weight:600">${esc(speed.text)}</p>
        <p class="mut" style="margin:0;font-size:14px;line-height:22px;max-width:66ch">${esc(speed.detail)}
          Publishing a tokens-per-second figure without the hardware, runtime build, context and
          offload split it came from would not be useful, so this page shows nothing until there is
          a real measurement to show.</p>
      </div>
    </div>
  </section>

  <section class="docsec">
    <h2>Test evidence</h2>
    <p>ForgeLocal runs an agent check suite against each profile: streaming, typed tool calls,
      schema-guided repair, a bounded write, a patch, a command and its output. A profile is
      only marked verified once that suite has passed on a named machine class.</p>
    <p style="margin:0;display:flex;align-items:center;gap:9px;font-size:15px;line-height:23px">
      <span class="dot" aria-hidden="true"></span>Not yet verified
      <span class="mut">No suite run has been recorded for this profile.</span>
    </p>
  </section>

  <section class="docsec">
    <h2>Source and license</h2>
    <dl class="specs" style="border-bottom:0;margin-top:0;padding-bottom:0;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
      <div><dt>Source</dt><dd><a href="${esc(m.sourceUrl)}" rel="noreferrer noopener" target="_blank">${esc(m.sourceUrl.replace("https://huggingface.co/", ""))}</a></dd></div>
      <div><dt>Revision</dt><dd class="m">${esc(m.sourceRevision)}</dd></div>
      <div><dt>License</dt><dd>${esc(m.licenseId)}</dd></div>
      <div><dt>Checksum</dt><dd style="font-size:14px;color:var(--mut)">Recorded at download time and re-verified on load.</dd></div>
    </dl>
    <p class="faint" style="margin:18px 0 0;font-size:13px;line-height:20px">
      Weights are fetched from the publisher. ForgeLocal distributes a signed profile manifest, not the model.
    </p>
  </section>
</section>`,
  }));
}

console.log(`routes: / /models/ + ${models.length} model details`);

// --------------------------------------------------------- extra routes ---
import { extraRoutes } from "./routes-extra.mjs";
const extra = extraRoutes({ write, marketing, appPage, part, workspace, esc, models, F, gb: F.gb });
console.log(`app routes: ${extra.appRoutes.length}, setup steps: ${extra.setup.length}`);
