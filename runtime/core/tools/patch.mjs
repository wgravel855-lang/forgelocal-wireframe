// @ts-check
/**
 * The editing tool.
 *
 * Structured edits rather than a shell command, for three reasons the brief
 * names and one it implies: they are reviewable before they run, reversible
 * after, verifiable against a hash, and they cannot become a command injection
 * because no string is ever handed to a shell.
 *
 * The operation is all-or-nothing. A patch with four hunks where the third
 * does not match leaves the file untouched and reports which hunk failed. A
 * half-applied edit is worse than a rejected one: the model cannot tell what
 * state it is now in.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { resolveInRoot } from "../paths.mjs";
import { assertStrictSchema } from "../schema.mjs";

export const hashOf = (text) =>
  `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex").slice(0, 16)}`;

export const MAX_PATCH_BYTES = 512 * 1024;
export const MAX_FILES = 20;

export class PatchConflict extends Error {
  /** @param {string} message @param {object} detail */
  constructor(message, detail) {
    super(message);
    this.name = "PatchConflict";
    this.code = "PATCH_CONFLICT";
    Object.assign(this, detail);
  }
}

const editSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "operation"],
  properties: {
    path: { type: "string", minLength: 1, maxLength: 1024, description: "Project-relative path." },
    operation: {
      type: "string",
      enum: ["replace", "create", "delete", "replace_file"],
      description: "replace swaps exact text; create writes a new file; delete removes one; replace_file overwrites.",
    },
    find: {
      type: "string", maxLength: 100000,
      description: "For replace: the exact existing text, including indentation. Must occur exactly once.",
    },
    replace: { type: "string", maxLength: 100000, description: "Replacement text." },
    content: { type: "string", maxLength: 500000, description: "For create and replace_file." },
    expected_hash: {
      type: "string", maxLength: 80,
      description: "If given, the edit is refused unless the file still hashes to this.",
    },
  },
};

export const applyPatchSchema = assertStrictSchema({
  type: "object",
  additionalProperties: false,
  required: ["edits"],
  properties: {
    edits: { type: "array", minItems: 1, maxItems: MAX_FILES, items: editSchema },
    description: { type: "string", maxLength: 300, description: "One line on what this change does." },
  },
});

/**
 * @typedef {object} PatchResult
 * @property {any[]} files    one entry per changed file
 * @property {any[]} rejected hunks that did not apply
 * @property {number} added
 * @property {number} removed
 * @property {string|null} snapshot_id
 */

/**
 * @param {{root: string, snapshotDir?: string}} ctx
 * @param {{edits: any[], description?: string}} args
 * @returns {PatchResult}
 */
export function applyPatch(ctx, args) {
  const edits = args.edits;
  const total = edits.reduce((n, e) => n + (e.replace?.length ?? 0) + (e.content?.length ?? 0), 0);
  if (total > MAX_PATCH_BYTES) {
    throw Object.assign(new Error(`Patch is larger than ${MAX_PATCH_BYTES} bytes`), { code: "PATCH_TOO_LARGE" });
  }

  // Phase one: resolve, verify and compute every result without writing.
  // Nothing touches the disk until every edit is known to apply.
  /** @type {any[]} */
  const planned = [];
  /** @type {any[]} */
  const rejected = [];

  edits.forEach((edit, i) => {
    const { absolute, relative: rel } = resolveInRoot(ctx.root, edit.path);
    const exists = existsSync(absolute) && statSync(absolute).isFile();
    const before = exists ? readFileSync(absolute, "utf8") : null;
    const beforeHash = before === null ? null : hashOf(before);

    if (edit.expected_hash && beforeHash !== edit.expected_hash) {
      rejected.push({
        index: i, path: rel, reason: exists
          ? "the file changed since it was read"
          : "the file does not exist",
        expected_hash: edit.expected_hash, actual_hash: beforeHash,
      });
      return;
    }

    if (edit.operation === "create") {
      if (exists) {
        rejected.push({ index: i, path: rel, reason: "the file already exists" });
        return;
      }
      if (typeof edit.content !== "string") {
        rejected.push({ index: i, path: rel, reason: "create needs content" });
        return;
      }
      planned.push({ path: rel, absolute, before: null, after: edit.content, change: "created" });
      return;
    }

    if (!exists) {
      rejected.push({ index: i, path: rel, reason: "the file does not exist" });
      return;
    }

    if (edit.operation === "delete") {
      planned.push({ path: rel, absolute, before, after: null, change: "deleted" });
      return;
    }

    if (edit.operation === "replace_file") {
      if (typeof edit.content !== "string") {
        rejected.push({ index: i, path: rel, reason: "replace_file needs content" });
        return;
      }
      planned.push({ path: rel, absolute, before, after: edit.content, change: "modified" });
      return;
    }

    // replace
    if (typeof edit.find !== "string" || edit.find.length === 0) {
      rejected.push({ index: i, path: rel, reason: "replace needs the exact text to find" });
      return;
    }
    if (typeof edit.replace !== "string") {
      rejected.push({ index: i, path: rel, reason: "replace needs replacement text" });
      return;
    }

    // Later edits in the same call must see earlier ones, or two edits to one
    // file would silently drop the first.
    const pending = planned.filter((p) => p.path === rel).pop();
    const source = pending ? pending.after : before;
    if (source === null) {
      rejected.push({ index: i, path: rel, reason: "the file was deleted earlier in this patch" });
      return;
    }

    const occurrences = countOccurrences(source, edit.find);
    if (occurrences === 0) {
      rejected.push({
        index: i, path: rel,
        reason: "the text to replace was not found",
        hint: nearestHint(source, edit.find),
      });
      return;
    }
    if (occurrences > 1) {
      // Ambiguity is refused rather than resolved by picking the first: the
      // model gets to say which one it meant by including more context.
      rejected.push({
        index: i, path: rel,
        reason: `the text to replace occurs ${occurrences} times; include more surrounding lines to make it unique`,
      });
      return;
    }

    const after = source.replace(edit.find, () => edit.replace);
    if (pending) pending.after = after;
    else planned.push({ path: rel, absolute, before, after, change: "modified" });
  });

  if (rejected.length) {
    throw new PatchConflict(
      `${rejected.length} of ${edits.length} edit(s) did not apply; no file was changed`,
      { rejected, files: [], added: 0, removed: 0 },
    );
  }

  // Phase two: snapshot, then write.
  const snapshotId = snapshot(ctx, planned);

  /** @type {any[]} */
  const files = [];
  let added = 0;
  let removed = 0;

  for (const p of planned) {
    if (p.after === null) {
      rmSync(p.absolute);
    } else {
      mkdirSync(dirname(p.absolute), { recursive: true });
      writeFileSync(p.absolute, p.after, "utf8");
    }
    const counts = lineDelta(p.before, p.after);
    added += counts.added;
    removed += counts.removed;
    files.push({
      path: p.path, change: p.change,
      added: counts.added, removed: counts.removed,
      hash_before: p.before === null ? null : hashOf(p.before),
      hash_after: p.after === null ? null : hashOf(p.after),
    });
  }

  return { files, rejected: [], added, removed, snapshot_id: snapshotId };
}

