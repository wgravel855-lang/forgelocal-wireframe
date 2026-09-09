// @ts-check
/**
 * The provider contract.
 *
 * A provider turns a request into a stream of normalized events. It knows how
 * to talk to one backend and nothing else: it does not decide what a tool is
 * allowed to do, it does not execute anything, and it does not know the
 * orchestrator exists. That separation is what lets the same loop run against a
 * scripted fake in a test and a real model on the user's GPU.
 *
 * Every provider yields only the shapes below. If a backend emits something
 * else, normalizing it is the adapter's job, not the orchestrator's.
 */

export const ModelEvent = Object.freeze({
  /** a chunk of user-visible assistant text */
  TEXT_DELTA: "text_delta",
  /** a user-facing summary of reasoning. Never raw chain-of-thought. */
  REASONING_DELTA: "reasoning_delta",
  /** a tool call has begun; carries id and name */
  TOOL_CALL_START: "tool_call_start",
  /** a chunk of the tool call's JSON arguments */
  TOOL_CALL_DELTA: "tool_call_delta",
  /** the tool call's arguments are complete */
  TOOL_CALL_END: "tool_call_end",
  /** token accounting, when the backend reports it */
  USAGE: "usage",
  /** why the turn ended: "final" | "tool_calls" | "length" | "cancelled" */
  FINISH: "finish",
  /** the backend failed. Carries a classified reason. */
  ERROR: "error",
});

/** Error classes, so a caller can tell a bad key from a dead socket. */
export const ProviderError = Object.freeze({
  UNREACHABLE: "unreachable",     // nothing is listening
  UNAUTHORIZED: "unauthorized",   // credentials rejected
  MODEL_MISSING: "model_missing", // the named model is not loaded
  BAD_RESPONSE: "bad_response",   // the stream was malformed
  CONTEXT: "context",             // request exceeded the window
  CANCELLED: "cancelled",
  UNKNOWN: "unknown",
});

export class ProviderFailure extends Error {
  /** @param {string} kind @param {string} message @param {any} [detail] */
  constructor(kind, message, detail) {
    super(message);
    this.name = "ProviderFailure";
    this.kind = kind;
    this.detail = detail;
  }
}

/**
 * @typedef {object} ProviderCapabilities
 * @property {boolean} tools           the model accepts a tool schema
 * @property {boolean} parallelCalls   more than one tool call per turn
 * @property {boolean} streaming
 * @property {number|null} contextWindow
 * @property {string} template         the chat template in use, when known
 */

/**
 * @typedef {object} TurnRequest
 * @property {any[]} messages   provider-neutral messages
 * @property {any[]} tools      JSON Schema tool specs
 * @property {number} [maxTokens]
 * @property {number} [temperature]
 */

/**
 * A rough token estimate for backends that do not offer a tokenizer.
 *
 * It is deliberately named as an estimate everywhere it surfaces: 3.6 chars per
 * token is a reasonable average for code and prose in a BPE vocabulary, and
 * wrong enough on any individual message that presenting it as a measurement
 * would be a lie. The real number replaces it as soon as a backend reports
 * usage.
 *
 * @param {any} value
 * @returns {number}
 */
export function estimateTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.ceil(text.length / 3.6);
}
