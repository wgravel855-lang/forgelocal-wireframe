// @ts-check
/**
 * Read and search tools.
 *
 * Every one of these is bounded: a byte cap, a line cap, a result cap. An
 * unbounded read is not a correctness problem, it is a context problem, and a
 * model that spends its window on a minified bundle cannot finish the task.
 * Truncation is always reported, never silent.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import { resolveInRoot, isIgnored, DEFAULT_IGNORES } from "../paths.mjs";
import { assertStrictSchema } from "../schema.mjs";
import { redact } from "../secrets.mjs";

/** Caps. Deliberately small: they protect the model's context, not the disk. */
export const LIMITS = Object.freeze({
  FILE_BYTES: 256 * 1024,
  FILE_LINES: 2000,
  DIR_ENTRIES: 300,
  GLOB_RESULTS: 300,
  GREP_RESULTS: 200,
  GREP_FILE_BYTES: 2 * 1024 * 1024,
  MATCH_CONTEXT: 240,
  WALK_ENTRIES: 20000,
});

const hash = (buf) => `sha256:${createHash("sha256").update(buf).digest("hex").slice(0, 16)}`;

/** Shared by every tool that names a file. */
const pathProp = {
  type: "string",
  minLength: 1,
  maxLength: 1024,
  description: "Path relative to the project root. Absolute paths are refused.",
};

export const readFileSchema = assertStrictSchema({
  type: "object",
  additionalProperties: false,
  required: ["path"],
  properties: {
    path: pathProp,
    start_line: { type: "integer", minimum: 1, description: "First line to return, 1-based." },
    end_line: { type: "integer", minimum: 1, description: "Last line to return, inclusive." },
  },
});

/**
 * @param {{root: string}} ctx
 * @param {{path: string, start_line?: number, end_line?: number}} args
 */
export function readFile(ctx, args) {
  const { absolute, relative: rel } = resolveInRoot(ctx.root, args.path);
  const st = statSync(absolute);
  if (st.isDirectory()) {
    throw Object.assign(new Error(`${rel} is a directory`), { code: "EISDIR" });
  }

  const raw = readFileSync(absolute);
  const contentHash = hash(raw);

  // A NUL in the first block is the practical test for "this is not text".
  // Returning binary as mojibake wastes context and teaches the model nothing.
  if (raw.subarray(0, 8000).includes(0)) {
    return {
      path: rel, binary: true, bytes: st.size, content: null,
      content_hash: contentHash, truncated: false,
      note: "Binary file. Contents were not read.",
    };
  }

  const overBytes = raw.length > LIMITS.FILE_BYTES;
  const text = raw.subarray(0, LIMITS.FILE_BYTES).toString("utf8");
  const allLines = text.split(/\r?\n/);
  const totalLines = overBytes ? null : allLines.length;

  const start = Math.max(1, args.start_line ?? 1);
  const requestedEnd = args.end_line ?? start + LIMITS.FILE_LINES - 1;
  const end = Math.min(requestedEnd, start + LIMITS.FILE_LINES - 1, allLines.length);
  if (start > allLines.length) {
    return {
      path: rel, binary: false, content: "", start_line: start, end_line: start - 1,
      total_lines: totalLines, content_hash: contentHash, truncated: false,
      note: `File has ${allLines.length} lines.`,
    };
  }

  const slice = allLines.slice(start - 1, end);
  const truncated = overBytes || end < allLines.length || start > 1;

  return {
    path: rel,
    binary: false,
    content: redact(slice.join("\n")),
    start_line: start,
    end_line: end,
    total_lines: totalLines,
    bytes: st.size,
    content_hash: contentHash,
    truncated,
    note: overBytes
      ? `File exceeds ${LIMITS.FILE_BYTES} bytes and was cut short.`
      : truncated ? `Lines ${start}-${end} of ${allLines.length}.` : null,
  };
}

