// @ts-check
/**
 * The interface's copy of the output styles must be the runtime's.
 *
 * This file exists because the duplication in styles.mjs is otherwise
 * unsafe. The renderer is a static site and cannot import from the runtime
 * tree at build time, so the four styles are written twice — and a settings
 * page that describes a style differently from the prompt layer that
 * implements it is a promise the user has no way to check.
 *
 * The test imports both and compares them. It is the only thing standing
 * between the two copies and the first edit that touches one of them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { STYLE_COPY, STYLE_ORDER, OutputStyle, normalizeStyle, styleChooserHtml } from "./styles.mjs";
import {
  STYLE_COPY as RUNTIME_COPY,
  OUTPUT_STYLES as RUNTIME_STYLES,
  OutputStyle as RuntimeStyle,
  styleLayer,
} from "../../runtime/core/prompt.mjs";

test("the interface offers exactly the styles the runtime implements", () => {
  assert.deepEqual([...STYLE_ORDER].sort(), [...RUNTIME_STYLES].sort());
  assert.deepEqual(OutputStyle, RuntimeStyle);
});

test("every style is described in the same words on both sides", () => {
  for (const id of STYLE_ORDER) {
    assert.deepEqual(STYLE_COPY[id], RUNTIME_COPY[id],
      `the interface and the runtime describe "${id}" differently`);
  }
});

test("a style's description is about how it writes, never about what it may do", () => {
  /* Style sits under the invariants, not over them. A description promising
     anything about permissions, safety or verification would be describing a
     control that does not exist — and would invite someone to implement it. */
  const forbidden = /permission|approv|allow|safe|skip|without asking|bypass/i;
  for (const id of STYLE_ORDER) {
    const all = `${STYLE_COPY[id].summary} ${STYLE_COPY[id].detail}`;
    assert.ok(!forbidden.test(all),
      `"${id}" describes itself as changing what the agent may do: ${all}`);
  }
});

test("an unknown style falls back to adaptive rather than to nothing", () => {
  for (const bad of [null, undefined, "", "verbose", 7, {}]) {
    assert.equal(normalizeStyle(bad), OutputStyle.ADAPTIVE);
  }
  // And a real one survives, including in the case a stored value might have.
  assert.equal(normalizeStyle("CONCISE"), OutputStyle.CONCISE);
});

test("the chooser marks the current style and names the default", () => {
  const html = styleChooserHtml(OutputStyle.LEARNING);
  assert.match(html, /value="learning" checked/);
  assert.ok(!/value="adaptive" checked/.test(html), "two styles were marked current");
  // Which one is the default is stated rather than implied by being first.
  assert.match(html, /Adaptive<span class="askopt-r">default<\/span>|Adaptive <span class="askopt-r">default/);
});

test("the chooser renders every style, and nothing else", () => {
  const html = styleChooserHtml(OutputStyle.ADAPTIVE);
  for (const id of STYLE_ORDER) {
    assert.match(html, new RegExp(`value="${id}"`), `${id} is not offered`);
  }
  const offered = [...html.matchAll(/name="output-style" value="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(offered, [...STYLE_ORDER]);
});

test("each style really does change the layer the model is given", () => {
  /* The settings page would be decoration if the styles produced the same
     prompt. They have to differ from each other, and none may be empty. */
  const layers = new Map();
  for (const id of STYLE_ORDER) {
    const text = styleLayer(id);
    assert.ok(text.trim().length > 40, `"${id}" produces almost no instruction`);
    assert.ok(!layers.has(text), `"${id}" produces the same layer as "${layers.get(text)}"`);
    layers.set(text, id);
  }
});
