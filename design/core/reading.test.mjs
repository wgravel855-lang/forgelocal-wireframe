// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capture, restore, isPinned, distanceFromBottom, shouldFollow, remember, PINNED_SLACK,
} from "./reading.mjs";

/** @param {number} top @param {number} height @param {number} client */
const m = (top, height = 4000, client = 800) => ({ scrollTop: top, scrollHeight: height, clientHeight: client });

/* 8. Per-session scroll restoration and pinned-to-bottom behaviour. */
test("a reader at the end is pinned; one who scrolled up is not", () => {
  assert.equal(isPinned(m(3200)), true, "3200 + 800 = 4000, exactly at the end");
  assert.equal(isPinned(m(3200 - PINNED_SLACK + 1)), true, "just inside the slack");
  assert.equal(isPinned(m(3200 - PINNED_SLACK - 1)), false);
  assert.equal(distanceFromBottom(m(1000)), 2200);
});

test("a historical chat is restored to where it was left, not to its end", () => {
  const pos = capture(m(1400), "3");
  assert.deepEqual(pos, { top: 1400, pinned: false, lastId: "3" });

  const back = restore(pos, m(0), null);
  assert.deepEqual(back, { top: 1400, follow: false }, "it does not jump to the end");
});

test("the anchored turn wins over the raw pixel value after a re-render", () => {
  const pos = capture(m(1400), "3");
  // the same turn now sits lower because an activity row expanded above it
  const back = restore(pos, m(0, 5200), 1850);
  assert.deepEqual(back, { top: 1838, follow: false });
});

test("a session that was following the end keeps following", () => {
  const pos = capture(m(3200), "9");
  assert.equal(pos.pinned, true);
  const back = restore(pos, m(0, 5000, 800), null);
  assert.ok(back);
  assert.deepEqual(back, { top: 4200, follow: true }, "the end of the taller transcript");
});

test("a restore never scrolls past the end of a shorter transcript", () => {
  const pos = capture(m(3000), null);
  const back = restore(pos, m(0, 1200, 800), null);
  assert.ok(back);
  assert.equal(back.top, 400, "clamped to the new maximum");
});

test("with no stored position the caller falls back to its own default", () => {
  assert.equal(restore(null, m(0), null), null);
});

test("auto-follow stops when the reader scrolls up mid-run and resumes at the bottom", () => {
  assert.equal(shouldFollow(true, m(3200)), true);
  assert.equal(shouldFollow(true, m(500)), false, "scrolling up during a run stops the follow");
  assert.equal(shouldFollow(false, m(3200)), true, "returning to the bottom resumes it");
});

test("positions are stored per session and a null id is ignored", () => {
  const a = remember({}, "c1", capture(m(1000), "2"));
  const b = remember(a, "c2", capture(m(3200), "7"));
  assert.deepEqual(Object.keys(b).sort(), ["c1", "c2"]);
  assert.equal(b.c1.top, 1000);
  assert.equal(b.c2.pinned, true);
  assert.equal(remember(b, null, capture(m(0), null)), b, "a new session stores nothing");
});
