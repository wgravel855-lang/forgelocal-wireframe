// Round-three: public-site finishing issues in the route generator.
import { readFileSync, writeFileSync } from "node:fs";

const p = "design/routes-extra.mjs";
let s = readFileSync(p, "utf8");
const swap = (a, b) => {
  if (!s.includes(a)) throw new Error("no match: " + a.slice(0, 80));
  s = s.split(a).join(b);
};

/* --- pricing: truthful pre-release CTAs and per-user framing ------------- */
swap(
  `        <span class="num" style="font-size:32px;font-weight:600"\${monthly ? \` data-price-monthly="\${monthly}"\` : ""}>\${monthly ? \`$\${monthly}\` : "$0"}</span>
        \${monthly ? '<span class="mut" data-price-period>/month</span>' : '<span class="mut">forever</span>'}`,
  `        <span class="num" style="font-size:32px;font-weight:600"\${monthly ? \` data-price-monthly="\${monthly}"\` : ""}>\${monthly ? \`$\${monthly}\` : "$0"}</span>
        \${monthly ? \`<span class="mut"><span data-price-unit>\${unit}</span><span data-price-period>/month</span></span>\` : '<span class="mut">forever</span>'}`,
);
swap(
  `  const plan = (name, monthly, blurb, feats, cta, primary) => \``,
  `  const plan = (name, monthly, blurb, feats, cta, primary, unit = "") => \``,
);
swap(
  `      ], \`<button class="btn btnp btnl" data-inert="Billing is not connected in this prototype.">Start Pro</button>\`, true)}`,
  `      ], \`<a class="btn btnp btnl" href="/signin/">Pro is not open yet &middot; get notified</a>\`, true)}`,
);
swap(
  `      ], \`<a class="btn btnl" href="/signin/">Talk to us</a>\`, false)}`,
  `      ], \`<a class="btn btnl" href="/signin/?team=1">Join the team waitlist</a>\`, false, " / user")}`,
);

/* --- download: real hit areas on the two standalone links --------------- */
swap(
  `    <p style="margin:0"><a href="/changelog/">Release notes</a> &middot; <a href="/status/">Service status</a></p>`,
  `    <p style="margin:0;display:flex;gap:20px;flex-wrap:wrap">
      <a class="link" href="/changelog/">Release notes</a>
      <a class="link" href="/status/">Service status</a></p>`,
);

/* --- download: do not advertise a build that does not exist ------------- */
swap(
  `    <button class="btn btnp btnl" data-inert="No installer has been published yet. This prototype has no build to serve.">Download for Windows</button>`,
  `    <button class="btn btnp btnl" data-inert="No installer has been published yet, so there is nothing to serve.">No build published yet</button>`,
);

writeFileSync(p, s);
console.log("patched", p);

/* --- footer: stop advertising a macOS download -------------------------- */
{
  const f = "design/partials/site-footer.html";
  let t = readFileSync(f, "utf8");
  t = t.replace(
    `<a href="/download/" class="btn btnp btnl" data-platform-cta>Download for Windows</a>
        <span class="faint" style="font-size:13px" data-platform-note>Windows 10 and 11, 64-bit. Free for local use.</span>`,
    `<a href="/download/" class="btn btnp btnl">View downloads</a>
        <span class="faint" style="font-size:13px" data-platform-note>Windows 10 and 11, 64-bit is the only build. Free for local use.</span>`,
  );
  writeFileSync(f, t);
  console.log("patched", f);
}