export const listDirectorySchema = assertStrictSchema({
  type: "object",
  additionalProperties: false,
  properties: {
    path: { ...pathProp, description: "Directory relative to the project root. Defaults to the root." },
    depth: { type: "integer", minimum: 1, maximum: 5, description: "How many levels to descend. Default 1." },
    limit: { type: "integer", minimum: 1, maximum: 300, description: "Maximum entries to return." },
  },
});

/**
 * @param {{root: string}} ctx
 * @param {{path?: string, depth?: number, limit?: number}} args
 */
export function listDirectory(ctx, args = {}) {
  const { absolute, relative: rel } = resolveInRoot(ctx.root, args.path || ".");
  const depth = Math.min(args.depth ?? 1, 5);
  const limit = Math.min(args.limit ?? LIMITS.DIR_ENTRIES, LIMITS.DIR_ENTRIES);

  /** @type {any[]} */
  const entries = [];
  let omitted = 0;
  let ignored = 0;

  /** @param {string} dir @param {string} prefix @param {number} left */
  const walk = (dir, prefix, left) => {
    /** @type {import("node:fs").Dirent[]} */
    let items;
    try {
      items = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      // A directory the user cannot read is a fact to report, not a crash.
      entries.push({ path: prefix.replace(/\/$/, ""), type: "unreadable", note: String(e.code ?? "EACCES") });
      return;
    }
    items.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const it of items) {
      const childRel = `${prefix}${it.name}`;
      if (isIgnored(childRel)) { ignored++; continue; }
      if (entries.length >= limit) { omitted++; continue; }
      const isDir = it.isDirectory();
      const row = { path: childRel, type: isDir ? "dir" : "file" };
      if (!isDir) {
        try { row.bytes = statSync(join(dir, it.name)).size; } catch { row.bytes = null; }
      }
      entries.push(row);
      if (isDir && left > 1) walk(join(dir, it.name), `${childRel}/`, left - 1);
    }
  };

  walk(absolute, rel === "." ? "" : `${rel}/`, depth);

  return {
    path: rel, entries, count: entries.length,
    omitted, ignored, ignored_names: DEFAULT_IGNORES,
    truncated: omitted > 0,
    note: omitted > 0 ? `${omitted} more entries were omitted by the limit.` : null,
  };
}

export const globSchema = assertStrictSchema({
  type: "object",
  additionalProperties: false,
  required: ["pattern"],
  properties: {
    pattern: {
      type: "string", minLength: 1, maxLength: 300,
      description: "Glob such as src/**/*.mjs. * and ? do not cross /, ** does.",
    },
    path: { ...pathProp, description: "Directory to search from. Defaults to the project root." },
    limit: { type: "integer", minimum: 1, maximum: 300 },
    include_ignored: {
      type: "boolean",
      description: "Search generated directories too. Off by default.",
    },
  },
});

/**
 * @param {{root: string}} ctx
 * @param {{pattern: string, path?: string, limit?: number, include_ignored?: boolean}} args
 */
export function glob(ctx, args) {
  const base = resolveInRoot(ctx.root, args.path || ".");
  const limit = Math.min(args.limit ?? LIMITS.GLOB_RESULTS, LIMITS.GLOB_RESULTS);
  const re = globToRegExp(args.pattern);

  const matches = [];
  let omitted = 0;
  for (const rel of walkFiles(base.absolute, ctx.root, !!args.include_ignored)) {
    const against = base.relative === "." ? rel : rel.slice(base.relative.length + 1);
    if (!re.test(against)) continue;
    if (matches.length >= limit) { omitted++; continue; }
    matches.push(rel);
  }
  matches.sort();

  return {
    pattern: args.pattern, matches, count: matches.length,
    omitted, truncated: omitted > 0,
    note: matches.length === 0 ? "No files matched." : null,
  };
}

export const grepSchema = assertStrictSchema({
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string", minLength: 1, maxLength: 500, description: "Regular expression." },
    path: { ...pathProp, description: "Directory or file to search. Defaults to the project root." },
    glob: { type: "string", maxLength: 300, description: "Only search files matching this glob." },
    case_sensitive: { type: "boolean", description: "Default false." },
    limit: { type: "integer", minimum: 1, maximum: 200 },
    include_ignored: { type: "boolean" },
  },
});

