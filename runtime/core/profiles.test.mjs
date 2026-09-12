// @ts-check
/**
 * Tests for remembered capability verdicts.
 *
 * Every one of these is about the same property: this cache may make a model
 * look worse than it is, and must never make one look better. Everything it
 * cannot vouch for reads as untested, and untested is the state that withholds
 * agent features.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProfiles, profileKey, SUITE_VERSION, MAX_AGE_MS } from "./profiles.mjs";
import { emptyProfile, AgentGrade } from "./capability.mjs";
import { agentAllowed } from "./conformance.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "fl-prof-"));
const clean = (d) => rmSync(d, { recursive: true, force: true });

const ready = (over = {}) => emptyProfile({
  model: "m1", baseUrl: "http://a/v1",
  agentGrade: AgentGrade.READY, score: 10, testedAt: Date.now(), ...over,
});

test("a verdict survives a restart", () => {
  const d = dir();
  let store = openProfiles(d);
  store.set("http://a/v1", "m1", ready());

  store = openProfiles(d);
  const back = store.get("http://a/v1", "m1");
  assert.ok(back, "the verdict did not come back");
  assert.equal(back.agentGrade, AgentGrade.READY);
  assert.equal(agentAllowed(back), true);
  clean(d);
});

test("a verdict is tied to the server as well as the model", () => {
  /* The same model name on two endpoints is two different things: a different
     quantization, a different chat template, a different context length. A
     cache keyed on the name alone would let one stand in for the other. */
  const d = dir();
  const store = openProfiles(d);
  store.set("http://a/v1", "qwen-30b", ready());

  assert.ok(store.get("http://a/v1", "qwen-30b"));
  assert.equal(store.get("http://b/v1", "qwen-30b"), null,
    "a verdict earned on one server was reused on another");
  assert.notEqual(profileKey("http://a/v1", "m"), profileKey("http://b/v1", "m"));
  clean(d);
});

test("a verdict graded by a different suite is not trusted", () => {
  const d = dir();
  const store = openProfiles(d);
  store.set("http://a/v1", "m1", ready());

  // Someone edits the cases. Every stored grade is now a grade for a
  // different question.
  const file = join(d, "profiles.json");
  const all = JSON.parse(readFileSync(file, "utf8"));
  all[profileKey("http://a/v1", "m1")].suite = `${SUITE_VERSION},a_new_case`;
  writeFileSync(file, JSON.stringify(all));

  assert.equal(openProfiles(d).get("http://a/v1", "m1"), null,
    "a grade from an older suite was presented as current");
  clean(d);
});

test("a verdict older than the limit is not trusted", () => {
  // A model file can be replaced in place, keeping its name and its server.
  const d = dir();
  const store = openProfiles(d);
  store.set("http://a/v1", "m1", ready({ testedAt: Date.now() - MAX_AGE_MS - 1000 }));
  assert.equal(store.get("http://a/v1", "m1"), null);

  // And one inside the limit still is.
  store.set("http://a/v1", "m2", ready({ testedAt: Date.now() - MAX_AGE_MS + 60_000 }));
  assert.ok(store.get("http://a/v1", "m2"));
  clean(d);
});

test("a damaged file means untested, not ready", () => {
  /* The direction this must fail in. A profiles.json truncated by a crash
     must not produce a partially-parsed object that happens to carry a grade. */
  const d = dir();
  writeFileSync(join(d, "profiles.json"), '{"http://a/v1::m1": {"suite": "x", "profi');
  assert.equal(openProfiles(d).get("http://a/v1", "m1"), null);

  writeFileSync(join(d, "profiles.json"), "[]");
  assert.equal(openProfiles(d).get("http://a/v1", "m1"), null);

  writeFileSync(join(d, "profiles.json"), "null");
  assert.equal(openProfiles(d).get("http://a/v1", "m1"), null);
  clean(d);
});

test("a row without a real verdict in it is not a verdict", () => {
  const d = dir();
  const file = join(d, "profiles.json");
  openProfiles(d); // creates the directory

  for (const row of [
    { suite: SUITE_VERSION },
    { suite: SUITE_VERSION, profile: {} },
    { suite: SUITE_VERSION, profile: { agentGrade: "ready" } },              // no testedAt
    { suite: SUITE_VERSION, profile: { agentGrade: "ready", testedAt: "y" } },
    { suite: SUITE_VERSION, profile: { testedAt: Date.now() } },             // no grade
  ]) {
    writeFileSync(file, JSON.stringify({ [profileKey("u", "m")]: row }));
    assert.equal(openProfiles(d).get("u", "m"), null,
      `a malformed row was accepted: ${JSON.stringify(row)}`);
  }
  clean(d);
});

test("a chat-only verdict is remembered as chat-only", () => {
  // The cache must not quietly lose a negative result; a forgotten failure
  // reads as a model nobody has tested, and that is a different claim.
  const d = dir();
  const store = openProfiles(d);
  const bad = ready({ agentGrade: AgentGrade.CHAT_ONLY, score: 6, failed: ["no_fabrication"] });
  store.set("http://a/v1", "liar", bad);

  const back = openProfiles(d).get("http://a/v1", "liar");
  assert.equal(back.agentGrade, AgentGrade.CHAT_ONLY);
  assert.deepEqual(back.failed, ["no_fabrication"]);
  assert.equal(agentAllowed(back), false);
  clean(d);
});

test("forgetting a model removes it and leaves the others", () => {
  const d = dir();
  const store = openProfiles(d);
  store.set("http://a/v1", "m1", ready());
  store.set("http://a/v1", "m2", ready({ model: "m2" }));

  store.forget("http://a/v1", "m1");
  assert.equal(store.get("http://a/v1", "m1"), null);
  assert.ok(store.get("http://a/v1", "m2"), "forgetting one removed another");
  clean(d);
});

test("listing shows only profiles the current suite produced", () => {
  const d = dir();
  const store = openProfiles(d);
  store.set("http://a/v1", "m1", ready());

  const file = join(d, "profiles.json");
  const all = JSON.parse(readFileSync(file, "utf8"));
  all[profileKey("http://a/v1", "old")] = { suite: "an-older-suite", profile: ready() };
  writeFileSync(file, JSON.stringify(all));

  const rows = openProfiles(d).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].model, "m1");
  clean(d);
});
