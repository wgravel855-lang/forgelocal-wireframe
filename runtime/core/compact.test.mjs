// @ts-check
/**
 * Tests for compaction.
 *
 * Compaction rewrites what the model believes happened, so the tests are
 * mostly about what it must never drop. A compaction that loses the acceptance
 * criteria makes the agent finish a different task; one that loses a failing
 * exit code turns a failure into an unverified claim of success. Those two are
 * the ones to hold down hardest.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarise, renderSummary, shedToolResults, compact,
  COMPACT_AT, KEEP_RECENT,
} from "./compact.mjs";

let n = 0;
const ev = (type, payload) => ({
  event_id: `e${++n}`, session_id: "s", turn_id: "t1",
  sequence: n, timestamp: 1757000000000 + n, type, payload,
});

/** A session that read, edited, ran a passing and a failing check, and asked. */
function history() {
  n = 0;
  return [
    ev("user_message_created", { message_id: "u1", text: "Fix the averaging bug. Keep the public API unchanged." }),
    ev("plan_updated", { items: [{ step: "Find the divisor", status: "done" }, { step: "Fix it", status: "active" }] }),
    ev("tool_call_requested", { tool_call_id: "c1", tool: "read_file", args: { path: "src/stats.js" } }),
    ev("tool_completed", { tool_call_id: "c1", result: { lines: 7 } }),
    ev("tool_call_requested", { tool_call_id: "c2", tool: "apply_patch", args: { edits: [{ operation: "update", path: "src/stats.js" }] } }),
    ev("tool_completed", { tool_call_id: "c2", result: { files: 1, added: 1, removed: 1 } }),
    ev("checkpoint_created", { checkpoint_id: "ck_1" }),
    ev("tool_call_requested", { tool_call_id: "c3", tool: "run_command", args: { argv: ["node", "--test"] } }),
    ev("tool_completed", { tool_call_id: "c3", result: { exit_code: 1 } }),
    ev("tool_call_requested", { tool_call_id: "c4", tool: "run_command", args: { argv: ["npx", "tsc", "--noEmit"] } }),
    ev("tool_failed", { tool_call_id: "c4", error: "Command exited with code 2" }),
    ev("user_message_created", { message_id: "u2", text: "Use Number.parseFloat, not parseFloat." }),
    ev("browser_navigated", { url: "http://localhost:3000/tasks?x=1" }),
    ev("browser_finding", { kind: "console", text: "TypeError: t is undefined" }),
  ];
}

/* ------------------------------------------------ what must never be lost */

test("the objective survives compaction", () => {
  const s = summarise(history());
  assert.match(s.objective, /Fix the averaging bug/);
  assert.match(renderSummary(s), /Objective: Fix the averaging bug/);
});

test("later user messages are kept as decisions, not merged into the objective", () => {
  // "Use Number.parseFloat" is a constraint the agent was given mid-run. Lose
  // it and it gets re-litigated, or silently violated.
  const s = summarise(history());
  assert.ok(s.constraints.some((c) => c.includes("Number.parseFloat")), JSON.stringify(s.constraints));
  assert.ok(!s.objective.includes("Number.parseFloat"));
});

test("a failing exit code survives as a failure", () => {
  // The one that matters most. If this is lost, the next turn's model has no
  // evidence the test failed and will report the task done.
  const s = summarise(history());
  const failed = s.verifications.find((v) => v.command === "node --test");
  assert.ok(failed, "the check disappeared");
  assert.equal(failed.exit, 1, "a failing check must not be summarised as a check");
  assert.match(renderSummary(s), /node --test -> exit 1/);
});

test("a failed tool is recorded so it is not retried blindly", () => {
  const s = summarise(history());
  assert.ok(s.errors.some((e) => e.includes("exited with code 2")), JSON.stringify(s.errors));
  assert.match(renderSummary(s), /Failed approaches, do not repeat/);
});

test("files read and files changed stay separate", () => {
  const s = summarise(history());
  assert.deepEqual(s.filesChanged, ["src/stats.js"]);
  assert.deepEqual(s.filesRead, ["src/stats.js"]);
  // Both, because "already changed" stops a duplicate edit and "already read"
  // stops a duplicate read, and they are different mistakes.
  const text = renderSummary(s);
  assert.match(text, /Files already changed: src\/stats\.js/);
  assert.match(text, /Files already read: src\/stats\.js/);
});

test("the plan, checkpoints and browser state survive", () => {
  const s = summarise(history());
  assert.equal(s.plan.length, 2);
  assert.deepEqual(s.checkpoints, ["ck_1"]);
  assert.equal(s.browserOrigin, "http://localhost:3000", "the origin, not the full URL with its query");
  assert.ok(s.browserFindings.some((f) => f.includes("TypeError")));
});

test("an unanswered question is carried as outstanding", () => {
  const withQuestion = [...history(), ev("question_requested", { call_id: "c9", questions: [] })];
  assert.match(String(summarise(withQuestion).pending), /question/);

  const answered = [...withQuestion, ev("question_answered", { call_id: "c9", text: "yes" })];
  assert.equal(summarise(answered).pending, null);
});

test("a pending permission request is carried as outstanding", () => {
  const waiting = [...history(), ev("permission_required", { request_id: "p1", tool: "run_command" })];
  assert.match(String(summarise(waiting).pending), /awaiting approval for run_command/);
});

/* ----------------------------------------------------------- stage one */

