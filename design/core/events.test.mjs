// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialRunState, reduce, reduceAll,
  composerAction, sessionActivity, activeTool, succeededTools,
  pendingPermission, runOutcome, contextPressure,
} from "./events.mjs";

/** @typedef {import("./events.mjs").AgentEvent} AgentEvent */

const at = "2026-09-08T12:00:00.000Z";
/** @param {AgentEvent} e @returns {AgentEvent} */
const ev = (e) => e;
/** @type {AgentEvent} */
const started = { type: "run.started", runId: "r1", sessionId: "s1", at };
/** @type {import("./events.mjs").ToolCall} */
const call = { callId: "c1", name: "run_command", label: "npm test", command: "npm test -- --run" };
/** @type {AgentEvent} */
const requested = { type: "tool.requested", runId: "r1", call, at };
/** @type {AgentEvent} */
const toolStarted = { type: "tool.started", runId: "r1", callId: "c1", at };

const running = () => reduceAll(initialRunState(), [started, requested, toolStarted]);

/* 1. Stop interrupts the active tool and updates every derived reading. */
test("stop settles the active tool and all derived state", () => {
  const before = running();
  assert.equal(before.tools[0].state, "running");
  assert.equal(composerAction(before), "stop");
  assert.equal(sessionActivity(before), "working");

  const after = reduce(before, ev({ type: "run.stopped", runId: "r1", at }));
  assert.equal(after.status, "stopped");
  assert.equal(after.tools[0].state, "interrupted", "no tool may still be running");
  assert.equal(activeTool(after), null);
  assert.equal(composerAction(after), "send");
  assert.equal(sessionActivity(after), "idle", "sidebar must leave Working");
  assert.deepEqual(runOutcome(after), { kind: "stopped", text: "You stopped this response" });
});

/* 2. Stop is idempotent. */
test("stopping twice changes nothing the second time", () => {
  const once = reduce(running(), ev({ type: "run.stopped", runId: "r1", at }));
  const twice = reduce(once, ev({ type: "run.stopped", runId: "r1", at }));
  assert.equal(twice, once, "a settled run returns the identical state object");
});

test("a completed run ignores a later stop", () => {
  const done = reduce(running(), ev({ type: "run.completed", runId: "r1", at }));
  const after = reduce(done, ev({ type: "run.stopped", runId: "r1", at }));
  assert.equal(after.status, "completed");
  assert.equal(after.userStopped, false);
});

/* 3 and 4. Permission decisions never invent an outcome. */
test("allow once unblocks the tool but does not complete it", () => {
  const s = reduceAll(initialRunState(), /** @type {AgentEvent[]} */ ([
    started, requested,
    { type: "permission.requested", runId: "r1", callId: "c1", risk: { scopeTag: "Network", scope: "writes package.json" }, at },
  ]));
  assert.equal(s.tools[0].state, "awaiting-permission");
  const pending = pendingPermission(s);
  assert.ok(pending);
  assert.equal(pending.callId, "c1");

  const allowed = reduce(s, ev({ type: "permission.decided", runId: "r1", callId: "c1", decision: "once", at }));
  assert.equal(allowed.tools[0].state, "pending", "allowing is not succeeding");
  assert.equal(succeededTools(allowed).length, 0, "nothing may claim success yet");
  assert.equal(allowed.status, "running");
});

test("only tool.completed produces a successful tool", () => {
  const allowed = reduceAll(initialRunState(), /** @type {AgentEvent[]} */ ([
    started, requested,
    { type: "permission.requested", runId: "r1", callId: "c1", risk: { scopeTag: "Network", scope: "x" }, at },
    { type: "permission.decided", runId: "r1", callId: "c1", decision: "once", at },
    toolStarted,
  ]));
  assert.equal(succeededTools(allowed).length, 0);

  const done = reduce(allowed, ev({
    type: "tool.completed", runId: "r1", callId: "c1",
    result: { exitCode: 0, summary: "added 1 package" }, at,
  }));
  assert.equal(done.tools[0].state, "succeeded");
  assert.equal(succeededTools(done).length, 1);
});

test("a non-zero exit is a failure, not a success", () => {
  const done = reduce(running(), ev({
    type: "tool.completed", runId: "r1", callId: "c1", result: { exitCode: 1 }, at,
  }));
  assert.equal(done.tools[0].state, "failed");
  assert.equal(succeededTools(done).length, 0);
});

test("deny marks the tool denied and ends the run truthfully", () => {
  const s = reduceAll(initialRunState(), /** @type {AgentEvent[]} */ ([
    started, requested,
    { type: "permission.requested", runId: "r1", callId: "c1", risk: { scopeTag: "Network", scope: "x" }, at },
    { type: "permission.decided", runId: "r1", callId: "c1", decision: "deny", at },
  ]));
  assert.equal(s.tools[0].state, "denied");
  assert.equal(s.status, "blocked", "the run may not keep running after a denial");
  assert.equal(composerAction(s), "send");
  assert.equal(sessionActivity(s), "needs-input");
  assert.equal(succeededTools(s).length, 0);
});

/* Ordering guards: a settled run must not accept more work. */
test("events after a run settles are ignored", () => {
  const stopped = reduce(running(), ev({ type: "run.stopped", runId: "r1", at }));
  const after = reduceAll(stopped, /** @type {AgentEvent[]} */ ([
    { type: "assistant.delta", runId: "r1", text: "more", at },
    { type: "tool.requested", runId: "r1", call: { callId: "c2", name: "read_file", label: "Read" }, at },
  ]));
  assert.equal(after.assistantText, "", "no text may arrive after a stop");
  assert.equal(after.tools.length, 1, "no new tool may start after a stop");
});

test("a duplicate tool.requested is ignored", () => {
  const s = reduceAll(initialRunState(), [started, requested, requested]);
  assert.equal(s.tools.length, 1);
});

/* 7. Context thresholds. */
test("context pressure crosses at the documented thresholds", () => {
  const withUsage = (used, reserve, effective) =>
    reduce(running(), ev({ type: "context.updated", runId: "r1", usage: { used, reserve, effective }, at }));
  assert.equal(contextPressure(withUsage(5000, 1000, 16000)), "ok");
  assert.equal(contextPressure(withUsage(11000, 1000, 16000)), "near");
  assert.equal(contextPressure(withUsage(13000, 1000, 16000)), "compact");
});

test("tool output accumulates and survives interruption", () => {
  const s = reduceAll(running(), /** @type {AgentEvent[]} */ ([
    { type: "tool.stdout", runId: "r1", callId: "c1", chunk: "line 1\n", at },
    { type: "tool.stdout", runId: "r1", callId: "c1", chunk: "line 2\n", at },
    { type: "run.stopped", runId: "r1", at },
  ]));
  assert.equal(s.tools[0].stdout, "line 1\nline 2\n");
  assert.equal(s.tools[0].state, "interrupted");
});
