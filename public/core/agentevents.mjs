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

export const EventType = Object.freeze({
  SESSION_STARTED: "session_started",
  TURN_STARTED: "turn_started",
  PHASE_CHANGED: "phase_changed",
  SESSION_STATE_CHANGED: "session_state_changed",
  USER_MESSAGE_CREATED: "user_message_created",
  ASSISTANT_TEXT_STARTED: "assistant_text_started",
  ASSISTANT_TEXT_DELTA: "assistant_text_delta",
  ASSISTANT_TEXT_COMPLETED: "assistant_text_completed",
  STATUS_CHANGED: "status_changed",
  PLAN_UPDATED: "plan_updated",
  QUESTION_REQUESTED: "question_requested",
  QUESTION_ANSWERED: "question_answered",
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
  /* The browser runs in a sidecar the renderer cannot reach, so everything
     it does has to arrive as an event or it is invisible and unauditable.
     These are deliberately separate from the tool events: a browser action
     is a tool call AND a state change to a page the user may be watching,
     and the work panel needs the second without re-deriving it. */
  BROWSER_SESSION_STARTED: "browser_session_started",
  BROWSER_NAVIGATED: "browser_navigated",
  BROWSER_SNAPSHOT: "browser_snapshot",
  BROWSER_ACTION: "browser_action",
  BROWSER_FINDING: "browser_finding",
  /* A small picture of the page, for the panel. Its own event rather than a
     field on browser_navigated because it arrives on a different schedule:
     throttled, best-effort, and dropped rather than delayed. */
  BROWSER_PREVIEW: "browser_preview",
  BROWSER_VIEWPORT: "browser_viewport",
  BROWSER_SESSION_CLOSED: "browser_session_closed",
  RUNTIME_ERROR: "runtime_error",
});

/**
 * An id generator that works in both places this module runs.
 *
 * It is shared by the runtime and the renderer, so it cannot import
 * `node:crypto`: doing so shipped a bare `node:crypto` specifier to the browser
 * and broke every route on the console gate. Web Crypto is global in Node 19+
 * and in browsers, and the fallback covers an insecure context where
 * randomUUID is missing.
 */
function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Every type the protocol defines, for validation at the boundary. */
export const EVENT_TYPES = Object.freeze(Object.values(EventType));
/** @type {Set<string>} */
const KNOWN = new Set(EVENT_TYPES);

/** Session-level status. The UI label is derived from this, never guessed. */
/**
 * The thirteen states the interface can show.
 *
 * SessionState below is the runtime's own coarse state and stays as it is;
 * this is the finer one the UI reads, because "running_tool" covers both
 * reading four files to understand something and running the test that proves
 * it, and those should not look the same to someone watching.
 *
 * A phase is only ever set by a phase_changed event. It is never inferred
 * from what tool happens to be running, because inference is how an interface
 * ends up claiming the agent is verifying when it is actually re-reading.
 */
