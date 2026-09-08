// @ts-check
/**
 * The one run-state model. Every visible consequence of a run — the transcript,
 * the sidebar glyph, the composer button, the top status, the work pane — is a
 * selector over this reducer. Nothing mutates a status in one place and hopes
 * the others agree, which is what let Stop leave a tool spinning.
 *
 * Events are append-only and the state is derived. That makes the awkward cases
 * (stop during a tool, deny a permission, stop twice) fall out of one
 * transition rather than needing a rule per consumer.
 */

/** @typedef {'chat'|'tool_use'|'reasoning'|'vision'|'fim'|'agent_ready'} ModelCapability */

/**
 * @typedef {object} ToolCall
 * @property {string} callId
 * @property {string} name          tool name, e.g. run_command
 * @property {string} label         what the row says: "Read 4 files"
 * @property {Record<string, unknown>} [args]
 * @property {string} [command]     canonical executable + argv, for run_command
 * @property {string} [cwd]
 */

/**
 * @typedef {object} ToolResult
 * @property {number} [exitCode]
 * @property {string} [stdout]
 * @property {string[]} [changedPaths]
 * @property {number} [added]
 * @property {number} [removed]
 * @property {string} [summary]
 * @property {boolean} [truncated]
 */

/** @typedef {'once'|'always'|'deny'} PermissionDecision */

/**
 * @typedef {object} RiskInfo
 * @property {string} scopeTag      "Network", "Filesystem"
 * @property {string} scope         one concise sentence
 * @property {string} [why]
 * @property {string} [cwd]
 * @property {string} [reversible]
 */

/**
 * @typedef {object} ContextUsage
 * @property {number} used          tokens in the active prompt
 * @property {number} effective     effective loaded context
 * @property {number} reserve       tokens held back for the response
 */

/** @typedef {{ message: string, kind?: string }} AgentError */

/**
 * @typedef {{type:'run.started', runId:string, sessionId:string, at:string}
 *   | {type:'assistant.delta', runId:string, text:string, at:string}
 *   | {type:'tool.requested', runId:string, call:ToolCall, at:string}
 *   | {type:'permission.requested', runId:string, callId:string, risk:RiskInfo, at:string}
 *   | {type:'permission.decided', runId:string, callId:string, decision:PermissionDecision, at:string}
 *   | {type:'tool.started', runId:string, callId:string, at:string}
 *   | {type:'tool.stdout', runId:string, callId:string, chunk:string, at:string}
 *   | {type:'tool.completed', runId:string, callId:string, result:ToolResult, at:string}
 *   | {type:'tool.interrupted', runId:string, callId:string, at:string}
 *   | {type:'context.updated', runId:string, usage:ContextUsage, at:string}
 *   | {type:'context.compaction.started', runId:string, at:string}
 *   | {type:'context.compaction.completed', runId:string, before:number, after:number, at:string}
 *   | {type:'run.completed', runId:string, at:string}
 *   | {type:'run.stopped', runId:string, at:string}
 *   | {type:'run.blocked', runId:string, reason:string, at:string}
 *   | {type:'run.failed', runId:string, error:AgentError, at:string}
 * } AgentEvent
 */

/** @typedef {'pending'|'awaiting-permission'|'running'|'succeeded'|'failed'|'denied'|'interrupted'} ToolState */

/**
 * @typedef {object} ToolView
 * @property {string} callId
 * @property {string} name
 * @property {string} label
 * @property {ToolState} state
 * @property {string} [command]
 * @property {string} [cwd]
 * @property {string} stdout
 * @property {ToolResult} [result]
 * @property {RiskInfo} [risk]
 * @property {PermissionDecision} [decision]
 */

/** @typedef {'idle'|'running'|'completed'|'stopped'|'blocked'|'failed'} RunStatus */

