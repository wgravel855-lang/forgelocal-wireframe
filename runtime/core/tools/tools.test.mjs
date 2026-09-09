// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalRoot, PathEscape } from "../paths.mjs";
import { validate, assertStrictSchema, SchemaError } from "../schema.mjs";
import { redact, childEnv } from "../secrets.mjs";
import { readFile, listDirectory, glob, grep, globToRegExp, LIMITS } from "./read.mjs";
import { applyPatch, restoreSnapshot, hashOf, PatchConflict } from "./patch.mjs";
import { runCommand } from "./command.mjs";
import { TOOLS, TOOL_NAMES, validateCall, toolSpecs } from "./index.mjs";

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "fl-tools-"));
  mkdirSync(join(base, "src", "deep"), { recursive: true });
  mkdirSync(join(base, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(base, "src", "app.js"), "const a = 1;\nconst b = 2;\nexport { a, b };\n");
  writeFileSync(join(base, "src", "deep", "util.js"), "export const help = () => 'ok';\n");
  writeFileSync(join(base, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
  writeFileSync(join(base, "README.md"), "# Fixture\nsearchable line here\n");
  return { base, ctx: { root: canonicalRoot(base), snapshotDir: join(base, ".snapshots") } };
}
const cleanup = (f) => rmSync(f.base, { recursive: true, force: true });

// ---------------------------------------------------------------- schema

test("every tool schema is strict", () => {
  for (const name of TOOL_NAMES) {
    assertStrictSchema(TOOLS[name].schema);
    assert.equal(TOOLS[name].schema.additionalProperties, false, name);
  }
});

test("a schema that forgets additionalProperties is rejected", () => {
  assert.throws(() => assertStrictSchema({ type: "object", properties: {} }), SchemaError);
});

test("validation rejects unknown properties, wrong types and missing required", () => {
  const s = TOOLS.read_file.schema;
  assert.equal(validate(s, { path: "a.js" }).ok, true);
  assert.equal(validate(s, {}).ok, false);
  assert.equal(validate(s, { path: 1 }).ok, false);
  assert.equal(validate(s, { path: "a", extra: true }).ok, false);
  // no coercion: a string is not an integer
  assert.equal(validate(s, { path: "a", start_line: "3" }).ok, false);
});

test("validation reports every problem at once", () => {
  const r = validate(TOOLS.run_command.schema, { argv: "npm test", nope: 1 });
  assert.ok(r.errors.length >= 2, r.errors.join("; "));
});

test("tool specs carry the schemas a model server receives", () => {
  const specs = toolSpecs();
  assert.equal(specs.length, TOOL_NAMES.length);
  for (const s of specs) {
    assert.equal(s.type, "function");
    assert.equal(s.function.parameters.additionalProperties, false);
    assert.ok(s.function.description.length > 20, `${s.function.name} needs a usable description`);
  }
});

// ---------------------------------------------------------------- read

test("read_file returns content, range, total lines and a hash", () => {
  const f = fixture();
  const r = readFile(f.ctx, { path: "src/app.js" });
  assert.equal(r.total_lines, 4);
  assert.equal(r.truncated, false);
  assert.match(r.content_hash, /^sha256:[0-9a-f]{16}$/);
  assert.ok(r.content.includes("const a = 1;"));

  const slice = readFile(f.ctx, { path: "src/app.js", start_line: 2, end_line: 2 });
  assert.equal(slice.content, "const b = 2;");
  assert.equal(slice.truncated, true, "a partial read must say so");
  cleanup(f);
});

test("read_file refuses to leave the root", () => {
  const f = fixture();
  assert.throws(() => readFile(f.ctx, { path: "../outside.txt" }), PathEscape);
  cleanup(f);
});

test("read_file reports a binary file instead of returning noise", () => {
  const f = fixture();
  writeFileSync(join(f.base, "bin.dat"), Buffer.from([0x00, 0x01, 0x02, 0x00]));
  const r = readFile(f.ctx, { path: "bin.dat" });
  assert.equal(r.binary, true);
  assert.equal(r.content, null);
  cleanup(f);
});

test("list_directory skips generated folders and says how many", () => {
  const f = fixture();
  const r = listDirectory(f.ctx, { path: ".", depth: 2 });
  const paths = r.entries.map((e) => e.path);
  assert.ok(paths.includes("src/app.js"));
  assert.ok(!paths.some((p) => p.startsWith("node_modules")), "node_modules leaked in");
  assert.ok(r.ignored > 0);
  cleanup(f);
});

test("list_directory honours its entry limit and reports the omission", () => {
  const f = fixture();
  const r = listDirectory(f.ctx, { path: ".", depth: 3, limit: 2 });
  assert.equal(r.entries.length, 2);
  assert.ok(r.omitted > 0);
  assert.equal(r.truncated, true);
  cleanup(f);
});

test("glob matches by pattern and does not cross a separator on a single star", () => {
  const f = fixture();
  assert.deepEqual(glob(f.ctx, { pattern: "src/*.js" }).matches, ["src/app.js"]);
  const deep = glob(f.ctx, { pattern: "src/**/*.js" }).matches;
  assert.ok(deep.includes("src/app.js") && deep.includes("src/deep/util.js"));
  assert.equal(glob(f.ctx, { pattern: "**/*.js" }).matches.some((p) => p.startsWith("node_modules")), false);
  cleanup(f);
});

test("glob translation handles braces and literal commas", () => {
  assert.ok(globToRegExp("*.{js,mjs}").test("a.mjs"));
  assert.ok(globToRegExp("a,b.js").test("a,b.js"));
  assert.ok(!globToRegExp("a,b.js").test("a.js"));
});

test("grep finds matches and reports no-match as a result", () => {
  const f = fixture();
  const hit = grep(f.ctx, { query: "searchable" });
  assert.equal(hit.count, 1);
  assert.equal(hit.matches[0].path, "README.md");
  assert.equal(hit.matches[0].line, 2);

  const miss = grep(f.ctx, { query: "nothingmatchesthis" });
  assert.equal(miss.count, 0);
  assert.equal(miss.note, "No matches.");
  cleanup(f);
});

test("grep reports an invalid pattern rather than throwing something opaque", () => {
  const f = fixture();
  assert.throws(() => grep(f.ctx, { query: "([unclosed" }), /Invalid search pattern/);
  cleanup(f);
});

// ---------------------------------------------------------------- secrets

test("likely secrets are redacted from tool output", () => {
  const cases = [
    ["API_KEY=abcdef123456789", "abcdef123456789"],
    ["Authorization: Bearer abcdefghijklmnopqrst", "abcdefghijklmnopqrst"],
    ["sk-ant-api03-AAAAAAAAAAAAAAAAAAAA", "sk-ant-api03-AAAAAAAAAAAAAAAAAAAA"],
    ["ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    ["postgres://user:hunter2pass@host/db", "hunter2pass"],
  ];
  for (const [input, secret] of cases) {
    const out = redact(input);
    assert.ok(!out.includes(secret), `leaked: ${input} -> ${out}`);
    assert.ok(out.includes("[redacted]"), input);
  }
  // and ordinary text is untouched
  assert.equal(redact("const count = 5;"), "const count = 5;");
});

test("grep output is redacted before it reaches the model", () => {
  const f = fixture();
  writeFileSync(join(f.base, ".env"), "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx\n");
  const r = grep(f.ctx, { query: "API_KEY" });
  assert.equal(r.count, 1);
  assert.ok(!r.matches[0].text.includes("sk-abcdefghijklmnopqrstuvwx"), r.matches[0].text);
  cleanup(f);
});

test("a child process gets an allowlisted environment, not the parent's", () => {
  const env = childEnv({ PATH: "/bin", AWS_SECRET_ACCESS_KEY: "leak", HOME: "/h" }, { cwd: "/p" });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.HOME, "/h");
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined, "a credential was inherited");
});

// ---------------------------------------------------------------- patch

test("apply_patch replaces exact text and reports the change", () => {
  const f = fixture();
  const r = applyPatch(f.ctx, {
    edits: [{ path: "src/app.js", operation: "replace", find: "const a = 1;", replace: "const a = 42;" }],
  });
  assert.equal(r.files.length, 1);
  assert.equal(r.files[0].change, "modified");
  assert.equal(r.added, 1);
  assert.equal(r.removed, 1);
  assert.ok(readFileSync(join(f.base, "src", "app.js"), "utf8").includes("const a = 42;"));
  cleanup(f);
});

test("apply_patch refuses an edit when the file changed since it was read", () => {
  const f = fixture();
  const stale = hashOf("something else entirely");
  assert.throws(
    () => applyPatch(f.ctx, {
      edits: [{ path: "src/app.js", operation: "replace", find: "const a = 1;", replace: "x", expected_hash: stale }],
    }),
    (e) => e instanceof PatchConflict && e.rejected[0].reason.includes("changed since it was read"),
  );
  // and the file is untouched
  assert.ok(readFileSync(join(f.base, "src", "app.js"), "utf8").includes("const a = 1;"));
  cleanup(f);
});

test("a matching hash lets the same edit through", () => {
  const f = fixture();
  const before = readFile(f.ctx, { path: "src/app.js" });
  const r = applyPatch(f.ctx, {
    edits: [{
      path: "src/app.js", operation: "replace", find: "const b = 2;",
      replace: "const b = 3;", expected_hash: before.content_hash,
    }],
  });
  assert.equal(r.files[0].hash_before, before.content_hash);
  assert.notEqual(r.files[0].hash_after, before.content_hash);
  cleanup(f);
});

test("ambiguous find text is rejected rather than guessed", () => {
  const f = fixture();
  writeFileSync(join(f.base, "dup.js"), "let x = 1;\nlet x = 1;\n");
  assert.throws(
    () => applyPatch(f.ctx, { edits: [{ path: "dup.js", operation: "replace", find: "let x = 1;", replace: "let x = 2;" }] }),
    (e) => e.rejected[0].reason.includes("occurs 2 times"),
  );
  cleanup(f);
});

test("a whitespace mismatch says so instead of just failing", () => {
  const f = fixture();
  assert.throws(
    () => applyPatch(f.ctx, { edits: [{ path: "src/app.js", operation: "replace", find: "const  a  =  1;", replace: "x" }] }),
    (e) => /whitespace or indentation differs/.test(e.rejected[0].hint ?? ""),
  );
  cleanup(f);
});

test("a multi-file patch is all or nothing", () => {
  const f = fixture();
  assert.throws(() => applyPatch(f.ctx, {
    edits: [
      { path: "src/app.js", operation: "replace", find: "const a = 1;", replace: "const a = 9;" },
      { path: "src/deep/util.js", operation: "replace", find: "does not exist", replace: "x" },
    ],
  }), PatchConflict);
  // the first edit must not have landed
  assert.ok(readFileSync(join(f.base, "src", "app.js"), "utf8").includes("const a = 1;"),
    "a rejected patch left a partial change behind");
  cleanup(f);
});

test("two edits to the same file in one patch both apply", () => {
  const f = fixture();
  const r = applyPatch(f.ctx, {
    edits: [
      { path: "src/app.js", operation: "replace", find: "const a = 1;", replace: "const a = 9;" },
      { path: "src/app.js", operation: "replace", find: "const b = 2;", replace: "const b = 8;" },
    ],
  });
  const text = readFileSync(join(f.base, "src", "app.js"), "utf8");
  assert.ok(text.includes("const a = 9;") && text.includes("const b = 8;"));
  assert.equal(r.files.length, 1);
  cleanup(f);
});

test("create, delete and writes outside the root behave correctly", () => {
  const f = fixture();
  applyPatch(f.ctx, { edits: [{ path: "src/new.js", operation: "create", content: "export const n = 1;\n" }] });
  assert.ok(existsSync(join(f.base, "src", "new.js")));

  assert.throws(() => applyPatch(f.ctx, { edits: [{ path: "src/new.js", operation: "create", content: "x" }] }),
    (e) => e.rejected[0].reason.includes("already exists"));

  applyPatch(f.ctx, { edits: [{ path: "src/new.js", operation: "delete" }] });
  assert.equal(existsSync(join(f.base, "src", "new.js")), false);

  assert.throws(() => applyPatch(f.ctx, { edits: [{ path: "../escape.js", operation: "create", content: "x" }] }), PathEscape);
  cleanup(f);
});

test("every mutation is snapshotted and can be restored", () => {
  const f = fixture();
  const original = readFileSync(join(f.base, "src", "app.js"), "utf8");
  const r = applyPatch(f.ctx, {
    edits: [
      { path: "src/app.js", operation: "replace", find: "const a = 1;", replace: "const a = 99;" },
      { path: "src/added.js", operation: "create", content: "export const z = 0;\n" },
    ],
  });
  assert.ok(r.snapshot_id);
  assert.ok(existsSync(join(f.base, "src", "added.js")));

  restoreSnapshot(f.ctx, r.snapshot_id);
  assert.equal(readFileSync(join(f.base, "src", "app.js"), "utf8"), original);
  assert.equal(existsSync(join(f.base, "src", "added.js")), false,
    "restoring did not undo a file creation");
  cleanup(f);
});

// ---------------------------------------------------------------- command

test("run_command returns stdout, exit code and duration", async () => {
  const f = fixture();
  const r = await runCommand(f.ctx, {
    argv: [process.execPath, "-e", "console.log('hello from child')"],
    purpose: "test",
  });
  assert.equal(r.exit_code, 0);
  assert.match(r.stdout, /hello from child/);
  assert.equal(r.timed_out, false);
  assert.ok(r.duration_ms >= 0);
  cleanup(f);
});

test("a nonzero exit is a result, not a thrown error", async () => {
  const f = fixture();
  const r = await runCommand(f.ctx, {
    argv: [process.execPath, "-e", "process.exit(3)"],
    purpose: "test",
  });
  assert.equal(r.exit_code, 3);
  assert.equal(r.failed_to_start, false);
  cleanup(f);
});

test("a missing program is reported clearly rather than crashing the runtime", async () => {
  const f = fixture();
  const r = await runCommand(f.ctx, { argv: ["definitely-not-a-real-program-xyz"], purpose: "test" });
  assert.equal(r.failed_to_start, true);
  assert.match(r.error, /not found on PATH/);
  cleanup(f);
});

test("a command that exceeds its timeout is killed", async () => {
  const f = fixture();
  const r = await runCommand(f.ctx, {
    argv: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
    purpose: "test",
    timeout_ms: 1000,
  });
  assert.equal(r.timed_out, true);
  assert.notEqual(r.exit_code, 0);
  assert.match(r.note, /Killed after/);
  cleanup(f);
});

test("cancellation stops a running command", async () => {
  const f = fixture();
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 300);
  const r = await runCommand(f.ctx, {
    argv: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
    purpose: "test",
    timeout_ms: 30000,
  }, { signal: ac.signal });
  assert.equal(r.cancelled, true);
  cleanup(f);
});

