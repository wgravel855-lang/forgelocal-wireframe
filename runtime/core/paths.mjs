// @ts-check
/**
 * Path containment.
 *
 * Every path the model names is untrusted input. It arrives as a string, and a
 * string can say `..`, or name a junction that points at C:\Windows, or use a
 * short name, or a UNC path, or a drive-relative path like `C:foo`. The only
 * safe question is not "does this string look like it stays inside the root"
 * but "where does the operating system actually land when it resolves this,
 * following every link".
 *
 * So containment is decided after realpath, on the real path, and a path whose
 * parent does not exist is resolved as far as it does exist. Nothing here
 * trusts a lexical check.
 */

import { realpathSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute, sep, dirname, parse } from "node:path";

export class PathEscape extends Error {
  /** @param {string} requested @param {string} reason */
  constructor(requested, reason) {
    super(`Path is outside the trusted project root: ${reason}`);
    this.name = "PathEscape";
    this.requested = requested;
    this.reason = reason;
    this.code = "PATH_ESCAPE";
  }
}

/**
 * Resolve as much of a path as exists on disk, following links, and return it
 * with the unresolved tail appended. A file that is about to be created has no
 * realpath of its own, but its directory does, and that is what decides
 * containment.
 * @param {string} abs
 * @returns {string}
 */
function realpathDeepest(abs) {
  let head = abs;
  /** @type {string[]} */
  const tail = [];
  const root = parse(abs).root;
  // walk up until something exists, then resolve links on that part
  while (head !== root && !existsSync(head)) {
    tail.unshift(head.slice(dirname(head).length).replace(/^[\\/]/, ""));
    head = dirname(head);
  }
  let real;
  try {
    real = realpathSync.native ? realpathSync.native(head) : realpathSync(head);
  } catch {
    real = head;
  }
  return tail.length ? resolve(real, ...tail) : real;
}

/**
 * Canonicalise a trusted root once, at trust time.
 * @param {string} root
 * @returns {string}
 */
export function canonicalRoot(root) {
  const abs = resolve(root);
  if (!existsSync(abs)) throw new PathEscape(root, "the folder does not exist");
  return realpathDeepest(abs);
}

/**
 * Resolve a project-relative path inside a canonical root.
 *
 * Absolute paths are rejected outright rather than checked: a tool contract
 * that says "project-relative" should not quietly accept `C:\Windows\System32`
 * because it happens to fail containment later.
 *
 * @param {string} canonicalRootPath  from canonicalRoot()
 * @param {string} requested          project-relative, untrusted
 * @returns {{absolute: string, relative: string}}
 */
export function resolveInRoot(canonicalRootPath, requested) {
  if (typeof requested !== "string" || requested.length === 0) {
    throw new PathEscape(String(requested), "no path was given");
  }
  // NUL and the other control characters truncate paths in some syscalls.
  if (/[\0-\x1f]/.test(requested)) {
    throw new PathEscape(requested, "the path contains control characters");
  }
  if (isAbsolute(requested) || /^[a-zA-Z]:/.test(requested)) {
    throw new PathEscape(requested, "an absolute path was given where a project-relative one is required");
  }
  // \\server\share and \\?\ bypass normalisation entirely.
  if (/^[\\/]{2}/.test(requested)) {
    throw new PathEscape(requested, "UNC and device paths are not project-relative");
  }

  const joined = resolve(canonicalRootPath, requested);
  const real = realpathDeepest(joined);

  const rel = relative(canonicalRootPath, real);
  if (rel === "") return { absolute: real, relative: "." };
  if (rel.startsWith("..") || isAbsolute(rel)) {
    // This is the case a lexical check misses: the string never said `..`, but
    // a junction or symlink in the middle of it landed outside the root.
    throw new PathEscape(requested, joined === real
      ? "it resolves above the root"
      : "a link in the path resolves outside the root");
  }
  return { absolute: real, relative: rel.split(sep).join("/") };
}

/**
 * Whether a real absolute path lies inside a canonical root. Used for results
 * that arrive already resolved, such as glob matches.
 * @param {string} canonicalRootPath
 * @param {string} absolute
 */
export function isInsideRoot(canonicalRootPath, absolute) {
  const rel = relative(canonicalRootPath, realpathDeepest(absolute));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Directories whose contents are generated and not worth a model's context. */
export const DEFAULT_IGNORES = [
  "node_modules", ".git", "dist", "build", "out", "target", ".next",
  ".venv", "venv", "__pycache__", ".cache", "coverage", ".vercel", ".turbo",
];

/** @param {string} relPath */
export const isIgnored = (relPath) =>
  relPath.split("/").some((seg) => DEFAULT_IGNORES.includes(seg));
