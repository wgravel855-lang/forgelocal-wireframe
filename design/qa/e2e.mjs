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
      // one per section, and the controller unhides exactly one
      assert.equal(count, 6, "settings: one heading per section");
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
