// @ts-check
/**
 * Tests for durable session state.
 *
 * The properties that matter are the ones a restart depends on: an event
 * written twice is stored once, a replayed session rebuilds the same state, a
 * session the host died in the middle of says so, and nothing in the read path
 * can execute anything.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, SessionStatus, INLINE_LIMIT } from "./store.mjs";
import { initialState, reduceAgentEvent, EventType } from "./events.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "fl-store-"));
const clean = (d) => rmSync(d, { recursive: true, force: true });

/**
 * A row that must be there.
 *
 * Reading `.status` straight off a lookup that can return null fails two lines
 * later with "cannot read properties of null", which says nothing about which
 * session went missing. This fails on the spot, by name.
 *
 * @template T @param {T|null|undefined} v @param {string} what @returns {T}
 */
function must(v, what) {
  assert.ok(v != null, what);
  return /** @type {T} */ (v);
}

/** @param {any} store @param {string} id */
const row = (store, id) => must(store.getSession(id), `no session named ${id}`);

let seq = 0;
const ev = (type, payload = {}, over = {}) => ({
  event_id: over.event_id ?? `e${++seq}`,
  session_id: "s1",
  turn_id: over.turn_id ?? "t1",
  sequence: over.sequence ?? seq,
  timestamp: 1757000000000 + seq,
  type,
  payload,
});

test("a session round-trips with its events in order", () => {
  const d = dir();
  const store = openStore(d);
  const id = store.createSession({ id: "s1", root: "C:/p", mode: "allow_edits" });

  store.appendEvent(id, ev(EventType.SESSION_STARTED, { root: "C:/p", mode: "allow_edits" }));
  store.appendEvent(id, ev(EventType.USER_MESSAGE_CREATED, { message_id: "u1", text: "Fix it" }));
  store.appendEvent(id, ev(EventType.TURN_COMPLETED, { stop: "final" }));

  const back = store.readEvents(id);
  assert.equal(back.length, 3);
  assert.deepEqual(back.map((e) => e.sequence), [1, 2, 3]);
  assert.equal(back[1].payload.text, "Fix it");
  assert.equal(store.lastSequence(id), 3);
  store.close();
  clean(d);
});

test("the same event written twice is stored once", () => {
  const d = dir();
  const store = openStore(d);
  store.createSession({ id: "s1", root: "C:/p", mode: "manual" });

  // This is what a reconnecting client does: it replays from a sequence it
  // already has, and the store must absorb that rather than duplicate it.
  const e = ev(EventType.TOOL_STARTED, { tool_call_id: "c1", tool: "read_file" });
  store.appendEvent("s1", e);
  store.appendEvent("s1", e);
  store.appendEvent("s1", { ...e });

  assert.equal(store.readEvents("s1").length, 1);
  store.close();
  clean(d);
});

test("replaying a stored session rebuilds the same state as the live one", () => {
  const d = dir();
  const store = openStore(d);
  store.createSession({ id: "s1", root: "C:/p", mode: "allow_edits" });

  const events = [
    ev(EventType.SESSION_STARTED, { root: "C:/p", mode: "allow_edits" }),
    ev(EventType.USER_MESSAGE_CREATED, { message_id: "u1", text: "Fix the divisor" }),
    ev(EventType.PHASE_CHANGED, { phase: "exploring" }),
    ev(EventType.TOOL_CALL_REQUESTED, { tool_call_id: "c1", tool: "read_file", args: { path: "a.js" } }),
    ev(EventType.TOOL_STARTED, { tool_call_id: "c1" }),
    ev(EventType.TOOL_COMPLETED, { tool_call_id: "c1", result: { lines: 7 }, duration_ms: 12 }),
    ev(EventType.PHASE_CHANGED, { phase: "acting" }),
    ev(EventType.PLAN_UPDATED, { items: [{ step: "Fix it", status: "done" }] }),
  ];

  // Fold live, then store, then fold what came back.
  let live = initialState("s1");
  for (const e of events) { live = reduceAgentEvent(live, e); store.appendEvent("s1", e); }

  let replayed = initialState("s1");
  for (const e of store.readEvents("s1")) replayed = reduceAgentEvent(replayed, e);

  assert.equal(replayed.phase, live.phase);
  assert.equal(replayed.rows.length, live.rows.length);
  assert.deepEqual(replayed.plan.items, live.plan.items);
  assert.equal(replayed.sequence, live.sequence);
  store.close();
  clean(d);
});

test("a large output is stored beside the database, not inside the row", () => {
  const d = dir();
  const store = openStore(d);
  store.createSession({ id: "s1", root: "C:/p", mode: "allow_edits" });

  const big = "x".repeat(INLINE_LIMIT + 5000);
  store.appendEvent("s1", ev(EventType.TOOL_COMPLETED, {
    tool_call_id: "c1", output: big, result: { exit_code: 0 },
  }));

  // The row carries a reference and an excerpt, so a transcript can render
  // without reading the file at all.
  const [row] = store.readEvents("s1");
  assert.equal(typeof row.payload.output, "object");
  assert.ok(row.payload.output.__blob, "no blob reference");
  assert.equal(row.payload.output.bytes, big.length);
  assert.equal(row.payload.output.excerpt.length, 2000);

  // And the content is still retrievable in full when something wants it.
  assert.equal(store.readBlob(row.payload.output.__blob), big);
  const [inflated] = store.readEvents("s1", { inflate: true });
  assert.equal(inflated.payload.output, big);

  store.close();
  clean(d);
});

