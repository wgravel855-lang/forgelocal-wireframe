// One-off: let the security page's two flex rows wrap at narrow widths.
import { readFileSync, writeFileSync } from "node:fs";

const p = "design/parts/SecurityPage.body.html";
let s = readFileSync(p, "utf8");

const swap = (a, b) => { s = s.split(a).join(b); };

// the data-storage band: two columns that must wrap, both able to shrink
swap(
  "border-top:1px solid var(--line);background:var(--panel);display:flex;gap:44px",
  "border-top:1px solid var(--line);background:var(--panel);display:flex;gap:44px;flex-wrap:wrap",
);
swap(
  'style="flex-grow:1;display:flex;flex-direction:column;gap:14px"',
  'style="flex:1;min-width:min(100%,280px);display:flex;flex-direction:column;gap:14px"',
);
swap(
  'style="width:360px;flex-shrink:0;display:flex;flex-direction:column;gap:14px"',
  'style="flex:1;min-width:min(100%,280px);display:flex;flex-direction:column;gap:14px"',
);

// the execution-boundary diagram: four stages wrap instead of forcing one row
swap('style="display:flex;align-items:stretch;gap:12px"', 'style="display:flex;align-items:stretch;gap:12px;flex-wrap:wrap"');
swap('class="box soft" style="flex-grow:1;padding:16px', 'class="box soft" style="flex:1 1 190px;min-width:0;padding:16px');
swap('class="box" style="flex-grow:1;padding:16px', 'class="box" style="flex:1 1 190px;min-width:0;padding:16px');

writeFileSync(p, s);
console.log("security page rows now wrap");
