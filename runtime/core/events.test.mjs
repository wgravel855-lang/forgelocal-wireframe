// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EventType, SessionState, EVENT_TYPES,
  createEmitter, reduce, replay, initialState, stateLabel, invalidReason,
} from "./events.mjs";

/** A deterministic emitter, so tests compare state and not clocks. */
function emitter(sessionId = "s1") {
  let n = 0;
  return createEmitter(sessionId, { now: () => 1000 + n, id: () => `e${++n}` });
}

/** The event sequence a normal turn produces. */
function turnEvents(e) {
  const t = { turnId: "t1" };
  return [
    e.emit(EventType.SESSION_STARTED, { cwd: "C:/p", mode: "manual", model: "m" }),
    e.emit(EventType.USER_MESSAGE_CREATED, { message_id: "u1", text: "count the files" }, t),
    e.emit(EventType.ASSISTANT_TEXT_STARTED, { message_id: "a1" }, t),
    e.emit(EventType.ASSISTANT_TEXT_DELTA, { message_id: "a1", text: "Let me " }, t),
    e.emit(EventType.ASSISTANT_TEXT_DELTA, { message_id: "a1", text: "look." }, t),
    e.emit(EventType.ASSISTANT_TEXT_COMPLETED, { message_id: "a1" }, t),
    e.emit(EventType.TOOL_CALL_REQUESTED, { tool_call_id: "c1", tool: "glob", args: { pattern: "**/*" } }, t),
    e.emit(EventType.TOOL_STARTED, { tool_call_id: "c1" }, t),
    e.emit(EventType.TOOL_OUTPUT_DELTA, { tool_call_id: "c1", chunk: "a.js\n" }, t),
    e.emit(EventType.TOOL_COMPLETED, { tool_call_id: "c1", result: { count: 1 }, duration_ms: 5 }, t),
    e.emit(EventType.TURN_COMPLETED, { stop_reason: "final" }, t),
  ];
}

test("the protocol defines every required event type", () => {
  // The brief names these; a rename would otherwise pass unnoticed.
  const required = [
    "session_started", "session_state_changed", "user_message_created",
    "assistant_text_started", "assistant_text_delta", "assistant_text_completed",
    "status_changed", "plan_updated", "tool_call_requested", "permission_required",
    "permission_resolved", "tool_started", "tool_output_delta", "tool_completed",
    "tool_failed", "file_changed", "checkpoint_created", "context_usage_updated",
    "compaction_started", "compaction_completed", "background_task_started",
    "background_task_updated", "background_task_completed", "turn_completed",
    "turn_cancelled", "runtime_error",
  ];
  for (const t of required) assert.ok(EVENT_TYPES.includes(t), `missing ${t}`);
  assert.equal(EVENT_TYPES.length, required.length, "an undocumented type was added");
});

test("sequence numbers are monotonic and start at 1", () => {
  const e = emitter();
  const events = turnEvents(e);
  assert.equal(events[0].sequence, 1);
  for (let i = 1; i < events.length; i++) {
    assert.equal(events[i].sequence, events[i - 1].sequence + 1);
  }
});

test("emitting an unknown type throws rather than producing a mystery event", () => {
  assert.throws(() => emitter().emit("tool_maybe_started", {}), /Unknown event type/);
});

test("a turn reduces to the transcript it describes", () => {
  const s = replay(turnEvents(emitter()));
  assert.equal(s.rows.length, 3);
  assert.deepEqual(s.rows.map((r) => r.kind), ["user", "assistant", "tool"]);
  assert.equal(s.rows[1].text, "Let me look.");
  assert.equal(s.rows[1].streaming, false);
  assert.equal(s.rows[2].status, "completed");
  assert.equal(s.rows[2].output, "a.js\n");
  assert.equal(s.state, SessionState.IDLE);
  assert.deepEqual(s.completedTurns, ["t1"]);
  assert.deepEqual(s.gaps, []);
});

test("replay after a restart reconstructs identical state", () => {
  const events = turnEvents(emitter());
  const live = replay(events);
  const restarted = replay(events);
  // Sets and Maps do not survive deepEqual comparison of the container, so
  // compare the parts a renderer actually draws.
  assert.deepEqual(restarted.rows, live.rows);
  assert.equal(restarted.state, live.state);
  assert.equal(restarted.sequence, live.sequence);
  assert.deepEqual(restarted.completedTurns, live.completedTurns);
});

test("duplicate delivery changes nothing and is detectable", () => {
  const events = turnEvents(emitter());
  const once = replay(events);
  // every event delivered twice, interleaved
  const twice = replay(events.flatMap((e) => [e, e]));
  assert.deepEqual(twice.rows, once.rows);
  assert.equal(twice.sequence, once.sequence);

  // and the reducer returns the same object for a duplicate
  const after = reduce(once, events[0]);
  assert.equal(after, once);
});

test("out-of-order arrival does not rewind the sequence", () => {
  const e = emitter();
  const events = turnEvents(e);
  const s = replay([events[0], events[1], events[3] ? events[2] : events[2]]);
  const back = reduce(s, events[1]); // already seen
  assert.equal(back.sequence, s.sequence);
});

