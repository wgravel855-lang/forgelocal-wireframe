// @ts-check
/**
 * A model server that says what it is told to say.
 *
 * The sidecar talks to an OpenAI-compatible HTTP endpoint and nothing about it
 * is stubbable from inside the process: the point of the sidecar tests is that
 * they spawn the real thing and speak the real protocol to it. So the model
 * server is real too, and scripted.
 *
 * It implements exactly what createOpenAIProvider uses — GET /v1/models and a
 * streaming POST /v1/chat/completions — because a double that implements more
 * than its subject uses is a second implementation to keep in step.
 *
 * This is a test fixture. It listens on 127.0.0.1 with an ephemeral port, it
 * holds no state between runs, and nothing ships it.
 */

import { createServer } from "node:http";

/**
 * @param {object} opts
 * @param {string} [opts.model]
 * @param {Array<{text?: string, hang?: boolean,
 *   calls?: Array<{name: string, args?: any}>}>} opts.turns
 *   One entry per assistant turn, replayed in order. Running past the end
 *   repeats the last entry rather than hanging, so a test that scripts three
 *   turns and gets four sees the fourth rather than a timeout with no cause.
 *   An entry with `hang: true` accepts the request and never answers, which is
 *   how a test gets a sidecar that is genuinely mid-turn when it is killed.
 */
export async function startFakeModelServer({ model = "test-model", turns }) {
  let index = 0;
  /** @type {any[]} */
  const requests = [];

  const server = createServer((req, res) => {
    const url = req.url ?? "";

    if (req.method === "GET" && url.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: model, object: "model" }] }));
      return;
    }

    if (req.method === "POST" && url.includes("/chat/completions")) {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        try { requests.push(JSON.parse(body)); } catch { requests.push({ unparsable: body }); }
        const turn = turns[Math.min(index, turns.length - 1)];
        index += 1;

        if (turn.hang) {
          // Headers sent, body never. The sidecar is now mid-turn and stays
          // there; the socket is left open for the test to kill.
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write(": waiting\n\n");
          return;
        }

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        /** @param {any} delta @param {string|null} [finish] */
        const chunk = (delta, finish = null) => {
          res.write(`data: ${JSON.stringify({
            id: "chatcmpl-fake", object: "chat.completion.chunk", model,
            choices: [{ index: 0, delta, finish_reason: finish }],
          })}\n\n`);
        };

        if (turn.text) chunk({ role: "assistant", content: turn.text });
        (turn.calls ?? []).forEach((c, i) => {
          chunk({
            tool_calls: [{
              index: i, id: `call_${index}_${i}`, type: "function",
              function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
            }],
          });
        });
        chunk({}, turn.calls?.length ? "tool_calls" : "stop");
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `no route for ${req.method} ${url}` } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(null)));
  const addr = /** @type {any} */ (server.address());

  return {
    model,
    baseUrl: `http://127.0.0.1:${addr.port}/v1`,
    /** Every request body the sidecar sent, so a test can assert what the model saw. */
    get requests() { return requests.slice(); },
    get served() { return index; },
    async close() {
      await new Promise((resolve) => server.close(() => resolve(null)));
    },
  };
}
