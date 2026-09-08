// @ts-check
/**
 * Context as a managed budget rather than an error you wait for.
 *
 * The rule is that compaction changes what is SENT to the model, never what the
 * user can scroll back and read. The full transcript is persisted outside the
 * prompt; this module only decides what the next prompt contains.
 */

/** @typedef {'system'|'rules'|'tools'|'messages'|'files'|'output'|'attachments'} Bucket */

/**
 * @typedef {object} Budget
 * @property {number} effective    effective loaded context, not the advertised max
 * @property {number} reserve      tokens held back for the response
 * @property {Record<Bucket, number>} used
 * @property {boolean} estimated   true when no real tokenizer was available
 */

export const SOFT = 0.72;      // meter gets more visible; no interruption
export const COMPACT = 0.82;   // the next round would cross this, so act first

/** @param {Budget} b */
export const totalUsed = (b) =>
  /** @type {Bucket[]} */(Object.keys(b.used)).reduce((n, k) => n + b.used[k], 0);

/** @param {Budget} b Tokens available for new input. */
export const available = (b) => Math.max(0, b.effective - b.reserve - totalUsed(b));

/** @param {Budget} b */
export const ratio = (b) => (b.effective ? (totalUsed(b) + b.reserve) / b.effective : 0);

/** @param {Budget} b @returns {'ok'|'near'|'compact'|'over'} */
export function pressure(b) {
  const r = ratio(b);
  if (r >= 1) return "over";
  if (r >= COMPACT) return "compact";
  if (r >= SOFT) return "near";
  return "ok";
}

/**
 * @typedef {object} CompactionPlan
 * @property {'none'|'prune-output'|'summarize'|'hard-stop'} action
 * @property {string} reason
 * @property {number} [freed]        tokens the step would recover
 * @property {Bucket} [bucket]
 */

/**
 * The automatic sequence, in order. Old raw tool output goes first because it is
 * the largest thing with the least conversational value; a structured summary is
 * the second resort; refusing to loop is the third.
 *
 * @param {Budget} b
 * @param {number} nextRoundTokens   projected size of the next model round
 * @returns {CompactionPlan}
 */
export function planCompaction(b, nextRoundTokens = 0) {
  const projected = (totalUsed(b) + b.reserve + nextRoundTokens) / (b.effective || 1);
  if (projected < COMPACT) return { action: "none", reason: "Within budget" };

  if (b.used.output > 0) {
    return {
      action: "prune-output",
      bucket: "output",
      freed: b.used.output,
      reason: "Old command output is dropped from the prompt first. The full output is still stored and readable.",
    };
  }

  const summarisable = b.used.messages + b.used.files;
  if (summarisable > 0) {
    return {
      action: "summarize",
      freed: Math.floor(summarisable * 0.7),
      reason: "Earlier turns are replaced with a structured summary.",
    };
  }

  // Nothing left to give: never loop, never silently forget.
  return {
    action: "hard-stop",
    reason: "One attachment or output is too large to fit on its own.",
  };
}

/**
 * What a compaction summary must carry forward. Losing any of these is what
 * makes a compacted session feel like it forgot the task.
 * @type {readonly string[]}
 */
export const SUMMARY_FIELDS = Object.freeze([
  "goal",              // user goal and acceptance criteria
  "plan",              // current plan and unfinished work
  "decisions",         // architectural and product decisions
  "filesRead",
  "filesChanged",
  "commands",          // commands run and their actual results
  "errors",            // failures and unresolved blockers
  "checkpoints",       // checkpoint ids and git state
  "pending",           // pending permissions or queued user messages
  "nextAction",        // the exact next step
  "nuance",            // recent conversational nuance
]);

/**
 * @param {Partial<Record<string, unknown>>} summary
 * @returns {{ok: boolean, missing: string[]}}
 */
export function validateSummary(summary) {
  const missing = SUMMARY_FIELDS.filter((f) => summary[f] === undefined || summary[f] === "");
  return { ok: missing.length === 0, missing };
}

/**
 * The choice panel shown when compaction cannot help. The user's unsent draft is
 * preserved by the caller; these are the only honest ways forward.
 * @param {Budget} b
 */
export const hardStopChoices = (b) => [
  { id: "handoff", label: "Start a new session with a handoff summary" },
  { id: "bigger-model", label: "Load a model with a larger context" },
  { id: "drop", label: "Remove the largest attachment from context" },
];

/**
 * @param {Budget} b
 * @returns {{bucket: Bucket, tokens: number}[]} largest first, for the popover
 */
export const largestBuckets = (b) =>
  /** @type {Bucket[]} */(Object.keys(b.used))
    .map((k) => ({ bucket: k, tokens: b.used[k] }))
    .filter((x) => x.tokens > 0)
    .sort((a, z) => z.tokens - a.tokens);
