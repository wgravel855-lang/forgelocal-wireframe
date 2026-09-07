// Round-three corrections: honest permission copy, sign-in form, hit areas,
// heading sizes, and the public-site finishing issues.
import { readFileSync, writeFileSync } from "node:fs";

const edit = (path, pairs) => {
  let s = readFileSync(path, "utf8");
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(`${path}: no match for ${a.slice(0, 70)}`);
    s = s.split(a).join(b);
  }
  writeFileSync(path, s);
  console.log("patched", path);
};

/* --- P0: onboarding step 4 overclaims the filesystem boundary ------------ */
edit("design/parts/Ob4Project.body.html", [
  [
    `<h1 class="h1" style="font-size:24px;line-height:30px">Which folder should it work in?</h1>`,
    `<h1 class="h1">Which folder should it work in?</h1>`,
  ],
  [
    `This is the only place ForgeLocal can read or write. Anything outside it is refused.`,
    `Project file access is limited to this folder by default. System checks and approved tools
          are shown separately, and a permission prompt is not the same thing as sandbox isolation.`,
  ],
  [`<a href="#">How the boundary works</a>`, `<a class="link" href="/security/">How the boundary works</a>`],
  [
    `<span class="mut" style="display:block;font-size:13px;line-height:19px;margin-top:2px">Most project work runs without asking. Deletes outside the project and system-wide changes stay blocked in every preset.</span>`,
    `<span class="mut" style="display:block;font-size:13px;line-height:19px;margin-top:2px">Edits, the project's own build and test commands, package installs and Git writes run without asking. Network access beyond the package registry, reads of files matching a secret pattern, deletes outside the project and system-wide changes still stop and ask, in every preset.</span>`,
  ],
]);

/* --- onboarding step 1: "What gets read" needs a real hit area ----------- */
edit("design/parts/Ob1Welcome.body.html", [
  [`<a href="#">What gets read</a>`, `<a class="link" href="/privacy/">What gets read</a>`],
]);

/* --- P0: Security still has two href="#" -------------------------------- */
edit("design/parts/SecurityPage.body.html", [
  [`<a href="#" style="font-size:13px">Field-by-field table</a>`,
   `<a class="link" href="/privacy/#collected">Field-by-field table</a>`],
  [`<a href="#" style="font-size:13px">Responsible disclosure</a>`,
   `<a class="link" href="/security/#disclosure">Responsible disclosure</a>`],
]);

/* --- Security H1 to 40px for consistency with the other public routes ---- */
edit("design/parts/SecurityPage.body.html", [
  [`<h1 class="h1" style="font-size:38px;max-width:800px">`, `<h1 class="mh1" style="max-width:800px">`],
]);

/* --- homepage: intentional two-line hero + honest platform CTA ----------- */
edit("design/parts/Homepage.body.html", [
  [`<h1>Build on your PC. Skip the model setup.</h1>`,
   `<h1 style="max-width:20ch">Build on your PC.<br>Skip the model setup.</h1>`],
  [`<a href="/download/" class="btn btnp btnl" data-platform-cta>Download for Windows</a>`,
   `<a href="/download/" class="btn btnp btnl" data-platform-cta>View downloads</a>`],
]);
