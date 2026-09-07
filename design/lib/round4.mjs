// Round four: behavioural wiring and the last stale values.
import { readFileSync, writeFileSync } from "node:fs";

const rd = (p) => readFileSync(p, "utf8");
const wr = (p, s) => { writeFileSync(p, s); console.log("patched", p); };
const must = (s, a, p) => { if (!s.includes(a)) throw new Error(`${p}: no match for ${a.slice(0, 70)}`); };

/* --- setup/5: leaked include tail + stale 32B claim ---------------------- */
{
  const p = "design/parts/Ob5FirstChat.body.html";
  let s = rd(p);
  // the splice left a doubled tail; keep one well-formed include
  s = s.replace(
    /(<!--#include composer\.html \{[^\n]*?send-arrow\.html -->"\} -->)(?:"\} -->)+/,
    "$1",
  );
  must(s, "Qwen2.5 Coder 32B is loaded", p);
  s = s.replace(
    `<span class="faint" style="font-size:13px">Qwen2.5 Coder 32B is loaded and passed all 7 setup checks. Balanced permissions are on.</span>`,
    `<span class="faint" style="font-size:13px"><!--REC_NAME--> is loaded and passed its setup checks. Balanced permissions are on. <a class="link" href="/setup/3/">What was checked</a></span>`,
  );
  wr(p, s);
}

/* --- setup/2: the footer note contradicted the card --------------------- */
{
  const p = "design/parts/Ob2Recommendation.body.html";
  let s = rd(p);
  must(s, "8.4 GB download, next step", p);
  s = s.replace(
    `<span class="lab">8.4 GB download, next step</span>`,
    `<span class="lab"><!--REC_TOTAL--> GB download, next step</span>`,
  );
  // primary action advances the flow
  s = s.replace(
    `<button class="btn btnp btnl" type="button">Use recommended</button>`,
    `<a class="btn btnp btnl" href="/setup/3/">Use recommended</a>`,
  );
  wr(p, s);
}

/* --- setup/1: primary + secondary actions ------------------------------- */
{
  const p = "design/parts/Ob1Welcome.body.html";
  let s = rd(p);
  s = s.replace(
    `<button class="btn btnp btnl" type="button">Set up this PC</button>`,
    `<a class="btn btnp btnl" href="/setup/2/">Set up this PC</a>`,
  );
  s = s.replace(
    `<button class="btn btnl" type="button">Connect an existing runtime</button>`,
    `<button class="btn btnl" type="button" data-inert="Connecting an existing runtime is not implemented in this prototype.">Connect an existing runtime</button>`,
  );
  wr(p, s);
}

/* --- setup/3: advance, and real pause / resume / cancel ----------------- */
{
  const p = "design/parts/Ob3Install.body.html";
  let s = rd(p);
  s = s.replace(
    `<button class="btn btnl" type="button">Continue while it downloads</button>`,
    `<a class="btn btnp btnl" href="/setup/4/">Keep setting up</a>`,
  );
  s = s.replace(
    `<div style="display:flex;align-items:center;gap:8px">
            <button class="btn btns" type="button">Pause</button>
            <button class="btn btnq btns" type="button" style="border-color:var(--line)">Cancel</button>
          </div>`,
    `<div style="display:flex;align-items:center;gap:8px" data-download>
            <button class="btn btns" type="button" data-dl-toggle>Pause</button>
            <button class="btn btnq btns" type="button" style="border-color:var(--line)" data-dl-cancel>Cancel</button>
            <span class="lab" data-dl-state>Downloading</span>
          </div>`,
  );
  // the progress pieces the controller drives
  s = s.replace(`<span class="dot acc pulse" aria-hidden="true"></span>`, `<span class="dot acc pulse" data-dl-dot aria-hidden="true"></span>`);
  s = s.replace(`<div class="fillbar" style="width:41%"></div>`, `<div class="fillbar" data-dl-bar style="width:41%"></div>`);
  wr(p, s);
}

/* --- setup/4: real radios, and the primary action ----------------------- */
{
  const p = "design/parts/Ob4Project.body.html";
  let s = rd(p);

  const radio = (id, value, checked, title, body) => `          <label class="box preset" style="padding:14px 16px;display:flex;gap:12px;align-items:flex-start;cursor:pointer${checked ? ";border-color:var(--acc)" : ""}">
            <input type="radio" name="preset" id="${id}" value="${value}"${checked ? " checked" : ""}
              style="width:18px;height:18px;flex-shrink:0;margin:2px 0 0;accent-color:var(--acc)">
            <span style="flex:1;min-width:0">
              ${title}
              <span class="mut" style="display:block;font-size:13px;line-height:19px;margin-top:2px">${body}</span>
            </span>
          </label>`;

  const start = s.indexOf(`<div role="radiogroup"`);
  const end = s.indexOf(`</div>`, s.lastIndexOf(`</label>`));
  if (start === -1) throw new Error("radiogroup not found");
  const group = `<div role="radiogroup" aria-labelledby="preset-legend" data-presets style="display:flex;flex-direction:column;gap:8px">

${radio("preset-ask", "ask", false, `<span style="display:block;font-size:14px;font-weight:600">Ask every time</span>`,
    "Approve every file write and every command, including reading files.")}

${radio("preset-balanced", "balanced", true,
    `<span style="display:flex;align-items:center;gap:8px"><span style="font-size:14px;font-weight:600">Balanced</span><span class="pill acc">Recommended</span></span>`,
    "Edits and the project's own test and build commands run on their own. Installing packages, network access, Git writes and deletes ask first.")}

${radio("preset-autopilot", "autopilot", false, `<span style="display:block;font-size:14px;font-weight:600">Autopilot</span>`,
    "Edits, the project's own build and test commands, package installs and Git writes run without asking. Network access beyond the package registry, reads of files matching a secret pattern, deletes outside the project and system-wide changes still stop and ask, in every preset.")}

        </div>`;
  s = s.slice(0, start) + group + s.slice(end + 6);

  s = s.replace(`<span class="lab">How much should it ask?</span>`,
    `<span class="lab" id="preset-legend">How much should it ask?</span>`);
  s = s.replace(`<button class="btn btnp btnl" type="button">Start building</button>`,
    `<a class="btn btnp btnl" href="/setup/5/" data-preset-continue>Start building</a>`);
  wr(p, s);
}

/* --- home workspace mock: reference machine runs the 14B ---------------- */
{
  const p = "design/partials/demo-workspace.html";
  let s = rd(p);
  must(s, "Qwen2.5 Coder 32B", p);
  s = s.split("Qwen2.5 Coder 32B").join("Qwen2.5 Coder 14B");
  wr(p, s);
}

/* --- security H1 back to the secondary-page scale ----------------------- */
{
  const p = "design/parts/SecurityPage.body.html";
  let s = rd(p);
  s = s.replace(`<h1 class="mh1" style="max-width:800px">`, `<h1 class="mh2" style="max-width:800px">`);
  wr(p, s);
}
