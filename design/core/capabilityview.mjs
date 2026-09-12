// @ts-check
/**
 * Saying what a model is, honestly.
 *
 * The whole point of the conformance suite is that a grade is earned, so the
 * interface must not imply one that was not. There are four things this can
 * say and they are genuinely different:
 *
 *   untested   nobody has checked. Not a failure, and not a pass.
 *   ready      passed every case.
 *   limited    passed everything that makes a loop safe, failed something else.
 *   chat_only  failed a case the loop depends on. Chat works; tools are off.
 *
 * "Untested" is the one this file exists to protect. It is the state a model
 * is in before anyone runs the suite, and the temptation is to render it as
 * something reassuring — a name, a parameter count, "supports tools" from the
 * server handshake. None of those is evidence and none of them appears here.
 */

import { escapeHtml as esc, truncate } from "./html.mjs";

export const AgentGrade = Object.freeze({
  READY: "ready",
  LIMITED: "limited",
  CHAT_ONLY: "chat_only",
  UNTESTED: "untested",
});

/**
 * What each grade means, in the words the interface uses.
 *
 * `tone` maps to the existing status colours. Untested is deliberately
 * neutral rather than a warning: not having run a test is not a problem with
 * the model, and colouring it amber would push people into running a suite
 * they may not need.
 */
export const GRADE_COPY = Object.freeze({
  [AgentGrade.READY]: {
    label: "Agent ready",
    tone: "ok",
    detail: "Passed every case in the suite. All tools are available.",
  },
  [AgentGrade.LIMITED]: {
    label: "Works, with limits",
    tone: "warn",
    detail:
      "Passed everything an agent loop depends on, and failed something else. "
      + "Tools are available; expect to watch it more closely.",
  },
  [AgentGrade.CHAT_ONLY]: {
    label: "Chat only",
    tone: "bad",
    detail:
      "Failed a case the agent loop depends on, so tools are turned off for "
      + "this model. Conversation still works.",
  },
  [AgentGrade.UNTESTED]: {
    label: "Not tested",
    tone: "mut",
    detail:
      "Nothing has checked what this model can do. Tools are available and "
      + "nothing is claimed about how well it uses them.",
  },
});

/** @param {any} profile */
export function gradeOf(profile) {
  const g = profile && typeof profile.agentGrade === "string" ? profile.agentGrade : null;
  return GRADE_COPY[g] ? g : AgentGrade.UNTESTED;
}

/**
 * Whether agent features may be offered.
 *
 * The same rule as the runtime's agentAllowed, and deliberately the same
 * shape, so the interface and the loop cannot disagree about whether a model
 * may drive tools.
 * @param {any} profile
 */
export function agentAllowed(profile) {
  const g = gradeOf(profile);
  return g !== AgentGrade.CHAT_ONLY && g !== AgentGrade.UNTESTED;
}

/** @param {number|null|undefined} at */
function when(at) {
  if (!at) return "";
  const d = new Date(at);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * The settings block.
 *
 * @param {object} input
 * @param {any} input.profile     the stored verdict, or null
 * @param {string|null} input.model
 * @param {boolean} input.connected
 * @param {{done: number, total: number, line: string}|null} [input.running]
 * @returns {string}
 */
export function capabilityBlock({ profile, model, connected, running = null }) {
  if (!connected || !model) {
    return `<p class="set-empty">Connect a model to see what it can do. Nothing is claimed about a model that is not loaded.</p>`;
  }

  if (running) {
    /* Progress by case, not a spinner. Ten prompts is long enough that a
       person wants to know it is moving, and watching a named case go past is
       more informative than a percentage. */
    return `<div class="capbox">
  <p class="cap-h"><span class="cap-pill" data-tone="mut">Testing</span>
    <span class="m">${esc(truncate(model, 44))}</span></p>
  <p class="set-d">Case ${running.done} of ${running.total}. Nothing it does touches your project.</p>
  <p class="set-d m">${esc(truncate(running.line, 90))}</p>
  <button class="btn btns" type="button" data-cap-cancel>Stop the test</button>
</div>`;
  }

  const grade = gradeOf(profile);
  const copy = GRADE_COPY[grade];
  const tested = profile && profile.testedAt ? when(profile.testedAt) : "";
  const score = profile && typeof profile.score === "number"
    ? `${profile.score} of ${profile.score + (profile.failed?.length ?? 0)} cases`
    : "";

  const failed = profile && Array.isArray(profile.failed) && profile.failed.length
    ? `<p class="set-d">Failed: ${profile.failed.map((f) => `<code>${esc(f)}</code>`).join(", ")}.</p>`
    : "";

  const facts = [];
  if (profile && profile.contextWindow) {
    facts.push(`${Number(profile.contextWindow).toLocaleString()} token context`);
  }
  if (profile && profile.toolCalling) facts.push(`${profile.toolCalling} tool calling`);
  if (profile && profile.browserMode) facts.push(`browser: ${profile.browserMode}`);

  return `<div class="capbox">
  <p class="cap-h"><span class="cap-pill" data-tone="${copy.tone}">${esc(copy.label)}</span>
    <span class="m">${esc(truncate(model, 44))}</span></p>
  <p class="set-d">${esc(copy.detail)}</p>
  ${failed}
  ${facts.length ? `<p class="set-d m">${esc(facts.join(" · "))}</p>` : ""}
  ${tested ? `<p class="set-d">Tested ${esc(tested)}${score ? `, ${esc(score)}` : ""}.</p>` : ""}
  <button class="btn btns" type="button" data-cap-test>${
    grade === AgentGrade.UNTESTED ? "Test this model" : "Test again"}</button>
  <p class="set-d">Sends about ten short prompts and grades the answers. It reads nothing,
    writes nothing and runs nothing: the tools are stubbed and their results are fixed.</p>
</div>`;
}
