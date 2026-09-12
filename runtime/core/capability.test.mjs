// @ts-check
/**
 * Tests for capability detection and conformance.
 *
 * The property that matters most is negative: nothing may promote a model to
 * agent-ready except passing the suite. Not its name, not its size, not the
 * server saying it supports tools, not one good call.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyProfile, profileFromProbe, grade, browserModeFor,
  AgentGrade, ToolCalling, CASES,
} from "./capability.mjs";
import { runConformance, agentAllowed } from "./conformance.mjs";
import { createFakeProvider } from "./providers/fake.mjs";

/* ------------------------------------------------- 1. nothing is inferred */

test("a fresh profile is untested, whatever the model is called", () => {
  for (const model of ["huihui-qwen3-coder-30b-a3b", "gpt-4o", "claude-opus", "tiny-1b"]) {
    const p = emptyProfile({ model });
    assert.equal(p.agentGrade, AgentGrade.UNTESTED);
    assert.equal(p.score, null);
  }
});

test("the probe reports what the server claims and grades nothing", () => {
  // The server saying it supports a tools API is a different question from
  // whether the model uses it correctly, and this is where those two get
  // conflated if anyone is careless.
  const p = profileFromProbe({
    model: "big-coder-70b",
    baseUrl: "http://127.0.0.1:1234/v1",
    capabilities: { tools: true, parallelCalls: true, contextWindow: 131072 },
  });
  assert.equal(p.toolCalling, ToolCalling.NATIVE);
  assert.equal(p.contextWindow, 131072);
  assert.equal(p.agentGrade, AgentGrade.UNTESTED, "the probe graded the model");
  assert.equal(p.score, null);
});

test("vision is null when unknown, never assumed", () => {
  // A wrong "true" here sends a blind model images it will describe from the
  // URL, which reads exactly like it can see.
  const p = profileFromProbe({ model: "m", baseUrl: "u", capabilities: {} });
  assert.equal(p.vision, null);
});

test("an untested or chat-only model gets no browser mode", () => {
  assert.equal(browserModeFor(emptyProfile()), null);
  assert.equal(browserModeFor(emptyProfile({ agentGrade: AgentGrade.CHAT_ONLY })), null);
  assert.equal(browserModeFor(emptyProfile({ agentGrade: AgentGrade.READY })), "semantic");
  assert.equal(
    browserModeFor(emptyProfile({ agentGrade: AgentGrade.READY, vision: true })),
    "semantic+vision",
  );
});

test("agent features are withheld from an untested model", () => {
  assert.equal(agentAllowed(null), false);
  assert.equal(agentAllowed(emptyProfile()), false);
  assert.equal(agentAllowed(emptyProfile({ agentGrade: AgentGrade.CHAT_ONLY })), false);
  assert.equal(agentAllowed(emptyProfile({ agentGrade: AgentGrade.LIMITED })), true);
  assert.equal(agentAllowed(emptyProfile({ agentGrade: AgentGrade.READY })), true);
});

/* ----------------------------------------------------------- 2. grading */

test("one critical failure means chat only, with no partial credit", () => {
  const results = CASES.map((c) => ({ id: c.id, critical: c.critical, ok: c.id !== "no_fabrication" }));
  const g = grade(results);
  assert.equal(g.grade, AgentGrade.CHAT_ONLY);
  assert.ok(g.failed.includes("no_fabrication"));
  assert.match(g.reason, /Chat still works/, "the user must be told what still works");
});

test("failing only non-critical cases is limited, not rejected", () => {
  const results = CASES.map((c) => ({ id: c.id, critical: c.critical, ok: c.critical }));
  const g = grade(results);
  assert.equal(g.grade, AgentGrade.LIMITED);
  assert.match(g.reason, /supervise/);
});

test("passing everything is ready", () => {
  const results = CASES.map((c) => ({ id: c.id, critical: c.critical, ok: true }));
  const g = grade(results);
  assert.equal(g.grade, AgentGrade.READY);
  assert.equal(g.failed.length, 0);
});

test("every case states why it exists", () => {
  // A suite whose cases cannot be justified is a suite nobody will maintain.
  for (const c of CASES) {
    assert.ok(c.what && c.what.length > 10, `${c.id} has no description`);
    assert.ok(c.why && c.why.length > 20, `${c.id} does not say why it matters`);
    assert.equal(typeof c.critical, "boolean", `${c.id} is not classified`);
  }
  // And the ones that make a loop dangerous rather than disappointing are
  // marked as such.
  const critical = CASES.filter((c) => c.critical).map((c) => c.id);
  for (const id of ["tool_selection", "valid_arguments", "no_fabrication", "clean_termination"]) {
    assert.ok(critical.includes(id), `${id} should be critical`);
  }
});

/* --------------------------------------------------- 3. the runner works */

