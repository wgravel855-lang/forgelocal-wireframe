// @ts-check
/**
 * The downloads summary, as a state table.
 *
 * Pausing a download changed both row surfaces to Paused while the sentence
 * above them still read "1 download in progress, 5.8 GB to go". Every state now
 * counts as itself, and the remaining-bytes clause names its own scope.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createState } from "./modelstore.mjs";
import { downloadsSummary, downloadsBadge, installedStats } from "./modelviews.mjs";
import { THIS_PC } from "./machine.mjs";

/** @param {Partial<import("./models.mjs").ModelRecord>} over */
const model = (over) => ({
  id: "m", displayName: "A model", publisher: "P", family: "f", architecture: "a",
  format: /** @type {'GGUF'} */ ("GGUF"), quantization: "Q4_K_M",
  fileSizeBytes: 10 * 1024 ** 3, capabilities: /** @type {any} */ ([]),
  installed: false, loadedInstances: [], ...over,
});

/** @param {string} id @param {any} state @param {number} [gotGiB] */
const dl = (id, state, gotGiB = 4) => model({
  id, installed: state === "completed",
  downloadState: { modelId: id, state, receivedBytes: gotGiB * 1024 ** 3, totalBytes: 10 * 1024 ** 3 },
});

const summary = (...models) => downloadsSummary(createState(models));

test("an empty list says so rather than counting to zero", () => {
  assert.equal(summary(), "No active downloads.");
  assert.equal(summary(model({ id: "a", installed: true })), "No active downloads.");
});

test("a completed download is not an active one", () => {
  assert.equal(summary(dl("a", "completed", 10)), "No active downloads.");
  assert.equal(downloadsBadge(createState([dl("a", "completed", 10)])), 0);
});

test("downloading counts as in progress", () => {
  assert.equal(summary(dl("a", "downloading")), "1 download in progress · 6 GB remaining.");
});

test("paused counts as paused, not as in progress", () => {
  const text = summary(dl("a", "paused"));
  assert.doesNotMatch(text, /in progress/, "a paused download was still called in progress");
  assert.match(text, /^1 paused/);
  assert.match(text, /6 GB remaining/, "its bytes are still owed");
});

test("queued and verifying count separately", () => {
  assert.match(summary(dl("a", "queued", 0)), /^1 queued/);
  assert.match(summary(dl("a", "verifying", 10)), /^1 verifying/);
});

test("failed is reported as stopped and never folded into progress", () => {
  const text = summary(dl("a", "failed", 6));
  assert.equal(text, "1 stopped.");
  assert.doesNotMatch(text, /in progress|remaining/);
});

test("a cancelled download leaves the summary entirely", () => {
  assert.equal(summary(dl("a", "canceled", 0)), "No active downloads.");
});

test("a mixed list names every state it contains", () => {
  const text = summary(
    dl("a", "downloading", 2), dl("b", "paused", 4), dl("c", "failed", 6),
    dl("d", "completed", 10), dl("e", "queued", 0),
  );
  assert.match(text, /1 download in progress/);
  assert.match(text, /1 paused/);
  assert.match(text, /1 queued/);
  assert.match(text, /1 stopped/);
  assert.doesNotMatch(text, /completed|installed/i, "a finished download is not pending work");
  // 8 + 6 + 10 GiB still owed across downloading, paused and queued
  assert.match(text, /24 GB remaining/);
});

test("plurals follow the count", () => {
  assert.match(summary(dl("a", "downloading"), dl("b", "downloading")), /2 downloads in progress/);
  assert.match(summary(dl("a", "downloading")), /1 download in progress/);
});

test("the badge counts work the user still owes an outcome", () => {
  const s = createState([dl("a", "downloading"), dl("b", "paused"), dl("c", "failed"), dl("d", "completed", 10)]);
  assert.equal(downloadsBadge(s), 3);
});

test("installed figures follow the store, not the fixtures", () => {
  const s = createState([
    model({ id: "a", installed: true, fileSizeBytes: 5 * 1024 ** 3 }),
    model({ id: "b", installed: false, fileSizeBytes: 9 * 1024 ** 3 }),
  ]);
  const stats = installedStats(s, THIS_PC);
  assert.equal(stats.count, 1);
  assert.equal(stats.countLabel, "1 model");
  assert.equal(stats.totalGB, "5.00");
});
