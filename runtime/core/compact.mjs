// @ts-check
/**
 * Making a long session fit.
 *
 * A turn that reads twenty files and runs six commands accumulates a working
 * context larger than the model's window, and the window is a hard wall: the
 * request fails, or the server silently truncates from the front and the model
 * loses the task it was given while keeping the grep results.
 *
 * Compaction is the answer, and it is dangerous in a specific way. It rewrites
 * what the model believes happened. If it drops the acceptance criteria, the
 * agent finishes something else; if it drops "the test still fails", the agent
 * reports success. So this module is built around one rule: **the summary is a
 * schema, not a paragraph.** Each field is extracted from the event history by
 * code, not written by the model, because a model asked to summarise its own
 * session will produce something fluent and drop the part that contradicts it.
 *
 * Two stages, in order of preference:
 *
 *   1. Shed weight without losing meaning — replace old bulky tool results
 *      with a one-line reference. A 40KB file read becomes "read a.js (412
 *      lines)". Nothing is forgotten, the detail is just no longer re-sent.
 *
 *   2. Only if that is not enough, summarise the older exchanges into the
 *      structured record below and drop them.
 *
 * The full pre-compaction transcript goes to the store. Compaction changes what
 * the model sees; it must never change what happened.
 */

import { estimateTokens } from "./providers/types.mjs";

/** Fraction of the window at which compaction starts. */
export const COMPACT_AT = 0.75;

/** How much of the window the compacted context should aim to occupy. */
export const COMPACT_TARGET = 0.45;

/** Exchanges at the end that are never touched, however long they are. */
export const KEEP_RECENT = 6;

/**
 * Two compactions in a row that freed almost nothing means the live tail alone
 * no longer fits, and compacting again will not change that. Better to stop
 * with something the user can act on than to loop.
 */
export const THRASH_FLOOR = 0.1;

/**
 * The structured record that stands in for everything dropped.
 *
 * Every field here exists because losing it produces a specific wrong
 * behaviour, noted alongside. This is the schema the brief asks for; it is
 * enforced by construction rather than by asking a model to honour it.
 *
 * @typedef {object} SessionSummary
 * @property {string} objective        lose it and the agent finishes a different task
 * @property {string[]} constraints    explicit user decisions; lose them and they get re-litigated
 * @property {any[]} plan              current steps and their status
 * @property {string[]} filesRead
 * @property {string[]} filesChanged   lose it and the agent re-edits what it already edited
 * @property {string[]} locations      file:line anchors worth keeping
 * @property {Array<{command: string, exit: number|null, at: number}>} verifications
 *   lose these and a failed test becomes an unverified claim of success
 * @property {string[]} browserFindings
 * @property {string|null} browserOrigin
 * @property {string[]} checkpoints
 * @property {string[]} errors         failed approaches, so they are not retried
 * @property {string|null} pending     an unanswered question or permission request
 */

/**
 * Build the structured summary from the event history.
 *
 * From events, not from the message list, because the message list is the
 * thing being replaced and because events carry results the messages only
 * describe.
 *
 * @param {any[]} events
 * @param {{objective?: string, plan?: any[]}} [extra]
 * @returns {SessionSummary}
 */
