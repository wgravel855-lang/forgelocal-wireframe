// One-off: attach the drawer / diff / review hooks to WsReview.
import { readFileSync, writeFileSync } from "node:fs";

const p = "design/parts/WsReview.body.html";
let s = readFileSync(p, "utf8");
const swap = (a, b) => {
  if (!s.includes(a)) throw new Error("no match: " + a.slice(0, 60));
  s = s.split(a).join(b);
};

// resize handle + drawer identity
swap(
  `<aside class="drawer" aria-label="Artifacts">`,
  `<aside class="drawer" aria-label="Artifacts" style="position:relative">
      <div class="drawer-handle" role="separator" aria-orientation="vertical" tabindex="0"
        aria-label="Resize the artifacts panel. Left and right arrows adjust the width."></div>`,
);

// close + maximize
swap(
  `<button class="btn btnq ico btns" type="button" aria-label="Maximise">`,
  `<button class="btn btnq ico btns" type="button" data-drawer-max aria-pressed="false" aria-label="Maximize the artifacts panel">`,
);
swap(
  `<button class="btn btnq ico btns" type="button" aria-label="Close artifacts">`,
  `<button class="btn btnq ico btns" type="button" data-drawer-close aria-label="Close artifacts">`,
);

// tabs point at panels
swap(`<button role="tab" class="btn btnq btns" type="button">Preview</button>`,
  `<button role="tab" class="btn btnq btns" type="button" aria-selected="false" tabindex="-1">Preview</button>`);
swap(`<button role="tab" class="btn btnq btns" type="button">Files</button>`,
  `<button role="tab" class="btn btnq btns" type="button" aria-selected="false" tabindex="-1">Files</button>`);
swap(`<button role="tab" class="btn btnq btns" type="button">Problems</button>`,
  `<button role="tab" class="btn btnq btns" type="button" aria-selected="false" tabindex="-1">Problems</button>`);
swap(`<button role="tab" class="btn btnq btns" type="button">Terminal</button>`,
  `<button role="tab" class="btn btnq btns" type="button" aria-selected="false" tabindex="-1">Terminal</button>`);

// unified / split actually switch the presentation
swap(
  `<button class="btn btns" type="button" style="background:var(--raised);border-color:var(--line-strong)">Unified</button>
          <button class="btn btnq btns" type="button">Split</button>`,
  `<button class="btn btns" type="button" data-diff-mode="unified" aria-pressed="true">Unified</button>
          <button class="btn btnq btns" type="button" data-diff-mode="split" aria-pressed="false">Split</button>`,
);

// review progress + per-file rows
swap(
  `<span style="font-size:13px;font-weight:600">2 files</span>`,
  `<span style="font-size:13px;font-weight:600">2 files</span>
        <span class="lab num" data-review-count>0 of 2 reviewed</span>`,
);
swap(
  `<button class="srow on" style="height:32px">
          <span class="m t">src/App.jsx</span>`,
  `<button class="srow on" style="height:32px" data-review-file data-reviewed="false" aria-current="true">
          <svg class="review-mark" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><path d="M20 6 9 17l-5-5"/></svg>
          <span class="m t">src/App.jsx</span>`,
);
swap(
  `<button class="srow" style="height:32px">
          <span class="m t">src/useTasks.js</span>`,
  `<button class="srow" style="height:32px" data-review-file data-reviewed="false">
          <svg class="review-mark" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><path d="M20 6 9 17l-5-5"/></svg>
          <span class="m t">src/useTasks.js</span>`,
);

// destructive actions confirm; keep actions mark progress
swap(`<button class="btn btnp" type="button">Keep changes</button>`,
  `<button class="btn btnp" type="button" data-review-action="keep-all">Keep changes</button>`);
swap(`<button class="btn" type="button">Revert all</button>`,
  `<button class="btn" type="button" data-review-action="revert-all">Revert all</button>`);
swap(`<button class="btn btns" type="button">Keep file</button>
        <button class="btn btnq btns" type="button" style="border-color:var(--line)">Revert file</button>`,
  `<button class="btn btns" type="button" data-review-action="keep-file">Keep file</button>
        <button class="btn btnq btns" type="button" style="border-color:var(--line)" data-review-action="revert-file">Revert file</button>`);
swap(`<button class="btn btnq btns" type="button" style="height:24px">Revert hunk</button>`,
  `<button class="btn btnq btns" type="button" style="height:24px" data-review-action="revert-hunk">Revert hunk</button>`);

// the diff body gets a mode container plus a side-by-side view
swap(
  `<div class="m" style="flex:1;min-height:0;overflow:auto;font-size:12px;line-height:20px;padding:6px 0">`,
  `<div data-diff-view data-mode="unified" style="flex:1;min-height:0;overflow:auto">
        <div class="m diff-unified" style="font-size:12px;line-height:20px;padding:6px 0">`,
);
swap(
  `          <div style="padding:0 12px;color:var(--mut)">    &lt;main className="wrap"&gt;</div>
        </div>`,
  `          <div style="padding:0 12px;color:var(--mut)">    &lt;main className="wrap"&gt;</div>
        </div>
        <div class="m diff-split" style="font-size:12px;line-height:20px;padding:6px 0;gap:1px;background:var(--line-soft)">
          <div style="background:var(--bg);padding:0 0 4px">
            <div class="lab" style="padding:2px 12px 6px">Before</div>
            <div style="padding:0 12px;color:var(--mut)">import { useState } from 'react'</div>
            <div style="padding:0 12px;background:var(--bad-soft);border-left:2px solid var(--bad-line);color:var(--bad)">const [tasks, setTasks] = useState([])</div>
            <div style="padding:0 12px;background:var(--bad-soft);border-left:2px solid var(--bad-line);color:var(--bad)">function addTask(text) {</div>
            <div style="padding:0 12px;background:var(--bad-soft);border-left:2px solid var(--bad-line);color:var(--bad)">  setTasks([...tasks, { id: nanoid(), text }])</div>
            <div style="padding:0 12px;background:var(--bad-soft);border-left:2px solid var(--bad-line);color:var(--bad)">}</div>
          </div>
          <div style="background:var(--bg);padding:0 0 4px">
            <div class="lab" style="padding:2px 12px 6px">After</div>
            <div style="padding:0 12px;color:var(--mut)">import { useState } from 'react'</div>
            <div style="padding:0 12px;background:var(--ok-soft);border-left:2px solid var(--ok-line);color:var(--ok)">import { useTasks } from './useTasks'</div>
            <div style="padding:0 12px;background:var(--ok-soft);border-left:2px solid var(--ok-line);color:var(--ok)">&nbsp;</div>
            <div style="padding:0 12px;background:var(--ok-soft);border-left:2px solid var(--ok-line);color:var(--ok)">export default function App() {</div>
            <div style="padding:0 12px;background:var(--ok-soft);border-left:2px solid var(--ok-line);color:var(--ok)">  const { tasks, add, toggle } = useTasks()</div>
          </div>
        </div>
      </div>`,
);

writeFileSync(p, s);
console.log("review wired");
