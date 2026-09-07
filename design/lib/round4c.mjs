// Round four: real tabpanels in the review drawer, and honest sidebar items.
import { readFileSync, writeFileSync } from "node:fs";

/* --------------------------------------------- review drawer tabpanels --- */
{
  const p = "design/parts/WsReview.body.html";
  let s = readFileSync(p, "utf8");
  const must = (a) => { if (!s.includes(a)) throw new Error("no match: " + a.slice(0, 70)); };

  const tab = (id, label, sel) =>
    `<button role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${sel}" tabindex="${sel ? 0 : -1}"` +
    ` class="btn ${sel ? "" : "btnq "}btns" type="button"` +
    (sel ? ` style="background:var(--raised);border-color:var(--line-strong)"` : "") + `>${label}</button>`;

  must(`<div role="tablist" style="display:flex;gap:2px;flex:1;min-width:0;overflow:hidden">`);
  const tlStart = s.indexOf(`<div role="tablist"`);
  const tlEnd = s.indexOf(`</div>`, s.indexOf(`>Terminal</button>`)) + 6;
  s = s.slice(0, tlStart) +
    `<div role="tablist" aria-label="Artifacts" style="display:flex;gap:2px;flex:1;min-width:0;overflow-x:auto">
          ${tab("preview", "Preview", false)}
          ${tab("diff", "Diff", true)}
          ${tab("files", "Files", false)}
          ${tab("problems", "Problems", false)}
          ${tab("terminal", "Terminal", false)}
        </div>` + s.slice(tlEnd);

  // Wrap everything below the tab strip in the Diff panel, then add siblings.
  const bodyStart = s.indexOf(`<div style="flex-shrink:0;height:40px;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--line-soft)">`);
  if (bodyStart === -1) throw new Error("diff toolbar not found");
  const tail = s.lastIndexOf(`</aside>`);
  const diffBody = s.slice(bodyStart, tail);

  const panel = (id, inner, extra = "") =>
    `<div role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}"${extra}
        style="flex:1;min-height:0;display:flex;flex-direction:column">${inner}</div>`;

  const emptyPanel = (icon, title, body, action = "") => `
        <div style="flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px 24px;text-align:center">
          ${icon}
          <div class="stack" style="gap:6px;max-width:38ch">
            <span class="h3">${title}</span>
            <span class="mut" style="font-size:13px;line-height:20px">${body}</span>
          </div>
          ${action}
        </div>`;

  const previewPanel = emptyPanel(
    `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="M2.5 9h19"/></svg>`,
    "Preview is not running",
    "This task changed a hook and a test, not anything the dev server renders. Start the project's dev server to preview it.",
    `<button class="btn btns" type="button" data-inert="No dev server runs in this prototype.">Start npm run dev</button>`,
  );

  const filesPanel = `
        <div style="flex:1;min-height:0;overflow-y:auto;padding:8px 6px">
          <div class="sgroup">src</div>
          <button class="srow"><span class="m t">App.jsx</span><span class="m" style="color:var(--ok);font-size:12px">+8</span><span class="m" style="color:var(--bad);font-size:12px">&minus;12</span></button>
          <button class="srow"><span class="m t">useTasks.js</span><span class="pill ok">new</span></button>
          <button class="srow"><span class="m t">index.css</span><span class="lab">unchanged</span></button>
          <button class="srow"><span class="m t">main.jsx</span><span class="lab">unchanged</span></button>
          <div class="sgroup" style="margin-top:6px">project root</div>
          <button class="srow"><span class="m t">package.json</span><span class="m" style="color:var(--ok);font-size:12px">+1</span></button>
          <button class="srow"><span class="m t">vite.config.js</span><span class="lab">unchanged</span></button>
        </div>`;

  const problemsPanel = `
        <div style="flex:1;min-height:0;overflow-y:auto;padding:14px 14px 18px;display:flex;flex-direction:column;gap:12px">
          <div class="box" style="border-color:var(--warn-line);background:var(--warn-soft);padding:14px 16px;display:flex;gap:11px;align-items:flex-start">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warn-line)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-top:2px"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5M12 15.8h.01"/></svg>
            <div class="stack" style="gap:4px">
              <span class="h3">No test covers a corrupt stored value</span>
              <span class="mut" style="font-size:13px;line-height:19px">If localStorage holds something that is not JSON, the hook throws on read. Worth one more test.</span>
              <span class="m lab">src/useTasks.js</span>
            </div>
          </div>
          <p class="mut" style="margin:0;font-size:13px">Nothing else was reported. The build and the four tests passed.</p>
        </div>`;

  const terminalPanel = `
        <div style="flex:1;min-height:0;overflow-y:auto;background:var(--bg)">
          <div style="padding:9px 14px;border-bottom:1px solid var(--line-soft);background:var(--panel);display:flex;align-items:center;gap:10px">
            <span class="m" style="flex:1">npm test -- --run</span><span class="lab">exit 0 &middot; 3.4s</span>
          </div>
          <pre class="m" style="margin:0;padding:12px 14px;font-size:13px;line-height:20px;color:var(--mut);white-space:pre-wrap">&gt; task-tracker@0.1.0 test
&gt; vitest --run

 &#10003; src/App.test.jsx (3)
 &#10003; src/useTasks.test.js (1)

 Test Files  2 passed (2)
      Tests  4 passed (4)</pre>
        </div>`;

  s = s.slice(0, bodyStart) +
    panel("diff", diffBody) + "\n        " +
    panel("preview", previewPanel, " hidden") + "\n        " +
    panel("files", filesPanel, " hidden") + "\n        " +
    panel("problems", problemsPanel, " hidden") + "\n        " +
    panel("terminal", terminalPanel, " hidden") + "\n      " +
    s.slice(tail);

  writeFileSync(p, s);
  console.log("patched", p);
}

/* The sidebar edits this script used to make were rewritten by hand: the lazy
   [^]*? patterns matched session rows instead of the nav items and relabelled
   the wrong buttons. design/partials/sidebar.html is the source of truth now. */