export function summarise(events, extra = {}) {
  /** @type {SessionSummary} */
  const s = {
    objective: extra.objective ?? "",
    constraints: [],
    plan: extra.plan ?? [],
    filesRead: [],
    filesChanged: [],
    locations: [],
    verifications: [],
    browserFindings: [],
    browserOrigin: null,
    checkpoints: [],
    errors: [],
    pending: null,
  };

  /** @type {Map<string, any>} */
  const calls = new Map();
  let firstUser = null;

  for (const ev of events) {
    const p = ev.payload ?? {};
    switch (ev.type) {
      case "user_message_created":
        if (firstUser === null) firstUser = String(p.text ?? "");
        // Later user messages are answers and corrections: they are the
        // constraints the agent must not forget it was given.
        else if (p.text) s.constraints.push(String(p.text).slice(0, 300));
        break;

      case "plan_updated":
        if (Array.isArray(p.items)) s.plan = p.items;
        break;

      case "tool_call_requested":
        calls.set(p.tool_call_id, { tool: p.tool, args: p.args ?? {} });
        break;

      case "tool_completed": {
        const c = calls.get(p.tool_call_id);
        if (!c) break;
        if (c.tool === "read_file" && c.args.path) push(s.filesRead, c.args.path);
        if (c.tool === "apply_patch") {
          for (const e of c.args.edits ?? []) push(s.filesChanged, e.path);
        }
        if (c.tool === "run_command") {
          s.verifications.push({
            command: (c.args.argv ?? []).join(" "),
            exit: typeof p.result?.exit_code === "number" ? p.result.exit_code : null,
            at: ev.timestamp ?? 0,
          });
        }
        break;
      }

      case "tool_failed": {
        const c = calls.get(p.tool_call_id);
        const what = c ? c.tool : "a tool";
        push(s.errors, `${what}: ${String(p.error ?? "failed").slice(0, 160)}`);
        break;
      }

      case "file_changed":
        if (p.path) push(s.filesChanged, p.path);
        break;

      case "checkpoint_created":
        if (p.checkpoint_id) push(s.checkpoints, String(p.checkpoint_id));
        break;

      case "browser_navigated":
        if (p.url) { try { s.browserOrigin = new URL(p.url).origin; } catch { /* keep the last good one */ } }
        break;

      case "browser_finding":
        push(s.browserFindings, `${p.kind ?? "console"}: ${String(p.text ?? "").slice(0, 160)}`);
        break;

      case "question_requested":
        s.pending = "a question was asked and not yet answered";
        break;
      case "question_answered":
        s.pending = null;
        break;
      case "permission_required":
        s.pending = `awaiting approval for ${p.tool ?? "an action"}`;
        break;
      case "permission_resolved":
        s.pending = null;
        break;

      case "runtime_error":
        push(s.errors, String(p.message ?? "runtime error").slice(0, 160));
        break;

      default:
        break;
    }
  }

  if (!s.objective && firstUser) s.objective = firstUser.slice(0, 500);
  return s;
}

/** Push if absent, and keep the list bounded. */
function push(list, value, max = 40) {
  const v = String(value);
  if (!list.includes(v) && list.length < max) list.push(v);
}

/**
 * Render the summary as the text the prompt's summary layer carries.
 *
 * Deliberately terse and labelled. The model reads this instead of two hundred
 * messages, so every line has to be worth its tokens, and a heading it can
 * scan beats a paragraph it has to parse.
 *
 * @param {SessionSummary} s
 */
export function renderSummary(s) {
  const out = [];
  if (s.objective) out.push(`Objective: ${s.objective}`);
  if (s.constraints.length) out.push(`Decisions already made:\n${s.constraints.map((c) => `- ${c}`).join("\n")}`);
  if (s.plan.length) {
    out.push(`Plan:\n${s.plan.map((p, i) => `${i + 1}. [${p.status}] ${p.step}`).join("\n")}`);
  }
  if (s.filesChanged.length) out.push(`Files already changed: ${s.filesChanged.join(", ")}`);
  if (s.filesRead.length) out.push(`Files already read: ${s.filesRead.join(", ")}`);
  if (s.locations.length) out.push(`Relevant locations: ${s.locations.join(", ")}`);
  if (s.verifications.length) {
    const lines = s.verifications.map((v) =>
      `- ${v.command} -> ${v.exit === null ? "no exit code" : `exit ${v.exit}`}`);
    out.push(`Checks run:\n${lines.join("\n")}`);
  }
  if (s.browserOrigin) out.push(`Browser is on: ${s.browserOrigin}`);
  if (s.browserFindings.length) {
    out.push(`Browser findings:\n${s.browserFindings.map((f) => `- ${f}`).join("\n")}`);
  }
  if (s.checkpoints.length) out.push(`Checkpoints: ${s.checkpoints.join(", ")}`);
  if (s.errors.length) out.push(`Failed approaches, do not repeat:\n${s.errors.map((e) => `- ${e}`).join("\n")}`);
  if (s.pending) out.push(`Outstanding: ${s.pending}`);
  return out.join("\n\n");
}