/**
 * @typedef {object} RunState
 * @property {string|null} runId
 * @property {string|null} sessionId
 * @property {RunStatus} status
 * @property {ToolView[]} tools
 * @property {string} assistantText
 * @property {ContextUsage|null} context
 * @property {{before:number, after:number}|null} compaction
 * @property {AgentError|null} error
 * @property {string|null} blockedReason
 * @property {boolean} userStopped
 */

/** @returns {RunState} */
export function initialRunState() {
  return {
    runId: null,
    sessionId: null,
    status: "idle",
    tools: [],
    assistantText: "",
    context: null,
    compaction: null,
    error: null,
    blockedReason: null,
    userStopped: false,
  };
}

/** A run is over; nothing may re-open it except a new run.started. */
const SETTLED = new Set(["completed", "stopped", "blocked", "failed"]);

/**
 * @param {RunState} state
 * @param {string} callId
 * @param {(t: ToolView) => ToolView} fn
 * @returns {ToolView[]}
 */
const mapTool = (state, callId, fn) =>
  state.tools.map((t) => (t.callId === callId ? fn(t) : t));

/**
 * Any tool that has not reached a terminal state becomes `to`. This is what
 * makes Stop atomic: one transition closes every open tool rather than the
 * caller remembering to.
 * @param {ToolView[]} tools
 * @param {ToolState} to
 * @returns {ToolView[]}
 */
const settleOpenTools = (tools, to) =>
  tools.map((t) =>
    t.state === "running" || t.state === "pending" || t.state === "awaiting-permission"
      ? { ...t, state: to }
      : t);

/**
 * @param {RunState} state
 * @param {AgentEvent} event
 * @returns {RunState}
 */
export function reduce(state, event) {
  switch (event.type) {
    case "run.started":
      return {
        ...initialRunState(),
        runId: event.runId,
        sessionId: event.sessionId,
        status: "running",
      };

    case "assistant.delta":
      if (state.status !== "running") return state;
      return { ...state, assistantText: state.assistantText + event.text };

    case "tool.requested": {
      if (state.status !== "running") return state;
      if (state.tools.some((t) => t.callId === event.call.callId)) return state;
      return {
        ...state,
        tools: [...state.tools, {
          callId: event.call.callId,
          name: event.call.name,
          label: event.call.label,
          command: event.call.command,
          cwd: event.call.cwd,
          state: "pending",
          stdout: "",
        }],
      };
    }

    case "permission.requested":
      if (state.status !== "running") return state;
      return {
        ...state,
        tools: mapTool(state, event.callId, (t) =>
          t.state === "pending" ? { ...t, state: "awaiting-permission", risk: event.risk } : t),
      };

    case "permission.decided": {
      if (state.status !== "running") return state;
      const denied = event.decision === "deny";
      const tools = mapTool(state, event.callId, (t) => ({
        ...t,
        decision: event.decision,
        // Allowing does NOT complete the tool. It only unblocks it: the tool
        // goes back to pending and waits for tool.started, then
        // tool.completed. Only tool.completed may claim success.
        state: denied ? "denied" : t.state === "awaiting-permission" ? "pending" : t.state,
      }));
      if (!denied) return { ...state, tools };
      // A denied tool ends this run. Without a model adapter there is nothing
      // to hand the refusal back to, so the run is blocked rather than
      // silently continuing as if the agent had another idea.
      return {
        ...state,
        tools: settleOpenTools(tools, "interrupted"),
        status: "blocked",
        blockedReason: "You denied a required action.",
      };
    }

    case "tool.started":
      if (state.status !== "running") return state;
      return {
        ...state,
        tools: mapTool(state, event.callId, (t) =>
          t.state === "pending" ? { ...t, state: "running" } : t),
      };

    case "tool.stdout":
      return {
        ...state,
        tools: mapTool(state, event.callId, (t) => ({ ...t, stdout: t.stdout + event.chunk })),
      };

    case "tool.completed":
      return {
        ...state,
        tools: mapTool(state, event.callId, (t) => ({
          ...t,
          state: (event.result.exitCode ?? 0) === 0 ? "succeeded" : "failed",
          result: event.result,
        })),
      };

    case "tool.interrupted":
      return {
        ...state,
        tools: mapTool(state, event.callId, (t) =>
          t.state === "succeeded" || t.state === "failed" ? t : { ...t, state: "interrupted" }),
      };

    case "context.updated":
      return { ...state, context: event.usage };

    case "context.compaction.completed":
      return { ...state, compaction: { before: event.before, after: event.after } };

    case "run.completed":
      if (SETTLED.has(state.status)) return state;
      return { ...state, status: "completed", tools: settleOpenTools(state.tools, "interrupted") };

    case "run.stopped":
      // Idempotent: stopping a settled run changes nothing at all.
      if (SETTLED.has(state.status)) return state;
      return {
        ...state,
        status: "stopped",
        userStopped: true,
        tools: settleOpenTools(state.tools, "interrupted"),
      };

    case "run.blocked":
      if (SETTLED.has(state.status)) return state;
      return {
        ...state,
        status: "blocked",
        blockedReason: event.reason,
        tools: settleOpenTools(state.tools, "interrupted"),
      };

    case "run.failed":
      if (SETTLED.has(state.status)) return state;
      return {
        ...state,
        status: "failed",
        error: event.error,
        tools: settleOpenTools(state.tools, "interrupted"),
      };

    default:
      return state;
  }
}