/**
 * Copy every affected file's prior content aside before mutating, so a
 * checkpoint can restore it. Files that did not exist are recorded as absent,
 * which is what makes "undo a create" possible.
 * @param {{root: string, snapshotDir?: string}} ctx
 * @param {any[]} planned
 */
function snapshot(ctx, planned) {
  if (!ctx.snapshotDir) return null;
  const id = `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(ctx.snapshotDir, id);
  mkdirSync(dir, { recursive: true });
  const manifest = planned.map((p, i) => {
    const file = `${i}.bin`;
    if (p.before !== null) writeFileSync(join(dir, file), p.before, "utf8");
    return {
      path: p.path, change: p.change,
      existed: p.before !== null,
      file: p.before !== null ? file : null,
      hash: p.before === null ? null : hashOf(p.before),
    };
  });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ id, at: Date.now(), files: manifest }, null, 2), "utf8");
  return id;
}

/**
 * Restore a snapshot. This is the mechanism a checkpoint restore uses; it is
 * not wired to a UI control yet, and nothing claims it is.
 * @param {{root: string, snapshotDir: string}} ctx @param {string} id
 */
export function restoreSnapshot(ctx, id) {
  const dir = join(ctx.snapshotDir, id);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const restored = [];
  for (const entry of manifest.files) {
    const { absolute } = resolveInRoot(ctx.root, entry.path);
    if (entry.existed) {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, readFileSync(join(dir, entry.file)));
    } else if (existsSync(absolute)) {
      rmSync(absolute);
    }
    restored.push(entry.path);
  }
  return { snapshot_id: id, restored };
}

/** @param {string} haystack @param {string} needle */
function countOccurrences(haystack, needle) {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) { n++; i = haystack.indexOf(needle, i + needle.length); }
  return n;
}

/**
 * When a find fails, the usual cause is whitespace. Say so if that is what it
 * is, rather than making the model guess by re-reading the file.
 * @param {string} source @param {string} find
 */
function nearestHint(source, find) {
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  if (norm(source).includes(norm(find))) {
    return "The text is present but the whitespace or indentation differs. Read the file and copy the exact lines.";
  }
  const firstLine = find.split("\n")[0].trim();
  if (firstLine && source.includes(firstLine)) {
    return `The first line was found but the rest did not match. Re-read around "${firstLine.slice(0, 60)}".`;
  }
  return null;
}

/** @param {string|null} before @param {string|null} after */
function lineDelta(before, after) {
  const a = before === null ? [] : before.split("\n");
  const b = after === null ? [] : after.split("\n");
  // A shared prefix and suffix gives an honest count for ordinary edits
  // without pulling in a diff algorithm this milestone does not need.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  return { added: Math.max(0, endB - start + 1), removed: Math.max(0, endA - start + 1) };
}
