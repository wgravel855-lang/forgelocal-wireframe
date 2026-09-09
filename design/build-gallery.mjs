// Internal design-review gallery.
//
// It does NOT render its own copies of the product screens any more. Every tile
// previews and links to the real route, so there is exactly one implementation
// of each screen and the gallery cannot drift from it (which is precisely how
// the round-three regressions happened: the gallery was a second, unbound copy).
//
//   node design/build-gallery.mjs   (run after build.mjs)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const GROUPS = [
  {
    name: "Workspace",
    note: "The real application routes. Controls here are live: sidebar collapse, model picker, composer, drawer tabs, diff mode and review actions all work.",
    items: [
      ["Empty", "/app/", 1440, 900],
      ["Agent running", "/app/running/", 1440, 900],
      ["Permission request", "/app/permission/", 1440, 900],
      ["Change review", "/app/review/", 1440, 900],
      ["Stopped, no progress", "/app/stopped/", 1440, 900],
      ["Models, explore", "/app/models/", 1440, 900],
      ["Models, installed", "/app/models/installed/", 1440, 900],
    ],
  },
  {
    name: "Onboarding",
    note: "Four decisions in the application shell, then the real workspace.",
    items: [
      ["1. Welcome and system check", "/setup/", 1440, 900],
      ["2. Recommended model", "/setup/model/", 1440, 900],
      ["3. Project access", "/setup/project/", 1440, 900],
      ["4. Permission mode", "/setup/permissions/", 1440, 900],
    ],
  },
  {
    name: "Marketing site",
    note: "Light surface. Every value on the model pages is derived from the shared profile source.",
    items: [
      ["Home", "/", 1280, 1000],
      ["How it works", "/product/", 1280, 900],
      ["Model catalog", "/models/", 1280, 1000],
      ["Model detail", "/models/qwen25-coder-14b-q4km/", 1280, 1000],
      ["Download", "/download/", 1280, 900],
      ["Pricing", "/pricing/", 1280, 1000],
      ["Security", "/security/", 1280, 1000],
      ["Docs", "/docs/", 1280, 800],
      ["Changelog", "/changelog/", 1280, 700],
      ["Status", "/status/", 1280, 800],
      ["Privacy", "/privacy/", 1280, 900],
      ["Terms", "/terms/", 1280, 700],
      ["Waitlist", "/waitlist/", 1280, 800],
      ["Not found", "/404.html", 1280, 700],
    ],
  },
];

const CARD = 420;

const tile = ([label, href, w, h]) => {
  const s = CARD / w;
  return `      <a class="g-card" href="${href}">
        <span class="g-shot" style="height:${Math.min(Math.round(h * s), 300)}px">
          <iframe src="${href}" scrolling="no" tabindex="-1" aria-hidden="true" loading="lazy"
            style="width:${w}px;height:${h}px;transform:scale(${s.toFixed(4)})"></iframe>
        </span>
        <span class="g-cap"><span>${esc(label)}</span><span class="g-dim">${href}</span></span>
      </a>`;
};

const sections = GROUPS.map((g) => `    <section>
      <h2>${esc(g.name)}</h2>
      <p class="g-note">${esc(g.note)}</p>
      <div class="g-grid">
${g.items.map(tile).join("\n")}
      </div>
    </section>`).join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Screen gallery (internal) — ForgeLocal</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/assets/mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/forgelocal.css">
<style>
  body { background: var(--bg); }
  .g-wrap { max-width: 1360px; margin: 0 auto; padding: 56px 32px 96px; }
  .g-head { display: flex; flex-direction: column; gap: 12px; margin-bottom: 40px; }
  .g-head h1 { font-size: 30px; line-height: 38px; font-weight: 600; margin: 0; letter-spacing: -.02em; }
  section { margin-bottom: 56px; }
  section h2 { font-size: 18px; line-height: 26px; font-weight: 600; margin: 0 0 8px; }
  .g-note { margin: 0 0 20px; max-width: 72ch; font-size: 14px; line-height: 21px; color: var(--mut);
    border-left: 2px solid var(--line); padding-left: 14px; }
  .g-grid { display: grid; grid-template-columns: repeat(auto-fill, ${CARD}px); justify-content: start; gap: 22px; }
  .g-card { display: block; border: 1px solid var(--line); border-radius: 10px; overflow: hidden;
    background: var(--raised); color: inherit; }
  .g-card:hover { border-color: var(--acc); text-decoration: none; }
  .g-shot { display: block; overflow: hidden; background: #0E0F10; border-bottom: 1px solid var(--line); }
  .g-shot iframe { border: 0; transform-origin: top left; pointer-events: none; display: block; }
  .g-cap { display: flex; align-items: center; gap: 12px; padding: 12px 14px; font-size: 14px; min-height: 44px; }
  .g-dim { margin-left: auto; font-size: 12px; color: var(--faint);
    font-family: "Geist Mono", "Cascadia Mono", ui-monospace, Consolas, monospace; }
  @media (max-width: 520px) { .g-grid { grid-template-columns: 1fr } .g-shot iframe { transform-origin: top left } }
</style>
</head>
<body class="site">
<div class="g-wrap">
  <header class="g-head">
    <span class="lab">Internal design review</span>
    <h1>ForgeLocal screen gallery</h1>
    <p style="margin:0;max-width:72ch;font-size:15px;line-height:24px;color:var(--mut)">
      Every tile below is a live preview of the real route, not a copy. Click one to open the
      working screen. This page is a review tool and is not part of the product.
      <a href="/">Go to the site</a>.
    </p>
  </header>
${sections}
</div>
</body>
</html>
`;

mkdirSync(join(root, "public", "gallery"), { recursive: true });
writeFileSync(join(root, "public", "gallery", "index.html"), html);
console.log(`gallery: ${GROUPS.reduce((a, g) => a + g.items.length, 0)} live route previews, 0 duplicated screens`);
