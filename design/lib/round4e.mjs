/* Round four, second pass: the controls the first pass left decorative.
 *
 * Every replacement below is an exact literal. No wildcards, no lazy
 * quantifiers: the previous sidebar patch used `[^]*?` and silently relabelled
 * the wrong buttons, so this script would rather throw than guess.
 */
import { readFileSync, writeFileSync } from "node:fs";

const files = new Map();
const rd = (p) => { if (!files.has(p)) files.set(p, readFileSync(p, "utf8")); return files.get(p); };
const sub = (p, from, to) => {
  const s = rd(p);
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error(`${p}: expected 1 match, found ${n} for ${JSON.stringify(from.slice(0, 60))}`);
  files.set(p, s.replace(from, to));
};
const subAll = (p, from, to, expect) => {
  const s = rd(p);
  const n = s.split(from).length - 1;
  if (n !== expect) throw new Error(`${p}: expected ${expect} matches, found ${n} for ${JSON.stringify(from.slice(0, 60))}`);
  files.set(p, s.split(from).join(to));
};

/* The workspace parts this script used to patch (WsEmpty, WsRunning,
   WsPermission, WsFailed) were replaced in round eight by one data-driven
   conversation. Only the edits to surviving files are kept below. */

/* ---- My models: no folder picker in a prototype -------------------------- */
sub("design/parts/ModelsMine.body.html",
  `<button class="btn btns" type="button">Change location</button>`,
  `<button class="btn btns" type="button" data-inert="Choosing a different model folder is not built in this prototype.">Change location</button>`);

/* ---- setup: Back goes back ----------------------------------------------- */
sub("design/partials/ob-top.html",
  `  <button class="btn btnq ico btns" type="button" aria-label="Back">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
  </button>`,
  `  <a class="btn btnq ico btns" href="{{back}}" aria-label="{{backLabel}}" title="{{backLabel}}">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
  </a>`);
for (const [n, back, label] of [
  ["1", "/", "Leave setup"],
  ["2", "/setup/1/", "Back to step 1"],
  ["3", "/setup/2/", "Back to step 2"],
  ["4", "/setup/3/", "Back to step 3"],
]) {
  sub(`design/parts/Ob${n}${["Welcome", "Recommendation", "Install", "Project"][+n - 1]}.body.html`,
    `<!--#include ob-top.html {"n":"${n}"} -->`,
    `<!--#include ob-top.html {"n":"${n}","back":"${back}","backLabel":"${label}"} -->`);
}

/* ---- setup step 2, 3, 4: the remaining decorative buttons ---------------- */
// "Use this instead" is generated in appviews.mjs and is edited there.

sub("design/parts/Ob3Install.body.html",
  `<button class="btnq hit" type="button" style="font-size:14px;color:var(--acc-text);padding:0 8px">Change</button>`,
  `<button class="btnq hit" type="button" style="font-size:14px;color:var(--acc-text);padding:0 8px" data-inert="Choosing a different install folder is not built in this prototype.">Change</button>`);

{
  const p = "design/parts/Ob4Project.body.html";
  sub(p, `<button class="btn btns" type="button" style="flex-shrink:0">Change</button>`,
    `<button class="btn btns" type="button" style="flex-shrink:0" data-inert="Choosing a different project folder is not built in this prototype.">Change</button>`);
  sub(p, `<button class="btn btns btnq" type="button" style="border-color:var(--line)">Clone from Git</button>`,
    `<button class="btn btns btnq" type="button" style="border-color:var(--line)" data-inert="Cloning a repository is not built in this prototype.">Clone from Git</button>`);
  sub(p, `<button class="btn btns btnq" type="button" style="border-color:var(--line)">Start from a blueprint</button>`,
    `<button class="btn btns btnq" type="button" style="border-color:var(--line)" data-inert="Project blueprints are not built in this prototype.">Start from a blueprint</button>`);
}

for (const [p, s] of files) { writeFileSync(p, s); console.log("patched", p); }