test("a dropped event is recorded as a gap, not smoothed over", () => {
  const e = emitter();
  const events = turnEvents(e);
  const without = events.filter((ev) => ev.sequence !== 4);
  const s = replay(without);
  assert.deepEqual(s.gaps, [4]);
  // and the visible text is genuinely missing the dropped delta
  assert.equal(s.rows[1].text, "look.");
});

test("a tool event with no requested call is rejected", () => {
  const e = emitter();
  const started = e.emit(EventType.SESSION_STARTED, {});
  const orphan = e.emit(EventType.TOOL_STARTED, { tool_call_id: "ghost" });
  assert.throws(() => replay([started, orphan]), /unknown tool call ghost/);
});

test("a text delta for an unopened message is rejected", () => {
  const e = emitter();
  const started = e.emit(EventType.SESSION_STARTED, {});
  const orphan = e.emit(EventType.ASSISTANT_TEXT_DELTA, { message_id: "nope", text: "x" });
  assert.throws(() => replay([started, orphan]), /unknown message nope/);
});

test("malformed events are refused at the boundary", () => {
  assert.equal(invalidReason(null), "not an object");
  assert.equal(invalidReason({ event_id: "a", session_id: "s", type: "nope", sequence: 1, timestamp: 1, payload: {} }), "unknown type nope");
  assert.equal(invalidReason({ event_id: "a", session_id: "s", type: "runtime_error", sequence: 0, timestamp: 1, payload: {} }), "sequence is not a positive integer");
  assert.equal(invalidReason({ event_id: "a", session_id: "s", type: "runtime_error", sequence: 1, timestamp: 1, payload: {} }), null);
});

test("permission suspends the turn and resolution clears it", () => {
  const e = emitter();
  const t = { turnId: "t1" };
  const s = replay([
    e.emit(EventType.SESSION_STARTED, {}),
    e.emit(EventType.TOOL_CALL_REQUESTED, { tool_call_id: "c1", tool: "run_command", args: { argv: ["npm", "test"] } }, t),
    e.emit(EventType.PERMISSION_REQUIRED, { request_id: "p1", tool_call_id: "c1", tool: "run_command", reason: "Run npm test" }, t),
  ]);
  assert.equal(s.state, SessionState.AWAITING_PERMISSION);
  assert.equal(s.permission.requestId, "p1");
  assert.equal(s.rows[0].status, "awaiting_permission");
  assert.equal(stateLabel(s), "Waiting for approval");

  const after = reduce(s, e.emit(EventType.PERMISSION_RESOLVED, { request_id: "p1", tool_call_id: "c1", decision: "deny" }, t));
  assert.equal(after.permission, null);
  assert.equal(after.rows[0].status, "denied");
});

test("cancellation leaves in-flight rows visibly unfinished", () => {
  const e = emitter();
  const t = { turnId: "t1" };
  const s = replay([
    e.emit(EventType.SESSION_STARTED, {}),
    e.emit(EventType.ASSISTANT_TEXT_STARTED, { message_id: "a1" }, t),
    e.emit(EventType.ASSISTANT_TEXT_DELTA, { message_id: "a1", text: "Runni" }, t),
    e.emit(EventType.TOOL_CALL_REQUESTED, { tool_call_id: "c1", tool: "run_command", args: {} }, t),
    e.emit(EventType.TOOL_STARTED, { tool_call_id: "c1" }, t),
    e.emit(EventType.TURN_CANCELLED, { reason: "user" }, t),
  ]);
  assert.equal(s.state, SessionState.CANCELLED);
  assert.equal(s.rows[0].cancelled, true);
  assert.equal(s.rows[0].streaming, false);
  assert.equal(s.rows[1].status, "cancelled");
  assert.equal(stateLabel(s), "Stopped");
});

test("file changes and checkpoints accumulate with their tool call", () => {
  const e = emitter();
  const t = { turnId: "t1" };
  const s = replay([
    e.emit(EventType.SESSION_STARTED, {}),
    e.emit(EventType.TOOL_CALL_REQUESTED, { tool_call_id: "c1", tool: "apply_patch", args: {} }, t),
    e.emit(EventType.FILE_CHANGED, { path: "src/a.js", change: "modified", added: 2, removed: 1 },
      { turnId: "t1", parentToolCallId: "c1" }),
    e.emit(EventType.CHECKPOINT_CREATED, { checkpoint_id: "k1", files: 1 }, t),
  ]);
  assert.equal(s.files.length, 1);
  assert.equal(s.files[0].toolCallId, "c1");
  assert.equal(s.checkpoints[0].id, "k1");
});

test("context usage is stored with a computed percentage", () => {
  const e = emitter();
  const s = replay([
    e.emit(EventType.SESSION_STARTED, {}),
    e.emit(EventType.CONTEXT_USAGE_UPDATED, { used_tokens: 8192, context_window: 32768 }),
  ]);
  assert.equal(s.context.used, 8192);
  assert.equal(s.context.percent, 0.25);
});

test("an idle session with no events reports Idle, not a fabricated status", () => {
  assert.equal(stateLabel(initialState()), "Idle");
  assert.equal(initialState().rows.length, 0);
  assert.equal(initialState().context, null);
});
