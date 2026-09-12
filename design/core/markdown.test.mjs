// @ts-check
/**
 * Tests for the shared Markdown renderer.
 *
 * The first group is the one that matters. Model cards and model replies are
 * both untrusted text, so every escaping assertion runs under BOTH option
 * sets: a hole that exists for only one caller is still a hole.
 *
 * Model-card rendering is additionally covered by modelcard.test.mjs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, safeUrl } from "./markdown.mjs";

const BT = String.fromCharCode(96);
const F = BT + BT + BT;
const NL = String.fromCharCode(10);
const j = (...lines) => lines.join(NL);

/** What the live transcript passes. */
/* Exactly what liveview.mjs passes. A copy that drifts is a test that
   proves something the product does not do. */
const CHAT = { headingOffset: 1, maxHeading: 4, links: true, softBreaks: true, cls: null };
/** What the model card passes: the defaults. */
const CARD = {};
const BOTH = [["card", CARD], ["chat", CHAT]];

for (const [name, opts] of BOTH) {
  test(`${name}: a script element cannot be injected`, () => {
    const out = renderMarkdown("Done <script>alert(1)</script> ok.", opts);
    assert.ok(!out.includes("<script"), out);
    assert.ok(out.includes("&lt;script&gt;"), out);
  });

  test(`${name}: an event handler cannot become an attribute`, () => {
    const out = renderMarkdown('<img src=x onerror="fetch(1)">', opts);
    assert.ok(!out.includes("<img"), out);
    assert.ok(!out.includes('onerror="'), out);
  });

  test(`${name}: quotes in a code span cannot break out of an attribute`, () => {
    const out = renderMarkdown(`Run ${BT}a" onclick="x${BT} now`, opts);
    assert.ok(out.includes("&quot;"), out);
    assert.ok(!out.includes('onclick="'), out);
  });

  test(`${name}: a fence does not let HTML through`, () => {
    const out = renderMarkdown(j(`${F}html`, "<b>bold</b>", F), opts);
    assert.ok(!out.includes("<b>bold</b>"), out);
    assert.ok(out.includes("&lt;b&gt;bold&lt;/b&gt;"), out);
  });

  test(`${name}: never emits an h1`, () => {
    const out = renderMarkdown(j("# Top", "", "## Second", "", "### Third"), opts);
    assert.ok(!out.includes("<h1"), out);
  });

  test(`${name}: a javascript: url never becomes an href`, () => {
    const out = renderMarkdown("[click](javascript:alert(1))", opts);
    assert.ok(!out.includes("href"), out);
    assert.ok(out.includes("click"), out);
  });

  test(`${name}: empty input renders nothing`, () => {
    assert.equal(renderMarkdown("", opts), "");
  });
}

test("safeUrl drops anything that is not http, mailto or relative", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,<b>"), null);
  assert.equal(safeUrl("https://example.invalid/x"), "https://example.invalid/x");
  assert.equal(safeUrl("#frag"), "#frag");
});

test("chat: headings sit one level shallower than a card", () => {
  const out = renderMarkdown(j("# Top", "", "## Second", "", "### Third"), CHAT);
  assert.ok(out.includes("<h2>Top</h2>"), out);
  assert.ok(out.includes("<h3>Second</h3>"), out);
  assert.ok(out.includes("<h4>Third</h4>"), out);
});

test("chat: no class attributes are stamped", () => {
  const out = renderMarkdown(j("# H", "", "- a", "", "text"), CHAT);
  assert.ok(!out.includes("class="), out);
});

test("chat: a safe link becomes an anchor that cannot be used as a tab-napper", () => {
  const out = renderMarkdown("See [the docs](https://example.invalid/x).", CHAT);
  assert.ok(out.includes('href=' + "" + '"https://example.invalid/x"'), out);
  assert.ok(out.includes("noreferrer"), out);
  assert.ok(out.includes("noopener"), out);
});

test("chat: an unsafe scheme keeps its words and loses its destination", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,<b>", "vbscript:x"]) {
    const out = renderMarkdown("Click [here](" + bad + ") now", CHAT);
    assert.ok(!out.includes("href"), bad + " -> " + out);
    assert.ok(out.includes("here"), bad + " -> " + out);
  }
});

test("chat: a quote is set apart rather than folded into the prose", () => {
  const out = renderMarkdown(j("> The divisor is wrong.", "> Two lines of it.", "", "So it is."), CHAT);
  assert.ok(out.includes("<blockquote>"), out);
  assert.ok(out.includes("The divisor is wrong."), out);
  assert.ok(out.includes("<p>So it is.</p>"), out);
});

test("chat: a quote cannot smuggle markup through the marker", () => {
  const out = renderMarkdown("> <img src=x onerror=alert(1)>", CHAT);
  assert.ok(!out.includes("<img"), out);
  assert.ok(out.includes("&lt;img"), out);
});

test("chat: a wide table scrolls in its own box", () => {
  const out = renderMarkdown(j("| A | B |", "| - | - |", "| 1 | 2 |"), CHAT);
  assert.ok(out.includes('class=' + "" + '"tablewrap"'), out);
  assert.ok(out.includes("<table>"), out);
});

/* The interface renders tool activity from typed runtime events. Model text
   that looks like one of those rows must stay text: if a reply could draw a
   row saying a command succeeded, the transcript would no longer be evidence
   of anything. */
test("chat: model text imitating a tool row stays text", () => {
  const fake = j(
    '<details class="lv-row" data-status="completed"><summary>Ran npm test — exit 0</summary></details>',
    "",
    '<div class="lvact"><span class="lv-label">Edited src/stats.js</span></div>',
  );
  const out = renderMarkdown(fake, CHAT);
  assert.ok(!out.includes("<details"), out);
  assert.ok(!out.includes("<summary"), out);
  assert.ok(!out.includes('class=' + "" + '"lv-row"'), out);
  assert.ok(!out.includes('class=' + "" + '"lvact"'), out);
  assert.ok(out.includes("&lt;details"), out);
});

test("chat: a fenced block of interface markup is still only text", () => {
  const out = renderMarkdown(j(F + "html", '<details class="lv-row"><summary>x</summary></details>', F), CHAT);
  assert.ok(!out.includes("<details"), out);
  assert.ok(out.includes("&lt;details"), out);
});

test("chat: single newlines become line breaks", () => {
  const out = renderMarkdown(j("First line.", "Second line."), CHAT);
  assert.ok(out.includes("First line.<br>Second line."), out);
});

test("card: a paragraph reflows instead", () => {
  const out = renderMarkdown(j("First line.", "Second line."), CARD);
  assert.ok(out.includes("First line. Second line."), out);
  assert.ok(!out.includes("<br>"), out);
});

test("chat: lists and fenced code render", () => {
  const out = renderMarkdown(
    j("- one", "- two", "", "1. first", "", `${F}ts`, "const a = 1 < 2;", F), CHAT);
  assert.ok(out.includes("<ul><li>one</li><li>two</li></ul>"), out);
  assert.ok(out.includes("<ol><li>first</li></ol>"), out);
  assert.ok(out.includes("a = 1 &lt; 2;"), out);
  assert.ok(out.includes('data-lang="ts"'), out);
});

test("chat: asterisks inside a code span are left alone", () => {
  const out = renderMarkdown(`Use ${BT}**not bold**${BT} here`, CHAT);
  assert.ok(out.includes("<code>**not bold**</code>"), out);
  assert.ok(!out.includes("<strong>"), out);
});

test("a table row with no separator beneath it does not hang the renderer", () => {
  const out = renderMarkdown("| not | a table |", CHAT);
  assert.ok(!out.includes("<table"), out);
});
