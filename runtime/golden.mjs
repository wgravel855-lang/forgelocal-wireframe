// @ts-check
/**
 * The golden task, run against a real local model.
 *
 * Usage:
 *   node runtime/golden.mjs --base http://127.0.0.1:1234/v1 --model <id>
 *
 * It builds a throwaway repository with a small bug, asks a real model to fix
 * it and prove the fix with the project's own test, approves the gated command,
 * and then checks the *filesystem and the exit code*, not the model's summary.
 *
 * The whole point is that this can fail. It prints the real event stream and a
 * verdict derived from what actually happened on disk.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalRoot } from "./core/paths.mjs";
import { createOpenAIProvider } from "./core/providers/openai.mjs";
import { createOrchestrator, StopReason } from "./core/orchestrator.mjs";
import { EventType } from "./core/events.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const BASE = arg("base", "http://127.0.0.1:1234/v1");
const MODEL = arg("model", null);
const MODE = arg("mode", "allow_edits");
const KEEP = process.argv.includes("--keep");

/**
 * A repository with one real bug: `average` divides by the wrong length, so the
 * shipped test fails. Fixing it needs the model to read, reason about an
 * off-by-one, patch, and re-run.
 */
function buildFixture() {
  const base = mkdtempSync(join(tmpdir(), "fl-golden-"));
  mkdirSync(join(base, "src"), { recursive: true });

  writeFileSync(join(base, "src", "stats.js"), `export function average(list) {
  if (list.length === 0) return 0;
  let total = 0;
  for (const n of list) total += n;
  return total / (list.length - 1);
}
`);

  writeFileSync(join(base, "src", "stats.test.js"), `import test from "node:test";
import assert from "node:assert/strict";
import { average } from "./stats.js";

test("average of 2 4 6 is 4", () => {
  assert.equal(average([2, 4, 6]), 4);
});

test("average of an empty list is 0", () => {
  assert.equal(average([]), 0);
});
`);

  writeFileSync(join(base, "package.json"), JSON.stringify({
    name: "golden-fixture", private: true, type: "module",
    scripts: { test: "node --test" },
  }, null, 2));

  // The documented command has to be one that actually works on the installed
  // Node. `node --test src/` does not on Node 24: it treats `src` as a test
  // file and fails even when the code is correct. The first run of this task
  // failed on exactly that, and the model was right to say so.
  writeFileSync(join(base, "FORGELOCAL.md"),
    "# Golden fixture\n\nRun the tests with `node --test`.\nSource lives in `src/`.\n");

  return base;
}

