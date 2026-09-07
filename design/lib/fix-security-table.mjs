// One-off: replace the security page's fixed-width comparison grid with a real
// table that stacks into labelled rows on narrow screens.
import { readFileSync, writeFileSync } from "node:fs";

const p = "design/parts/SecurityPage.body.html";
const lines = readFileSync(p, "utf8").split("\n");

const rows = [
  ["Read files, search, Git status and diff", "Asks", "Runs", "Runs"],
  ["Write inside the project root", "Asks", "Runs", "Runs"],
  ["Install dependencies, reach the network", "Asks", "Asks", "Runs"],
  ["Git writes: commit, reset, clean, push", "Asks", "Asks", "Runs"],
  ["Read a file matching a secret pattern", "Asks", "Asks", "Asks"],
  ["Anything outside an approved root", "Blocked", "Blocked", "Blocked"],
  ["System-wide or destructive operations", "Blocked", "Blocked", "Blocked"],
];

const cell = (v, label) => {
  const tone = v === "Runs" ? "var(--ok)" : v === "Blocked" ? "var(--bad)" : "var(--warn)";
  const icon = v === "Runs"
    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
    : v === "Blocked"
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'
      : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8.5v4M12 15.8h.01"/><circle cx="12" cy="12" r="8.5"/></svg>';
  // icon as well as color: status is never conveyed by color alone
  return `<td data-l="${label}"><span style="display:inline-flex;align-items:center;gap:6px;color:${tone}">${icon}${v}</span></td>`;
};

const table = `    <div style="min-width:0">
      <table class="tbl cmp">
        <caption class="vh">What each permission preset allows for each class of action</caption>
        <thead><tr><th scope="col">Class of action</th><th scope="col">Ask every time</th><th scope="col">Balanced</th><th scope="col">Autopilot</th></tr></thead>
        <tbody>
${rows.map(([c, a, b, d]) => `          <tr><th scope="row" style="font-weight:500">${c}</th>${cell(a, "Ask every time")}${cell(b, "Balanced")}${cell(d, "Autopilot")}</tr>`).join("\n")}
        </tbody>
      </table>
    </div>`;

// lines are 1-indexed in the grep above: block runs from line 54 to the </div></div> before line 105
const start = 53;                        // 0-indexed line 54
const endIdx = lines.findIndex((l, i) => i > start && l.includes("There is no consumer mode"));
const before = lines.slice(0, start);
const after = lines.slice(endIdx - 1);   // keep the closing wrapper line + the note

writeFileSync(p, [...before, table, ...after].join("\n"));
console.log("classification table replaced");
