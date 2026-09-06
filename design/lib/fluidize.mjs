// One-off: make the two older marketing pages fluid instead of 1280px fixed.
import { readFileSync, writeFileSync } from "node:fs";

const files = [
  ["design/parts/ModelsPage.body.html", 1550],
  ["design/parts/SecurityPage.body.html", 1950],
];

const PAD = "clamp(20px, 5vw, 56px)";

for (const [f, minh] of files) {
  let s = readFileSync(f, "utf8");

  s = s.replace(
    `<div style="width:1280px;min-height:${minh}px;background:#F6F4EF;display:flex;flex-direction:column">`,
    `<div class="site" style="width:100%;min-height:100%;display:flex;flex-direction:column">`,
  );

  // horizontal padding becomes fluid wherever it was a hard 56px
  s = s.replace(/padding:(\d+px) 56px/g, `padding:$1 ${PAD}`);
  s = s.replace(/padding:0 56px/g, `padding:0 ${PAD}`);
  s = s.replace(/padding:56px(?=[;"])/g, `padding:56px ${PAD}`);

  // wide tables scroll inside their own container rather than widening the page
  s = s.split(`<div class="box" style="display:flex;flex-direction:column;overflow:hidden">`)
    .join(`<div style="overflow-x:auto"><div class="box" style="display:flex;flex-direction:column;min-width:740px">`);

  writeFileSync(f, s);
  console.log("patched", f);
}
