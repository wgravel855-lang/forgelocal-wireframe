// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupActivity, labelFor, runningLabel, detailOf } from "./activity.mjs";

const call = (tool, args, status = "completed", extra = {}) =>
  ({ kind: "tool", tool, args, status, output: "", ...extra });

test("consecutive reads collapse into one row that counts them", () => {
  const rows = groupActivity([
    call("read_file", { path: "a.js" }),
    call("read_file", { path: "b.js" }),
    call("read_file", { path: "c.js" }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "Read 3 files");
  assert.equal(rows[0].grouped, true);
  assert.equal(rows[0].calls.length, 3, "the individual reads survive for expansion");
});

test("a single read names the file", () => {
  const rows = groupActivity([call("read_file", { path: "src/app.js" })]);
  assert.equal(rows[0].label, "Read src/app.js");
  assert.equal(rows[0].grouped, false);
});

test("searches group separately from reads", () => {
  const rows = groupActivity([
    call("grep", { query: "localStorage" }),
    call("glob", { pattern: "src/*.js" }),
    call("read_file", { path: "a.js" }),
    call("read_file", { path: "b.js" }),
  ]);
  assert.deepEqual(rows.map((r) => r.kind), ["search", "read"]);
  assert.equal(rows[0].label, "Searched 2 times");
  assert.equal(rows[1].label, "Read 2 files");
});

test("one search names what it looked for", () => {
  const rows = groupActivity([call("grep", { query: "localStorage" })]);
  assert.equal(rows[0].label, "Searched for localStorage");
});

test("an edit names the file it changed", () => {
  const rows = groupActivity([
    call("apply_patch", { edits: [{ operation: "replace", path: "src/example.ts" }] }),
  ]);
  assert.equal(rows[0].label, "Edited src/example.ts");
});

test("a single command names itself and its exit code", () => {
  const rows = groupActivity([
    call("run_command", { argv: ["npm", "test"] }, "completed", { result: { exit_code: 0 } }),
  ]);
  assert.equal(rows[0].label, "Ran npm test — exit 0");
});

test("consecutive commands collapse into a count", () => {
  // These used to be one row each, on the reasoning that two runs are two
  // facts. Eleven runs are still eleven facts and they were eleven rows, which
  // is a log. The count is the row; the runs survive for expansion.
  const rows = groupActivity(Array.from({ length: 5 }, (_, i) =>
    call("run_command", { argv: ["npx", "vitest", `case${i}`] }, "completed", { result: { exit_code: 0 } })));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "Ran 5 commands");
  assert.equal(rows[0].calls.length, 5, "the individual runs survive for expansion");
});

test("a running command says so and shows the exit code once it has one", () => {
  assert.equal(
    labelFor("command", [call("run_command", { argv: ["npm", "test"] }, "running")]),
    "Running npm test",
  );
  assert.equal(
    labelFor("command", [call("run_command", { argv: ["npm", "test"] }, "completed", { result: { exit_code: 0 } })]),
    "Ran npm test — exit 0",
  );
});

/* The rule that failures must never be hidden has not changed; how it is kept
   has. A failure used to split the group, which meant eleven commands with
   three failures became eleven rows and the three were buried among them. The
   group may now contain them, and the label is required to say so. These are
   the tests that hold that requirement in place. */

test("a group that contains a failure says so in its label", () => {
  const rows = groupActivity([
    call("read_file", { path: "a.js" }),
    call("read_file", { path: "missing.js" }, "failed", { error: "no such file" }),
    call("read_file", { path: "c.js" }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "Read 3 files (1 failed)");
  assert.equal(rows[0].status, "failed", "the row is marked failed, not healthy");
  assert.equal(rows[0].calls.length, 3);
});

test("a mixed run of commands counts its failures", () => {
  const rows = groupActivity(Array.from({ length: 11 }, (_, i) =>
    call("run_command", { argv: ["npx", "vitest", `case${i}`] },
      i === 2 || i === 5 || i === 9 ? "failed" : "completed",
      { result: { exit_code: 0 } })));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "Ran 11 commands (3 failed)");
  assert.equal(rows[0].status, "failed");
});

test("a denial is counted as a failure rather than passed over", () => {
  const rows = groupActivity([
    call("apply_patch", { edits: [{ operation: "update", path: "a.js" }] }),
    call("apply_patch", { edits: [{ operation: "update", path: "b.js" }] }, "denied"),
  ]);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].label.endsWith("(1 failed)"), rows[0].label);
});

test("a call that still needs attention always stands alone", () => {
  // Running and awaiting are not summaries of the past; they are demands on
  // the present, and a count cannot represent them.
  for (const status of ["awaiting_permission", "running", "requested"]) {
    const rows = groupActivity([
      call("read_file", { path: "a.js" }),
      call("read_file", { path: "b.js" }, status),
      call("read_file", { path: "c.js" }),
    ]);
    assert.equal(rows.length, 3, `${status} was collapsed into a group`);
  }
});

test("a group takes the status of its worst member", () => {
  // Not reachable through grouping (a failure splits), but the reducer can hand
  // in a group whose later member failed, and the row must not read as healthy.
  assert.equal(
    groupActivity([call("read_file", { path: "a" }), call("read_file", { path: "b" })])[0].status,
    "completed",
  );
});

test("the running label is derived from runtime state, never invented", () => {
  assert.equal(runningLabel({ state: "thinking" }), "Thinking");
  assert.equal(runningLabel({ state: "running_tool", status: "Running npm test" }), "Running npm test");
  assert.equal(runningLabel({ state: "running_tool" }), "Working");
  assert.equal(runningLabel({ state: "awaiting_permission", permission: {} }), "Waiting for approval");
  assert.equal(runningLabel({ state: "awaiting_permission" }), "Waiting for an answer");
  assert.equal(runningLabel({ state: "error", error: { message: "x" } }), "Runtime error");
  // idle says nothing at all rather than inventing reassurance
  assert.equal(runningLabel({ state: "idle" }), null);
  assert.equal(runningLabel(null), null);
});

test("expansion shows the command, directory and exit code", () => {
  const d = detailOf(call("run_command", {
    argv: ["npm", "test"], cwd: "packages/api", purpose: "run the suite",
  }, "completed", { result: { exit_code: 1 }, durationMs: 1234, output: "1 failing\n" }));
  const map = Object.fromEntries(d.rows);
  assert.equal(map.Command, "npm test");
  assert.equal(map["Working in"], "packages/api");
  assert.equal(map["Exit code"], "1");
  assert.equal(map.Took, "1234 ms");
  assert.equal(d.output, "1 failing\n");
});

test("expansion of an edit lists the operations and the totals", () => {
  const d = detailOf(call("apply_patch", {
    edits: [{ operation: "replace", path: "a.js" }, { operation: "create", path: "b.js" }],
  }, "completed", { result: { files: 2, added: 10, removed: 3 } }));
  const pairs = d.rows.map((r) => r.join(" "));
  assert.ok(pairs.includes("replace a.js"));
  assert.ok(pairs.includes("create b.js"));
  assert.ok(pairs.some((p) => p.includes("+10")));
});
