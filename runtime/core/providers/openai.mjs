// @ts-check
/**
 * OpenAI-compatible chat-completions adapter.
 *
 * This one endpoint is spoken by llama.cpp's `llama-server --jinja`, LM Studio,
 * and Ollama's compatibility layer, which means one adapter reaches all three
 * without pretending they are identical: capabilities are probed, not assumed,
 * and anything the backend does not report is returned as unknown rather than
 * guessed.
 *
 * Streaming tool calls are the fiddly part. The wire format delivers a call's
 * arguments as fragments across many chunks, keyed by an index rather than by
 * id, and some backends send the id only on the first fragment. So fragments
 * are accumulated per index and the id is remembered from whichever chunk
 * carried it.
 */

import { ModelEvent, ProviderFailure, ProviderError, estimateTokens } from "./types.mjs";

const DEFAULT_BASE = "http://127.0.0.1:1234/v1";

/**
 * @param {object} opts
 * @param {string} [opts.baseUrl]      e.g. http://127.0.0.1:8080/v1
 * @param {string} opts.model
 * @param {string} [opts.apiKey]       never logged, never persisted here
 * @param {number} [opts.contextWindow]
 * @param {typeof fetch} [opts.fetch]  injectable for tests
 */
export function createOpenAIProvider({
  baseUrl = DEFAULT_BASE, model, apiKey, contextWindow = null, fetch: f = fetch,
}) {
  const url = baseUrl.replace(/\/+$/, "");
  /** @type {import("./types.mjs").ProviderCapabilities|null} */
  let probed = null;

  const headers = () => {
    const h = { "content-type": "application/json" };
    // The key goes on the request and nowhere else: not into events, not into
    // the transcript, not into an error message.
    if (apiKey) h.authorization = `Bearer ${apiKey}`;
    return h;
  };

  return {
    name: "openai-compatible",
    model,
    baseUrl: url,

    /**
     * Ask the server what it has. A model that is not listed is reported as
     * missing rather than discovered halfway through a turn.
     */
    async probe() {
      let res;
      try {
        res = await f(`${url}/models`, { headers: headers() });
      } catch (e) {
        throw new ProviderFailure(
          ProviderError.UNREACHABLE,
          `No inference server is listening at ${url}. Start one, then try again.`,
          String(e && e.message),
        );
      }
      if (res.status === 401 || res.status === 403) {
        throw new ProviderFailure(ProviderError.UNAUTHORIZED, "The inference server rejected the credentials.");
      }
      if (!res.ok) {
        throw new ProviderFailure(ProviderError.BAD_RESPONSE, `The server answered ${res.status} for /models.`);
      }
      const body = await res.json();
      const ids = (body.data ?? []).map((m) => m.id);
      if (model && !ids.includes(model)) {
        throw new ProviderFailure(
          ProviderError.MODEL_MISSING,
          `The server is running but "${model}" is not loaded. Loaded: ${ids.join(", ") || "nothing"}.`,
          { available: ids },
        );
      }
      probed = {
        tools: true,            // proven per model by the conformance check
        parallelCalls: false,   // stays off until a model passes conformance
        streaming: true,
        contextWindow,
        template: "server-native",
      };
      return { models: ids, capabilities: probed };
    },

    capabilities() {
      return probed ?? {
        tools: true, parallelCalls: false, streaming: true,
        contextWindow, template: "unknown",
      };
    },

    countTokens(request) {
      // No tokenizer over this API, so this is an estimate and says so. Real
      // usage from the server replaces it at the end of every turn.
      return { input: estimateTokens(request.messages), estimated: true };
    },

    /**
     * @param {import("./types.mjs").TurnRequest} request
     * @param {{signal?: AbortSignal}} [opts]
     */
    async *streamTurn(request, opts = {}) {
      const body = {
        model,
        messages: request.messages,
        stream: true,
        temperature: request.temperature ?? 0.2,
      };
      if (request.tools && request.tools.length) {
        body.tools = request.tools;
        body.tool_choice = "auto";
        // Parallel calls stay off until this exact model passes conformance.
        body.parallel_tool_calls = false;
      }
      if (request.maxTokens) body.max_tokens = request.maxTokens;

      let res;
      try {
        res = await f(`${url}/chat/completions`, {
          method: "POST", headers: headers(),
          body: JSON.stringify(body), signal: opts.signal,
        });
      } catch (e) {
        if (opts.signal?.aborted) {
          yield { type: ModelEvent.FINISH, reason: "cancelled" };
          return;
        }
        throw new ProviderFailure(ProviderError.UNREACHABLE,
          `Could not reach the inference server at ${url}.`, String(e && e.message));
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const kind = res.status === 401 || res.status === 403 ? ProviderError.UNAUTHORIZED
          : /context|too long|exceed/i.test(text) ? ProviderError.CONTEXT
          : ProviderError.BAD_RESPONSE;
        yield { type: ModelEvent.ERROR, kind, message: `The server answered ${res.status}. ${text.slice(0, 300)}` };
        return;
      }
      if (!res.body) {
        yield { type: ModelEvent.ERROR, kind: ProviderError.BAD_RESPONSE, message: "The server returned no stream." };
        return;
      }

      /** index -> {id, name, started} */
      const calls = new Map();
      let finish = null;
      let usage = null;
      let sawText = false;

      try {
        for await (const data of sse(res.body, opts.signal)) {
          if (data === "[DONE]") break;
          let json;
          try { json = JSON.parse(data); } catch { continue; } // keep-alives and blank frames
          if (json.usage) usage = json.usage;

          const choice = (json.choices ?? [])[0];
          if (!choice) continue;
          const delta = choice.delta ?? {};

          // Some servers expose a separate reasoning channel. It is surfaced as
          // a summary stream, and never merged into the answer text.
          const reasoning = delta.reasoning_content ?? delta.reasoning;
          if (typeof reasoning === "string" && reasoning) {
            yield { type: ModelEvent.REASONING_DELTA, text: reasoning };
          }
          if (typeof delta.content === "string" && delta.content) {
            sawText = true;
            yield { type: ModelEvent.TEXT_DELTA, text: delta.content };
          }

          for (const tc of delta.tool_calls ?? []) {
            const key = tc.index ?? 0;
            let entry = calls.get(key);
            if (!entry) {
              entry = { id: tc.id ?? `call_${key}`, name: "", started: false, pending: "" };
              calls.set(key, entry);
            }
            // The id and name can arrive on a later fragment than the first.
            if (tc.id) entry.id = tc.id;

            const incoming = tc.function?.name;
            if (typeof incoming === "string" && incoming) {
              // Two server behaviours share this field. Most send the complete
              // name once; some repeat it on every chunk of the same call. A
              // few stream it in pieces. Appending unconditionally turns the
              // second case into "list_directorylist_directory", which is what
              // this adapter did until the model kept being told its tool did
              // not exist. Repeats are ignored; genuine fragments still append.
              if (entry.name !== incoming) entry.name += incoming;
            }

            const frag = tc.function?.arguments;
            if (typeof frag === "string" && frag) {
              // Start is emitted with the first argument fragment, by which
              // point the name is complete.
              if (!entry.started && entry.name) {
                entry.started = true;
                yield { type: ModelEvent.TOOL_CALL_START, id: entry.id, name: entry.name };
              }
              if (entry.started) yield { type: ModelEvent.TOOL_CALL_DELTA, id: entry.id, text: frag };
              else entry.pending += frag; // arguments before a name; replayed below
            }
          }

          if (choice.finish_reason) finish = choice.finish_reason;
        }
      } catch (e) {
        if (opts.signal?.aborted) {
          yield { type: ModelEvent.FINISH, reason: "cancelled" };
          return;
        }
        yield { type: ModelEvent.ERROR, kind: ProviderError.BAD_RESPONSE, message: `The stream ended badly: ${e && e.message}` };
        return;
      }

      // A call whose arguments were empty never got a start event above, and a
      // call is still a call with no arguments.
      for (const entry of calls.values()) {
        if (!entry.started && entry.name) {
          entry.started = true;
          yield { type: ModelEvent.TOOL_CALL_START, id: entry.id, name: entry.name };
          if (entry.pending) yield { type: ModelEvent.TOOL_CALL_DELTA, id: entry.id, text: entry.pending };
        }
        if (entry.started) yield { type: ModelEvent.TOOL_CALL_END, id: entry.id };
      }

      if (usage) {
        yield {
          type: ModelEvent.USAGE,
          input: usage.prompt_tokens ?? null,
          output: usage.completion_tokens ?? null,
          contextWindow,
          estimated: false,
        };
      }

      // A stream that carried no text, no tool call and no finish reason did
      // not produce a turn. Reporting that as "final" is how a server-side
      // failure became a silent empty answer: the loop saw a model with nothing
      // to say and stopped, and the run looked successful. It is an error.
      if (!calls.size && !sawText && !finish) {
        yield {
          type: ModelEvent.ERROR,
          kind: ProviderError.BAD_RESPONSE,
          message: "The model returned an empty response: no text, no tool call and no finish reason. "
            + "The inference server usually logs the reason.",
        };
        return;
      }

      // Normalize the finish reason. A server that emits tool calls but reports
      // "stop" still ended its turn to call a tool, and treating that as a final
      // answer would strand the loop.
      const reason = calls.size ? "tool_calls"
        : finish === "length" ? "length"
        : "final";
      yield { type: ModelEvent.FINISH, reason };
    },
  };
}

/**
 * Server-sent events over a fetch body. Frames are separated by a blank line
 * and a frame's payload may span several `data:` lines.
 * @param {ReadableStream<Uint8Array>} body
 * @param {AbortSignal} [signal]
 */
async function* sse(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const payload = frame.split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("");
        if (payload) yield payload;
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
}
