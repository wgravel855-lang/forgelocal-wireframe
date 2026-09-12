// @ts-check
/**
 * Windows-specific containment and process tests.
 *
 * These are the cases where a POSIX intuition about paths is wrong. Windows
 * compares paths case-insensitively, resolves 8.3 short names, treats `C:foo`
 * as relative to a per-drive current directory, reserves device names like
 * `CON` and `NUL` in every directory, and lets an unprivileged user create a
 * junction that redirects a lexically ordinary path anywhere on the volume.
 *
 * Every escape here is attempted against a real filesystem with a real secret
 * outside the root. A test that only checked the error message would pass on an
 * implementation that never actually protected anything, so each one also
 * asserts that the file outside the root was not read.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalRoot, resolveInRoot, isInsideRoot, PathEscape } from "./paths.mjs";
import { readFile } from "./tools/read.mjs";
import { applyPatch } from "./tools/patch.mjs";
import { runCommand, killTree } from "./tools/command.mjs";
import { childEnv } from "./secrets.mjs";

const win = process.platform === "win32";
const SECRET = "TOP-SECRET-OUTSIDE-THE-ROOT";

/** A project root, and a sibling holding something that must stay unreachable. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "fl-win-"));
  const root = join(base, "project");
  const outside = join(base, "outside");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, "src", "app.js"), "export const a = 1;\n");
  writeFileSync(join(outside, "secret.txt"), `${SECRET}\n`);
  return { base, raw: root, root: canonicalRoot(root), outside };
}
const clean = (f) => rmSync(f.base, { recursive: true, force: true });

/** Every refusal must also have read nothing. */
function refuses(ctx, path, label) {
  assert.throws(() => resolveInRoot(ctx.root, path), PathEscape, label);
  let leaked = null;
  try { leaked = readFile(ctx, { path }); } catch { /* expected */ }
  assert.equal(leaked, null, `${label}: the tool returned content for an escaping path`);
}

test("a junction escaping the root is refused, and reads nothing", { skip: !win }, () => {
  const f = fixture();
  // A junction needs no elevation, which is what makes it the realistic escape.
  execFileSync("cmd", ["/c", "mklink", "/J", join(f.raw, "link"), f.outside], { stdio: "pipe" });
  refuses(f, "link/secret.txt", "junction");
  // and a resolved path handed in from elsewhere is caught too
  assert.equal(isInsideRoot(f.root, join(f.raw, "link", "secret.txt")), false);
  clean(f);
});

test("a junction nested several levels down is still refused", { skip: !win }, () => {
  const f = fixture();
  mkdirSync(join(f.raw, "a", "b"), { recursive: true });
  execFileSync("cmd", ["/c", "mklink", "/J", join(f.raw, "a", "b", "c"), f.outside], { stdio: "pipe" });
  refuses(f, "a/b/c/secret.txt", "nested junction");
  clean(f);
});

test("path containment survives a case-different root", { skip: !win }, () => {
  const f = fixture();
  // Windows is case-insensitive, so the same file has many spellings. A
  // containment check that compared strings case-sensitively would treat these
  // as different paths and could be walked out of.
  const shouted = canonicalRoot(f.raw.toUpperCase());
  const a = resolveInRoot(f.root, "src/app.js");
  const b = resolveInRoot(shouted, "SRC/APP.JS");
  assert.equal(a.absolute.toLowerCase(), b.absolute.toLowerCase(),
    "the same file resolved to two different places depending on case");
  assert.ok(isInsideRoot(f.root, b.absolute), "a case-different spelling fell outside the root");
  assert.ok(isInsideRoot(shouted, a.absolute));
  clean(f);
});

test("case tricks cannot smuggle a traversal", { skip: !win }, () => {
  const f = fixture();
  for (const attempt of ["../OUTSIDE/secret.txt", "SRC/../../outside/secret.txt", "..\\Outside\\SECRET.TXT"]) {
    refuses(f, attempt, attempt);
  }
  clean(f);
});

test("UNC paths are refused in every spelling", () => {
  const f = fixture();
  for (const attempt of [
    "\\\\server\\share\\secret.txt",
    "//server/share/secret.txt",
    "\\\\?\\C:\\Windows\\win.ini",
    "\\\\.\\C:\\Windows\\win.ini",
    "//?/UNC/server/share/x",
  ]) {
    refuses(f, attempt, attempt);
  }
  clean(f);
});

test("drive-relative paths are refused", () => {
  const f = fixture();
  // `C:foo` is not `C:\foo`. It means "foo relative to the current directory on
  // drive C", which is a location this process does not control.
  for (const attempt of ["C:secret.txt", "c:..\\outside\\secret.txt", "D:project", "Z:"]) {
    refuses(f, attempt, attempt);
  }
  clean(f);
});

