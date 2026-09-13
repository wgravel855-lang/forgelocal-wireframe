// @ts-check
/**
 * Browser tests, run against the built site with no browser dependency.
 *
 * The pages are static HTML whose behaviour lives in one ES module, so the
 * assertions that matter — which panel a tab selects, how many headings a route
 * exposes, whether a control is inert, whether a layout can overflow — are
 * checked against the built output and the module's own reducers. What this
 * cannot do is lay out a page, so anything that needs real geometry is checked
 * in the browser and reported as such rather than asserted here.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const pub = join(root, "public");
const page = (route) => readFileSync(join(pub, route, "index.html"), "utf8");
const sheet = () => readFileSync(join(pub, "assets/forgelocal.css"), "utf8");
const APP = ["app", "app/running", "app/permission", "app/stopped", "app/review",
  "app/models", "app/models/installed", "app/models/downloads", "app/settings"];

/* Every work-pane tab points at its own panel, and every panel exists. */
test("each work-pane tab selects a distinct panel that exists", () => {
  const html = page("app/review");
  const tabs = [...html.matchAll(/role="tab"[^>]*aria-controls="([^"]+)"[^>]*>([^<]*)</g)]
    .map((m) => ({ panel: m[1], label: m[2].trim() }));
  assert.ok(tabs.length >= 5, `expected at least five tabs, found ${tabs.length}`);
  assert.equal(new Set(tabs.map((t) => t.panel)).size, tabs.length, "no two tabs share a panel");
  for (const t of tabs) {
    assert.ok(html.includes(`id="${t.panel}"`), `${t.label} points at a panel that exists`);
    const body = html.slice(html.indexOf(`id="${t.panel}"`));
    const end = body.indexOf('role="tabpanel"', 10);
    const inner = (end > 0 ? body.slice(0, end) : body).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    assert.ok(inner.length > 20, `${t.label} panel has content of its own`);
  }
});

