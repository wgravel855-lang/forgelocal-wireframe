// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pressure, planCompaction, available, ratio,
  validateSummary, SUMMARY_FIELDS, largestBuckets, hardStopChoices,
} from "./context.mjs";

const budget = (over = {}) => ({
  effective: 16384,
  reserve: 2048,
  used: { system: 600, rules: 400, tools: 900, messages: 3000, files: 1200, output: 0, attachments: 0 },
  estimated: false,
  ...over,
});

/* 7. Soft threshold, output pruning, compaction, hard stop. */
test("pressure reports ok, near and compact at the documented points", () => {
  assert.equal(pressure(budget()), "ok");
  assert.equal(pressure(budget({ used: { ...budget().used, messages: 8200 } })), "near");
  assert.equal(pressure(budget({ used: { ...budget().used, messages: 10600 } })), "compact");
});

test("below the threshold nothing is compacted", () => {
  assert.equal(planCompaction(budget(), 500).action, "none");
});

test("old tool output is pruned before anything is summarized", () => {
  const b = budget({ used: { ...budget().used, output: 5000 } });
  const plan = planCompaction(b, 2000);
  assert.equal(plan.action, "prune-output");
  assert.equal(plan.bucket, "output");
  assert.equal(plan.freed, 5000);
  assert.match(plan.reason, /still stored/, "the user can still read what was pruned");
});

test("with no output left, earlier turns are summarized", () => {
  const b = budget({ used: { ...budget().used, messages: 11000, output: 0 } });
  const plan = planCompaction(b, 1000);
  assert.equal(plan.action, "summarize");
  assert.ok((plan.freed ?? 0) > 0);
});

test("when nothing can be freed it hard-stops instead of looping", () => {
  const b = budget({
    effective: 8192, reserve: 2048,
    used: { system: 0, rules: 0, tools: 0, messages: 0, files: 0, output: 0, attachments: 7000 },
  });
  const plan = planCompaction(b, 500);
  assert.equal(plan.action, "hard-stop");
  assert.equal(hardStopChoices(b).length, 3, "three honest ways forward");
});

test("available input never goes negative", () => {
  const b = budget({ used: { ...budget().used, messages: 40000 } });
  assert.equal(available(b), 0);
  assert.ok(ratio(b) > 1);
  assert.equal(pressure(b), "over");
});

test("a summary missing any required field is rejected", () => {
  const full = Object.fromEntries(SUMMARY_FIELDS.map((f) => [f, "x"]));
  assert.deepEqual(validateSummary(full), { ok: true, missing: [] });

  const partial = { ...full };
  delete partial.nextAction;
  delete partial.errors;
  const res = validateSummary(partial);
  assert.equal(res.ok, false);
  assert.deepEqual(res.missing.sort(), ["errors", "nextAction"]);
});

test("the context popover ranks the largest categories first", () => {
  const b = budget({ used: { ...budget().used, output: 5000, files: 1200 } });
  const ranked = largestBuckets(b);
  assert.equal(ranked[0].bucket, "output");
  assert.equal(ranked[0].tokens, 5000);
  assert.ok(ranked.every((x) => x.tokens > 0), "empty categories are not listed");
});