/**
 * @param {RunState} state
 * @param {AgentEvent[]} events
 * @returns {RunState}
 */
export const reduceAll = (state, events) => events.reduce(reduce, state);

/* ------------------------------------------------------------- selectors -- */
/* Every consumer reads one of these. None of them is allowed to keep its own
   copy of "is it running". */

/** @param {RunState} s */
export const isRunning = (s) => s.status === "running";

/** @param {RunState} s The composer button: Stop only while a run is live. */
export const composerAction = (s) => (isRunning(s) ? "stop" : "send");

/** @param {RunState} s The sidebar glyph and grouping. */
export const sessionActivity = (s) =>
  s.status === "running" ? "working"
    : s.status === "blocked" ? "needs-input"
      : s.status === "failed" ? "failed"
        : "idle";

/** @param {RunState} s A tool still asking for a decision, or null. */
export const pendingPermission = (s) =>
  s.tools.find((t) => t.state === "awaiting-permission") || null;

/** @param {RunState} s The one tool a Normal transcript shows as active. */
export const activeTool = (s) => s.tools.find((t) => t.state === "running") || null;

/** @param {RunState} s Only a completed tool may be described as having done something. */
export const succeededTools = (s) => s.tools.filter((t) => t.state === "succeeded");

/** @param {RunState} s */
export const contextRatio = (s) =>
  s.context && s.context.effective
    ? (s.context.used + s.context.reserve) / s.context.effective
    : 0;

/** Soft threshold, then the point where the next round would trigger compaction. */
export const CONTEXT_SOFT = 0.72;
export const CONTEXT_COMPACT = 0.82;

/** @param {RunState} s @returns {'ok'|'near'|'compact'} */
export const contextPressure = (s) => {
  const r = contextRatio(s);
  return r >= CONTEXT_COMPACT ? "compact" : r >= CONTEXT_SOFT ? "near" : "ok";
};

/**
 * What the transcript should say happened, in one place.
 * @param {RunState} s
 * @returns {{kind:string, text:string}|null}
 */
export const runOutcome = (s) => {
  if (s.status === "stopped") return { kind: "stopped", text: "You stopped this response" };
  if (s.status === "blocked") return { kind: "blocked", text: s.blockedReason || "Run blocked" };
  if (s.status === "failed") return { kind: "failed", text: s.error?.message || "Run failed" };
  if (s.status === "completed") return { kind: "completed", text: "Done" };
  return null;
};
