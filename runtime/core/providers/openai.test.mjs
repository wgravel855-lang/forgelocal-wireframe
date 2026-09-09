// @ts-check
/**
 * Adapter tests.
 *
 * Every case here is a shape a real server actually produced. Two of them are
 * regressions from the first golden-task runs, where the adapter was wrong and
 * the model got the blame: a repeated function name that became
 * "list_directorylist_directory", and an empty stream that was reported as a
 * final answer so a server-side failure looked like a successful silent turn.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenAIProvider } from "./openai.mjs";
import { ModelEvent, ProviderError } from "./types.mjs";
import { toolSpecs } from "../tools/index.mjs";

/** Build a fetch that replays SSE frames. */
function streamOf(frames, { status = 200 } = {}) {
  return async (url, init) => {
    if (String(url).endsWith("/models")) {
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "m" }] }) };
    }
    if (status !== 200) {
      return { ok: false, status, text: async () => "boom" };
    }
    const body = new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const f of frames) c.enqueue(enc.encode(`data: ${typeof f === "string" ? f : JSON.stringify(f)}\n\n`));
        c.close();
      },
    });
    return { ok: true, status: 200, body, lastInit: init };
  };
}

const chunk = (delta, finish) => ({
  choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }],
});

const collect = async (provider, req = { messages: [], tools: [] }) => {
  const out = [];
  for await (const e of provider.streamTurn(req)) out.push(e);
  return out;
};

test("text deltas are passed through and the turn finishes final", async () => {
  const p = createOpenAIProvider({
    model: "m",
    fetch: streamOf([chunk({ content: "Hel" }), chunk({ content: "lo" }), chunk({}, "stop"), "[DONE]"]),
  });
  const events = await collect(p);
  assert.deepEqual(
    events.filter((e) => e.type === ModelEvent.TEXT_DELTA).map((e) => e.text),
    ["Hel", "lo"],
  );
  assert.equal(events.at(-1).type, ModelEvent.FINISH);
  assert.equal(events.at(-1).reason, "final");
});

test("a function name repeated on every chunk is not concatenated", async () => {
  // This is exactly what the local server sends, and appending produced
  // "list_directorylist_directory", which the model was then told did not exist.
  const p = createOpenAIProvider({
    model: "m",
    fetch: streamOf([
      chunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "list_directory", arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "list_directory", arguments: "{\"path\"" } }] }),
      chunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "list_directory", arguments: ":\".\"}" } }] }),
      chunk({}, "tool_calls"),
      "[DONE]",
    ]),
  });
  const events = await collect(p);
  const start = events.find((e) => e.type === ModelEvent.TOOL_CALL_START);
  assert.equal(start.name, "list_directory");
  const args = events.filter((e) => e.type === ModelEvent.TOOL_CALL_DELTA).map((e) => e.text).join("");
  assert.deepEqual(JSON.parse(args), { path: "." });
});

test("a name genuinely streamed in fragments is reassembled", async () => {
  const p = createOpenAIProvider({
    model: "m",
    fetch: streamOf([
      chunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "read_" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { name: "file" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: "{}" } }] }),
      chunk({}, "tool_calls"),
      "[DONE]",
    ]),
  });
  const events = await collect(p);
  assert.equal(events.find((e) => e.type === ModelEvent.TOOL_CALL_START).name, "read_file");
});

test("a call with no arguments still starts and ends", async () => {
  const p = createOpenAIProvider({
    model: "m",
    fetch: streamOf([
      chunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "glob" } }] }),
      chunk({}, "tool_calls"),
      "[DONE]",
    ]),
  });
  const events = await collect(p);
  assert.ok(events.some((e) => e.type === ModelEvent.TOOL_CALL_START && e.name === "glob"));
  assert.ok(events.some((e) => e.type === ModelEvent.TOOL_CALL_END));
});

test("an empty stream is an error, not a final answer", async () => {
  // The server answered 200 and then sent nothing, because the tool grammar had
  // failed to build. Reporting "final" here made a broken run look like a model
  // that simply had nothing to say.
  const p = createOpenAIProvider({ model: "m", fetch: streamOf(["[DONE]"]) });
  const events = await collect(p);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, ModelEvent.ERROR);
  assert.equal(events[0].kind, ProviderError.BAD_RESPONSE);
  assert.match(events[0].message, /empty response/);
});

