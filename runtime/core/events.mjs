// @ts-check
/**
 * The normalized event protocol.
 *
 * Everything the interface shows about a running agent comes from here. The
 * renderer holds no runtime state of its own: it holds a reduction of this
 * stream, so a restart that replays the stream lands on the identical screen,
 * and a row that has no event behind it cannot be drawn.
 *
 * Three properties this file is responsible for:
 *
 *   monotonic   sequence increases by one per session, assigned at emit time
 *   replayable  reduce() is pure, so state is a fold over the log
 *   idempotent  a duplicate delivery is dropped by event_id, not by luck
 */

import { randomUUID } from "node:crypto";

export const EventType = Object.freeze({
  SESSION_STARTED: "session_started",
  SESSION_STATE_CHANGED: "session_state_changed",
  USER_MESSAGE_CREATED: "user_message_created",
  ASSISTANT_TEXT_STARTED: "assistant_text_started",
  ASSISTANT_TEXT_DELTA: "assistant_text_delta",
  ASSISTANT_TEXT_COMPLETED: "assistant_text_completed",
  STATUS_CHANGED: "status_changed",
  PLAN_UPDATED: "plan_updated",
  TOOL_CALL_REQUESTED: "tool_call_requested",
  PERMISSION_REQUIRED: "permission_required",
  PERMISSION_RESOLVED: "permission_resolved",
  TOOL_STARTED: "tool_started",
  TOOL_OUTPUT_DELTA: "tool_output_delta",
  TOOL_COMPLETED: "tool_completed",
  TOOL_FAILED: "tool_failed",
  FILE_CHANGED: "file_changed",
  CHECKPOINT_CREATED: "checkpoint_created",
  CONTEXT_USAGE_UPDATED: "context_usage_updated",
  COMPACTION_STARTED: "compaction_started",
  COMPACTION_COMPLETED: "compaction_completed",
  BACKGROUND_TASK_STARTED: "background_task_started",
  BACKGROUND_TASK_UPDATED: "background_task_updated",
  BACKGROUND_TASK_COMPLETED: "background_task_completed",
  TURN_COMPLETED: "turn_completed",
  TURN_CANCELLED: "turn_cancelled",
  RUNTIME_ERROR: "runtime_error",
});

/** Every type the protocol defines, for validation at the boundary. */
export const EVENT_TYPES = Object.freeze(Object.values(EventType));
const KNOWN = new Set(EVENT_TYPES);

/** Session-level status. The UI label is derived from this, never guessed. */
export const SessionState = Object.freeze({
  IDLE: "idle",
  THINKING: "thinking",
  STREAMING: "streaming",
  RUNNING_TOOL: "running_tool",
  AWAITING_PERMISSION: "awaiting_permission",
  COMPACTING: "compacting",
  CANCELLED: "cancelled",
  ERROR: "error",
});

/**
 * An emitter owns the sequence for one session. Sequence is assigned here and
 * nowhere else, which is what makes it monotonic: there is one counter.
 *
 * @param {string} sessionId
 * @param {{ now?: () => number, id?: () => string, start?: number }} [opts]
 */
export function createEmitter(sessionId, opts = {}) {
  const now = opts.now ?? (() => Date.now());
  const id = opts.id ?? (() => randomUUID());
  let sequence = opts.start ?? 0;

  return {
    get sequence() { return sequence; },
    /**
     * @param {string} type
     * @param {Record<string, unknown>} [payload]
     * @param {{ turnId?: string|null, parentToolCallId?: string|null }} [meta]
     */
    emit(type, payload = {}, meta = {}) {
      if (!KNOWN.has(type)) throw new Error(`Unknown event type: ${type}`);
      sequence += 1;
      return Object.freeze({
        event_id: id(),
        session_id: sessionId,
        turn_id: meta.turnId ?? null,
        sequence,
        timestamp: now(),
        type,
        payload,
        parent_tool_call_id: meta.parentToolCallId ?? null,
      });
    },
  };
}

/**
 * Shape check for an event arriving from outside this process. The host
 * re-validates rather than trusting the wire.
 * @param {unknown} e
 * @returns {string|null} the reason it is invalid, or null
 */