test("killing a command kills the whole process tree", async () => {
  const f = fixture();
  // A parent that spawns a detached grandchild writing to a file. If only the
  // parent is killed, the grandchild keeps writing and the file keeps growing.
  const marker = join(f.base, "grandchild.txt").replace(/\\/g, "/");
  const script = `
    const { spawn } = require("node:child_process");
    spawn(process.execPath, ["-e",
      "const fs=require('node:fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'x'),50)"],
      { stdio: "ignore" });
    setInterval(() => {}, 1000);
  `;
  await runCommand(f.ctx, {
    argv: [process.execPath, "-e", script],
    purpose: "test",
    timeout_ms: 1200,
  });

  await new Promise((r) => setTimeout(r, 700));
  const sizeA = existsSync(marker) ? readFileSync(marker, "utf8").length : 0;
  await new Promise((r) => setTimeout(r, 700));
  const sizeB = existsSync(marker) ? readFileSync(marker, "utf8").length : 0;

  assert.equal(sizeB, sizeA, `a grandchild survived the kill and kept writing (${sizeA} -> ${sizeB})`);
  cleanup(f);
});

test("output is bounded and the truncation is reported", async () => {
  const f = fixture();
  const r = await runCommand(f.ctx, {
    argv: [process.execPath, "-e", "for (let i = 0; i < 200000; i++) console.log('line ' + i)"],
    purpose: "test",
    timeout_ms: 30000,
  });
  assert.equal(r.truncated, true);
  assert.ok(r.stdout.length <= LIMITS.FILE_BYTES, "output exceeded the cap");
  assert.match(r.note, /cut off/);
  cleanup(f);
});

test("a command's working directory must resolve inside the root", async () => {
  const f = fixture();
  await assert.rejects(
    async () => runCommand(f.ctx, { argv: [process.execPath, "-e", ""], cwd: "../..", purpose: "test" }),
    PathEscape,
  );
  cleanup(f);
});

test("secrets in command output are redacted", async () => {
  const f = fixture();
  const r = await runCommand(f.ctx, {
    argv: [process.execPath, "-e", "console.log('TOKEN=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')"],
    purpose: "test",
  });
  assert.ok(!r.stdout.includes("ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), r.stdout);
  cleanup(f);
});

test("validateCall gates arguments before anything runs", () => {
  assert.equal(validateCall("run_command", { argv: ["npm", "test"], purpose: "run tests" }).ok, true);
  assert.equal(validateCall("run_command", { argv: ["npm"] }).ok, false); // purpose is required
  assert.equal(validateCall("run_command", { command: "npm test" }).ok, false); // wrong shape
});