test("old bulky tool results become a reference, recent ones are untouched", () => {
  const messages = [];
  for (let i = 0; i < 12; i++) {
    messages.push({ role: "assistant", content: `step ${i}` });
    messages.push({ role: "tool", content: "x".repeat(5000) });
  }
  const out = shedToolResults(messages, KEEP_RECENT);

  const old = out[1];
  assert.match(String(old.content), /earlier result, 5000 characters/);
  assert.match(String(old.content), /Call the tool again if you need it/,
    "the model must know the content still exists");

  // The tail is left exactly as it was.
  const tail = out.slice(-KEEP_RECENT);
  for (const m of tail) {
    if (m.role === "tool") assert.equal(String(m.content).length, 5000);
  }
});

test("a short tool result is never replaced", () => {
  const messages = Array.from({ length: 20 }, () => ({ role: "tool", content: "exit 0" }));
  const out = shedToolResults(messages, 2);
  assert.ok(out.every((m) => m.content === "exit 0"));
});

/* ------------------------------------------------------------- decision */

test("a context under the threshold is left alone", () => {
  const r = compact({
    messages: [{ role: "user", content: "hi" }],
    events: history(), window: 8000, headTokens: 100,
  });
  assert.equal(r.needed, false);
  assert.equal(r.messages, undefined, "nothing should have been rebuilt");
});

test("compaction only starts above the threshold", () => {
  const window = 4000;
  // Just under: roughly 4 chars per token, so aim below 0.75 * 4000 tokens.
  const small = [{ role: "user", content: "x".repeat(Math.floor(window * COMPACT_AT * 4 * 0.5)) }];
  assert.equal(compact({ messages: small, events: [], window, headTokens: 0 }).needed, false);

  const big = [{ role: "user", content: "x".repeat(window * 4) }];
  assert.equal(compact({ messages: big, events: [], window, headTokens: 0 }).needed, true);
});

test("compaction frees room and reports how much", () => {
  const messages = [];
  for (let i = 0; i < 40; i++) {
    messages.push({ role: "assistant", content: `step ${i}` });
    messages.push({ role: "tool", content: "y".repeat(4000) });
  }
  const r = compact({ messages, events: history(), window: 8000, headTokens: 200 });

  assert.equal(r.needed, true);
  assert.equal(r.thrashing, undefined);
  assert.ok(r.messages, "compact reported a rewrite but returned no messages");
  const { after = 0, before = 0, freed = 0, dropped = 0, messages: kept = [] } = r;
  assert.ok(after < before, `after ${after} was not less than before ${before}`);
  assert.ok(freed > 0.5, `only freed ${freed}`);
  assert.ok(dropped > 0, "nothing was dropped despite being over target");
  assert.ok(kept.length <= KEEP_RECENT);
  // And the summary that replaces them still carries the failure.
  assert.match(String(r.summaryText), /node --test -> exit 1/);
});

test("two compactions that free nothing stop instead of looping", () => {
  // The tail alone is over the window: nothing can be dropped without losing
  // what the model is currently working on. Compacting again would not help,
  // so it must say so rather than spin.
  const messages = Array.from({ length: 3 }, () => ({ role: "user", content: "z".repeat(60000) }));
  const r = compact({
    messages, events: history(), window: 4000, headTokens: 0, previousFreed: 0.01,
  });
  assert.equal(r.needed, true);
  assert.equal(r.thrashing, true);
  assert.match(String(r.reason), /cannot be reduced further/);
  assert.match(String(r.reason), /longer context/, "the message must say what to do about it");
});

/* This is the one that caught a real bug. A session can cross the threshold
   while holding fewer messages than KEEP_RECENT — a couple of very large
   ones — and the first version added a summary while dropping nothing, which
   grew the context by 2.6%. A compaction that makes things worse is worse
   than no compaction. */
test("compaction never returns a context larger than it was given", () => {
  const cases = [
    { name: "two huge messages", messages: [
      { role: "user", content: "a".repeat(20000) },
      { role: "assistant", content: "b".repeat(20000) },
    ] },
    { name: "one huge message", messages: [{ role: "user", content: "c".repeat(40000) }] },
    { name: "many small messages", messages: Array.from({ length: 200 },
      (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `line ${i}` })) },
  ];

  for (const c of cases) {
    const r = compact({ messages: c.messages, events: history(), window: 4000, headTokens: 50 });
    if (!r.needed) continue;
    const { after = 0, before = 0 } = r;
    assert.ok(after <= before,
      `${c.name}: compaction grew the context from ${before} to ${after}`);
    if (r.noop) assert.equal(r.messages, undefined, `${c.name}: a noop must not rewrite anything`);
  }
});

test("a first compaction that frees little is not treated as thrashing", () => {
  // previousFreed defaults to 1: one poor result is not a pattern, and
  // stopping on the first would break sessions that are merely near the edge.
  const messages = Array.from({ length: 3 }, () => ({ role: "user", content: "z".repeat(60000) }));
  const r = compact({ messages, events: history(), window: 4000, headTokens: 0 });
  assert.equal(r.thrashing, undefined);
});

test("the summary never invents a verification that did not run", () => {
  const s = summarise([
    ev("user_message_created", { message_id: "u1", text: "Fix it" }),
    ev("tool_call_requested", { tool_call_id: "c1", tool: "apply_patch", args: { edits: [{ operation: "update", path: "a.js" }] } }),
    ev("tool_completed", { tool_call_id: "c1", result: { files: 1 } }),
  ]);
  assert.deepEqual(s.verifications, [], "an edit is not a check");
  assert.ok(!renderSummary(s).includes("Checks run"));
});
