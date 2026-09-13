// @ts-check
/**
 * The visual checks, as part of the suite.
 *
 * Skips rather than fails when there is no browser to render in or no preview
 * page to render: this runs on machines with Edge installed and machines
 * without, and a missing browser is not a broken layout. The geometry it does
 * check — modal size, centring, the 40/60 split, overflow, the text floor — is
 * exactly what a screenshot comparison cannot assert reliably.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runVisual, checkVisual } from "./visual.mjs";

test("the model browser holds its layout at every size", async (t) => {
  const { results, skipped } = await runVisual();
  if (skipped) return t.skip(skipped);

  /** @type {string[]} */
  const problems = [];
  for (const r of results) problems.push(...checkVisual(r));
  assert.deepEqual(problems, [], `\n  ${problems.join("\n  ")}`);
  assert.ok(results.length >= 3, "fewer than three sizes were measured");
});
