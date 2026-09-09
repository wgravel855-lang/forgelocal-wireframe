// @ts-check
/**
 * Containment is tested against the real filesystem, including a real Windows
 * junction, because the bug being defended against is precisely the one a
 * string check cannot see.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalRoot, resolveInRoot, isInsideRoot, PathEscape, isIgnored } from "./paths.mjs";

/** A project root, and a sibling directory that must stay unreachable. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "fl-paths-"));
  const root = join(base, "project");
  const outside = join(base, "outside");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, "src", "app.js"), "export const a = 1;\n");
  writeFileSync(join(outside, "secret.txt"), "do not read me\n");
  return { base, root: canonicalRoot(root), outside, raw: root };
}

test("an ordinary project-relative path resolves inside the root", () => {
  const f = fixture();
  const r = resolveInRoot(f.root, "src/app.js");
  assert.equal(r.relative, "src/app.js");
  assert.ok(isInsideRoot(f.root, r.absolute));
  rmSync(f.base, { recursive: true, force: true });
});

test("dot-dot traversal is rejected however it is spelled", () => {
  const f = fixture();
  for (const attempt of [
    "../outside/secret.txt",
    "src/../../outside/secret.txt",
    "./src/./../../outside/secret.txt",
    "src/../..",
  ]) {
    assert.throws(() => resolveInRoot(f.root, attempt), PathEscape, attempt);
  }
  rmSync(f.base, { recursive: true, force: true });
});

test("an absolute path is refused where a project-relative one is required", () => {
  const f = fixture();
  for (const attempt of [f.outside, "C:\\Windows\\System32", "/etc/passwd", "C:relative"]) {
    assert.throws(() => resolveInRoot(f.root, attempt), PathEscape, attempt);
  }
  rmSync(f.base, { recursive: true, force: true });
});

test("UNC and device paths are refused", () => {
  const f = fixture();
  for (const attempt of ["\\\\server\\share\\x", "//server/share/x", "\\\\?\\C:\\Windows"]) {
    assert.throws(() => resolveInRoot(f.root, attempt), PathEscape, attempt);
  }
  rmSync(f.base, { recursive: true, force: true });
});

test("a control character in the path is refused", () => {
  const f = fixture();
  assert.throws(() => resolveInRoot(f.root, "src/app.js\u0000.txt"), PathEscape);
  rmSync(f.base, { recursive: true, force: true });
});

test("a symlink pointing outside the root is refused", { skip: process.platform === "win32" && !process.env.FL_SYMLINK }, () => {
  const f = fixture();
  try {
    symlinkSync(f.outside, join(f.raw, "escape"), "dir");
  } catch {
    rmSync(f.base, { recursive: true, force: true });
    return; // no privilege to create symlinks; the junction test covers this
  }
  assert.throws(() => resolveInRoot(f.root, "escape/secret.txt"), PathEscape);
  rmSync(f.base, { recursive: true, force: true });
});

test("a Windows junction pointing outside the root is refused", { skip: process.platform !== "win32" }, () => {
  const f = fixture();
  // A junction needs no elevation on Windows, which is exactly why it is the
  // realistic escape: the path string looks entirely ordinary.
  execFileSync("cmd", ["/c", "mklink", "/J", join(f.raw, "link"), f.outside], { stdio: "pipe" });
  assert.throws(() => resolveInRoot(f.root, "link/secret.txt"), PathEscape,
    "a junction let a lexically clean path escape the root");
  assert.equal(isInsideRoot(f.root, join(f.raw, "link", "secret.txt")), false);
  rmSync(f.base, { recursive: true, force: true });
});

test("a file that does not exist yet is contained by its parent", () => {
  const f = fixture();
  const r = resolveInRoot(f.root, "src/new-file.js");
  assert.equal(r.relative, "src/new-file.js");
  // and the same rule still refuses one that would be created outside
  assert.throws(() => resolveInRoot(f.root, "../outside/new-file.js"), PathEscape);
  rmSync(f.base, { recursive: true, force: true });
});

test("the root itself resolves, and an empty path does not", () => {
  const f = fixture();
  assert.equal(resolveInRoot(f.root, ".").relative, ".");
  assert.throws(() => resolveInRoot(f.root, ""), PathEscape);
  rmSync(f.base, { recursive: true, force: true });
});

test("generated directories are ignored by default", () => {
  assert.equal(isIgnored("node_modules/x/index.js"), true);
  assert.equal(isIgnored("src/.git/config"), true);
  assert.equal(isIgnored("src/app.js"), false);
});
