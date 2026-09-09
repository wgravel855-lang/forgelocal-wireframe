// @ts-check
/**
 * The deterministic provider.
 *
 * Integration tests need a model that behaves the same way every run, so this
 * one is scripted: each turn is a list of events it will emit, in order. It is
 * not a mock of the orchestrator's expectations — it goes through the identical
 * code path a real adapter does, streaming the same normalized events, so a
 * test that passes here is exercising the real loop.
 *
 * It can also be told to misbehave, because the behaviours worth testing are
 * the bad ones: malformed JSON arguments, a call to a tool that does not exist,
 * the same call repeated forever, a turn that never finishes.
 */

import { ModelEvent, ProviderFailure, ProviderError, estimateTokens } from "./types.mjs";

/**
 * @typedef {object} ScriptedTurn
 * @property {string} [text]                    assistant text for this turn
 * @property {string} [reasoning]
 * @property {Array<{id?: string, name: string, args: any, raw?: string}>} [calls]
 * @property {string} [finish]                  defaults to tool_calls or final
 * @property {{kind: string, message: string}} [error]
 * @property {number} [delayMs]                 pause before emitting, for cancellation tests
 */

/**
 * @param {object} opts
 * @param {ScriptedTurn[]} opts.turns   consumed one per stream_turn call
 * @param {string} [opts.model]
 * @param {number} [opts.contextWindow]
 */
export function createFakeProvider({ turns, model = "fake-1", contextWindow = 8192 }) {
  let index = 0;
  /** every request the loop made, so a test can assert what the model saw */
  const seen = [];

  return {
    name: "fake",
    model,

    /** @returns {import("./types.mjs").ProviderCapabilities} */
    capabilities() {
      return {
        tools: true, parallelCalls: false, streaming: true,
        contextWindow, template: "scripted",
      };
    },

    countTokens(request) {
      return { input: estimateTokens(request.messages), estimated: true };
    },

    /** How many turns are left, so a test can assert the loop stopped early. */
    get remaining() { return Math.max(0, turns.length - index); },
    get requests() { return seen; },

    /**
     * @param {import("./types.mjs").TurnRequest} request
     * @param {{signal?: AbortSignal}} [opts]
     */
    async *streamTurn(request, opts = {}) {
      seen.push(request);
      const turn = turns[index++];
      if (!turn) {
        // Running past the end of the script is a test bug, and a silent
        // "final" here would hide it behind a passing assertion.
        throw new ProviderFailure(
          ProviderError.UNKNOWN,
          `fake provider ran out of scripted turns after ${index - 1}`,
        );
      }

      if (turn.delayMs) {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, turn.delayMs);
          if (opts.signal) {
            opts.signal.addEventListener("abort", () => {
              clearTimeout(t);
              reject(new ProviderFailure(ProviderError.CANCELLED, "cancelled"));
            }, { once: true });
          }
        });
      }
      if (opts.signal?.aborted) {
        yield { type: ModelEvent.FINISH, reason: "cancelled" };
        return;
      }

      if (turn.error) {
        yield { type: ModelEvent.ERROR, kind: turn.error.kind, message: turn.error.message };
        return;
      }

      if (turn.reasoning) {
        yield { type: ModelEvent.REASONING_DELTA, text: turn.reasoning };
      }

      if (turn.text) {
        // Split into a few deltas so the consumer really does reassemble a
        // stream rather than receiving one convenient string.
        for (const piece of chunk(turn.text, 3)) {
          if (opts.signal?.aborted) {
            yield { type: ModelEvent.FINISH, reason: "cancelled" };
            return;
          }
          yield { type: ModelEvent.TEXT_DELTA, text: piece };
        }
      }

      for (const [i, call] of (turn.calls ?? []).entries()) {
        const id = call.id ?? `call_${index}_${i}`;
        yield { type: ModelEvent.TOOL_CALL_START, id, name: call.name };
        // `raw` lets a test send arguments that are not valid JSON at all.
        const json = call.raw !== undefined ? call.raw : JSON.stringify(call.args ?? {});
        for (const piece of chunk(json, 2)) {
          yield { type: ModelEvent.TOOL_CALL_DELTA, id, text: piece };
        }
        yield { type: ModelEvent.TOOL_CALL_END, id };
      }

      yield {
        type: ModelEvent.USAGE,
        input: estimateTokens(request.messages),
        output: estimateTokens(turn.text ?? ""),
        contextWindow,
        estimated: true,
      };
      yield {
        type: ModelEvent.FINISH,
        reason: turn.finish ?? ((turn.calls ?? []).length ? "tool_calls" : "final"),
      };
    },
  };
}

/** @param {string} s @param {number} parts */
function chunk(s, parts) {
  if (!s) return [];
  const size = Math.max(1, Math.ceil(s.length / parts));
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}
