// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMode, modeLabel, modeDescription, MODE_LABELS, MODE_ORDER,
  DEFAULT_MODE, isSelectable,
} from "./modes.mjs";

test("the legacy value that leaked into the composer migrates", () => {
  // "normal" was the stored default of an older build and no menu offered it,
  // so the composer rendered the raw string next to Plan and Manual.
  assert.equal(normalizeMode("normal"), "allow_edits");
  assert.equal(modeLabel("normal"), "Allow edits");
  assert.doesNotMatch(modeLabel("normal"), /normal/i);
});

test("every legacy preset maps to the mode that behaved the same way", () => {
  assert.equal(normalizeMode("balanced"), "allow_edits");
  assert.equal(normalizeMode("ask"), "manual");
  assert.equal(normalizeMode("autopilot"), "auto");
});

test("an unknown value falls back and warns exactly once", () => {
  /** @type {string[]} */
  const warnings = [];
  assert.equal(normalizeMode("banana", (m) => warnings.push(m)), DEFAULT_MODE);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /banana/);
});

test("absent values are the default and do not warn", () => {
  /** @type {string[]} */
  const warnings = [];
  assert.equal(normalizeMode(undefined, (m) => warnings.push(m)), DEFAULT_MODE);
  assert.equal(normalizeMode(null, (m) => warnings.push(m)), DEFAULT_MODE);
  assert.equal(warnings.length, 0, "an empty slot is not a corrupt one");
});

test("no input renders as a raw value", () => {
  const labels = Object.values(MODE_LABELS);
  for (const input of ["normal", "", "  ", "AUTO", "Allow edits", "banana", 7, {}, null, undefined, []]) {
    const label = modeLabel(input);
    assert.ok(labels.includes(label), `${JSON.stringify(input)} rendered as ${label}`);
    assert.doesNotMatch(label, /^[a-z_]+$/, "a label is never the enum id");
  }
});

test("case and spacing in stored data do not produce a new mode", () => {
  assert.equal(normalizeMode("  Plan  "), "plan");
  assert.equal(normalizeMode("ALLOW_EDITS"), "allow_edits");
  assert.equal(normalizeMode("Allow edits"), "allow_edits");
});

test("switching sessions cannot leak one mode into another", () => {
  // Each session normalises its own stored value; there is no shared mutable
  // default for a second session to inherit.
  const sessions = { a: "normal", b: "plan", c: undefined };
  const resolved = Object.fromEntries(
    Object.entries(sessions).map(([id, v]) => [id, normalizeMode(v)]));
  assert.deepEqual(resolved, { a: "allow_edits", b: "plan", c: DEFAULT_MODE });
  // resolving b again is unaffected by having resolved a and c
  assert.equal(normalizeMode(sessions.b), "plan");
});

test("a normalised mode survives a round trip through storage", () => {
  const stored = JSON.stringify({ mode: normalizeMode("normal") });
  assert.equal(normalizeMode(JSON.parse(stored).mode), "allow_edits");
});

test("the menu lists every mode and marks Auto unselectable", () => {
  assert.deepEqual(MODE_ORDER, ["plan", "manual", "allow_edits", "auto"]);
  assert.equal(MODE_ORDER.length, Object.keys(MODE_LABELS).length);
  assert.equal(isSelectable("auto"), false);
  assert.match(modeDescription("auto"), /isolated runtime/);
});
