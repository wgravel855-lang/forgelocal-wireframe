// Generates a plain static site from the wireframe artboards.
//
// The .dc.html files only render inside the design-canvas runtime, so this
// re-wraps each parts/*.body.html in an ordinary HTML document using the same
// stylesheet, and builds an index that previews them all in scaled iframes.
//
//   node design/build-site.mjs
//
// Output: ./index.html and ./screens/*.html at the repo root.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { readBody } from "./lib/assemble.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const partsDir = join(here, "parts");
const outDir = join(root, "screens");

const css = readFileSync(join(here, "head.part"), "utf8")
  .match(/<style>([\s\S]*?)<\/style>/)[1];

const canvas = JSON.parse(readFileSync(join(here, "canvas.json"), "utf8"));

const meta = new Map(
  canvas.artboards.map((a) => [
    a.file.replace(/\.dc\.html$/, ""),
    { title: a.title ?? a.file, page: a.page ?? canvas.pages[0].id, w: a.w, h: a.h, mode: a.mode ?? "fixed" },
  ]),
);
const pageName = new Map(canvas.pages.map((p) => [p.id, p.name]));
const noteFor = new Map((canvas.annotations ?? []).map((n) => [n.page, n.text]));

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const shell = (title, head, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/assets/forgelocal.css">
<style>
${head}
</style>
</head>
<body>
${body}
</body>
</html>
`;

mkdirSync(outDir, { recursive: true });

// canvas.json order is the intended reading order; readdir order is alphabetical
const onDisk = new Set(
  readdirSync(partsDir)
    .filter((f) => f.endsWith(".body.html"))
    .map((f) => f.replace(/\.body\.html$/, "")),
);
const names = canvas.artboards
  .map((a) => a.file.replace(/\.dc\.html$/, ""))
  .filter((n) => onDisk.has(n));

for (const name of names) {
  const { title, w, h, mode } = meta.get(name);
  const body = readBody(partsDir, name);

  // "app"   fills the viewport, scrolls internally  (desktop shell)
  // "page"  flows at full width, document scrolls   (marketing)
  // "fixed" legacy fixed-width canvas               (superseded screens)
  const fluid = mode === "app";
  const flow = mode === "page";
  const dark = fluid || (mode === "fixed" && /class="(win )?app[\s"]/.test(body));

  const head = flow ? `
  body { margin:0; }
  .bar { position:sticky; top:0; z-index:5; height:40px; display:flex; align-items:center;
    gap:14px; padding:0 16px; background:var(--panel);
    border-bottom:1px solid var(--line); color:var(--fg); font-size:13px; }
  #bare:target { display:none; }
  ` : fluid ? `
  html, body { height:100%; overflow:hidden; }
  body { margin:0; display:flex; flex-direction:column; }
  .bar { flex-shrink:0; height:40px; display:flex; align-items:center; gap:14px; padding:0 16px;
    background:#121315; border-bottom:1px solid #26282C; color:#EDEDEB; font-size:13px; }
  .bar a { color:#9698F2; }
  #bare:target { display:none; }
  .stage { flex:1; min-height:0; display:flex; }
  .stage > * { flex:1; min-width:0; }
  ` : `
  body { margin:0; background:${dark ? "#0A0A0B" : "#E4E0D8"};
    display:flex; flex-direction:column; align-items:center; }
  .bar { position:sticky; top:0; z-index:2; width:100%; height:44px; display:flex;
    align-items:center; gap:14px; padding:0 18px;
    background:${dark ? "#141517" : "#F1EDE5"};
    border-bottom:1px solid ${dark ? "#2A2C30" : "#DAD5CB"};
    color:${dark ? "#E9E9E7" : "#161719"}; font-size:13px; }
  .bar a { color:${dark ? "#8E90FF" : "#5B5CF0"}; }
  #bare:target { display:none; }
  #bare:target ~ .stage { padding:0; }
  .stage { padding:28px 20px 56px; }
  .frame { width:${w}px; box-shadow:0 18px 48px rgba(0,0,0,${dark ? ".55" : ".18"}); }
  @media (max-width: ${w + 60}px) {
    .stage { padding:16px 0 40px; }
    .frame { transform-origin: top left; }
  }`;

  // A page-mode screen flows at whatever width it is given; only the legacy
  // fixed canvases still get a hard-coded frame width.
  const stage = flow
    ? `<div class="stage">\n${body}\n</div>`
    : `<div class="stage"><div class="frame">\n${body}\n</div></div>`;

  const page = `<div class="bar" id="bare">
  <a href="/gallery/">&larr; Gallery</a>
  <a href="/" style="opacity:.6">Site</a>
  <span style="opacity:.5">/</span>
  <span>${esc(title)}</span>
  <span style="flex-grow:1"></span>
  <span style="opacity:.5;font-size:12px">${flow ? "responsive" : `${w} &times; ${h}`}</span>
</div>
${stage}`;

  writeFileSync(join(outDir, `${name}.html`), shell(`${title} · ForgeLocal wireframe`, head, page));
}

// ---- index -----------------------------------------------------------------

const CARD = 400;

const card = (name) => {
  const { title, w, h } = meta.get(name);
  const s = CARD / w;
  const clipped = Math.min(Math.round(h * s), 300);
  return `    <a class="card" href="/screens/${name}.html">
      <div class="shot" style="height:${clipped}px">
        <iframe src="/screens/${name}.html#bare" scrolling="no" tabindex="-1" aria-hidden="true"
          style="width:${w}px;height:${h}px;transform:scale(${s.toFixed(4)})"></iframe>
      </div>
      <div class="cap"><span>${esc(title)}</span><span class="dim">${w}&times;${h}</span></div>
    </a>`;
};

const sections = canvas.pages
  .map((p) => {
    const inPage = names.filter((n) => meta.get(n).page === p.id);
    if (!inPage.length) return "";
    const note = noteFor.get(p.id);
    return `  <section>
    <h2>${esc(p.name)}</h2>
    ${note ? `<p class="pagenote">${esc(note).replace(/\n/g, "<br>")}</p>` : ""}
    <div class="grid">
${inPage.map(card).join("\n")}
    </div>
  </section>`;
  })
  .filter(Boolean)
  .join("\n");

const indexHead = `
  body { margin:0; background:#F6F4EF; color:#161719; }
  .wrap { max-width:1320px; margin:0 auto; padding:56px 32px 96px; }
  header { display:flex; flex-direction:column; gap:12px; margin-bottom:44px; }
  h1 { font-size:30px; font-weight:600; letter-spacing:-.015em; margin:0; }
  h2 { font-size:16px; font-weight:600; margin:0 0 10px; }
  section { margin-bottom:52px; }
  .pagenote { margin:0 0 20px; max-width:760px; font-size:13px; line-height:1.6; color:#6E6A62;
    border-left:2px solid #DAD5CB; padding-left:14px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, 400px); justify-content:start; gap:22px; }
  .card { display:block; border:1px solid #DAD5CB; border-radius:8px; overflow:hidden;
    background:#FFF; text-decoration:none; color:inherit; }
  .card:hover { border-color:#5B5CF0; text-decoration:none; }
  .shot { overflow:hidden; background:#E4E0D8; border-bottom:1px solid #DAD5CB; }
  .shot iframe { border:0; transform-origin:top left; pointer-events:none; display:block; }
  .cap { display:flex; align-items:center; gap:10px; padding:11px 14px; font-size:13px; }
  .cap .dim { margin-left:auto; font-size:11px; color:#8B867C;
    font-family:"Geist Mono","Cascadia Mono",ui-monospace,Consolas,monospace; }`;

const indexBody = `<div class="wrap">
  <header>
    <span class="lab">Wireframe</span>
    <h1>ForgeLocal</h1>
    <p style="margin:0;max-width:660px;font-size:15px;line-height:1.6;color:#6E6A62">A local coding agent: it detects what the machine can run, installs a suitable open model, gives that model bounded coding tools, and keeps the whole thing reviewable. Greybox screens, not a build.</p>
  </header>
${sections}
</div>`;

mkdirSync(join(root, "gallery"), { recursive: true });
writeFileSync(join(root, "gallery", "index.html"), shell("Screen gallery (internal) - ForgeLocal", indexHead, indexBody));

console.log(`gallery + ${names.length} screens`);