/**
 * Stage one: replace bulky old tool results with a one-line reference.
 *
 * The reference is not a lie by omission — it names what was read and how big
 * it was, so the model knows the content exists and can read it again. What it
 * stops doing is re-sending forty kilobytes on every single turn.
 *
 * @param {any[]} messages
 * @param {number} keepRecent  exchanges at the end to leave alone
 */
export function shedToolResults(messages, keepRecent = KEEP_RECENT) {
  const cut = Math.max(0, messages.length - keepRecent);
  return messages.map((m, i) => {
    if (i >= cut) return m;
    if (m.role !== "tool" || typeof m.content !== "string") return m;
    if (m.content.length <= 600) return m;
    const lines = m.content.split("\n").length;
    return {
      ...m,
      content: `[earlier result, ${m.content.length} characters over ${lines} lines, dropped from context to make room. Call the tool again if you need it.]`,
    };
  });
}

/**
 * Decide whether to compact, and produce the compacted context.
 *
 * @param {object} input
 * @param {any[]} input.messages     the working context, system head excluded
 * @param {any[]} input.events       everything that has happened
 * @param {number|null} input.window the model's context length
 * @param {number} input.headTokens  what the system head costs
 * @param {number} [input.previousFreed] how much the last compaction freed, 0..1
 * @param {string} [input.objective]
 * @param {any[]} [input.plan]
 * @returns {{
 *   needed: boolean, thrashing?: boolean, reason?: string,
 *   messages?: any[], summary?: SessionSummary, summaryText?: string,
 *   before?: number, after?: number, dropped?: number, freed?: number,
 * }}
 */
export function compact({
  messages, events, window, headTokens = 0, previousFreed = 1,
  objective = "", plan = [],
}) {
  if (!window || window <= 0) return { needed: false };

  const cost = (list) => list.reduce((n, m) => n + estimateTokens(String(m.content ?? "")), 0);
  const before = headTokens + cost(messages);
  if (before < window * COMPACT_AT) return { needed: false };

  // Stage one.
  let next = shedToolResults(messages);
  let after = headTokens + cost(next);

  /* Stage two, only if stage one left it over target AND there is actually
     something to drop. A session can cross the threshold while holding fewer
     messages than KEEP_RECENT — a couple of very large ones — and in that
     case stage two drops nothing and adds a summary, which grew the context
     by 2.6% the first time this ran. A compaction that makes things worse is
     worse than no compaction. */
  let summary = null;
  let summaryText = "";
  let dropped = 0;
  if (after > window * COMPACT_TARGET && next.length > KEEP_RECENT) {
    summary = summarise(events, { objective, plan });
    summaryText = renderSummary(summary);
    const keep = next.slice(next.length - KEEP_RECENT);
    const candidate = headTokens + estimateTokens(summaryText) + cost(keep);
    if (candidate < after) {
      dropped = next.length - keep.length;
      next = keep;
      after = candidate;
    } else {
      // The summary costs more than the messages it would replace. Keep the
      // messages: they are the truth, and the summary is a lossy stand-in.
      summary = null;
      summaryText = "";
    }
  }


  const freed = before > 0 ? (before - after) / before : 0;

  /* Two outcomes to separate here, and the order matters.

     Thrashing is when this attempt freed almost nothing AND the last one
     also freed almost nothing. That means what remains is the irreducible
     tail: compacting again would drop the exchanges the model is actively
     using, so it stops with something the user can act on.

     A noop is a single attempt that could not help — usually a session
     holding a few very large messages, where there is no old bulk to shed
     and too few messages to summarise. Once is not a pattern, so it reports
     and lets the next attempt decide. */
  if (freed < THRASH_FLOOR && previousFreed < THRASH_FLOOR) {
    return {
      needed: true,
      thrashing: true,
      reason:
        "The context cannot be reduced further: the most recent exchanges alone "
        + "exceed the model's window. Start a new session, or load a model with a "
        + "longer context.",
      before, after, freed,
    };
  }

  if (after >= before) {
    return {
      needed: true, noop: true, before, after, freed: 0,
      reason: "Nothing left to reduce: no old bulk to shed and too few messages to summarise.",
    };
  }

  return { needed: true, messages: next, summary, summaryText, before, after, dropped, freed };
}
