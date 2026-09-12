// @ts-check
/**
 * The tool registry.
 *
 * One place that knows every tool, its schema, and how to run it. The
 * orchestrator never reaches past this: a tool the registry does not list
 * cannot be called, and a call whose arguments fail the schema never reaches
 * an implementation.
 */

import { validate } from "../schema.mjs";
import { TOOL_EFFECTS } from "../permissions.mjs";
import {
  readFile, readFileSchema,
  listDirectory, listDirectorySchema,
  glob, globSchema,
  grep, grepSchema,
} from "./read.mjs";
import { applyPatch, applyPatchSchema } from "./patch.mjs";
import { runCommand, runCommandSchema } from "./command.mjs";
import { updatePlan, updatePlanSchema, askUser, askUserSchema } from "./plan.mjs";

/**
 * @typedef {object} ToolDef
 * @property {string} name
 * @property {string} description  what the model is told
 * @property {any} schema
 * @property {(ctx: any, args: any, opts?: any) => any} run
 * @property {boolean} [streams]   emits tool_output_delta while running
 */

/** @type {Record<string, ToolDef>} */
export const TOOLS = {
  read_file: {
    name: "read_file",
    description:
      "Read a text file from the project. Returns content with line numbers available, "
      + "the total line count and a content hash. Use the hash with apply_patch to be sure "
      + "the file has not changed since you read it.",
    schema: readFileSchema,
    run: readFile,
  },
  list_directory: {
    name: "list_directory",
    description:
      "List files and folders. Generated directories such as node_modules and .git are "
      + "skipped and the count of skipped entries is reported.",
    schema: listDirectorySchema,
    run: listDirectory,
  },
  glob: {
    name: "glob",
    description: "Find files by path pattern, for example src/**/*.mjs. Returns matching paths.",
    schema: globSchema,
    run: glob,
  },
  grep: {
    name: "grep",
    description:
      "Search file contents with a regular expression. Returns file, line number and the "
      + "matching line. Finding nothing is a normal result.",
    schema: grepSchema,
    run: grep,
  },
  apply_patch: {
    name: "apply_patch",
    description:
      "Change files with structured edits. Each edit names a path and an operation: replace "
      + "(exact text, which must occur once), create, delete, or replace_file. All edits apply "
      + "together or none do. Pass expected_hash to refuse the edit if the file changed.",
    schema: applyPatchSchema,
    run: applyPatch,
  },
  run_command: {
    name: "run_command",
    description:
      "Run a program. Pass the program and each argument as separate strings in argv; there is "
      + "no shell, so pipes, redirection and quoting do not apply. State the purpose in one line. "
      + "A nonzero exit code is returned as a result, not an error.",
    schema: runCommandSchema,
    run: runCommand,
    streams: true,
  },
  update_plan: {
    name: "update_plan",
    description:
      "Record the plan for a multi-step task. Send every step each time, with one marked "
      + "active. Use it before starting work and again whenever a step finishes or blocks. "
      + "Skip it for a task that is a single step.",
    schema: updatePlanSchema,
    run: updatePlan,
  },
  ask_user: {
    name: "ask_user",
    description:
      "Stop and ask the person one question. Use it only when the answer cannot be found by "
      + "reading the project and choosing wrong would waste the work. The turn pauses until "
      + "they reply.",
    schema: askUserSchema,
    run: askUser,
  },
};

/**
 * Tool groups.
 *
 * A local model given forty schemas answers worse than the same model given
 * eight: the catalogue is spent context and every extra name is another way to
 * pick wrong. So the registry knows which group a tool belongs to, and a
 * session enables the groups the task needs. The four base groups are always
 * on; web and browser are opt-in per session.
 */
export const ToolGroup = Object.freeze({
  READ: "read",
  EDIT: "edit",
  COMMAND: "command",
  PLAN: "plan",
  WEB: "web",
  BROWSER: "browser",
});

/** The groups a session gets when it asks for nothing in particular. */
export const DEFAULT_GROUPS = Object.freeze([
  ToolGroup.READ, ToolGroup.EDIT, ToolGroup.COMMAND, ToolGroup.PLAN,
]);

/**
 * Which group each tool belongs to.
 *
 * Kept as a map beside the registry rather than a field on each entry, so the
 * grouping can be read in one glance and the completeness check below is a
 * loop rather than eight separate omissions waiting to happen.
 * @type {Record<string, string>}
 */
export const TOOL_GROUPS = {
  read_file: ToolGroup.READ,
  list_directory: ToolGroup.READ,
  glob: ToolGroup.READ,
  grep: ToolGroup.READ,
  apply_patch: ToolGroup.EDIT,
  run_command: ToolGroup.COMMAND,
  update_plan: ToolGroup.PLAN,
  ask_user: ToolGroup.PLAN,
};

