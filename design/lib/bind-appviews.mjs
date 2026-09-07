// Replace the hand-typed model blocks in the app screens with build-time
// markers, so they render from design/data/models.mjs instead.
import { readFileSync, writeFileSync } from "node:fs";

const cut = (s, startNeedle, endNeedle, marker) => {
  const i = s.indexOf(startNeedle);
  if (i === -1) throw new Error("start not found: " + startNeedle.slice(0, 50));
  const j = s.indexOf(endNeedle, i);
  if (j === -1) throw new Error("end not found: " + endNeedle.slice(0, 50));
  return s.slice(0, i) + marker + s.slice(j + endNeedle.length);
};

/* ---- onboarding step 2: whole recommendation block ---------------------- */
{
  const p = "design/parts/Ob2Recommendation.body.html";
  let s = readFileSync(p, "utf8");
  s = cut(s, `<div style="display:flex;flex-direction:column;gap:12px">
        <span class="lab">Recommended for this PC</span>`, `</details>
      </div>`, "<!--RECOMMENDATION-->");
  s = s.replace(`<h1 class="h1" style="font-size:24px;line-height:30px">`, `<h1 class="h1">`);
  writeFileSync(p, s);
  console.log("Ob2Recommendation bound");
}

/* ---- onboarding step 3: model identity + sizes -------------------------- */
{
  const p = "design/parts/Ob3Install.body.html";
  let s = readFileSync(p, "utf8");
  s = s.replace(`<h1 class="h1" style="font-size:24px;line-height:30px">Setting up the balanced profile</h1>`,
    `<h1 class="h1">Setting up <!--REC_NAME--></h1>`);
  s = s.replace("Downloading Qwen2.5 Coder 32B", "Downloading <!--REC_NAME-->");
  s = s.replace("3.4 of 8.4 GB", "<!--REC_DONE--> of <!--REC_TOTAL--> GB");
  s = s.replace(">239 GB<", "><!--REC_FREE--> GB<");
  writeFileSync(p, s);
  console.log("Ob3Install bound");
}

/* ---- Explore + My models: list bodies ----------------------------------- */
{
  const p = "design/parts/ModelsExplore.body.html";
  let s = readFileSync(p, "utf8");
  s = cut(s, `<ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px">`,
    `</ul>`, `<ul data-filter-root style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px"><!--EXPLORE_LIST--></ul>`);
  s = s.replace(`<h1 class="h1" style="font-size:24px;line-height:30px">Models</h1>`, `<h1 class="h1">Models</h1>`);
  s = s.replace(/<p class="faint"[^>]*>\s*Speeds are measured[\s\S]*?<\/p>/,
    `<p class="faint" style="margin:0;font-size:13px;line-height:19px;max-width:70ch">
            Fit is arithmetic: quantized weights, plus the key-value cache at the stated context,
            plus runtime overhead, against this machine's video memory. Throughput is only shown
            once it has been measured here.
          </p>`);
  writeFileSync(p, s);
  console.log("ModelsExplore bound");
}
{
  const p = "design/parts/ModelsMine.body.html";
  let s = readFileSync(p, "utf8");
  s = cut(s, `<ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px">`,
    `</ul>`, `<ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px"><!--MINE_LIST--></ul>`);
  s = s.replace(`<h1 class="h1" style="font-size:24px;line-height:30px">Models</h1>`, `<h1 class="h1">Models</h1>`);
  s = s.replace(/<p class="mut"[^>]*>13\.1 GB of models on disk[^<]*<\/p>/,
    `<p class="mut" style="margin:0;font-size:14px"><!--MINE_TOTAL--> GB of models on disk &middot; <!--MINE_FREE--> GB free</p>`);
  s = s.replace(/13\.1 GB used by models/, "<!--MINE_TOTAL--> GB used by models");
  writeFileSync(p, s);
  console.log("ModelsMine bound");
}

/* ---- build.mjs performs the substitutions ------------------------------- */
{
  const p = "design/build.mjs";
  let s = readFileSync(p, "utf8");
  s = s.replace(`import { pickerHtml } from "./lib/picker.mjs";`,
    `import { pickerHtml } from "./lib/picker.mjs";
import { recommendationBlock, installBlock, exploreList, myModelsList } from "./lib/appviews.mjs";`);
  s = s.replace(
    `const part = (name) =>
  expand(readFileSync(join(partsDir, \`\${name}.body.html\`), "utf8"))
    .replace("<!--MODEL_PICKER-->", () => pickerHtml(models, SELECTED));`,
    `const inst = installBlock();
const mine = myModelsList(models);
const BIND = {
  "<!--MODEL_PICKER-->": () => pickerHtml(models, SELECTED),
  "<!--RECOMMENDATION-->": () => recommendationBlock(models),
  "<!--EXPLORE_LIST-->": () => exploreList(models),
  "<!--MINE_LIST-->": () => mine.rows,
  "<!--MINE_TOTAL-->": () => mine.totalGB,
  "<!--MINE_FREE-->": () => mine.freeGB,
  "<!--REC_NAME-->": () => inst.name,
  "<!--REC_TOTAL-->": () => inst.total,
  "<!--REC_DONE-->": () => inst.done,
  "<!--REC_FREE-->": () => inst.freeAfter,
};
const part = (name) => {
  let html = expand(readFileSync(join(partsDir, \`\${name}.body.html\`), "utf8"));
  for (const [marker, render] of Object.entries(BIND)) {
    if (html.includes(marker)) html = html.split(marker).join(render());
  }
  return html;
};`);
  writeFileSync(p, s);
  console.log("build.mjs binds the markers");
}
