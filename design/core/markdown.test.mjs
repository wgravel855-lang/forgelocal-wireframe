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
const CHAT = { headingOffset: 1, maxHeading: 4, links: false, softBreaks: true, cls: null };
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

test("chat: a link keeps its words and loses its destination", () => {
  const out = renderMarkdown("See [the docs](https://example.invalid/x).", CHAT);
  assert.ok(!out.includes("<a "), out);
  assert.ok(out.includes("the docs"), out);
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
