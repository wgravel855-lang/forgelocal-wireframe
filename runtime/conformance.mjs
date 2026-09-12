// @ts-check
/**
 * Run the conformance suite against a real model server.
 *
 *   node runtime/conformance.mjs [baseUrl] [model]
 *
 * Prints a per-case result and a grade. Exits non-zero only if the run itself
 * failed — a model graded chat_only is a result, not an error.
 */

import { createOpenAIProvider } from "./core/providers/openai.mjs";
import { runConformance } from "./core/conformance.mjs";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:1234/v1";
const wanted = process.argv[3] ?? null;

const probe = createOpenAIProvider({ baseUrl, model: "" });
let info;
try {
  info = await probe.probe();
} catch (/** @type {any} */ e) {
  console.error(`Could not reach ${baseUrl}: ${e && e.message ? e.message : e}`);
  console.error("Start LM Studio's server, or pass a different base URL.");
  process.exit(2);
}

const model = wanted ?? info.models[0];
if (!model) {
  console.error(`${baseUrl} is running but has no model loaded.`);
  process.exit(2);
}

console.log(`model:   ${model}`);
console.log(`server:  ${baseUrl}`);
console.log(`context: ${info.capabilities?.contextWindow ?? "unknown"}`);
console.log(`tools:   ${info.capabilities?.tools ? "native" : "not reported"}`);
console.log("");

const provider = createOpenAIProvider({
  baseUrl, model, contextWindow: info.capabilities?.contextWindow ?? null,
});

const out = await runConformance({
  provider, model, baseUrl,
  capabilities: info.capabilities ?? {},
  log: (line) => console.log(line),
});

console.log("");
console.log(`grade:  ${out.profile.agentGrade}   (${out.profile.score}/${out.total})`);
console.log(`browser: ${out.profile.browserMode ?? "not offered"}`);
console.log(out.reason);

if (out.profile.failed.length) {
  console.log("");
  console.log("failed:");
  for (const r of out.results.filter((x) => !x.ok)) {
    console.log(`  ${r.id}${r.critical ? " (critical)" : ""} — ${r.detail}`);
  }
}
