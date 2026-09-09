// @ts-check
/**
 * Command execution.
 *
 * Read this before trusting it: **this is permission-gated, not sandboxed.**
 * The child runs with the user's full privileges on the host. What this module
 * provides is a narrower surface, not isolation:
 *
 *   - argv arrays, never a shell string built from model output, so there is
 *     no quoting to get wrong and no injection point;
 *   - an environment allowlist, so a child never inherits provider keys;
 *   - a working directory that must resolve inside the trusted root;
 *   - a real timeout with process-tree termination, because killing a shell on
 *     Windows leaves its children running;
 *   - bounded, redacted output.
 *
 * OS-level isolation is a later milestone and is not claimed here.
 */

import { spawn } from "node:child_process";
import { assertStrictSchema } from "../schema.mjs";
import { resolveInRoot } from "../paths.mjs";
import { redact, childEnv } from "../secrets.mjs";

export const DEFAULT_TIMEOUT_MS = 120000;
export const MAX_TIMEOUT_MS = 600000;
export const MAX_OUTPUT_BYTES = 100 * 1024;

export const runCommandSchema = assertStrictSchema({
  type: "object",
  additionalProperties: false,
  required: ["argv", "purpose"],
  properties: {
    argv: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: { type: "string", maxLength: 2000 },
      description: "Program and arguments as separate strings. No shell is used, so no quoting or redirection.",
    },
    cwd: { type: "string", maxLength: 1024, description: "Working directory relative to the project root." },
    timeout_ms: { type: "integer", minimum: 1000, maximum: MAX_TIMEOUT_MS },
    purpose: {
      type: "string", minLength: 1, maxLength: 200,
      description: "One line explaining why, shown in the approval prompt.",
    },
    background: { type: "boolean", description: "Return a handle instead of waiting." },
  },
});

/**
 * @typedef {object} RunOptions
 * @property {(chunk: string, stream: "stdout"|"stderr") => void} [onOutput]
 * @property {AbortSignal} [signal]
 */

/**
 * @param {{root: string}} ctx
 * @param {{argv: string[], cwd?: string, timeout_ms?: number, purpose: string}} args
 * @param {RunOptions} [opts]
 */
export async function runCommand(ctx, args, opts = {}) {
  const cwd = args.cwd ? resolveInRoot(ctx.root, args.cwd).absolute : ctx.root;
  const timeout = Math.min(args.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const [exe, ...rest] = args.argv;
  const started = Date.now();

  const child = spawn(exe, rest, {
    cwd,
    env: childEnv(process.env, { cwd }),
    windowsHide: true,
    // No shell. The argv array is passed through, which is the whole point:
    // a model-authored string never reaches a command interpreter.
    shell: false,
  });

  let stdout = "";
  let stderr = "";
  let truncated = false;
  let timedOut = false;
  let cancelled = false;

  /** @param {"stdout"|"stderr"} name @param {Buffer} buf */
  const collect = (name, buf) => {
    const text = buf.toString("utf8");
    const total = stdout.length + stderr.length;
    if (total >= MAX_OUTPUT_BYTES) { truncated = true; return; }
    const room = MAX_OUTPUT_BYTES - total;
    const piece = text.length > room ? (truncated = true, text.slice(0, room)) : text;
    if (name === "stdout") stdout += piece; else stderr += piece;
    if (opts.onOutput) opts.onOutput(redact(piece), name);
  };

  child.stdout.on("data", (b) => collect("stdout", b));
  child.stderr.on("data", (b) => collect("stderr", b));

  // A child that unexpectedly reads stdin would otherwise wait forever.
  child.stdin.end();

  const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, timeout);

  const onAbort = () => { cancelled = true; killTree(child.pid); };
  if (opts.signal) {
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  /** @type {{code: number|null, signal: string|null, error?: Error}} */
  const outcome = await new Promise((resolve) => {
    child.on("error", (error) => resolve({ code: null, signal: null, error }));
    child.on("close", (code, signal) => resolve({ code, signal }));
  });

  clearTimeout(timer);
  if (opts.signal) opts.signal.removeEventListener("abort", onAbort);

  if (outcome.error) {
    const err = /** @type {any} */ (outcome.error);
    return {
      pid: null, argv: args.argv, cwd,
      exit_code: null, signal: null,
      stdout: "", stderr: "",
      duration_ms: Date.now() - started,
      truncated: false, timed_out: false, cancelled: false,
      failed_to_start: true,
      error: err.code === "ENOENT" ? `${exe} was not found on PATH` : err.message,
    };
  }

  return {
    pid: child.pid ?? null,
    argv: args.argv,
    cwd,
    exit_code: outcome.code,
    signal: outcome.signal,
    stdout: redact(stdout),
    stderr: redact(stderr),
    duration_ms: Date.now() - started,
    truncated,
    timed_out: timedOut,
    cancelled,
    failed_to_start: false,
    // A nonzero exit is reported, not thrown. grep, diff and test runners use
    // exit codes to mean "no match" and "some tests failed", and treating those
    // as runtime failures would make the model avoid the tools that answer its
    // questions.
    note: timedOut ? `Killed after ${timeout}ms.`
      : cancelled ? "Stopped."
      : truncated ? `Output was cut off at ${MAX_OUTPUT_BYTES} bytes.`
      : null,
  };
}

/**
 * Kill a process and everything it started.
 *
 * On Windows, `child.kill()` terminates only the direct child. A `cmd` or
 * `npm` wrapper leaves the real work running, which is how a "cancelled"
 * command keeps writing to the disk. `taskkill /T` walks the tree.
 *
 * @param {number|undefined} pid
 */
export function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" })
        .on("error", () => { try { process.kill(pid); } catch { /* already gone */ } });
    } catch {
      try { process.kill(pid); } catch { /* already gone */ }
    }
    return;
  }
  try { process.kill(-pid, "SIGKILL"); } catch {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
}