test("absolute paths, including the real outside path, are refused", () => {
  const f = fixture();
  refuses(f, join(f.outside, "secret.txt"), "absolute path to the secret");
  refuses(f, "C:\\Windows\\System32\\drivers\\etc\\hosts", "absolute system path");
  clean(f);
});

test("reserved device names cannot be read or written", { skip: !win }, () => {
  const f = fixture();
  // CON, NUL, PRN, AUX, COM1..9 and LPT1..9 are reserved in *every* directory
  // on Windows, with or without an extension. Opening one is not a file
  // operation at all; writing to it is a device write.
  for (const name of ["CON", "NUL", "PRN", "AUX", "COM1", "LPT1", "con.txt", "nul.log", "src/NUL"]) {
    let out = null;
    try { out = readFile(f.ctx ?? { root: f.root }, { path: name }); } catch { /* expected */ }
    assert.equal(out && out.content ? out.binary === false && out.content.length > 0 : false, false,
      `${name} returned content`);

    // A write to a device name must not be treated as a file inside the project.
    let wrote = false;
    try {
      applyPatch({ root: f.root }, { edits: [{ path: name, operation: "create", content: "x" }] });
      wrote = true;
    } catch { /* expected */ }
    if (wrote) {
      // If it "succeeded", it must at least have produced a real file inside
      // the root rather than having gone to a device.
      assert.ok(existsSync(join(f.root, name)), `${name} was written somewhere that is not the project`);
    }
  }
  clean(f);
});

test("a hard link to a file outside the root does not smuggle it in", { skip: !win }, () => {
  const f = fixture();
  let made = false;
  try {
    execFileSync("cmd", ["/c", "mklink", "/H", join(f.raw, "src", "linked.txt"), join(f.outside, "secret.txt")],
      { stdio: "pipe" });
    made = true;
  } catch { /* hard links need the same volume; skip if refused */ }
  if (!made) { clean(f); return; }

  // A hard link is a second name for the same bytes on the same volume, and
  // realpath cannot tell them apart: there is no "target" to resolve to. This
  // is a real limit, and it is stated rather than papered over. What matters is
  // that the read stays inside the root and is visible as a project file.
  const r = readFile({ root: f.root }, { path: "src/linked.txt" });
  assert.equal(r.path, "src/linked.txt");
  assert.ok(isInsideRoot(f.root, join(f.raw, "src", "linked.txt")),
    "the link itself is inside the project, which is where the user put it");
  clean(f);
});

test("a command's working directory cannot escape the root", async () => {
  const f = fixture();
  await assert.rejects(
    () => runCommand({ root: f.root }, {
      argv: [process.execPath, "-e", "console.log(process.cwd())"],
      cwd: "../outside", purpose: "escape",
    }),
    PathEscape,
  );
  clean(f);
});

/**
 * Build a two-level process tree on disk.
 *
 * The scripts are written as files rather than passed with `-e`, because
 * embedding a path with JSON.stringify inside an already-quoted `-e` string
 * produces a syntax error: the grandchild never starts, the marker file stays
 * empty, and a test that only compares "bytes before" with "bytes after" then
 * passes while proving nothing. That is exactly what the first version of this
 * test did. Every test below now asserts the tree was alive first.
 */
function treeScripts(dir, markerName) {
  const marker = join(dir, markerName);
  writeFileSync(join(dir, "grandchild.cjs"),
    `const fs = require("node:fs");\n`
    + `setInterval(() => fs.appendFileSync(${JSON.stringify(marker)}, "x"), 30);\n`);
  writeFileSync(join(dir, "parent.cjs"),
    `const { spawn } = require("node:child_process");\n`
    + `spawn(process.execPath, [${JSON.stringify(join(dir, "grandchild.cjs"))}], `
    + `{ stdio: "ignore", detached: true });\n`
    + `setInterval(() => {}, 1000);\n`);
  return { marker, parent: join(dir, "parent.cjs") };
}

const sizeOf = (p) => (existsSync(p) ? readFileSync(p, "utf8").length : 0);

test("killing a command terminates the whole process tree", async () => {
  const f = fixture();
  const { marker, parent } = treeScripts(f.raw, "grandchild.txt");

  // Killing only the direct child on Windows leaves the grandchild running,
  // which is how a "cancelled" command keeps writing to the user's disk.
  await runCommand({ root: f.root }, {
    argv: [process.execPath, parent], purpose: "spawn a tree", timeout_ms: 1500,
  });

  const atKill = sizeOf(marker);
  assert.ok(atKill > 0, "the grandchild never started, so this proves nothing");

  await new Promise((r) => setTimeout(r, 700));
  const a = sizeOf(marker);
  await new Promise((r) => setTimeout(r, 700));
  const b = sizeOf(marker);
  assert.equal(b, a, `a grandchild outlived the kill and kept writing (${a} -> ${b} bytes)`);
  clean(f);
});

