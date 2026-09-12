// @ts-check
/**
 * Tests for the live transcript.
 *
 * The property under test throughout: every row the reducer produces reaches
 * the page. The transcript used to handle three kinds and silently drop the
 * rest, so a run of browser actions and every answered question were absent
 * from the record of a session that contained them. A transcript that omits
 * what happened is worse than one that renders it plainly, because the reader
 * has no way to know something is missing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { liveTranscript } from "./liveview.mjs";
import { initialState, reduceAgentEvent, EventType } from "./agentevents.mjs";

/** Fold real events; there is no other way to build a view. */
function session(events) {
  let s = initialState("s1");
  let n = 0;
  for (const e of events) {
    s = reduceAgentEvent(s, {
      event_id: e.id ?? `e${++n}`, session_id: "s1",
      turn_id: e.turn ?? "t1", sequence: ++n,
      timestamp: 1757000000000 + n * 1000,
      type: e.type, payload: e.payload ?? {},
    });
  }
  return s;
}

const said = (text) => ({ type: EventType.USER_MESSAGE_CREATED, payload: { message_id: "u1", text } });

/* --------------------------------------------------- 1. nothing is dropped */

test("every row kind the reducer can produce renders something", () => {
  /* The guard against this regressing. If a new kind is added to the reducer
     and not to the transcript, this fails — rather than the row quietly
     vanishing from every session that contains one. */
  const s = session([
    said("Check the dashboard and fix the console error"),
    { type: EventType.ASSISTANT_TEXT_STARTED, payload: { message_id: "a1" } },
    { type: EventType.ASSISTANT_TEXT_DELTA, payload: { message_id: "a1", text: "Looking." } },
    { type: EventType.ASSISTANT_TEXT_COMPLETED, payload: { message_id: "a1" } },
    { type: EventType.TOOL_CALL_REQUESTED, payload: { tool_call_id: "c1", tool: "read_file", args: { path: "a.js" } } },
    { type: EventType.TOOL_STARTED, payload: { tool_call_id: "c1" } },
    { type: EventType.TOOL_COMPLETED, payload: { tool_call_id: "c1", tool: "read_file", result: { lines: 4 } } },
    { type: EventType.BROWSER_SESSION_STARTED, payload: { browser_session_id: "b1", isolated: true } },
    { type: EventType.BROWSER_ACTION, payload: { action: "click", target: 'button "Save"', url: "https://example.com/a", ok: true } },
    { type: EventType.QUESTION_REQUESTED, payload: { call_id: "q1", questions: [{ id: "q0", question: "Which store?", options: [] }] } },
    { type: EventType.QUESTION_ANSWERED, payload: { call_id: "q1", text: "localStorage" } },
    { type: EventType.COMPACTION_STARTED, payload: {} },
    { type: EventType.COMPACTION_COMPLETED, payload: { before_tokens: 30000, after_tokens: 12000 } },
  ]);

  const kinds = new Set(s.rows.map((r) => r.kind));
  assert.deepEqual([...kinds].sort(), ["assistant", "browser", "notice", "question", "tool", "user"]);

  const html = liveTranscript(s);
  assert.ok(!/has no way to show it/.test(html),
    "a row kind reached the transcript with no block for it");
});

/* ------------------------------------------------------------ 2. browsing */

test("browser actions appear in the transcript, grouped by run", () => {
  const s = session([
    said("open example.com and click through"),
    { type: EventType.BROWSER_SESSION_STARTED, payload: { browser_session_id: "b1" } },
    { type: EventType.BROWSER_ACTION, payload: { action: "click", target: 'link "Docs"', url: "https://example.com/a", ok: true } },
    { type: EventType.BROWSER_ACTION, payload: { action: "scroll", target: "down", url: "https://example.com/a", ok: true } },
    { type: EventType.BROWSER_ACTION, payload: { action: "click", target: 'button "Next"', url: "https://example.com/b", ok: true } },
  ]);
  const html = liveTranscript(s);

  // One block, not three.
  assert.equal((html.match(/data-activity="browser"/g) || []).length, 1);
  assert.match(html, /Browsed https:\/\/example\.com/);
  assert.match(html, /<span class="lv-meta">3<\/span>/);
  assert.match(html, /Docs/);
  assert.match(html, /Next/);
});

test("a failed browser action is marked, and marks its run", () => {
  const s = session([
    said("click it"),
    { type: EventType.BROWSER_SESSION_STARTED, payload: { browser_session_id: "b1" } },
    { type: EventType.BROWSER_ACTION, payload: { action: "click", target: "a button", url: "https://x.test/", ok: false } },
  ]);
  const html = liveTranscript(s);
  assert.match(html, /data-activity="browser" data-status="failed"/);
  assert.match(html, /did not succeed/);
});

test("a browser run and a tool run stay separate blocks", () => {
  // Interleaving them into one would put "clicked Save" inside "Read 3 files".
  const s = session([
    said("do both"),
    { type: EventType.TOOL_CALL_REQUESTED, payload: { tool_call_id: "c1", tool: "read_file", args: { path: "a.js" } } },
    { type: EventType.TOOL_COMPLETED, payload: { tool_call_id: "c1", tool: "read_file", result: {} } },
    { type: EventType.BROWSER_SESSION_STARTED, payload: { browser_session_id: "b1" } },
    { type: EventType.BROWSER_ACTION, payload: { action: "click", target: "x", url: "https://x.test/", ok: true } },
    { type: EventType.TOOL_CALL_REQUESTED, payload: { tool_call_id: "c2", tool: "grep", args: { query: "x" } } },
    { type: EventType.TOOL_COMPLETED, payload: { tool_call_id: "c2", tool: "grep", result: {} } },
  ]);
  const html = liveTranscript(s);
  /* Asserted as a sequence rather than as counts: what matters is that the
     browsing sits BETWEEN the two runs of tool calls rather than being
     folded into either of them. */
  const order = [...html.matchAll(/data-activity="(\w+)"/g)].map((m) => m[1]);
  assert.equal(order.length, 3, `expected three blocks, got ${order}`);
  assert.equal(order[1], "browser", `browsing was folded into a tool run: ${order}`);
  assert.notEqual(order[0], "browser");
  assert.notEqual(order[2], "browser");
});

