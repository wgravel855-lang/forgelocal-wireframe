// @ts-check
/**
 * Running the conformance suite against a real provider.
 *
 * Separate from capability.mjs so the cases and the grading can be tested
 * without a model server, and so this file can be pointed at LM Studio from a
 * script without dragging the orchestrator in with it.
 *
 * Nothing here executes a tool. The suite is about whether the model emits
 * well-formed, sensible calls — not about what happens when they run — so the
 * tools are stubbed and their "results" are fixed strings. That keeps the run
 * deterministic, fast, and incapable of touching the user's project.
 */

import { CASES, grade, profileFromProbe, browserModeFor, AgentGrade } from "./capability.mjs";
import { validateCall, toolSpecs, DEFAULT_GROUPS } from "./tools/index.mjs";
import { ModelEvent } from "./providers/types.mjs";

/** Fixed results the stubbed tools return, so every model sees the same run. */
const STUB_RESULTS = {
  list_directory: '{"entries":["app.js","sum.js"],"skipped":0}',
  glob: '{"matches":["src/sum.js"],"count":1}',
  grep: '{"matches":[{"path":"src/sum.js","line":1,"text":"export function sum(list) {"}],"count":1}',
  read_file: '{"path":"src/app.js","total_lines":12,"content":"const greeting = \'hi\';\\n"}',
  apply_patch: '{"files":1,"added":1,"removed":1}',
  run_command: '{"exit_code":1,"output":"1 failing"}',
  update_plan: '{"ok":true}',
  ask_user: '{"ok":true,"awaiting":true}',
};

/**
 * Collect one model turn: its text and its tool calls.
 *
 * The provider streams; this folds the stream into the shape the cases check.
 * @param {any} provider @param {any[]} messages @param {AbortSignal} [signal]
 */
async function oneTurn(provider, messages, signal) {
  let text = "";
  /** @type {Map<string, {id: string, name: string, raw: string}>} */
  const building = new Map();

  /* A call arrives as start / delta* / end, not as one event: the wire
     format delivers arguments as fragments and some backends send the id
     only on the first. The first version of this looked for a TOOL_CALL
     event that does not exist, matched nothing, and graded a model that
     calls tools correctly as chat-only. */
  for await (const ev of provider.streamTurn({ messages, tools: toolSpecs(DEFAULT_GROUPS) }, { signal })) {
    switch (ev.type) {
      case ModelEvent.TEXT_DELTA:
        text += ev.text ?? "";
        break;
      case ModelEvent.TOOL_CALL_START:
        building.set(ev.id, { id: ev.id, name: ev.name ?? "", raw: "" });
        break;
      case ModelEvent.TOOL_CALL_DELTA: {
        const c = building.get(ev.id);
        if (c) c.raw += ev.text ?? "";
        break;
      }
      default:
        break;
    }
  }

  const calls = [...building.values()].map((c) => {
    let args = {};
    try { args = c.raw ? JSON.parse(c.raw) : {}; }
    catch { args = { __unparsable: c.raw }; }
    return { id: c.id, name: c.name, args };
  });
  return { text, calls };
}

/**
 * Run the suite.
 *
 * @param {object} opts
 * @param {any} opts.provider
 * @param {string} opts.model
 * @param {string} opts.baseUrl
 * @param {any} [opts.capabilities]
 * @param {(line: string) => void} [opts.log]
 * @param {AbortSignal} [opts.signal]
 */
export async function runConformance({
  provider, model, baseUrl, capabilities = {}, log = () => {}, signal,
}) {
  const profile = profileFromProbe({ model, baseUrl, capabilities });
  /** @type {any[]} */
  const results = [];

  for (const kase of CASES) {
    const started = Date.now();
    /** @type {any} */
    let outcome = { ok: true };
    let detail = "";

    try {
      /** @type {any[]} */
      const messages = [
        {
          role: "system",
          content:
            "You are a coding agent in a test harness. The project contains "
            + "src/app.js and src/sum.js. Use the tools you are given. Do not "
            + "describe what a tool would return; call it.",
        },
        { role: "user", content: kase.prompt },
      ];

      const turnCount = kase.turns ?? 1;
      const ctx = { index: 0, sawPatch: false, validate: validateCall };

      for (let i = 0; i < turnCount; i++) {
        ctx.index = i;
        const turn = await oneTurn(provider, messages, signal);
        if (turn.calls.some((c) => c.name === "apply_patch")) ctx.sawPatch = true;

        const check = kase.expect(turn, ctx);
        if (!check.ok) { outcome = check; detail = check.why ?? ""; break; }
        if (check.soft) detail = check.soft;

        // Feed the turn back so the next one has somewhere to continue from.
        if (turn.calls.length) {
          messages.push({
            role: "assistant",
            content: turn.text || null,
            tool_calls: turn.calls.map((c) => ({
              id: c.id, type: "function",
              function: { name: c.name, arguments: JSON.stringify(c.args) },
            })),
          });
          for (const c of turn.calls) {
            const injected = kase.inject && kase.inject.afterTurn === i
              ? JSON.stringify({ error: kase.inject.error })
              : (STUB_RESULTS[c.name] ?? '{"ok":true}');
            messages.push({ role: "tool", tool_call_id: c.id, content: injected });
          }
        } else {
          messages.push({ role: "assistant", content: turn.text });
          // Nothing more will happen; later turns would test nothing.
          if (i + 1 < turnCount) break;
        }
      }
    } catch (/** @type {any} */ e) {
      outcome = { ok: false, why: `threw: ${e && e.message ? e.message : e}` };
      detail = outcome.why;
    }

    const row = {
      id: kase.id,
      what: kase.what,
      critical: kase.critical,
      ok: outcome.ok,
      detail: detail || (outcome.ok ? "" : outcome.why ?? ""),
      ms: Date.now() - started,
    };
    results.push(row);
    log(`${row.ok ? "pass" : "FAIL"}  ${row.id}${row.detail ? ` — ${row.detail}` : ""}`);
  }

  const verdict = grade(results);
  const graded = {
    ...profile,
    agentGrade: verdict.grade,
    score: verdict.score,
    failed: verdict.failed,
    testedAt: Date.now(),
  };
  return {
    profile: { ...graded, browserMode: browserModeFor(graded) },
    results,
    reason: verdict.reason,
    total: CASES.length,
  };
}

/**
 * Whether agent features may be offered for this profile.
 *
 * One place, so the answer cannot differ between the composer, the
 * orchestrator and the model picker.
 * @param {any} profile
 */
export function agentAllowed(profile) {
  return !!profile
    && profile.agentGrade !== AgentGrade.CHAT_ONLY
    && profile.agentGrade !== AgentGrade.UNTESTED;
}
