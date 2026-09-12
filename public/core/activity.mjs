// @ts-check
/**
 * Turning the runtime's event stream into transcript rows.
 *
 * The runtime emits one event per thing that happened. A transcript that drew
 * one row per event would be a log, not a summary: four reads in a row are one
 * step of work, and the interface should say "Read 4 files" while still being
 * able to name them when asked.
 *
 * Three rules decide the grouping, and the third is the one that matters:
 *
 *   - consecutive calls of the same *kind* collapse into one row
 *   - a patch is its own row, because a change deserves to be seen
 *   - anything that failed, was denied, or is waiting NEVER collapses
 *
 * That last rule is why grouping is safe. A collapsed group can hide detail; it
 * must never hide a problem.
 */

/** How a tool's activity is grouped and titled. */
const KIND = {
  read_file: "read",
  list_directory: "read",
  glob: "search",
  grep: "search",
  apply_patch: "edit",
  run_command: "command",
  update_plan: "plan",
  ask_user: "question",
};

/** Rows in these states stand alone, always. */
const STANDALONE = new Set(["failed", "denied", "awaiting_permission", "cancelled", "running", "requested"]);

/**
 * @typedef {object} ActivityRow
 * @property {string} kind        read | search | edit | command | plan | question
 * @property {string} label       what the collapsed row says
 * @property {string} status      completed | failed | running | denied | awaiting_permission | cancelled
 * @property {any[]} calls        the tool rows behind it, for expansion
 * @property {boolean} grouped    true when it stands for more than one call
 */

/**
 * Group a run of tool rows from the event reducer's transcript.
 * @param {any[]} rows  rows where kind === "tool"
 * @returns {ActivityRow[]}
 */
export function groupActivity(rows) {
  /** @type {ActivityRow[]} */
  const out = [];

  for (const row of rows) {
    const kind = KIND[row.tool] ?? "other";
    const solo = STANDALONE.has(row.status);
    const last = out[out.length - 1];

    // A command is always its own row: two different commands are two different
    // things, and the output of each is worth keeping separate.
    const canJoin = !solo
      && last
      && last.kind === kind
      && !STANDALONE.has(last.status)
      && kind !== "command"
      && kind !== "question";

    if (canJoin) {
      last.calls.push(row);
      last.grouped = true;
      last.label = labelFor(kind, last.calls);
      last.status = worstOf(last.calls);
      continue;
    }
    out.push({
      kind,
      calls: [row],
      grouped: false,
      label: labelFor(kind, [row]),
      status: row.status,
    });
  }
  return out;
}

/** The one line a collapsed row shows. */
export function labelFor(kind, calls) {
  const n = calls.length;
  const first = calls[0] ?? {};
  const args = first.args ?? {};

  switch (kind) {
    case "read": {
      if (n === 1) {
        const path = args.path;
        return path && first.tool === "read_file" ? `Read ${path}` : `Read ${path || "the project"}`;
      }
      return `Read ${n} files`;
    }
    case "search": {
      if (n === 1) {
        if (first.tool === "grep") return `Searched for ${trim(args.query, 40)}`;
        return `Found files matching ${trim(args.pattern, 40)}`;
      }
      return `Searched ${n} times`;
    }
    case "edit": {
      const files = calls.flatMap((c) => (c.args?.edits ?? []).map((e) => e.path));
      const unique = [...new Set(files)];
      if (unique.length === 1) return `Edited ${unique[0]}`;
      return `Edited ${unique.length} files`;
    }
    case "command": {
      const argv = args.argv ?? [];
      const line = argv.join(" ");
      // The exit code belongs in the label once it is known, because that is
      // the fact the reader wants and the model is not allowed to summarise.
      if (first.status === "completed" && first.result && typeof first.result.exit_code === "number") {
        return `${trim(line, 48)} — exit ${first.result.exit_code}`;
      }
      if (first.status === "running") return `Running ${trim(line, 48)}`;
      return trim(line, 56) || "a command";
    }
    case "plan":
      return "Updated the plan";
    case "question":
      return trim(args.question, 60) || "Asked a question";
    default:
      return first.tool ?? "Worked";
  }
}

/** A group is only as healthy as its unhealthiest member. */
function worstOf(calls) {
  const order = ["failed", "denied", "cancelled", "awaiting_permission", "running", "requested", "approved", "completed"];
  for (const s of order) {
    if (calls.some((c) => c.status === s)) return s;
  }
  return calls[calls.length - 1]?.status ?? "completed";
}

/** @param {any} s @param {number} n */
function trim(s, n) {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * The one status line the composer shows while a turn runs. It is derived from
 * the runtime's own status and state, never invented, and it says nothing at
 * all when there is nothing to say.
 * @param {any} view  the reduced session view
 */
export function runningLabel(view) {
  if (!view) return null;
  if (view.error) return "Runtime error";
  switch (view.state) {
    case "thinking": return "Thinking";
    case "streaming": return "Responding";
    case "running_tool": return view.status || "Working";
    case "awaiting_permission": return view.permission ? "Waiting for approval" : "Waiting for an answer";
    case "compacting": return "Compacting context";
    case "cancelled": return "Stopped";
    default: return null;
  }
}

/**
 * What the expanded view of one call shows. Everything here came from a tool
 * result; nothing is inferred.
 * @param {any} call
 */
export function detailOf(call) {
  const args = call.args ?? {};
  const r = call.result ?? null;
  const rows = [];

  if (call.tool === "run_command") {
    rows.push(["Command", (args.argv ?? []).join(" ")]);
    if (args.cwd) rows.push(["Working in", args.cwd]);
    if (args.purpose) rows.push(["Purpose", args.purpose]);
    if (r && typeof r.exit_code === "number") rows.push(["Exit code", String(r.exit_code)]);
    if (r && r.timed_out) rows.push(["Timed out", "yes"]);
  } else if (call.tool === "apply_patch") {
    for (const e of args.edits ?? []) rows.push([e.operation, e.path]);
    if (r) rows.push(["Changed", `${r.files} file(s), +${r.added} −${r.removed}`]);
  } else if (call.tool === "read_file") {
    rows.push(["Path", args.path]);
    if (r && r.lines) rows.push(["Lines", String(r.lines)]);
    if (r && r.truncated) rows.push(["Truncated", "yes"]);
  } else if (call.tool === "grep") {
    rows.push(["Query", args.query]);
    if (r) rows.push(["Matches", `${r.count} in ${r.files} file(s)`]);
  } else if (call.tool === "glob") {
    rows.push(["Pattern", args.pattern]);
    if (r) rows.push(["Matches", String(r.count)]);
  }

  if (typeof call.durationMs === "number") rows.push(["Took", `${call.durationMs} ms`]);
  if (call.decision) rows.push(["Decision", call.decision]);
  if (call.error) rows.push(["Error", call.error]);

  return {
    rows,
    // Streamed stdout/stderr, already redacted by the runtime.
    output: call.output || null,
    truncated: !!call.truncated,
  };
}