/**
 * No match is a result, not a failure. A tool that throws on "nothing found"
 * teaches the model that searching is risky.
 *
 * @param {{root: string}} ctx
 * @param {{query: string, path?: string, glob?: string, case_sensitive?: boolean, limit?: number, include_ignored?: boolean}} args
 */
export function grep(ctx, args) {
  const base = resolveInRoot(ctx.root, args.path || ".");
  const limit = Math.min(args.limit ?? LIMITS.GREP_RESULTS, LIMITS.GREP_RESULTS);

  let re;
  try {
    re = new RegExp(args.query, args.case_sensitive ? "" : "i");
  } catch (e) {
    // An invalid pattern is the model's mistake to correct, so say what broke.
    throw Object.assign(new Error(`Invalid search pattern: ${e.message}`), { code: "BAD_PATTERN" });
  }
  const nameFilter = args.glob ? globToRegExp(args.glob) : null;

  let files;
  try {
    files = statSync(base.absolute).isFile()
      ? [base.relative]
      : [...walkFiles(base.absolute, ctx.root, !!args.include_ignored)];
  } catch {
    files = [];
  }

  const results = [];
  let omitted = 0;
  let scanned = 0;

  for (const rel of files) {
    if (nameFilter && !nameFilter.test(rel)) continue;
    const abs = join(ctx.root, ...rel.split("/"));
    let raw;
    try {
      if (statSync(abs).size > LIMITS.GREP_FILE_BYTES) continue;
      raw = readFileSync(abs);
    } catch { continue; }
    if (raw.subarray(0, 8000).includes(0)) continue; // binary
    scanned++;

    const lines = raw.toString("utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      if (results.length >= limit) { omitted++; continue; }
      const text = lines[i].trim();
      results.push({
        path: rel,
        line: i + 1,
        text: redact(text.length > LIMITS.MATCH_CONTEXT
          ? `${text.slice(0, LIMITS.MATCH_CONTEXT)}...`
          : text),
      });
    }
  }

  return {
    query: args.query, matches: results, count: results.length,
    files_scanned: scanned, omitted, truncated: omitted > 0,
    note: results.length === 0 ? "No matches." : null,
  };
}

/**
 * Walk files under a directory, yielding project-relative paths.
 * Bounded by WALK_ENTRIES so a pathological tree cannot hang a turn.
 * @param {string} dir @param {string} root @param {boolean} includeIgnored
 */
function* walkFiles(dir, root, includeIgnored) {
  let budget = LIMITS.WALK_ENTRIES;
  const stack = [dir];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (budget-- <= 0) return;
    let items;
    try { items = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const it of items) {
      const abs = join(cur, it.name);
      const rel = relative(root, abs).split(sep).join("/");
      if (!includeIgnored && isIgnored(rel)) continue;
      if (it.isSymbolicLink()) continue; // containment is decided by realpath, and a link out is not followed here
      if (it.isDirectory()) {
        if (seen.has(abs)) continue;
        seen.add(abs);
        stack.push(abs);
      } else if (it.isFile()) {
        yield rel;
      }
    }
  }
}

/**
 * Translate a glob to a regular expression.
 * `**` crosses directory separators; `*` and `?` do not.
 * @param {string} pattern
 */
export function globToRegExp(pattern) {
  let out = "";
  let braces = 0; // a comma only means alternation inside {a,b}
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` should also match zero directories, so a/**/b matches a/b
        if (pattern[i + 2] === "/") { out += "(?:[^/]*(?:/|$))*"; i += 2; }
        else { out += ".*"; i += 1; }
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === "{") { braces++; out += "(?:"; }
    else if (c === "}" && braces > 0) { braces--; out += ")"; }
    else if (c === "," && braces > 0) out += "|";
    else out += escapeLiteral(c);
  }
  return new RegExp(`^${out}$`);
}

/** @param {string} c */
function escapeLiteral(c) {
  return /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
}
