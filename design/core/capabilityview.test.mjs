// @ts-check
/**
 * Tests for how the interface talks about a model.
 *
 * All of these guard the same line: a grade is earned by running the suite,
 * and the interface must never imply one that was not. The negative cases
 * matter more than the positive one, because the failure mode is a reassuring
 * label on a model nobody has checked.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capabilityBlock, agentAllowed, gradeOf, AgentGrade, GRADE_COPY,
} from "./capabilityview.mjs";
import { emptyProfile } from "../../runtime/core/capability.mjs";
import { agentAllowed as runtimeAllowed } from "../../runtime/core/conformance.mjs";

const graded = (over) => emptyProfile({
  model: "m", baseUrl: "http://a/v1", testedAt: Date.parse("2026-06-01"), ...over,
});

test("the interface and the runtime agree on who may use tools", () => {
  /* Two implementations of the same rule, in two trees that cannot import
     each other. If they diverge, the interface offers a feature the loop
     refuses, or hides one it would have allowed. */
  const cases = [
    null,
    emptyProfile(),
    graded({ agentGrade: AgentGrade.CHAT_ONLY }),
    graded({ agentGrade: AgentGrade.LIMITED }),
    graded({ agentGrade: AgentGrade.READY }),
  ];
  for (const p of cases) {
    assert.equal(agentAllowed(p), runtimeAllowed(p),
      `disagreed about ${p ? p.agentGrade : "null"}`);
  }
});

test("no profile at all is untested, never ready", () => {
  for (const p of [null, undefined, {}, { agentGrade: "excellent" }, { agentGrade: 7 }]) {
    assert.equal(gradeOf(p), AgentGrade.UNTESTED, JSON.stringify(p));
    assert.equal(agentAllowed(p), false);
  }
});

test("an untested model is described as unchecked, not as a problem", () => {
  const html = capabilityBlock({
    profile: emptyProfile({ model: "qwen-30b" }), model: "qwen-30b", connected: true,
  });
  assert.match(html, /Not tested/);
  assert.match(html, /Nothing has checked/);
  // Neutral, not a warning: not having run a test is not a fault in the model.
  assert.match(html, /data-tone="mut"/);
  assert.ok(!/data-tone="bad"/.test(html));
  // And the way out is offered.
  assert.match(html, /data-cap-test/);
  assert.match(html, /Test this model/);
});

test("a disconnected runtime claims nothing about any model", () => {
  for (const input of [
    { profile: graded({ agentGrade: AgentGrade.READY }), model: "m", connected: false },
    { profile: graded({ agentGrade: AgentGrade.READY }), model: null, connected: true },
  ]) {
    const html = capabilityBlock(input);
    assert.ok(!/Agent ready/.test(html), "a grade was shown with no model loaded");
    assert.match(html, /Connect a model/);
  }
});

test("a chat-only model says tools are off and that chat still works", () => {
  const html = capabilityBlock({
    profile: graded({ agentGrade: AgentGrade.CHAT_ONLY, score: 6, failed: ["no_fabrication"] }),
    model: "liar-1", connected: true,
  });
  assert.match(html, /Chat only/);
  assert.match(html, /tools are turned off/i);
  assert.match(html, /Conversation still works/);
  // The case it failed is named, because "chat only" alone is not actionable.
  assert.match(html, /no_fabrication/);
  assert.match(html, /data-tone="bad"/);
});

test("a limited model is offered tools, with the limit stated", () => {
  const html = capabilityBlock({
    profile: graded({ agentGrade: AgentGrade.LIMITED, score: 8, failed: ["error_recovery", "clarification"] }),
    model: "m", connected: true,
  });
  assert.match(html, /Works, with limits/);
  assert.match(html, /error_recovery/);
  assert.match(html, /clarification/);
  assert.match(html, /data-tone="warn"/);
});

test("a run in flight shows which case it is on and offers a stop", () => {
  const html = capabilityBlock({
    profile: null, model: "m", connected: true,
    running: { done: 4, total: 10, line: "pass  multi_turn" },
  });
  assert.match(html, /Case 4 of 10/);
  assert.match(html, /multi_turn/);
  assert.match(html, /data-cap-cancel/);
  // And no grade while there isn't one.
  assert.ok(!/Agent ready|Chat only|Not tested/.test(html));
});

test("what the test does is stated before it is offered", () => {
  /* Ten prompts against a model nobody trusts is exactly the kind of button a
     person should be told about before pressing. */
  // Whitespace-normalised: where the sentence wraps in the source is not
  // something a test should be able to break.
  const html = capabilityBlock({ profile: null, model: "m", connected: true })
    .replace(/\s+/g, " ");
  assert.match(html, /reads nothing, writes nothing and runs nothing/i);
  assert.match(html, /stubbed/);
});

test("a model's name is not evidence, and nothing renders it as any", () => {
  /* The temptation this file exists to refuse: a name containing "coder" or a
     parameter count producing a better label than an untested 3B. */
  const a = capabilityBlock({
    profile: emptyProfile({ model: "qwen3-coder-70b-instruct" }),
    model: "qwen3-coder-70b-instruct", connected: true,
  });
  const b = capabilityBlock({
    profile: emptyProfile({ model: "tiny-1b" }), model: "tiny-1b", connected: true,
  });
  const grade = (h) => h.match(/data-tone="(\w+)"/)[1];
  assert.equal(grade(a), grade(b), "two untested models were graded differently by name");
});

test("every grade has copy, and every copy has a tone the stylesheet knows", () => {
  const tones = new Set(["ok", "warn", "bad", "mut"]);
  for (const [id, copy] of Object.entries(GRADE_COPY)) {
    assert.ok(copy.label, `${id} has no label`);
    assert.ok(copy.detail.length > 30, `${id} does not explain itself`);
    assert.ok(tones.has(copy.tone), `${id} has an unknown tone: ${copy.tone}`);
  }
});

test("a page's model name cannot become markup", () => {
  const html = capabilityBlock({
    profile: emptyProfile({ model: "x" }),
    model: '<img src=x onerror=alert(1)>', connected: true,
  });
  assert.ok(!html.includes("<img src=x"));
  assert.match(html, /&lt;img/);
});