test("tool calls win over a 'stop' finish reason", async () => {
  const p = createOpenAIProvider({
    model: "m",
    fetch: streamOf([
      chunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "grep", arguments: "{}" } }] }),
      chunk({}, "stop"),
      "[DONE]",
    ]),
  });
  const events = await collect(p);
  assert.equal(events.at(-1).reason, "tool_calls");
});

test("reasoning is a separate channel and never becomes answer text", async () => {
  const p = createOpenAIProvider({
    model: "m",
    fetch: streamOf([
      chunk({ reasoning_content: "thinking about it" }),
      chunk({ content: "Answer." }),
      chunk({}, "stop"),
      "[DONE]",
    ]),
  });
  const events = await collect(p);
  assert.ok(events.some((e) => e.type === ModelEvent.REASONING_DELTA));
  assert.deepEqual(
    events.filter((e) => e.type === ModelEvent.TEXT_DELTA).map((e) => e.text),
    ["Answer."],
  );
});

test("usage is reported as measured when the server sends it", async () => {
  const p = createOpenAIProvider({
    model: "m", contextWindow: 4096,
    fetch: streamOf([
      chunk({ content: "hi" }),
      { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 4 } },
      "[DONE]",
    ]),
  });
  const usage = (await collect(p)).find((e) => e.type === ModelEvent.USAGE);
  assert.equal(usage.input, 120);
  assert.equal(usage.estimated, false, "a server-reported count is not an estimate");
});

test("an http error is classified rather than thrown as noise", async () => {
  const p = createOpenAIProvider({ model: "m", fetch: streamOf([], { status: 401 }) });
  const events = await collect(p);
  assert.equal(events[0].type, ModelEvent.ERROR);
  assert.equal(events[0].kind, ProviderError.UNAUTHORIZED);
});

test("probe names the model that is missing instead of failing mid-turn", async () => {
  const p = createOpenAIProvider({
    model: "not-loaded",
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: "other" }] }) }),
  });
  await assert.rejects(() => p.probe(), (e) => {
    assert.equal(e.kind, ProviderError.MODEL_MISSING);
    assert.match(e.message, /not loaded/);
    assert.deepEqual(e.detail.available, ["other"]);
    return true;
  });
});

test("an unreachable server says so plainly", async () => {
  const p = createOpenAIProvider({
    model: "m",
    fetch: async () => { throw new Error("ECONNREFUSED"); },
  });
  await assert.rejects(() => p.probe(), (e) => {
    assert.equal(e.kind, ProviderError.UNREACHABLE);
    assert.match(e.message, /No inference server is listening/);
    return true;
  });
});

test("the wire schema drops the bounds that broke the tool grammar", () => {
  // Sent with their length bounds, the eight tools produced
  // "Failed to initialize samplers: failed to parse grammar" and killed the
  // inference engine. The bounds stay in the strict schema that gates
  // execution; they are just not sent to the model.
  // Walked structurally rather than matched as text: "pattern" is also the name
  // of glob's own argument, so a regex over the JSON reports a false positive.
  const stripped = ["maxLength", "minLength", "minItems", "maxItems", "minimum", "maximum", "pattern"];
  const walk = (schema, path) => {
    if (!schema || typeof schema !== "object") return;
    for (const key of stripped) {
      assert.ok(!(key in schema), `${path} still declares ${key} on the wire`);
    }
    for (const [name, sub] of Object.entries(schema.properties ?? {})) walk(sub, `${path}.${name}`);
    if (schema.items) walk(schema.items, `${path}[]`);
  };
  const specs = toolSpecs();
  for (const s of specs) walk(s.function.parameters, s.function.name);
  assert.equal(specs.length, 8);
  for (const s of specs) {
    assert.equal(s.function.parameters.additionalProperties, false);
    assert.ok(s.function.parameters.properties);
  }
  const patch = specs.find((s) => s.function.name === "apply_patch");
  assert.ok(patch.function.parameters.properties.edits.items.properties.operation.enum,
    "enums survive, because they are what keep the model on the rails");
});

test("credentials never appear in a provider error", async () => {
  const p = createOpenAIProvider({
    model: "m", apiKey: "sk-secret-value-do-not-leak",
    fetch: streamOf([], { status: 500 }),
  });
  const events = await collect(p);
  assert.doesNotMatch(JSON.stringify(events), /sk-secret-value/);
});