/** Did the fixture actually end up correct? Checked by running it ourselves. */
async function verify(base) {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, ["--test"], {
    cwd: base, encoding: "utf8", windowsHide: true,
  });
  return { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

async function main() {
  if (!MODEL) {
    console.error("Pass --model <id>. Use /v1/models on the server to list them.");
    process.exit(2);
  }

  const base = buildFixture();
  const root = canonicalRoot(base);
  console.log(`fixture:  ${root}`);
  console.log(`provider: ${BASE}`);
  console.log(`model:    ${MODEL}`);
  console.log(`mode:     ${MODE}\n`);

  // Confirm the bug is real before asking anyone to fix it.
  const before = await verify(base);
  console.log(`baseline: the fixture's own tests exit ${before.exit} (expected non-zero)\n`);
  if (before.exit === 0) {
    console.error("The fixture is not broken. The task would prove nothing.");
    process.exit(2);
  }

  const provider = createOpenAIProvider({ baseUrl: BASE, model: MODEL, contextWindow: 32768 });
  try {
    const probe = await provider.probe();
    console.log(`server:   ${probe.models.length} model(s) loaded\n`);
  } catch (e) {
    console.error(`provider unreachable: ${e.message}`);
    process.exit(3);
  }

  const events = [];
  let approvals = 0;

  const agent = createOrchestrator({
    root, provider, mode: MODE,
    paths: { snapshotDir: join(base, ".forgelocal", "snapshots") },
    onEvent: (e) => { events.push(e); print(e); },
  });
  agent.start();

  let result = await agent.send(
    "The tests in this project are failing. Find out why, fix the bug in the source "
    + "(not the test), and run the tests to prove the fix works.",
  );

  // Approve gated actions, up to a sane bound, exactly as a user would.
  while (result.stop === StopReason.AWAITING_PERMISSION && approvals < 12) {
    const ask = [...events].reverse().find((e) => e.type === EventType.PERMISSION_REQUIRED);
    approvals++;
    console.log(`\n  >> approving: ${ask.payload.reason}\n`);
    result = await agent.resolvePermission(ask.payload.request_id, "approve_for_session");
  }

  console.log(`\nstop reason: ${result.stop}`);

  // The verdict comes from the repository, not from the model's summary.
  const after = await verify(base);
  const source = existsSync(join(base, "src", "stats.js"))
    ? readFileSync(join(base, "src", "stats.js"), "utf8") : "";
  const testFile = existsSync(join(base, "src", "stats.test.js"))
    ? readFileSync(join(base, "src", "stats.test.js"), "utf8") : "";

  const checks = {
    "tests pass when we run them ourselves": after.exit === 0,
    "the source was changed": !source.includes("list.length - 1"),
    "the test was not weakened": testFile.includes("assert.equal(average([2, 4, 6]), 4)"),
    "the agent ran the tests itself": agent.ledger.commands.length > 0,
    "the loop ended on its own terms": result.stop === StopReason.FINAL,
  };

  console.log("\n--- verdict (from the repository, not the model) ---");
  for (const [name, ok] of Object.entries(checks)) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  }
  console.log(`\n  our own test run exits ${after.exit}`);
  console.log(`  files changed: ${[...agent.ledger.changed.keys()].join(", ") || "none"}`);
  console.log(`  commands run:  ${agent.ledger.commands.map((c) => (c.argv || []).join(" ")).join(" | ") || "none"}`);
  console.log(`  events:        ${events.length}`);

  const passed = Object.values(checks).every(Boolean);
  console.log(`\nGOLDEN TASK: ${passed ? "PASS" : "FAIL"}`);

  if (KEEP) console.log(`\nfixture kept at ${base}`);
  else rmSync(base, { recursive: true, force: true });
  process.exit(passed ? 0 : 1);
}

/** One line per meaningful event, so the run is readable as it happens. */
function print(e) {
  const p = e.payload;
  switch (e.type) {
    case EventType.ASSISTANT_TEXT_COMPLETED:
      if (p.text) console.log(`\n  model: ${p.text.trim().slice(0, 400)}\n`);
      break;
    case EventType.TOOL_CALL_REQUESTED:
      console.log(`  call:  ${p.tool} ${JSON.stringify(p.args).slice(0, 160)}`);
      break;
    case EventType.TOOL_COMPLETED:
      console.log(`  done:  ${JSON.stringify(p.result)} (${p.duration_ms}ms)`);
      break;
    case EventType.TOOL_FAILED:
      console.log(`  FAIL:  ${p.error}`);
      break;
    case EventType.PERMISSION_REQUIRED:
      console.log(`  ask:   ${p.reason}`);
      break;
    case EventType.FILE_CHANGED:
      console.log(`  file:  ${p.change} ${p.path} +${p.added} -${p.removed}`);
      break;
    case EventType.PLAN_UPDATED:
      console.log(`  plan:  ${p.items.map((s) => `[${s.status}] ${s.step}`).join(" | ")}`);
      break;
    case EventType.RUNTIME_ERROR:
      console.log(`  ERROR: ${p.message}`);
      break;
    default:
      break;
  }
}

main().catch((e) => {
  console.error(`\nunhandled: ${e && e.stack ? e.stack : e}`);
  process.exit(4);
});