export const Phase = Object.freeze({
  IDLE: "idle",
  UNDERSTANDING: "understanding",
  EXPLORING: "exploring",
  PLANNING: "planning",
  AWAITING_USER: "awaiting_user",
  AWAITING_PERMISSION: "awaiting_permission",
  ACTING: "acting",
  VERIFYING: "verifying",
  COMPACTING: "compacting",
  COMPLETED: "completed",
  BLOCKED: "blocked",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const PHASES = Object.freeze(Object.values(Phase));

/** What each phase says while it is current. Short, and never a claim. */
export const PHASE_LABELS = Object.freeze({
  [Phase.IDLE]: null,
  [Phase.UNDERSTANDING]: "Reading the request",
  [Phase.EXPLORING]: "Exploring the project",
  [Phase.PLANNING]: "Planning",
  [Phase.AWAITING_USER]: "Waiting for an answer",
  [Phase.AWAITING_PERMISSION]: "Waiting for approval",
  [Phase.ACTING]: "Making changes",
  [Phase.VERIFYING]: "Verifying",
  [Phase.COMPACTING]: "Compacting context",
  [Phase.COMPLETED]: null,
  [Phase.BLOCKED]: "Blocked",
  [Phase.FAILED]: "Failed",
  [Phase.CANCELLED]: "Stopped",
});

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
  const id = opts.id ?? newId;
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

/** The reduced view. Nothing in it is writable by the renderer.
 *  @param {string|null} [sessionId] */
export function initialState(sessionId = null) {
  return {
    sessionId,
    /** last sequence folded in, so a gap is visible rather than silent */
    sequence: 0,
    seen: /** @type {Set<string>} */ (new Set()),
    /** @type {string} */
    state: SessionState.IDLE,
    /** the finer UI phase; only phase_changed moves it */
    phase: Phase.IDLE,
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
    /** the unanswered structured question, or null */
    question: /** @type {any} */ (null),
    /** live browser state, when a session has one */
    browser: /** @type {any} */ (null),
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
export function reduceAgentEvent(prev, ev) {
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

    case EventType.TURN_STARTED:
      s.turnId = ev.turn_id ?? s.turnId;
      s.stopReason = null;
      s.cancelled = false;
      break;

    /* The phase is set, never derived. An interface that guessed the phase
       from the running tool would say "Verifying" for a read that happened
       to come after an edit. */
    case EventType.PHASE_CHANGED:
      if (PHASES.includes(p.phase)) s.phase = p.phase;
      break;

    case EventType.QUESTION_REQUESTED:
      s.question = {
        callId: p.call_id ?? null,
        questions: Array.isArray(p.questions) ? p.questions : [],
        at: ev.timestamp,
      };
      s.phase = Phase.AWAITING_USER;
      pushRow(s, {
        kind: "question", id: p.call_id ?? ev.event_id,
        questions: s.question.questions, answered: false, answerText: null,
        at: ev.timestamp, turnId: ev.turn_id,
      }, p.call_id);
      break;

    case EventType.QUESTION_ANSWERED: {
      s.question = null;
      const row = rowFor(s, p.call_id);
      if (row) {
        s.rows[row.i] = {
          ...row.row, answered: true,
          answerText: typeof p.text === "string" ? p.text : null,
          answers: Array.isArray(p.answers) ? p.answers : null,
        };
      }
      break;
    }

    case EventType.BROWSER_SESSION_STARTED:
      s.browser = {
        sessionId: p.browser_session_id ?? null,
        isolated: p.isolated !== false,
        url: null, title: null, snapshotId: null,
        console: [], network: [], downloads: [], closed: false,
        preview: null, viewport: { width: 1280, height: 800 },
        lastAction: null,
      };
      break;

    case EventType.BROWSER_NAVIGATED:
      if (s.browser) {
        s.browser = { ...s.browser, url: p.url ?? null, title: p.title ?? null };
      }
      break;

    case EventType.BROWSER_SNAPSHOT:
      if (s.browser) {
        s.browser = {
          ...s.browser,
          snapshotId: p.snapshot_id ?? null,
          url: p.url ?? s.browser.url,
          title: p.title ?? s.browser.title,
        };
      }
      break;

    case EventType.BROWSER_ACTION:
      pushRow(s, {
        kind: "browser", id: p.action_id ?? ev.event_id,
        action: p.action ?? "action", target: p.target ?? null,
        url: p.url ?? null, ok: p.ok !== false, detail: p.detail ?? null,
        at: ev.timestamp, turnId: ev.turn_id,
      }, p.action_id);
      /* Also kept as the panel's status line. The transcript row is the
         record; this is "what is happening right now", and deriving it by
         scanning backwards through rows for the last browser one is how a
         panel ends up a few actions behind the page it is showing. */
      if (s.browser) {
        s.browser = {
          ...s.browser,
          lastAction: {
            action: p.action ?? "action", target: p.target ?? null,
            ok: p.ok !== false, at: ev.timestamp,
          },
        };
      }
      break;

    /* Console errors and failed requests are evidence, so they are kept on
       the session rather than only rendered once and lost. Bounded, because a
       page in a redirect loop can emit thousands. */
    case EventType.BROWSER_FINDING:
      if (s.browser) {
        const bucket = p.kind === "network" ? "network"
          : p.kind === "download" ? "downloads"
          : "console";
        const next = [...s.browser[bucket], {
          level: p.level ?? "error",
          text: p.text ?? "",
          url: p.url ?? null,
          status: p.status ?? null,
          at: ev.timestamp,
        }].slice(-50);
        s.browser = { ...s.browser, [bucket]: next };
      }
      break;

    /* The image is held on the state, replacing the last one rather than
       accumulating: a panel shows the page now, and forty stale JPEGs in a
       reducer is a memory leak with a picture of a webpage in it. */
    case EventType.BROWSER_PREVIEW:
      if (s.browser) {
        s.browser = {
          ...s.browser,
          url: p.url ?? s.browser.url,
          title: p.title ?? s.browser.title,
          preview: p.image
            ? { image: p.image, mime: p.mime ?? "image/jpeg", bytes: p.bytes ?? 0,
                width: p.width ?? null, height: p.height ?? null, at: ev.timestamp }
            : s.browser.preview,
        };
      }
      break;

    case EventType.BROWSER_VIEWPORT:
      if (s.browser && p.width && p.height) {
        s.browser = { ...s.browser, viewport: { width: p.width, height: p.height } };
      }
      break;

    case EventType.BROWSER_SESSION_CLOSED:
      /* The preview goes with it. A closed session showing the last page it
         was on reads as still open, which is the one thing this panel must
         never imply. */
      if (s.browser) s.browser = { ...s.browser, closed: true, preview: null };
      break;

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
  for (const ev of events) s = reduceAgentEvent(s, ev);
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