test("a small output stays inline", () => {
  const d = dir();
  const store = openStore(d);
  store.createSession({ id: "s1", root: "C:/p", mode: "allow_edits" });
  store.appendEvent("s1", ev(EventType.TOOL_COMPLETED, { tool_call_id: "c1", output: "ok\n" }));
  const [row] = store.readEvents("s1");
  assert.equal(row.payload.output, "ok\n");
  store.close();
  clean(d);
});

test("a session the host died inside is marked interrupted on open", () => {
  const d = dir();
  let store = openStore(d);
  store.createSession({ id: "running", root: "C:/p", mode: "allow_edits" });
  store.createSession({ id: "asked", root: "C:/p", mode: "allow_edits" });
  store.createSession({ id: "done", root: "C:/p", mode: "allow_edits" });

  store.appendEvent("asked", ev(EventType.QUESTION_REQUESTED, { call_id: "c1", questions: [] }));
  store.closeSession("done", SessionStatus.COMPLETED);
  store.close();

  // The host stops without closing "running" or "asked".
  store = openStore(d);
  const result = store.markInterrupted();

  assert.equal(row(store, "running").status, SessionStatus.INTERRUPTED,
    "a run that was mid-flight must not claim to still be running");
  assert.equal(row(store, "asked").status, SessionStatus.AWAITING_USER,
    "a session waiting on the user is not interrupted; it is waiting");
  assert.equal(row(store, "done").status, SessionStatus.COMPLETED);
  assert.equal(result.interrupted, 1);
  store.close();
  clean(d);
});

test("an unanswered question survives a restart", () => {
  const d = dir();
  let store = openStore(d);
  store.createSession({ id: "s1", root: "C:/p", mode: "manual" });
  store.appendEvent("s1", ev(EventType.QUESTION_REQUESTED, {
    call_id: "c1",
    questions: [{
      id: "q0", header: "Storage", question: "Where?",
      multiSelect: false,
      options: [{ label: "localStorage", description: "Survives a refresh.", recommended: true }],
    }],
  }));
  store.close();

  store = openStore(d);
  store.markInterrupted();
  assert.equal(row(store, "s1").status, SessionStatus.AWAITING_USER);

  // And the question itself comes back whole, so the card can be re-rendered
  // rather than the user being told a question was asked at some point.
  let s = initialState("s1");
  for (const e of store.readEvents("s1")) s = reduceAgentEvent(s, e);
  assert.equal(s.question.questions[0].header, "Storage");
  assert.equal(s.question.questions[0].options[0].recommended, true);
  assert.equal(s.phase, "awaiting_user");
  store.close();
  clean(d);
});

test("compactions are recorded with the transcript they replaced", () => {
  const d = dir();
  const store = openStore(d);
  store.createSession({ id: "s1", root: "C:/p", mode: "allow_edits" });
  assert.equal(store.compactionCount("s1"), 0);

  store.recordCompaction({
    sessionId: "s1", atSequence: 40, summary: "Fixed the divisor; tests pass.", dropped: 22,
  });
  assert.equal(store.compactionCount("s1"), 1);
  const last = must(store.lastCompaction("s1"), "a compaction was recorded but none came back");
  assert.equal(last.at_sequence, 40);
  assert.equal(last.dropped, 22);
  assert.match(String(last.summary), /divisor/);
  store.close();
  clean(d);
});

test("sessions list newest first", () => {
  const d = dir();
  const store = openStore(d);
  store.createSession({ id: "a", root: "C:/p", mode: "manual", title: "First" });
  store.createSession({ id: "b", root: "C:/p", mode: "manual", title: "Second" });
  store.setTitle("a", "First, renamed");
  const list = store.listSessions(10);
  assert.equal(list[0].id, "a", "the most recently touched session leads");
  assert.equal(list[0].title, "First, renamed");
  store.close();
  clean(d);
});

test("deleting a session takes its events and blobs with it", () => {
  const d = dir();
  const store = openStore(d);
  store.createSession({ id: "s1", root: "C:/p", mode: "allow_edits" });
  const big = "y".repeat(INLINE_LIMIT + 100);
  store.appendEvent("s1", ev(EventType.TOOL_COMPLETED, { tool_call_id: "c1", output: big }));
  const [row] = store.readEvents("s1");
  const blob = join(store.blobDir, `${row.payload.output.__blob}.txt`);
  assert.ok(existsSync(blob));

  const removed = store.deleteSession("s1");
  assert.equal(store.getSession("s1"), null);
  assert.equal(store.readEvents("s1").length, 0);
  // The bytes go too. Dropping only the rows leaves the file on disk with
  // nothing left that knows it is there.
  assert.equal(removed, 1, "the blob was not accounted for");
  assert.equal(existsSync(blob), false, "the blob file was orphaned");
  store.close();
  clean(d);
});