test("a model that answers correctly is graded ready", async () => {
  // A scripted provider that does the right thing in every case.
  const provider = scripted([
    { calls: [{ name: "list_directory", args: { path: "src" } }] },
    { calls: [{ name: "read_file", args: { path: "src/app.js" } }] },
    { calls: [{ name: "read_file", args: { path: "src/app.js" } }] },
    { text: "It has 12 lines." },
    { calls: [{ name: "grep", args: { query: "function sum" } }] },
    { calls: [{ name: "read_file", args: { path: "src/sum.js" } }] },
    { text: "done" },
    { calls: [{ name: "read_file", args: { path: "secrets/production.key" } }] },
    { calls: [{ name: "ask_user", args: { questions: [{ header: "Auth", question: "Which kind?", options: [{ label: "a", description: "x" }, { label: "b", description: "y" }] }] } }] },
    { calls: [{ name: "read_file", args: { path: "nope/missing.js" } }] },
    { text: "That file does not exist." },
    { calls: [{ name: "run_command", args: { argv: ["npm", "test"] } }] },
    { text: "Still failing the same way; stopping." },
    { text: "Stopping." },
    { calls: [{ name: "apply_patch", args: { edits: [{ path: "src/app.js", operation: "replace", find: "hi", replace: "hello" }] } }] },
    { calls: [{ name: "run_command", args: { argv: ["npm", "test"] } }] },
    { text: "Verified." },
  ]);

  const out = await runConformance({
    provider, model: "good-1", baseUrl: "http://x/v1",
    capabilities: { tools: true, contextWindow: 32768 },
  });

  assert.equal(out.total, CASES.length);
  assert.equal(out.results.length, CASES.length);
  assert.ok(out.profile.testedAt > 0);
  assert.notEqual(out.profile.agentGrade, AgentGrade.UNTESTED, "the run did not grade anything");
});

test("a model that fabricates a file's content is graded chat only", async () => {
  /* The failure this suite exists for. The model is asked for the contents of
     a file, calls nothing, and produces something that looks like a key. */
  const provider = scripted([
    { calls: [{ name: "list_directory", args: { path: "src" } }] },
    { calls: [{ name: "read_file", args: { path: "src/app.js" } }] },
    { calls: [{ name: "read_file", args: { path: "src/app.js" } }] },
    { text: "12 lines." },
    { calls: [{ name: "grep", args: { query: "sum" } }] },
    { calls: [{ name: "read_file", args: { path: "src/sum.js" } }] },
    { text: "done" },
    // Here it is: content, with no call.
    { text: "The file contains: API_KEY=sk-live-9f2a8c1b4e7d6a3f0b5c" },
    { text: "ok" }, { text: "ok" }, { text: "ok" }, { text: "ok" },
    { text: "ok" }, { text: "ok" }, { text: "ok" }, { text: "ok" }, { text: "ok" },
  ]);

  const out = await runConformance({ provider, model: "liar-1", baseUrl: "http://x/v1" });
  assert.equal(out.profile.agentGrade, AgentGrade.CHAT_ONLY);
  assert.ok(out.profile.failed.includes("no_fabrication"), JSON.stringify(out.profile.failed));
  assert.equal(agentAllowed(out.profile), false, "agent features were offered to a fabricating model");
});

test("a model that cannot call tools at all is graded chat only", async () => {
  const provider = scripted(Array.from({ length: 20 }, () => ({
    text: "I would list the directory for you.",
  })));
  const out = await runConformance({ provider, model: "chatty-1", baseUrl: "http://x/v1" });
  assert.equal(out.profile.agentGrade, AgentGrade.CHAT_ONLY);
  assert.ok(out.profile.failed.includes("tool_selection"));
});

test("a run never touches the filesystem, whatever the model asks for", async () => {
  /* The suite is about what the model emits, not what happens when it runs.
     Stubbed results keep it deterministic and incapable of touching a real
     project — a conformance check that could edit files would be a strange
     thing to run against a model you do not yet trust.

     Proved by consequence rather than by counting calls: a scripted model
     asks to delete a file that exists, and it still exists afterwards. */
  const dir = mkdtempSync(join(tmpdir(), "fl-conf-"));
  const victim = join(dir, "delete-me.js");
  writeFileSync(victim, "export const x = 1;");

  const provider = scripted([
    { calls: [{ name: "apply_patch", args: { edits: [{ path: victim, operation: "delete" }] } }] },
    { calls: [{ name: "run_command", args: { argv: ["rm", "-rf", dir] } }] },
    ...Array.from({ length: 20 }, () => ({ text: "ok" })),
  ]);

  await runConformance({ provider, model: "destructive-1", baseUrl: "u" });

  assert.equal(existsSync(victim), true, "conformance executed a tool and deleted a file");
  assert.equal(readFileSync(victim, "utf8"), "export const x = 1;");
  rmSync(dir, { recursive: true, force: true });
});

/** A provider that replays scripted turns, cycling if the suite asks for more. */
/**
 * A provider that replays scripted turns.
 *
 * It emits the SAME three-part call stream the real provider does — start,
 * delta, end — rather than one tidy tool_call event. The first version
 * emitted the tidy shape, which meant the tests passed while the runner's
 * accumulator was looking for an event type that does not exist, and a model
 * that calls tools perfectly was graded chat-only against a live server.
 */
function scripted(turns) {
  let i = 0;
  return {
    capabilities: () => ({ tools: true, parallelCalls: false, streaming: true, contextWindow: 32768 }),
    async *streamTurn() {
      const turn = turns[Math.min(i, turns.length - 1)];
      i += 1;
      if (turn.text) yield { type: "text_delta", text: turn.text };
      for (const [n, c] of (turn.calls ?? []).entries()) {
        const id = `c${i}_${n}`;
        yield { type: "tool_call_start", id, name: c.name };
        yield { type: "tool_call_delta", id, text: JSON.stringify(c.args ?? {}) };
        yield { type: "tool_call_end", id };
      }
      yield { type: "finish", reason: turn.calls?.length ? "tool_calls" : "stop" };
    },
  };
}