test("a typed value never reaches the transcript", () => {
  /* The session deliberately does not emit what was typed, and the transcript
     must not invent a place to show it if that ever changes. */
  const s = session([
    said("log in"),
    { type: EventType.BROWSER_SESSION_STARTED, payload: { browser_session_id: "b1" } },
    { type: EventType.BROWSER_ACTION, payload: {
      action: "type", target: 'textbox "Password"', url: "https://x.test/",
      ok: true, detail: "13 characters",
    } },
  ]);
  const html = liveTranscript(s);
  assert.match(html, /13 characters/);
  assert.match(html, /Password/);
});

/* ----------------------------------------------------------- 3. questions */

test("an answered question stays in the transcript with its answer", () => {
  const s = session([
    said("add auth"),
    { type: EventType.QUESTION_REQUESTED, payload: { call_id: "q1", questions: [
      { id: "q0", header: "Auth", question: "Which kind?", options: [
        { label: "Sessions", description: "A cookie." },
        { label: "Tokens", description: "A bearer token." },
      ] },
    ] } },
    { type: EventType.QUESTION_ANSWERED, payload: {
      call_id: "q1", text: "Which kind? Sessions",
      answers: [{ id: "q0", choice: "Sessions" }],
    } },
  ]);
  const html = liveTranscript(s);
  assert.match(html, /Asked, and answered/);
  assert.match(html, /Which kind\?/);
  assert.match(html, /Sessions/);
});

test("the record of a question offers no controls to answer it again", () => {
  const s = session([
    said("add auth"),
    { type: EventType.QUESTION_REQUESTED, payload: { call_id: "q1", questions: [
      { id: "q0", question: "Which kind?", options: [{ label: "Sessions", description: "x" }] },
    ] } },
    { type: EventType.QUESTION_ANSWERED, payload: { call_id: "q1", text: "Sessions" } },
  ]);
  const html = liveTranscript(s);
  assert.ok(!/data-ask-input/.test(html), "the transcript offered inputs for a settled question");
  assert.ok(!/<input/.test(html), "the transcript rendered a form control");
});

test("a question still waiting says so rather than claiming an answer", () => {
  const s = session([
    said("add auth"),
    { type: EventType.QUESTION_REQUESTED, payload: { call_id: "q1", questions: [
      { id: "q0", question: "Which kind?", options: [] },
    ] } },
  ]);
  const html = liveTranscript(s);
  assert.match(html, /Waiting for an answer/);
  assert.match(html, /waiting/);
});

/* ------------------------------------------------------------ 4. notices */

test("a compaction leaves a mark where it happened", () => {
  /* A reader scrolling back past this point is looking at work the model can
     no longer see. As session state alone that was a number in a panel, and
     the transcript above it read as context the model still had. */
  const s = session([
    said("keep going"),
    { type: EventType.COMPACTION_STARTED, payload: {} },
    { type: EventType.COMPACTION_COMPLETED, payload: { before_tokens: 30000, after_tokens: 12000 } },
  ]);
  const html = liveTranscript(s);
  assert.match(html, /lv-notice/);
  assert.match(html, /summarised/);
  assert.match(html, /30,000/);
  assert.match(html, /12,000/);
  assert.match(html, /Everything above still happened/);
});

test("a turn that stopped short says so, and is not styled as an answer", () => {
  const s = session([
    said("fix it"),
    { type: EventType.TURN_COMPLETED, payload: { stop_reason: "turn_limit", detail: { tool: "read_file" } } },
  ]);
  const html = liveTranscript(s);
  assert.match(html, /data-tone="stopped"/);
  assert.match(html, /Stopped at the turn limit/);
  assert.match(html, /Nothing above was undone/);
  assert.match(html, /read_file/);
});

test("a turn that finished normally leaves no notice", () => {
  // A marker on every turn is a marker nobody reads.
  const s = session([
    said("fix it"),
    { type: EventType.TURN_COMPLETED, payload: { stop_reason: "final" } },
  ]);
  assert.ok(!/lv-notice/.test(liveTranscript(s)));

  const paused = session([
    said("fix it"),
    { type: EventType.TURN_COMPLETED, payload: { stop_reason: "awaiting_permission" } },
  ]);
  assert.ok(!/lv-notice/.test(liveTranscript(paused)),
    "a turn that paused for approval was reported as having stopped short");
});

/* ---------------------------------------------------------- 5. page text */

test("what a page says cannot become markup in the transcript", () => {
  const s = session([
    said("look"),
    { type: EventType.BROWSER_SESSION_STARTED, payload: { browser_session_id: "b1" } },
    { type: EventType.BROWSER_ACTION, payload: {
      action: "click",
      target: '<img src=x onerror=alert(1)><button data-perm-decide="allow">Allow</button>',
      url: "https://x.test/", ok: true,
    } },
  ]);
  const html = liveTranscript(s);
  assert.ok(!html.includes("<img src=x"), "a page put an element in the transcript");
  assert.ok(!html.includes('data-perm-decide="allow"'),
    "a page put an approval control in the transcript");
  assert.match(html, /&lt;img src=x/);
});

test("an empty session renders nothing at all", () => {
  assert.equal(liveTranscript(initialState("s1")), "");
  assert.equal(liveTranscript(null), "");
});