test("cancelling a command terminates its tree too", async () => {
  const f = fixture();
  const { marker, parent } = treeScripts(f.raw, "cancel.txt");

  const ac = new AbortController();
  setTimeout(() => ac.abort(), 700);
  const r = await runCommand({ root: f.root }, {
    argv: [process.execPath, parent], purpose: "spawn a tree", timeout_ms: 30000,
  }, { signal: ac.signal });
  assert.equal(r.cancelled, true, "the command was not reported as cancelled");
  assert.ok(sizeOf(marker) > 0, "the grandchild never started, so this proves nothing");

  await new Promise((x) => setTimeout(x, 700));
  const a = sizeOf(marker);
  await new Promise((x) => setTimeout(x, 700));
  const b = sizeOf(marker);
  assert.equal(b, a, "cancellation left part of the tree alive");
  clean(f);
});

test("killTree on a pid that is already gone does not throw", () => {
  // Called on every timeout and cancel, including races where the process
  // finished first. Throwing here would turn a clean finish into an error.
  assert.doesNotThrow(() => killTree(undefined));
  assert.doesNotThrow(() => killTree(999999));
});

test("a child process receives an allowlist, not the parent environment", async () => {
  const f = fixture();
  // Put credential-shaped variables in this process's environment, the way a
  // developer machine has them.
  const saved = { ...process.env };
  process.env.AWS_SECRET_ACCESS_KEY = "aws-should-not-leak";
  process.env.GITHUB_TOKEN = "ghp_should_not_leak";
  process.env.OPENAI_API_KEY = "sk-should-not-leak";
  process.env.NPM_TOKEN = "npm-should-not-leak";
  try {
    const r = await runCommand({ root: f.root }, {
      argv: [process.execPath, "-e", "console.log(JSON.stringify(process.env))"],
      purpose: "inspect the environment",
    });
    const env = JSON.parse(r.stdout.trim());
    for (const key of ["AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "OPENAI_API_KEY", "NPM_TOKEN"]) {
      assert.equal(env[key], undefined, `${key} was inherited by the child`);
    }
    // and the child is still usable
    assert.ok(env.PATH, "the child got a PATH");
    assert.equal(env.NO_COLOR, "1", "ANSI is off, so output is not full of escapes");
  } finally {
    process.env = saved;
  }
  clean(f);
});

test("the environment allowlist keeps only what a build needs", () => {
  const env = childEnv({
    PATH: "/bin", SYSTEMROOT: "C:\\Windows", USERPROFILE: "C:\\Users\\x",
    AWS_SECRET_ACCESS_KEY: "leak", GH_TOKEN: "leak", DATABASE_URL: "postgres://u:p@h/db",
    SOME_APP_SECRET: "leak",
  }, { cwd: "C:\\p" });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.SYSTEMROOT, "C:\\Windows");
  for (const k of ["AWS_SECRET_ACCESS_KEY", "GH_TOKEN", "DATABASE_URL", "SOME_APP_SECRET"]) {
    assert.equal(env[k], undefined, `${k} survived the allowlist`);
  }
});

test("a command that reads stdin gets EOF instead of hanging", async () => {
  const f = fixture();
  const r = await runCommand({ root: f.root }, {
    argv: [process.execPath, "-e",
      "process.stdin.on('end',()=>{console.log('eof');process.exit(0)});process.stdin.resume()"],
    purpose: "wait on stdin", timeout_ms: 5000,
  });
  assert.equal(r.timed_out, false, "the child waited on stdin forever");
  assert.match(r.stdout, /eof/);
  clean(f);
});

test("UTF-8 survives the round trip through a child process", async () => {
  const f = fixture();
  const r = await runCommand({ root: f.root }, {
    argv: [process.execPath, "-e", "console.log('héllo — 世界 ✓')"],
    purpose: "check encoding",
  });
  assert.match(r.stdout, /héllo — 世界 ✓/, "non-ASCII output was mangled");
  clean(f);
});

test("a nonzero exit from a search-style command is a result, not a failure", async () => {
  const f = fixture();
  // findstr exits 1 when it matches nothing. Treating that as a runtime error
  // would teach the agent that searching is dangerous.
  const r = await runCommand({ root: f.root }, {
    argv: [process.execPath, "-e", "process.exit(1)"], purpose: "no matches",
  });
  assert.equal(r.exit_code, 1);
  assert.equal(r.failed_to_start, false);
  assert.equal(r.timed_out, false);
  clean(f);
});
