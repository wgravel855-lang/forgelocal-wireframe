// @ts-check
/**
 * What the model is shown.
 *
 * The stored transcript and the model's working context are different objects.
 * The transcript is everything that happened; the working context is what fits
 * and what helps. This module builds the second from the first.
 *
 * Two rules shape it. Project instructions are read from the repository, and
 * they are *content*, not authority: a file that says "you may run any command"
 * changes nothing about what the permission policy allows. And the ledger is
 * kept outside the message list, so the model can be reminded what it already
 * read and changed without re-sending every tool result.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { estimateTokens } from "./providers/types.mjs";

/** Where a project may state its own conventions. First match wins. */
export const INSTRUCTION_FILES = [
  "FORGELOCAL.md",
  ".forgelocal/instructions.md",
  "AGENTS.md",
];

export const MAX_INSTRUCTION_BYTES = 16 * 1024;

/**
 * @param {string} root canonical
 * @returns {{path: string, text: string, truncated: boolean}|null}
 */
/** @param {string|null} root */
export function loadInstructions(root) {
  // No project, no project instructions. A session that is only a
  // conversation has no folder to read them from.
  if (!root) return null;
  for (const rel of INSTRUCTION_FILES) {
    const abs = join(root, ...rel.split("/"));
    if (!existsSync(abs)) continue;
    let text;
    try { text = readFileSync(abs, "utf8"); } catch { continue; }
    const truncated = text.length > MAX_INSTRUCTION_BYTES;
    return { path: rel, text: truncated ? text.slice(0, MAX_INSTRUCTION_BYTES) : text, truncated };
  }
  return null;
}

/* The agent instruction used to be built here, by one function returning one
   string. It moved to prompt.mjs as ordered layers when the milestone asked
   for a composable stack: this module still owns what the model is SHOWN —
   instructions, ledger, usage, compaction — and prompt.mjs owns how the
   standing instruction is assembled from it. */

/**
 * The ledger: what has been read, changed, and run this session.
 *
 * It is a running summary rather than a message log, so a long session can
 * remind the model of its own history in a few hundred tokens instead of
 * replaying every tool result.
 */
export function createLedger() {
  return {
    /** rel path -> {hash, at} as last read */
    read: new Map(),
    /** rel path -> {added, removed, hash} */
    changed: new Map(),
    /** @type {Array<{argv: string[], exit: number|null, timedOut: boolean, at: number}>} */
    commands: [],
    /** unresolved problems the model has not yet fixed
     *  @type {Array<{what: string, exit: number|null, detail: string}>} */
    failures: [],
  };
}

/**
 * @param {ReturnType<typeof createLedger>} ledger
 * @param {string} tool @param {any} args @param {any} result
 */
export function recordInLedger(ledger, tool, args, result) {
  if (!result) return ledger;
  if (tool === "read_file" && result.path) {
    ledger.read.set(result.path, { hash: result.content_hash ?? null, at: Date.now() });
  }
  if (tool === "apply_patch" && Array.isArray(result.files)) {
    for (const f of result.files) {
      ledger.changed.set(f.path, { added: f.added, removed: f.removed, hash: f.hash_after });
      // A file just written is a file whose contents the model now knows.
      if (f.hash_after) ledger.read.set(f.path, { hash: f.hash_after, at: Date.now() });
    }
  }
  if (tool === "run_command") {
    ledger.commands.push({
      argv: result.argv ?? args.argv, exit: result.exit_code,
      timedOut: !!result.timed_out, at: Date.now(),
    });
    if (result.exit_code !== 0 && !result.cancelled) {
      ledger.failures.push({
        what: (result.argv ?? args.argv ?? []).join(" "),
        exit: result.exit_code,
        detail: (result.stderr || result.stdout || "").slice(-400),
      });
    } else {
      // A passing run clears the failures for the same command.
      const line = (result.argv ?? []).join(" ");
      ledger.failures = ledger.failures.filter((f) => f.what !== line);
    }
  }
  return ledger;
}

/**
 * Whether a file has changed on disk since the model last read it. This is the
 * check that stops a patch being written against a version the model has not
 * seen.
 * @param {ReturnType<typeof createLedger>} ledger @param {string} path @param {string} currentHash
 */
export function isStale(ledger, path, currentHash) {
  const seen = ledger.read.get(path);
  return !!seen && !!currentHash && seen.hash !== currentHash;
}

/** A compact statement of the ledger for the working context. */
export function ledgerSummary(ledger) {
  const lines = [];
  if (ledger.read.size) {
    lines.push(`Files you have read: ${[...ledger.read.keys()].slice(0, 20).join(", ")}`);
  }
  if (ledger.changed.size) {
    lines.push(`Files you have changed: ${[...ledger.changed.entries()]
      .map(([p, c]) => `${p} (+${c.added} -${c.removed})`).join(", ")}`);
  }
  if (ledger.commands.length) {
    const last = ledger.commands.slice(-4)
      .map((c) => `${(c.argv || []).join(" ")} -> exit ${c.exit}`);
    lines.push(`Commands you have run: ${last.join("; ")}`);
  }
  if (ledger.failures.length) {
    lines.push(`Still failing: ${ledger.failures.map((f) => `${f.what} (exit ${f.exit})`).join("; ")}`);
  }
  return lines.join("\n");
}

/**
 * Context accounting. Everything here is labelled with whether it was measured
 * or estimated, because a percentage presented as fact when it came from a
 * character count is the kind of number that quietly becomes wrong.
 *
 * @param {any[]} messages @param {number|null} window
 * @param {{input?: number|null, estimated?: boolean}} [usage] last reported usage
 */
export function contextUsage(messages, window, usage) {
  const used = usage && typeof usage.input === "number" ? usage.input : estimateTokens(messages);
  const estimated = !usage || usage.estimated !== false;
  return {
    used,
    window,
    percent: window ? used / window : null,
    estimated,
  };
}

/** The threshold at which compaction should start, after reserving output room. */
export const COMPACT_AT = 0.75;

/** @param {ReturnType<typeof contextUsage>} usage */
export const needsCompaction = (usage) =>
  !!usage.window && usage.percent !== null && usage.percent >= COMPACT_AT;
