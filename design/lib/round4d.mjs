// Round four P2: give the text-only Product page three restrained crops built
// from the real app components, on the real dark tokens. No illustrations, no
// fake browser chrome, no new decorative styles.
import { readFileSync, writeFileSync } from "node:fs";

const p = "design/routes-extra.mjs";
let s = readFileSync(p, "utf8");
if (!s.includes(`<ol style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1px`)) {
  throw new Error("product step list not found");
}

const crops = {
  1: `<div class="crop app">
          <dl class="kv" style="grid-template-columns:110px 1fr;margin-bottom:12px">
            <dt>Graphics</dt><dd class="num">RTX 4070 &middot; <strong>12 GB</strong> usable</dd>
            <dt>Memory</dt><dd class="num">32 GB total, 19 GB free</dd>
          </dl>
          <div class="box" style="border-color:var(--acc);padding:14px 16px;display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;align-items:flex-start;gap:12px">
              <div class="stack" style="flex:1;gap:4px">
                <span class="h2">Qwen2.5 Coder 14B</span>
                <span class="mut" style="font-size:13px;line-height:19px">Q4_K_M at an 8k context</span>
              </div>
              <span class="pill warn" style="flex-shrink:0">Runs with tradeoffs</span>
            </div>
            <span class="faint" style="font-size:13px;line-height:19px">Needs 11.1 GB of the 12 GB available.</span>
          </div>
        </div>`,
  4: `<div class="crop app">
          <div class="box" style="border-color:var(--warn-line);background:var(--warn-soft);overflow:hidden">
            <div style="padding:13px 15px;display:flex;align-items:center;gap:10px">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warn-line)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><path d="M12 9.5v4.2M12 17.4h.01M10.4 4.2 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.6 4.2a2 2 0 0 0-3.2 0z"/></svg>
              <span class="h2" style="flex:1">Install one package</span>
              <span class="pill warn">Network</span>
            </div>
            <pre class="m" style="margin:0 15px;padding:9px 11px;border-radius:6px;background:var(--bg);border:1px solid var(--line);font-size:13px">npm install --save-dev jsdom</pre>
            <div style="padding:12px 15px 14px;display:flex;gap:8px;flex-wrap:wrap">
              <span class="btn btnp btns">Allow once</span>
              <span class="btn btns">Always allow npm install here</span>
              <span class="btn btns">Deny</span>
            </div>
          </div>
        </div>`,
  5: `<div class="crop app">
          <div style="display:flex;align-items:center;gap:9px;margin-bottom:10px">
            <span class="h3" style="flex:1">2 files changed</span>
            <span class="m num" style="color:var(--ok)">+46</span>
            <span class="m num" style="color:var(--bad)">&minus;12</span>
          </div>
          <div class="m box" style="font-size:13px;line-height:20px;padding:8px 0;overflow:hidden;margin-bottom:10px">
            <div style="padding:0 12px;color:var(--mut)">import { useState } from 'react'</div>
            <div style="padding:0 12px;background:var(--bad-soft);border-left:2px solid var(--bad-line);color:var(--bad)">- const [tasks, setTasks] = useState([])</div>
            <div style="padding:0 12px;background:var(--ok-soft);border-left:2px solid var(--ok-line);color:var(--ok)">+ import { useTasks } from './useTasks'</div>
          </div>
          <div style="display:flex;gap:8px"><span class="btn btnp btns">Keep changes</span><span class="btn btns">Revert all</span></div>
        </div>`,
};

s = s.replace(
  `].map(([t, d], i) => \`<li style="background:var(--bg);padding:22px;display:flex;gap:18px">
        <span class="lab num" style="width:24px;flex-shrink:0;padding-top:2px">0\${i + 1}</span>
        <div class="stack" style="gap:6px"><span class="h2">\${esc(t)}</span>
        <p class="mut" style="margin:0;font-size:14px;line-height:21px;max-width:68ch">\${esc(d)}</p></div></li>\`).join("\\n")}`,
  `].map(([t, d], i) => \`<li style="background:var(--bg);padding:24px;display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
        <span class="lab num" style="width:24px;flex-shrink:0;padding-top:2px">0\${i + 1}</span>
        <div class="stack" style="gap:6px;flex:1;min-width:280px"><span class="h2">\${esc(t)}</span>
        <p class="mut" style="margin:0;font-size:14px;line-height:21px;max-width:62ch">\${esc(d)}</p></div>
        \${CROPS[i + 1] ?? ""}</li>\`).join("\\n")}`,
);

s = s.replace(
  `export function extraRoutes({ write, marketing, appPage, part, esc, models, F, gb }) {`,
  `const CROPS = ${JSON.stringify(crops, null, 2)};

export function extraRoutes({ write, marketing, appPage, part, esc, models, F, gb }) {`,
);

writeFileSync(p, s);
console.log("patched", p);

/* the crop container, matching the one Home already uses */
{
  const h = "design/head.part";
  let c = readFileSync(h, "utf8");
  if (!c.includes(".crop {")) {
    c = c.replace(
      `    .msec { padding: 0 32px; }`,
      `    .crop { border:1px solid var(--line-strong); border-radius:12px; overflow:hidden;
      background:#0E0F10; padding:18px; flex:1 1 340px; min-width:0; }

    .msec { padding: 0 32px; }`,
    );
    writeFileSync(h, c);
    console.log("patched", h);
  }
}
