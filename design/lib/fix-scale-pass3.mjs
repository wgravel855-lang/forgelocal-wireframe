// Round-two scale fixes, part 3.
//   - any inline height on a control below 36px is raised
//   - 12.5px is fine for standalone metadata but not inside a control, so the
//     inline floor becomes 13px everywhere
//   - the topbar project button gets a real hit area
//   - the two in-app model surfaces get real <input> search fields
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let bumped = 0, heights = 0, files = 0;

for (const dir of ["design/parts", "design/partials"]) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".html"))) {
    const p = join(dir, f);
    let s = readFileSync(p, "utf8");
    const before = s;

    // 12.5px is legal only for standalone metadata; inside a control it is
    // functional text and must be 13px. Raising the floor is simpler than
    // trying to classify each one, and costs nothing visually.
    s = s.replace(/font-size:12\.5px/g, () => { bumped++; return "font-size:13px"; });

    // an inline height on a button/anchor/field below 36px defeats the token
    s = s.replace(/(<(?:button|a|div)[^>]*?)height:\s*(\d+)px/g, (m, head, h) => {
      if (Number(h) >= 36) return m;
      const isControl = /class="[^"]*\b(btn|field|srow|pill)\b/.test(head);
      if (!isControl) return m;
      heights++;
      return head + "height:36px";
    });

    if (s !== before) { writeFileSync(p, s); files++; }
  }
}
console.log(`pass3 sweep: ${files} files, ${bumped} sizes to 13px, ${heights} control heights to 36px`);

/* ---- topbar project disclosure gets a hit area -------------------------- */
{
  const p = "design/partials/topbar.html";
  let s = readFileSync(p, "utf8");
  s = s.replace(
    `<button style="display:flex;align-items:center;gap:7px;padding:4px 7px;border-radius:6px;min-width:0" aria-label="Project and session details">`,
    `<button class="hit" style="gap:7px;padding:0 8px;border-radius:7px;min-width:0" aria-label="Project and session details">`,
  );
  writeFileSync(p, s);
  console.log("topbar project button: 36px hit area");
}

/* ---- real search inputs on the in-app model surfaces -------------------- */
for (const p of ["design/parts/ModelsExplore.body.html", "design/parts/ModelsMine.body.html"]) {
  let s = readFileSync(p, "utf8");
  s = s.replace(
    /<div class="field" style="width:240px">([\s\S]*?)Search<\/div>/,
    (_m, icon) =>
      `<label class="field" style="width:240px">${icon}<span class="vh">Search models</span>` +
      `<input type="search" data-filter-search placeholder="Search models"></label>`,
  );
  writeFileSync(p, s);
}
console.log("in-app model surfaces: real <input type=search>");