export function invalidReason(e) {
  if (!e || typeof e !== "object") return "not an object";
  const ev = /** @type {Record<string, unknown>} */ (e);
  for (const k of ["event_id", "session_id", "type"]) {
    if (typeof ev[k] !== "string" || !ev[k]) return `missing ${k}`;
  }
  if (!KNOWN.has(/** @type {string} */ (ev.type))) return `unknown type ${String(ev.type)}`;
  if (!Number.isInteger(ev.sequence) || Number(ev.sequence) < 1) {
    return "sequence is not a positive integer";
  }
  if (!Number.isFinite(ev.timestamp)) return "timestamp is not a number";
  if (!ev.payload || typeof ev.payload !== "object") return "payload is not an object";
  return null;
}

/** The reduced view. Nothing in it is writable by the renderer. */
export function initialState(sessionId = null) {
  return {
    sessionId,
    /** last sequence folded in, so a gap is visible rather than silent */
    sequence: 0,
    seen: /** @type {Set<string>} */ (new Set()),
    state: SessionState.IDLE,
    /** short human status line, only ever set by status_changed */
    status: /** @type {string|null} */ (null),
    turnId: /** @type {string|null} */ (null),
    cwd: /** @type {string|null} */ (null),
    mode: /** @type {string|null} */ (null),
    model: /** @type {string|null} */ (null),
    stopReason: /** @type {string|null} */ (null),
    /** transcript rows, in arrival order */
    rows: /** @type {any[]} */ ([]),
    /** message/tool id -> row index, so deltas find their row in O(1) */
    index: /** @type {Map<string, number>} */ (new Map()),
    plan: /** @type {{items: any[], updatedAt: number|null}} */ ({ items: [], updatedAt: null }),
    permission: /** @type {any} */ (null),
    context: /** @type {any} */ (null),
    compaction: /** @type {any} */ (null),
    files: /** @type {any[]} */ ([]),
    checkpoints: /** @type {any[]} */ ([]),
    background: /** @type {Map<string, any>} */ (new Map()),
    error: /** @type {any} */ (null),
    cancelled: false,
    /** turns that reached turn_completed */
    completedTurns: /** @type {string[]} */ ([]),
    /** sequence numbers skipped, if the transport ever loses one */
    gaps: /** @type {number[]} */ ([]),
  };
}

/** @param {any} s */
function clone(s) {
  return {
    ...s,
    seen: new Set(s.seen),
    rows: s.rows.slice(),
    index: new Map(s.index),
    plan: { ...s.plan, items: s.plan.items.slice() },
    files: s.files.slice(),
    checkpoints: s.checkpoints.slice(),
    background: new Map(s.background),
    completedTurns: s.completedTurns.slice(),
    gaps: s.gaps.slice(),
  };
}

/** @param {any} s @param {any} row @param {string} [key] */
function pushRow(s, row, key) {
  s.rows.push(row);
  if (key) s.index.set(key, s.rows.length - 1);
}

/** @param {any} s @param {string} key */
function rowFor(s, key) {
  const i = s.index.get(key);
  return i === undefined ? null : { i, row: s.rows[i] };
}

/** @param {any} s @param {string} id @param {(r: any) => any} fn */
function updateTool(s, id, fn) {
  const found = rowFor(s, id);
  // A tool event with no requested call is a protocol violation. Creating the
  // row on demand would let a malformed stream draw activity that never
  // happened, which is exactly what this protocol exists to prevent.
  if (!found) throw new Error(`event references unknown tool call ${id}`);
  s.rows[found.i] = fn(found.row);
}

/**
 * Fold one event into the view.
 *
 * Returns the same object identity when the event is a duplicate, so a caller
 * can cheaply tell that nothing changed.
 *
 * @param {ReturnType<typeof initialState>} prev
 * @param {any} ev
 */
