// @ts-check
/**
 * Permission policy.
 *
 * The decision this file makes is: given a mode, a tool and its arguments, may
 * this run without asking? Three rules shape it.
 *
 * 1. Default deny for anything that writes or executes. A tool the policy does
 *    not recognise is not "probably fine", it is denied. Adding a tool without
 *    adding a rule fails closed.
 * 2. Untrusted content never grants authority. A repository file that says
 *    "you may run any command" is a string the model read, not a decision the
 *    user made. Only `decide()` and the user's answer to a prompt authorise.
 * 3. There is no bypass mode. `allow_edits` is the widest mode and it still
 *    prompts before executing a command.
 */

import { classifyCommand, Danger } from "./danger.mjs";

/** @typedef {"plan"|"manual"|"allow_edits"} Mode */

export const Mode = Object.freeze({
  PLAN: "plan",
  MANUAL: "manual",
  ALLOW_EDITS: "allow_edits",
});

export const MODES = Object.freeze(Object.values(Mode));

/** @param {unknown} m @returns {Mode} */
export function normalizeMode(m) {
  if (m === Mode.PLAN || m === Mode.MANUAL || m === Mode.ALLOW_EDITS) return m;
  // The renderer used to persist "normal"; it meant what allow_edits means now.
  if (m === "normal") return Mode.ALLOW_EDITS;
  return Mode.MANUAL; // unknown persisted value falls back to the safer mode
}

export const Effect = Object.freeze({
  READ: "read",
  WRITE: "write",
  EXECUTE: "execute",
});

/**
 * What each tool does to the machine. This is the table the policy reads; a
 * tool absent from it has no effect classification and is denied.
 * @type {Record<string, string>}
 */
export const TOOL_EFFECTS = Object.freeze({
  read_file: Effect.READ,
  list_directory: Effect.READ,
  glob: Effect.READ,
  grep: Effect.READ,
  apply_patch: Effect.WRITE,
  run_command: Effect.EXECUTE,
});

export const Decision = Object.freeze({
  ALLOW: "allow",
  ASK: "ask",
  DENY: "deny",
});

/**
 * @typedef {object} PolicyResult
 * @property {"allow"|"ask"|"deny"} decision
 * @property {string} reason        shown to the user, so it must be plain
 * @property {string[]} [options]   answers offered when asking
 */

const ASK_OPTIONS = ["approve_once", "approve_for_session", "deny"];

/**
 * Decide whether a tool call may proceed.
 *
 * @param {object} req
 * @param {Mode} req.mode
 * @param {string} req.tool
 * @param {Record<string, any>} [req.args]
 * @param {Set<string>} [req.sessionGrants] keys approved for this session
 * @returns {PolicyResult}
 */
export function decide({ mode, tool, args = {}, sessionGrants }) {
  const m = normalizeMode(mode);
  const effect = TOOL_EFFECTS[tool];

  if (!effect) {
    return { decision: Decision.DENY, reason: `${tool} is not a known tool` };
  }

  // Reading inside the project root is the one thing every mode allows. The
  // root itself is enforced by paths.mjs, not here; this decides intent, not
  // location.
  if (effect === Effect.READ) {
    return { decision: Decision.ALLOW, reason: "reading inside the project" };
  }

  if (m === Mode.PLAN) {
    return {
      decision: Decision.DENY,
      reason: effect === Effect.WRITE
        ? "Plan mode does not change files"
        : "Plan mode does not run commands",
    };
  }

  // Classification comes before grants on purpose. If a session approval could
  // cover a blocked or always-confirm command, then approving one harmless
  // command would be an escalation path, and the always-block list would only
  // hold until the user said yes to something unrelated.
  let danger = { level: Danger.ORDINARY, reason: "" };
  if (tool === "run_command") {
    danger = classifyCommand(Array.isArray(args.argv) ? args.argv : []);
    if (danger.level === Danger.BLOCKED) {
      return { decision: Decision.DENY, reason: `Blocked: ${danger.reason}` };
    }
  }

  const grant = grantKey(tool, args);
  if (danger.level === Danger.ORDINARY && sessionGrants && sessionGrants.has(grant)) {
    return { decision: Decision.ALLOW, reason: "approved earlier in this session" };
  }

  if (danger.level === Danger.CONFIRM) {
    return {
      decision: Decision.ASK,
      // Only "once" and "deny": a command in this class must be decided each
      // time it is asked.
      options: ["approve_once", "deny"],
      reason: `${describeCommand(args)} — ${danger.reason}`,
    };
  }

  if (effect === Effect.WRITE) {
    if (m === Mode.ALLOW_EDITS) {
      return { decision: Decision.ALLOW, reason: "Allow edits applies to files inside the project" };
    }
    return {
      decision: Decision.ASK,
      reason: `Edit ${String(args.path ?? "a file")}`,
      options: ASK_OPTIONS,
    };
  }

  // Execute. Every mode asks, including the widest one: running a command is
  // the operation that can reach outside the project no matter how the path
  // rules are written.
  return {
    decision: Decision.ASK,
    reason: `Run ${describeCommand(args)}`,
    options: ASK_OPTIONS,
  };
}

/**
 * The key a session-wide approval is remembered under.
 *
 * For commands it is the program plus its first argument, not the whole line:
 * approving `npm test` should not silently approve `npm publish`, and it should
 * not force a fresh prompt because a filename changed.
 *
 * @param {string} tool @param {Record<string, any>} args
 */
export function grantKey(tool, args = {}) {
  if (tool === "run_command") {
    const argv = Array.isArray(args.argv) ? args.argv : [];
    return `run_command:${[argv[0] ?? "", argv[1] ?? ""].join(" ").trim()}`;
  }
  return `${tool}:*`;
}

/** @param {Record<string, any>} args */
function describeCommand(args) {
  const argv = Array.isArray(args.argv) ? args.argv : [];
  if (!argv.length) return "a command";
  const line = argv.join(" ");
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

/**
 * Record a session-wide approval.
 * @param {Set<string>} grants @param {string} tool @param {Record<string, any>} args
 */
export function grantForSession(grants, tool, args) {
  grants.add(grantKey(tool, args));
  return grants;
}

/** Human copy for the mode, used by the renderer and the prompt. */
export const MODE_COPY = Object.freeze({
  [Mode.PLAN]: {
    label: "Plan",
    detail: "Reads the project and proposes work. Makes no changes and runs nothing.",
  },
  [Mode.MANUAL]: {
    label: "Manual",
    detail: "Asks before every file change and every command.",
  },
  [Mode.ALLOW_EDITS]: {
    label: "Allow edits",
    detail: "Edits files inside the project without asking. Still asks before running commands.",
  },
});