/* Exactly one page heading per app route. */
test("every app route exposes exactly one h1", () => {
  for (const route of APP) {
    const html = page(route);
    const count = (html.match(/<h1[\s>]/g) || []).length;
    if (route === "app/settings") {
      /* One per section, and the controller unhides exactly one.
         Counted from the navigation rather than written down: the number
         was a literal 6, so adding a section failed this test with an
         arithmetic complaint instead of checking the rule it states. */
      const sections = (html.match(/data-set-nav="/g) || []).length;
      assert.ok(sections >= 5, `settings has only ${sections} sections`);
      assert.equal(count, sections,
        `settings: ${sections} sections but ${count} headings`);
      assert.ok(/hidden/.test(html), "inactive sections ship hidden");
    } else {
      assert.equal(count, 1, `${route} has one h1, found ${count}`);
    }
  }
});

/* No enabled control may be inert, and no fake retry may exist. */
test("no route ships an enabled control with nothing behind it", () => {
  const js = readFileSync(join(pub, "assets/forgelocal.js"), "utf8");
  const hooks = new Set([...js.matchAll(/\[data-([a-z-]+)[\]=]/g)].map((m) => m[1]));
  const classes = new Set([...js.matchAll(/["'`]\.([a-z][a-z0-9-]+)["'`,\s]/gi)].map((m) => m[1]));
  for (const route of APP) {
    const html = page(route);
    for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const attrs = m[1];
      if (/\bdisabled\b|type="submit"/.test(attrs)) continue;
      const label = (m[2].replace(/<[^>]+>/g, "").trim()
        || (attrs.match(/aria-label="([^"]*)"/) || [])[1] || "(unnamed)").slice(0, 30);
      const data = [...attrs.matchAll(/data-([a-z-]+)/g)].map((x) => x[1]);
      const cls = ((attrs.match(/class="([^"]*)"/) || [])[1] || "").split(/\s+/).filter(Boolean);
      const wired = data.some((d) => hooks.has(d)) || cls.some((c) => classes.has(c))
        || /aria-expanded|aria-controls|role="tab"|role="menuitem/.test(attrs);
      assert.ok(wired, `${route}: "${label}" is enabled but nothing handles it`);
    }
  }
});

test("rewind is not offered, because no checkpoint store exists", () => {
  for (const route of APP) {
    assert.doesNotMatch(page(route), /data-rewind=/, `${route} still offers rewind`);
  }
  // The recovery row is rendered in the browser from the thread fixtures, so
  // scanning the built HTML missed a "Rewind" button that was shipping on
  // /app/stopped/. The fixtures are the source those controls come from.
  const threads = readFileSync(join(root, "design/data/threads.mjs"), "utf8");
  assert.doesNotMatch(threads, /label: "Rewind"/,
    "a thread fixture still offers Rewind, which no checkpoint store can honour");
  assert.doesNotMatch(threads, /action: "restore"/,
    "a thread fixture still offers a restore action");
});

/* Truthfulness: nothing may claim an effect the prototype cannot produce. */
test("no shipped copy claims a command ran or a file changed for real", () => {
  const js = readFileSync(join(pub, "assets/forgelocal.js"), "utf8");
  // "Allowed once. Installed" was the exact regression; permission copy may
  // describe the grant but never the outcome.
  assert.doesNotMatch(js, /Allowed once\. Installed/);
  assert.doesNotMatch(js, /Allowed here from now on\. Installed/);
  assert.match(js, /Waiting for the runtime/, "an allowed action says what it is waiting for");
});

test("the runtime is described as disconnected in one place, not in every card", () => {
  const adapters = readFileSync(join(pub, "core/adapters.mjs"), "utf8");
  assert.match(adapters, /disconnected/, "the adapter reports its real state");
  assert.match(adapters, /RuntimeUnavailable/, "and refuses rather than simulating");
});

/* Layout hazards that can be read statically. */
test("no app route hard-codes a desktop grid column that would survive one column", () => {
  for (const route of APP) {
    const html = page(route);
    const inline = [...html.matchAll(/style="([^"]*grid-column[^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(inline, [], `${route} pins a grid column inline`);
  }
});

test("every icon-only control has an accessible name", () => {
  for (const route of APP) {
    const html = page(route);
    for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const text = m[2].replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").trim();
      if (text) continue;
      assert.match(m[1], /aria-label=|aria-labelledby=|title=/,
        `${route}: an icon-only button has no accessible name`);
    }
  }
});

test("the model picker, catalog and installed page read one payload", () => {
  const explore = page("app/models");
  const installed = page("app/models/installed");
  const app = page("app");
  for (const [name, html] of [["catalog", explore], ["installed", installed], ["workspace", app]]) {
    assert.match(html, /id="fl-sessions"/, `${name} ships the shared model payload`);
  }
  const payload = JSON.parse(
    (app.match(/id="fl-sessions">([\s\S]*?)<\/script>/) || [])[1]
      .split("\\u003c").join("<"));

  // One model schema, not two. The legacy `models` array carried a second
  // representation whose fields were machine facts (vramGB, fitReason, local
  // paths) the web preview cannot know; it was the reason contradictory states
  // kept appearing, and it is gone.
  assert.equal(payload.models, undefined, "the legacy model schema is not shipped");
  assert.ok(Array.isArray(payload.modelSeed) && payload.modelSeed.length > 0);
  const legacyFields = ["vramGB", "fitReason", "diskGB", "downloadGB", "store", "runtime"];
  for (const m of payload.modelSeed) {
    for (const f of legacyFields) {
      assert.equal(m[f], undefined, `${m.id} still carries the legacy field ${f}`);
    }
    // catalog identity is present, because a catalog is servable
    assert.equal(typeof m.displayName, "string");
    assert.equal(typeof m.fileSizeBytes, "number");
  }
});

test("the module graph the browser loads is complete", () => {
  const entry = join(pub, "assets/forgelocal.js");
  const seen = new Set();
  /** @param {string} file */
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/from\s+"([^"]+\.mjs)"/g)) {
      const target = join(file, "..", m[1]);
      assert.ok(existsSync(target), `${m[1]} is imported but was not shipped`);
      walk(target);
    }
  };
  walk(entry);
  assert.ok(seen.size >= 3, "the controller imports the core");
});

/* Two workspace compositions, selected by session state and never by route. */
test("the composition is derived from messages, not from the URL", () => {
  const js = readFileSync(join(pub, "assets/forgelocal.js"), "utf8");
  // setComposition takes the message count; a route check here would mean a
  // fixture URL could show the wrong layout for its own content.
  assert.match(js, /function setComposition\(hasMessages\)/);
  assert.match(js, /hasMessages \? "session" : "start"/);
  assert.match(js, /const hasMessages = !!\(t && t\.turns && t\.turns\.length\)/);
  assert.doesNotMatch(js, /composition[^\n]*location\.pathname/,
    "the composition must not be chosen by inspecting the route");

  // Both geometries come from one composer in the markup, not two.
  for (const route of ["app", "app/running", "app/review"]) {
    const html = readFileSync(join(pub, route, "index.html"), "utf8");
    assert.equal((html.match(/class="composer"/g) || []).length, 1,
      `${route} ships more than one composer`);
    assert.equal((html.match(/class="cshell"/g) || []).length, 1,
      `${route} ships more than one composer shell`);
  }
});

/* The type scale, asserted against the built stylesheet. */
test("no shipped rule sets text below the floor or off the scale", () => {
  const css = readFileSync(join(pub, "assets/forgelocal.css"), "utf8");
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length > 50, "the stylesheet was read");

  // 13px is the floor for anything visible. Nothing may sit below it.
  const below = [...new Set(sizes.filter((n) => n < 13))];
  assert.deepEqual(below, [], `sizes below the 13px floor: ${below.join(", ")}`);

  // Fractional sizes were the residue of fitting text to a column rather than
  // choosing a role for it, and every one of them is gone.
  const fractional = [...new Set(sizes.filter((n) => !Number.isInteger(n)))];
  assert.deepEqual(fractional, [], `fractional sizes: ${fractional.join(", ")}`);

  // The scale's tokens exist and carry their own line heights, so raising a
  // size cannot leave a cramped line box behind.
  for (const t of ["--t-meta", "--t-label", "--t-copy", "--t-body", "--t-title", "--t-hero"]) {
    assert.match(css, new RegExp(`${t}:\\s*\\d+px`), `${t} is defined`);
    assert.match(css, new RegExp(`${t.replace("--t-", "--lh-")}:\\s*\\d+px`), `${t} has a line height`);
  }
});

test("13px text is never paired with the faintest grey", () => {
  const css = readFileSync(join(pub, "assets/forgelocal.css"), "utf8");
  // Small and faint together is what made the interface read as undersized.
  for (const block of css.match(/\{[^{}]*\}/g) || []) {
    if (!/font-size:\s*13px/.test(block)) continue;
    assert.doesNotMatch(block, /color:\s*var\(--faint\)/,
      `a 13px rule still uses the faintest grey: ${block.slice(0, 90)}`);
  }
});

/* Each composer control is addressed by an attribute the controller treats as
   unique. `data-project` was already the sidebar's marker for which project a
   chat belongs to, so a composer button carrying it wired a directory picker
   onto nine chat rows. The same shape of bug has now appeared three times
   (`data-mode` on the sidebar aside, `data-sort` outside its root, this), so
   the uniqueness is asserted rather than eyeballed. */
test("every composer control selector matches exactly one element per route", () => {
  const unique = [
    "data-composer", "data-attach", "data-attach-input", "data-attachments",
    "data-project-choose", "data-project-name", "data-project-input",
    "data-mode-label", "data-model-label", "data-effort-label", "data-send",
  ];
  for (const route of ["app", "app/running", "app/permission", "app/stopped", "app/review"]) {
    const html = page(route);
    for (const attr of unique) {
      const n = (html.match(new RegExp(`${attr}(?![a-z-])`, "g")) || []).length;
      assert.equal(n, 1, `${attr} appears ${n} times on /${route}/, expected exactly one`);
    }
  }
});

/* Send lives in the control row, and below 620px .cbar-r scrolls. If Send is
   inside that group it becomes something you have to swipe to reach, which is
   how it shipped for one build. It is a sibling of the group, not a child. */
test("the send button is outside the group that scrolls on a narrow window", () => {
  for (const route of ["app", "app/running", "app/permission", "app/stopped", "app/review"]) {
    const html = page(route);
    const from = html.indexOf('class="cbar-r"');
    const to = html.indexOf("data-send");
    assert.ok(from > 0 && to > from, `/${route}/: cbar-r and data-send not both present in order`);
    // More closing tags than opening ones between them means the group
    // ended before the button did, which is the whole assertion.
    const between = html.slice(from, to);
    const opened = (between.match(/<div\b/g) || []).length;
    const closed = (between.match(/<\/div>/g) || []).length;
    assert.ok(closed > opened,
      `/${route}/: send is still inside .cbar-r, which scrolls below 620px`);
  }
});

/* A blanket touch rule gave every .cbar button min-height 44px and height
   auto, which turned a 36px-wide circle into an ellipse on a phone. The
   circle is a fixed size and takes its larger target from an overlay. */
test("the send button is a circle at every width", () => {
  const css = sheet();
  const rule = css.match(/\.btn\.sendbtn \{[^}]*\}/);
  assert.ok(rule, "no .btn.sendbtn rule in the sheet");
  assert.match(rule[0], /border-radius:\s*50%/, rule[0]);
  assert.match(css, /\.cbar \.btn\.sendbtn \{[^}]*height:\s*36px/,
    "the touch block does not pin the send button height back to 36px");
});

/* The composer is one object at one size. The session composition used to
   collapse it to a 56px row, move the controls inline and hide the reasoning
   selector; nothing may reintroduce a rule that resizes it by chat state. */
test("no rule resizes the composer by conversation state", () => {
  // Comments are stripped first: they sit in front of a rule and would
  // otherwise be read as part of its selector.
  const css = readFileSync(join(pub, "assets/forgelocal.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of css.match(/[^{}]*\{[^{}]*\}/g) || []) {
    const [selector, body] = [block.slice(0, block.indexOf("{")), block.slice(block.indexOf("{"))];
    if (!/data-composition/.test(selector)) continue;
    if (!/\.cshell|\.cinput|\.cbar|\.ta\b/.test(selector)) continue;
    assert.doesNotMatch(body, /min-height|height|padding|flex-direction|border-radius|display:\s*none/,
      `a composition rule still resizes the composer: ${selector.trim()}`);
  }
});

/* The plus attaches files. It used to open a popover offering two things the
   prototype could not do, both of them marked inert. */
test("the attach control opens a file input, not a popover", () => {
  const html = page("app");
  assert.match(html, /data-attach\b[^>]*>/, "the attach button exists");
  assert.doesNotMatch(html, /data-attach\b[^>]*data-popover/, "the attach button still opens a popover");
  assert.match(html, /<input[^>]*type="file"[^>]*data-attach-input/, "a real file input backs it");
});

/* One fact, one place. The project path used to appear both under the composer
   and in the topbar panel. */
test("the project is not repeated beneath the composer", () => {
  for (const route of ["app", "app/running", "app/review"]) {
    const html = page(route);
    const strip = html.match(/<div class="cstrip">([\s\S]*?)<\/div>\s*\n/);
    assert.ok(strip, `/${route}/ has a context strip`);
    assert.doesNotMatch(strip[1], /~\/projects|data-folder-label/,
      `/${route}/ still repeats the project path under the composer`);
  }
});

/* ---- landing and onboarding ------------------------------------------ */

const LANDING = "";
const SETUP = ["setup", "setup/model", "setup/project", "setup/permissions"];

/* The product proof is a picture. If the controller could see it, it would
   wire a second composer on a marketing page, duplicate the composer-input id,
   and rewrite the runtime label it was given. */
test("the landing product preview is inert and outside the controller's reach", () => {
  const html = page(LANDING);
  assert.match(html, /data-preview inert/, "the preview surface is marked inert");
  // Everything interactive on the page that belongs to the app lives inside it.
  const outside = html.replace(/<div class="app lp-proof-surface"[\s\S]*?\n<\/div>/, "");
  assert.doesNotMatch(outside, /data-composer/, "a composer escaped the preview");

  const js = readFileSync(join(pub, "assets/forgelocal.js"), "utf8");
  assert.match(js, /closest\("\[data-preview\]"\)/,
    "the query helpers no longer exclude preview subtrees");
});

/* The state the brief calls impossible: a preview that says it is disconnected
   with no model, beside tool rows that are running. */
test("the landing preview shows one coherent state, not a contradiction", () => {
  const html = page(LANDING);
  const surface = html.match(/<div class="app lp-proof-surface"[\s\S]*?\n<\/div>/);
  assert.ok(surface, "the preview surface is in the page");
  const s = surface[0];
  const claimsActivity = /running|Edited \d|Read \d/.test(s);
  if (claimsActivity) {
    assert.doesNotMatch(s, /Desktop not connected/, "activity beside a disconnected runtime");
    assert.doesNotMatch(s, /No model loaded/, "activity beside no model");
  }
  // and it is labelled as a preview in the page's own copy
  assert.match(html, /Product preview/, "the preview is not labelled");
});

/* The first viewport carries one message and no hardware card. */
test("the hero holds one headline, one paragraph, two actions and nothing else", () => {
  const html = page(LANDING);
  const hero = html.match(/<section class="lp-wrap"[\s\S]*?<\/section>/);
  assert.ok(hero, "the hero section exists");
  const h = hero[0];
  assert.equal((h.match(/<h1/g) || []).length, 1);
  assert.equal((h.match(/<p /g) || []).length, 2, "one lede and one support line");
  assert.equal((h.match(/<a /g) || []).length, 2, "one primary and one secondary action");
  // the arithmetic that used to live here
  assert.doesNotMatch(h, /RTX|GB|Q4_K_M|quantization/i, "hardware detail is still in the hero");
});

test("every landing and setup route exposes exactly one h1", () => {
  for (const route of [LANDING, ...SETUP]) {
    const n = (page(route).match(/<h1[\s>]/g) || []).length;
    assert.equal(n, 1, `/${route}/ has ${n} h1 elements`);
  }
});

/* Four decisions, then the workspace. */
test("onboarding is four steps and hands off to the app", () => {
  SETUP.forEach((route, i) => {
    const html = page(route);
    assert.match(html, new RegExp(`aria-valuetext="Step ${i + 1} of 4"`), `/${route}/ step count`);
    assert.match(html, /aria-valuemax="4"/);
  });
  assert.match(page("setup/permissions"), /data-perm-start[^>]*href="\/app\/"|href="\/app\/"[^>]*data-perm-start/,
    "the last step opens the workspace");
  // and there is no allow-everything option anywhere in the flow
  for (const route of SETUP) {
    assert.doesNotMatch(page(route), /allow every|unrestricted|bypass/i, `/${route}/`);
  }
});

/* Inline <style> blocks ship in the HTML and were never covered by the
   stylesheet type-scale test, so a part file could set 11px unnoticed. */
test("no inline style block sets text below the floor or off the scale", () => {
  for (const route of [LANDING, ...SETUP, "app", "app/review"]) {
    const html = page(route);
    for (const block of html.match(/<style>[\s\S]*?<\/style>/g) || []) {
      const sizes = [...block.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
      const bad = sizes.filter((n) => n < 13 || !Number.isInteger(n));
      assert.deepEqual([...new Set(bad)], [], `/${route}/ inline style: ${bad.join(", ")}`);
    }
  }
});

/* Nothing on the landing page hides content behind a script that may not run. */
test("the landing reveal cannot leave the page blank", () => {
  const css = readFileSync(join(pub, "assets/forgelocal.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of css.match(/[^{}]*\{[^{}]*\}/g) || []) {
    const sel = block.slice(0, block.indexOf("{"));
    if (!/\.lp-enter/.test(sel)) continue;
    if (!/opacity:\s*0/.test(block)) continue;
    assert.match(sel, /body\.lp-anim/,
      `.lp-enter hides content without the script-added gate: ${sel.trim()}`);
  }
});

test("the composer's control row never wraps, so Send cannot move", () => {
  /* The bug this pins. `.cbar` was `flex-wrap: wrap` above 620px, on the
     assumption that the row always fits on a wide window. A 49-character
     model id does not fit, the controls overflowed, and Send — the last
     child, and the only control whose position is specified — dropped onto a
     line of its own below the composer.

     Wrapping puts the primary action wherever the leftovers land, which is
     the one place it can never be. The row holds one line at every width and
     the middle group scrolls instead. */
  const css = sheet().replace(/\/\*[\s\S]*?\*\//g, "");

  const cbarRules = [...css.matchAll(/(^|\})\s*([^{}]*\.cbar[^{}]*)\{([^}]*)\}/g)]
    .map((m) => ({ sel: m[2].trim(), body: m[3] }));
  assert.ok(cbarRules.length, "no .cbar rules in the built stylesheet");

  for (const r of cbarRules) {
    // A rule may set nowrap; none may set wrap.
    assert.ok(!/flex-wrap:\s*wrap/.test(r.body),
      `${r.sel} lets the composer's control row wrap, which moves Send`);
  }

  // And the two rules that keep Send where it belongs are present.
  assert.match(css, /\.cbar\s*\{[^}]*flex-wrap:\s*nowrap/,
    "the control row does not declare nowrap");
  assert.match(css, /\.cbar\s*>\s*\.btn\.sendbtn\s*\{[^}]*flex-shrink:\s*0/,
    "Send can be shrunk out of place");
  /* And the group holding the popovers does not clip them.

     This assertion replaced its own opposite. The first fix for the wrap
     gave .cbar-r overflow-x: auto so it could scroll, and the spec makes
     that a clipping context in BOTH axes — so the model picker, which
     opens above the row, was cut to the height of a 36px control and
     rendered as a dark sliver. The controls truncate instead. */
  const cbarR = css.match(/\.cbar-r\s*\{([^}]*)\}/g) || [];
  assert.ok(cbarR.length, "no .cbar-r rule at all");
  for (const rule of cbarR) {
    assert.ok(!/overflow[-a-z]*:\s*(auto|scroll|hidden|clip)/.test(rule),
      `.cbar-r clips or scrolls, which hides the popovers inside it: ${rule}`);
  }
});

/* ------------------------------------ a chat that needs no project folder */

test("setup offers a way past the project step", () => {
  /* The runtime allows a session with no folder, but the flow to reach it went
     through a step whose only exit was a folder picker: Continue stayed
     aria-disabled until one was chosen. Allowing it in the runtime and walling
     it off in setup is the same as not allowing it. */
  const html = page("setup/project");
  const skip = /<a[^>]*data-proj-skip[^>]*>/.exec(html);
  assert.ok(skip, "the project step has no way past it");
  assert.match(skip[0], /href="\/app\/"/,
    "skip went to the permission step, which asks about files there are none of");
  assert.ok(!/data-proj-skip[^>]*aria-disabled="true"/.test(html),
    "the way past the project step is itself disabled");
});

test("the composer does not require a project folder", () => {
  /* The check Send is gated on. A folder in this list is what made asking a
     question impossible without one. */
  const js = readFileSync(join(pub, "assets/forgelocal.js"), "utf8");
  const fn = /function canSendLive\(\)\s*\{([\s\S]*?)\n  \}/.exec(js);
  assert.ok(fn, "canSendLive is not where this test expects it");
  assert.ok(!/LIVE\.project/.test(fn[1]),
    "sending still requires a project folder");
  assert.match(fn[1], /LIVE\.session/,
    "sending no longer checks that a session is open, which a project used to stand in for");
});

test("loading a model opens a session whether or not a project is open", () => {
  /* Three places load a model and each opened a session only if a project
     happened to be open. Without one that left Send enabled with nothing
     behind it — the worst of the three possible states, because it looks
     ready. */
  const js = readFileSync(join(pub, "assets/forgelocal.js"), "utf8");
  const guarded = js.match(/if \(LIVE\.project\) await openProject\(/g) ?? [];
  assert.deepEqual(guarded, [],
    "a model-load path still opens a session only when a project is open");
  const opens = js.match(/await openProject\(LIVE\.project \? LIVE\.project\.path : null\)/g) ?? [];
  assert.equal(opens.length, 3, `expected three model-load paths, found ${opens.length}`);
});

/* ------------------------------ opening a folder must not reset the chat */

test("opening a project attaches it instead of starting a new session", () => {
  /* Reported from use: the model said "open a project folder so I can read
     that file" — which is what the prompt tells it to say — and opening one
     cleared the conversation. openProject called createSession every time, so
     the transcript that had just asked for the folder was thrown away at the
     moment the person acted on it, and the old session was left running.

     The check is on the branch, because that is what went wrong: a window with
     a live session attaches, and only a window without one creates. */
  const js = readFileSync(join(pub, "assets/forgelocal.js"), "utf8");

  const fn = /async function openProject\(path\) \{([\s\S]*?)\n  \}/.exec(js);
  assert.ok(fn, "openProject is not where this test expects it");
  assert.match(fn[1], /if \(LIVE\.session\) return attachProject\(/,
    "openProject still creates a session even when one is already open");

  const attach = /async function attachProject\(path\) \{([\s\S]*?)\n  \}/.exec(js);
  assert.ok(attach, "there is no attachProject");
  assert.match(attach[1], /setSessionRoot\(/,
    "attachProject does not use the request that keeps the session");
  assert.ok(!/createSession\(/.test(attach[1]),
    "attachProject creates a session, which is the bug it exists to fix");
  assert.ok(!/initialRunView\(\)/.test(attach[1]),
    "attaching a folder still resets the transcript");
});

test("the client can ask for a folder without asking for a session", () => {
  const client = readFileSync(join(pub, "core/hostclient.mjs"), "utf8");
  assert.match(client, /setSessionRoot\(root\)/,
    "the renderer has no way to attach a folder to an open session");
  assert.match(client, /SESSION_SET_ROOT: "session\.root"/);
});

/* ------------------------ the app must not ask you to install the app */

test("the desktop shell identifies itself, so the runtime state can move", () => {
  /* Root cause of "desktop app required" appearing inside the desktop app.
     detectEnvironment reads window.forgelocalDesktop and nothing ever set it,
     so the page decided it was a web preview — and reduceRuntime refuses every
     transition unless the environment is "desktop". The runtime state was
     frozen at {disconnected, web-preview} for the life of the process, and
     every control keyed on it said the app was missing. */
  const js = readFileSync(join(pub, "assets/forgelocal.js"), "utf8");
  assert.match(js, /forgelocalDesktop\s*=\s*true/,
    "nothing tells the page it is running in the desktop shell");
  /* And only on the evidence of the IPC bridge. A page that set this from a
     query string or a stored value could talk itself into "desktop". */
  const line = js.split("\n").find((l) => /forgelocalDesktop\s*=\s*true/.test(l)) ?? "";
  assert.match(line, /hasTauri\(\)/,
    "the desktop flag is set without checking for the desktop bridge");
});

test("the live host drives the runtime state machine", () => {
  /* The other half: dispatchRuntime existed and had no callers at all, so even
     with the right environment nothing ever moved the state off disconnected. */
  const js = readFileSync(join(pub, "assets/forgelocal.js"), "utf8");
  const calls = (js.match(/syncRuntimeFromLive\(\)/g) ?? []).length;
  assert.ok(calls >= 3,
    `the runtime state machine is driven from ${calls} place(s); it needs the handshake and the provider frames`);
  assert.match(js, /function syncRuntimeFromLive\(\)/);
});

test("no surface tells a desktop user they need the desktop app", () => {
  /* The reported symptom, as a rule rather than as six separate fixes: a
     person running the desktop app was told, by the desktop app, that they
     needed the desktop app. Every remaining claim of that shape has to sit in
     a function that checked which host it is in — or be about something the
     host genuinely could not measure, which is a different sentence.

     Comments are stripped first. An explanation of why a string was removed
     should not read as the string. */
  const raw = readFileSync(join(pub, "assets/forgelocal.js"), "utf8");
  /* Block comments are blanked rather than removed, so reported line numbers
     still point at the file. Stripping per-line cannot work: a continuation
     line inside a block comment carries no marker of its own. */
  const js = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const lines = js.split("\n");

  /** The nearest enclosing top-level function declaration, searching upward. */
  const enclosing = (i) => {
    for (let k = i; k >= 0; k--) {
      if (/^  (?:async )?function [a-zA-Z]/.test(lines[k])) return lines.slice(k, i + 1).join("\n");
    }
    return lines.slice(Math.max(0, i - 40), i + 1).join("\n");
  };

  const claims = [];
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    if (!/needs the desktop app|Desktop app required/i.test(code)) return;
    /* Conditional on what was measured, not on which app this is: a host that
       looked and could not tell says so, and that is legitimate. */
    if (/res\.measured|measured \?/.test(code)) return;
    if (!/hasTauri\(\)/.test(enclosing(i))) claims.push(`${i + 1}: ${code.trim().slice(0, 90)}`);
  });

  assert.deepEqual(claims, [],
    `these tell the reader to get the desktop app without checking whether they already have it:\n${claims.join("\n")}`);
});