export function reduce(prev, ev) {
  const bad = invalidReason(ev);
  if (bad) throw new Error(`Malformed runtime event: ${bad}`);
  if (prev.seen.has(ev.event_id)) return prev; // idempotent by id

  const s = clone(prev);
  s.seen.add(ev.event_id);

  // A gap is recorded, not repaired. Silently renumbering would hide a dropped
  // tool result behind a plausible-looking transcript.
  if (ev.sequence > s.sequence + 1) {
    for (let n = s.sequence + 1; n < ev.sequence; n++) s.gaps.push(n);
  }
  if (ev.sequence > s.sequence) s.sequence = ev.sequence;
  if (ev.turn_id) s.turnId = ev.turn_id;

  const p = ev.payload;

  switch (ev.type) {
    case EventType.SESSION_STARTED:
      s.sessionId = ev.session_id;
      s.state = SessionState.IDLE;
      s.cwd = p.cwd ?? null;
      s.mode = p.mode ?? null;
      s.model = p.model ?? null;
      break;

    case EventType.SESSION_STATE_CHANGED:
      s.state = p.state;
      if (p.state !== SessionState.ERROR) s.error = null;
      break;

    case EventType.STATUS_CHANGED:
      s.status = p.status ?? null;
      break;

    case EventType.USER_MESSAGE_CREATED:
      pushRow(s, {
        kind: "user", id: p.message_id ?? ev.event_id,
        text: p.text ?? "", at: ev.timestamp,
      });
      break;

    case EventType.ASSISTANT_TEXT_STARTED:
      pushRow(s, {
        kind: "assistant", id: p.message_id ?? ev.event_id, text: "",
        streaming: true, at: ev.timestamp, turnId: ev.turn_id,
      }, p.message_id);
      s.state = SessionState.STREAMING;
      break;

    case EventType.ASSISTANT_TEXT_DELTA: {
      const row = rowFor(s, p.message_id);
      if (!row) throw new Error(`assistant_text_delta for unknown message ${p.message_id}`);
      s.rows[row.i] = { ...row.row, text: row.row.text + (p.text ?? "") };
      break;
    }

    case EventType.ASSISTANT_TEXT_COMPLETED: {
      const row = rowFor(s, p.message_id);
      if (!row) throw new Error(`assistant_text_completed for unknown message ${p.message_id}`);
      s.rows[row.i] = {
        ...row.row, streaming: false,
        text: typeof p.text === "string" ? p.text : row.row.text,
      };
      break;
    }

    case EventType.PLAN_UPDATED:
      s.plan = {
        items: Array.isArray(p.items) ? p.items.slice() : [],
        updatedAt: ev.timestamp,
      };
      break;

    case EventType.TOOL_CALL_REQUESTED:
      pushRow(s, {
        kind: "tool", id: p.tool_call_id, tool: p.tool, args: p.args ?? {},
        status: "requested", output: "", truncated: false,
        at: ev.timestamp, turnId: ev.turn_id,
        parentToolCallId: ev.parent_tool_call_id ?? null,
      }, p.tool_call_id);
      break;

    case EventType.PERMISSION_REQUIRED:
      s.permission = {
        requestId: p.request_id, toolCallId: p.tool_call_id, tool: p.tool,
        args: p.args ?? {}, reason: p.reason ?? null, mode: p.mode ?? null,
        options: Array.isArray(p.options) ? p.options.slice() : [],
        at: ev.timestamp,
      };
      s.state = SessionState.AWAITING_PERMISSION;
      updateTool(s, p.tool_call_id, (r) => ({ ...r, status: "awaiting_permission" }));
      break;

    case EventType.PERMISSION_RESOLVED:
      if (s.permission && s.permission.requestId === p.request_id) s.permission = null;
      updateTool(s, p.tool_call_id, (r) => ({
        ...r,
        status: p.decision === "deny" ? "denied" : "approved",
        decision: p.decision,
        decidedBy: p.decided_by ?? null,
      }));
      break;

    case EventType.TOOL_STARTED:
      updateTool(s, p.tool_call_id, (r) => ({ ...r, status: "running", startedAt: ev.timestamp }));
      s.state = SessionState.RUNNING_TOOL;
      break;

    case EventType.TOOL_OUTPUT_DELTA:
      updateTool(s, p.tool_call_id, (r) => ({
        ...r,
        output: r.output + (p.chunk ?? ""),
        truncated: p.truncated ?? r.truncated,
      }));
      break;

    case EventType.TOOL_COMPLETED:
      updateTool(s, p.tool_call_id, (r) => ({
        ...r, status: "completed", result: p.result ?? null,
        durationMs: p.duration_ms ?? null, completedAt: ev.timestamp,
        truncated: p.truncated ?? r.truncated,
      }));
      break;

    case EventType.TOOL_FAILED:
      updateTool(s, p.tool_call_id, (r) => ({
        ...r, status: "failed", error: p.error ?? null,
        errorCode: p.code ?? null, completedAt: ev.timestamp,
      }));
      break;

    case EventType.FILE_CHANGED:
      s.files.push({
        path: p.path, change: p.change,
        added: p.added ?? null, removed: p.removed ?? null,
        toolCallId: ev.parent_tool_call_id ?? p.tool_call_id ?? null,
        at: ev.timestamp,
      });
      break;

    case EventType.CHECKPOINT_CREATED:
      s.checkpoints.push({
        id: p.checkpoint_id, label: p.label ?? null,
        turnId: ev.turn_id, files: p.files ?? 0, at: ev.timestamp,
      });
      break;

    case EventType.CONTEXT_USAGE_UPDATED:
      s.context = {
        used: p.used_tokens, window: p.context_window,
        percent: p.context_window ? p.used_tokens / p.context_window : null,
        breakdown: p.breakdown ?? null, at: ev.timestamp,
      };
      break;

    case EventType.COMPACTION_STARTED:
      s.state = SessionState.COMPACTING;
      s.compaction = { startedAt: ev.timestamp, reason: p.reason ?? null };
      break;

    case EventType.COMPACTION_COMPLETED:
      s.compaction = {
        ...(s.compaction ?? {}), completedAt: ev.timestamp,
        before: p.before_tokens ?? null, after: p.after_tokens ?? null,
        digestId: p.digest_id ?? null,
      };
      break;

    case EventType.BACKGROUND_TASK_STARTED:
      s.background.set(p.task_id, {
        id: p.task_id, label: p.label ?? null, command: p.command ?? null,
        status: "running", output: "", at: ev.timestamp,
      });
      break;

    case EventType.BACKGROUND_TASK_UPDATED: {
      const t = s.background.get(p.task_id);
      if (!t) throw new Error(`background_task_updated for unknown task ${p.task_id}`);
      s.background.set(p.task_id, {
        ...t, output: t.output + (p.chunk ?? ""), status: p.status ?? t.status,
      });
      break;
    }

    case EventType.BACKGROUND_TASK_COMPLETED: {
      const t = s.background.get(p.task_id);
      if (!t) throw new Error(`background_task_completed for unknown task ${p.task_id}`);
      s.background.set(p.task_id, {
        ...t, status: p.status ?? "completed",
        exitCode: p.exit_code ?? null, completedAt: ev.timestamp,
      });
      break;
    }

    case EventType.TURN_COMPLETED:
      if (ev.turn_id) s.completedTurns.push(ev.turn_id);
      // A turn that ended because the provider failed is still a turn that
      // ended, but the session is not idle: it is in an error the user has not
      // seen resolved. Returning to idle here would erase the only signal that
      // something went wrong, which is how an error becomes a silent no-op.
      s.state = s.error ? SessionState.ERROR : SessionState.IDLE;
      s.status = null;
      s.turnId = null;
      s.stopReason = p.stop_reason ?? null;
      break;

    case EventType.TURN_CANCELLED:
      s.state = SessionState.CANCELLED;
      s.cancelled = true;
      s.status = null;
      // A cancelled turn leaves its in-flight rows visibly unfinished rather
      // than pretending they completed.
      for (let i = 0; i < s.rows.length; i++) {
        const r = s.rows[i];
        if (r.kind === "assistant" && r.streaming) {
          s.rows[i] = { ...r, streaming: false, cancelled: true };
        }
        if (r.kind === "tool" && (r.status === "running" || r.status === "requested" || r.status === "awaiting_permission")) {
          s.rows[i] = { ...r, status: "cancelled" };
        }
      }
      s.permission = null;
      break;

    case EventType.RUNTIME_ERROR:
      s.error = {
        message: p.message ?? "Runtime error", code: p.code ?? null,
        detail: p.detail ?? null, at: ev.timestamp,
      };
      s.state = SessionState.ERROR;
      break;

    default:
      // Unreachable: invalidReason() already rejected unknown types. Reaching
      // here means the enum and this switch drifted apart.
      throw new Error(`No reduction for event type ${ev.type}`);
  }
  return s;
}

/**
 * Fold a whole log. This is the restart path: the same events in the same
 * order must produce the same screen.
 * @param {any[]} events
 * @param {ReturnType<typeof initialState>} [from]
 */
export function replay(events, from) {
  let s = from ?? initialState();
  for (const ev of events) s = reduce(s, ev);
  return s;
}

/** Rows the transcript draws, with in-flight tool calls still visible. */
export const transcript = (s) => s.rows;

/**
 * The one status label the UI may show. Derived, never stored twice.
 * @param {ReturnType<typeof initialState>} s
 */
export function stateLabel(s) {
  if (s.error) return "Runtime error";
  switch (s.state) {
    case SessionState.THINKING: return "Thinking";
    case SessionState.STREAMING: return "Responding";
    case SessionState.RUNNING_TOOL: return s.status ?? "Working";
    case SessionState.AWAITING_PERMISSION: return "Waiting for approval";
    case SessionState.COMPACTING: return "Compacting context";
    case SessionState.CANCELLED: return "Stopped";
    case SessionState.ERROR: return "Runtime error";
    default: return "Idle";
  }
}