/** One line per tool, for the prompt's TOOLS layer. */
export const TOOL_SUMMARIES = {
  read_file: "Read a file, with a hash you can pass to apply_patch",
  list_directory: "List a folder, generated directories skipped",
  glob: "Find files by path pattern",
  grep: "Search file contents by regular expression",
  apply_patch: "Change files. Checkpointed, so it can be undone",
  run_command: "Run a command in the project. Always asks first",
  update_plan: "Post or revise the plan. Send the whole list every time",
  ask_user: "Stop and ask a structured question. The turn pauses",
};

export const TOOL_NAMES = Object.freeze(Object.keys(TOOLS));

/**
 * Every registered tool must have a permission classification, a group and a
 * summary. All three are how a tool becomes visible to the model, and a tool
 * that is visible without a classification would be denied at runtime after
 * the user had already been asked about it.
 */
for (const name of TOOL_NAMES) {
  if (!TOOL_EFFECTS[name]) {
    throw new Error(`Tool ${name} has no entry in TOOL_EFFECTS; it would be denied at runtime`);
  }
  if (!TOOL_GROUPS[name]) {
    throw new Error(`Tool ${name} has no group; it would never be offered to a model`);
  }
  if (!TOOL_SUMMARIES[name]) {
    throw new Error(`Tool ${name} has no summary; the prompt's tool list would be incomplete`);
  }
}

/**
 * Keywords that are load-bearing for validation but ruinous on the wire.
 *
 * A local server builds a GBNF grammar from the tool schemas to constrain the
 * model's output, and a length bound becomes a bounded repetition in that
 * grammar: `maxLength: 500000` on apply_patch's `content` is half a million
 * alternatives. Sent together, the eight tools produced
 * "Failed to initialize samplers: failed to parse grammar" and then killed the
 * inference engine outright.
 *
 * So the wire schema drops the size and range bounds and keeps the shape. This
 * costs nothing in safety: the grammar is guidance for the model, while
 * validateCall() below still checks the full strict schema before anything
 * runs, and that is the check that actually gates execution.
 */
const WIRE_STRIP = new Set([
  "minLength", "maxLength", "minimum", "maximum",
  "minItems", "maxItems", "pattern",
]);

/** @param {any} schema */
function wireSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  /** @type {any} */
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (WIRE_STRIP.has(k)) continue;
    if (k === "properties") {
      out.properties = Object.fromEntries(
        Object.entries(v).map(([name, sub]) => [name, wireSchema(sub)]),
      );
    } else if (k === "items") {
      out.items = wireSchema(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Which tools are enabled, and their names in registry order.
 * @param {readonly string[]} groups
 * @returns {string[]}
 */
export function namesInGroups(groups = DEFAULT_GROUPS) {
  const want = new Set(groups);
  return TOOL_NAMES.filter((n) => want.has(TOOL_GROUPS[n]));
}

/**
 * The one-line-per-tool list the prompt's TOOLS layer renders.
 * @param {readonly string[]} groups
 * @returns {Array<{name: string, summary: string, group: string}>}
 */
export function toolSummaries(groups = DEFAULT_GROUPS) {
  return namesInGroups(groups).map((name) => ({
    name, summary: TOOL_SUMMARIES[name], group: TOOL_GROUPS[name],
  }));
}

/**
 * The tool list in the shape an OpenAI-compatible server expects, limited to
 * the enabled groups.
 * @param {readonly string[]} groups
 * @returns {any[]}
 */
export function toolSpecs(groups = DEFAULT_GROUPS) {
  return namesInGroups(groups).map((name) => ({
    type: "function",
    function: {
      name,
      description: TOOLS[name].description,
      parameters: wireSchema(TOOLS[name].schema),
    },
  }));
}

/**
 * Validate a call without running it. Used before asking for permission, so
 * the user is never shown an approval prompt for arguments that cannot run.
 * @param {string} name @param {any} args
 * @returns {{ok: true} | {ok: false, errors: string[]}}
 */
export function validateCall(name, args, groups = DEFAULT_GROUPS) {
  const tool = TOOLS[name];
  const enabled = namesInGroups(groups);
  if (!tool) {
    return { ok: false, errors: [`${name} is not a tool. Available: ${enabled.join(", ")}`] };
  }
  if (!enabled.includes(name)) {
    return {
      ok: false,
      errors: [`${name} exists but is not enabled for this session. Available: ${enabled.join(", ")}`],
    };
  }
  const result = validate(tool.schema, args ?? {});
  return result.ok ? { ok: true } : { ok: false, errors: result.errors };
}
