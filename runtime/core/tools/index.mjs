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
};

export const TOOL_NAMES = Object.freeze(Object.keys(TOOLS));

/** Every registered tool must have a permission classification. */
for (const name of TOOL_NAMES) {
  if (!TOOL_EFFECTS[name]) {
    throw new Error(`Tool ${name} has no entry in TOOL_EFFECTS; it would be denied at runtime`);
  }
}

/**
 * The tool list in the shape an OpenAI-compatible server expects.
 * @returns {any[]}
 */
export function toolSpecs() {
  return TOOL_NAMES.map((name) => ({
    type: "function",
    function: {
      name,
      description: TOOLS[name].description,
      parameters: TOOLS[name].schema,
    },
  }));
}

/**
 * Validate a call without running it. Used before asking for permission, so
 * the user is never shown an approval prompt for arguments that cannot run.
 * @param {string} name @param {any} args
 * @returns {{ok: true} | {ok: false, errors: string[]}}
 */
export function validateCall(name, args) {
  const tool = TOOLS[name];
  if (!tool) {
    return { ok: false, errors: [`${name} is not a tool. Available: ${TOOL_NAMES.join(", ")}`] };
  }
  const result = validate(tool.schema, args ?? {});
  return result.ok ? { ok: true } : { ok: false, errors: result.errors };
}
