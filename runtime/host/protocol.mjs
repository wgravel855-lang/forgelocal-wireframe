// @ts-check
/**
 * The host protocol.
 *
 * One JSON object per line, over stdin and stdout. JSON.stringify escapes every
 * newline inside a string, so a line break can only ever be a frame boundary:
 * the format frames itself, with no length prefix to get out of step with.
 *
 * The rule that makes it work is that the sidecar writes *nothing* else to
 * stdout. Every log, warning and stack trace goes to stderr. A stray
 * console.log in a dependency would otherwise corrupt the stream, so the
 * sidecar takes stdout away from console entirely.
 *
 * Both sides validate. Rust checks the frame it forwards and this module checks
 * it again on arrival, because a transport check is not an authorization check
 * and neither is a UI one.
 */

export const PROTOCOL_VERSION = 1;

/** Frontend -> runtime. Anything else is rejected. */
export const Request = Object.freeze({
  SESSION_CREATE: "session.create",
  SESSION_DISPOSE: "session.dispose",
  TURN_START: "turn.start",
  TURN_CANCEL: "turn.cancel",
  PERMISSION_RESOLVE: "permission.resolve",
  QUESTION_ANSWER: "question.answer",
  PROVIDER_CONNECT: "provider.connect",
  PROVIDER_DISCONNECT: "provider.disconnect",
  /* What the person pressed in the browser panel. One request rather than
     five, so the set of things the panel can do is stated in one place and
     validated once. Notably absent: navigating to a URL. */
  BROWSER_CONTROL: "browser.control",
  /* What is on disk, and reopening one of it. Neither takes a live session:
     the whole point is to reach a session this process did not create. */
  SESSION_LIST: "session.list",
  SESSION_RESUME: "session.resume",
  /* Run the conformance suite against the connected model. Its own request
     because it costs ten real model turns: it is something a person chooses
     to do, never something that happens on connect. */
  MODEL_TEST: "model.test",
  MODEL_TEST_CANCEL: "model.test.cancel",
});

/** Runtime -> frontend. */
export const Notify = Object.freeze({
  RUNTIME_STATE: "runtime.state",
  PROVIDER_STATE: "provider.state",
  SESSION_CREATED: "session.created",
  AGENT_EVENT: "agent.event",
  PERMISSION_REQUESTED: "permission.requested",
  QUESTION_REQUESTED: "question.requested",
  TURN_COMPLETED: "turn.completed",
  TURN_FAILED: "turn.failed",
  /* The result of a panel control. Separate from turn.failed because a
     browser button that could not act is not a failed turn, and rendering
     it as one would put a red banner over a working conversation. */
  BROWSER_CONTROLLED: "browser.controlled",
  SESSION_LIST: "session.list",
  /* Sent after a reopened session's events have all been replayed, so the
     interface knows the transcript is complete rather than still arriving. */
  SESSION_REPLAYED: "session.replayed",
  /* One per case as the suite runs, then one with the verdict. Progress is
     sent because ten model turns is long enough that a silent interface looks
     broken, and because a person watching a case fail learns more from that
     than from a grade at the end. */
  MODEL_TEST_PROGRESS: "model.test.progress",
  MODEL_TESTED: "model.tested",
  /* Sent only when a session got fewer tool groups than it asked for, so a
     toggle the runtime refused does not sit there looking enabled. */
  SESSION_TOOLS: "session.tools",
});

export const REQUEST_TYPES = Object.freeze(Object.values(Request));
export const NOTIFY_TYPES = Object.freeze(Object.values(Notify));
const REQUESTS = new Set(REQUEST_TYPES);

/** Which requests are meaningless without a session. */
const NEEDS_SESSION = new Set([
  Request.SESSION_DISPOSE, Request.TURN_START, Request.TURN_CANCEL,
  Request.PERMISSION_RESOLVE, Request.QUESTION_ANSWER, Request.BROWSER_CONTROL,
]);

export const ErrorCode = Object.freeze({
  BAD_FRAME: "bad_frame",
  BAD_VERSION: "bad_version",
  UNKNOWN_TYPE: "unknown_type",
  MISSING_SESSION: "missing_session",
  NO_SUCH_SESSION: "no_such_session",
  BAD_ARGUMENT: "bad_argument",
  PROVIDER: "provider",
  BUSY: "busy",
  INTERNAL: "internal",
});

/**
 * Validate an inbound frame. Returns the reason it is invalid, or null.
 * @param {unknown} frame
 * @returns {{code: string, message: string}|null}
 */
export function invalidRequest(frame) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    return { code: ErrorCode.BAD_FRAME, message: "A frame must be a JSON object." };
  }
  const f = /** @type {any} */ (frame);
  if (f.v !== PROTOCOL_VERSION) {
    return {
      code: ErrorCode.BAD_VERSION,
      message: `This runtime speaks protocol v${PROTOCOL_VERSION}; the frame said v${String(f.v)}.`,
    };
  }
  if (typeof f.id !== "string" || !f.id) {
    return { code: ErrorCode.BAD_FRAME, message: "Every request needs a string id." };
  }
  if (typeof f.type !== "string" || !REQUESTS.has(f.type)) {
    return { code: ErrorCode.UNKNOWN_TYPE, message: `Unknown request type: ${String(f.type)}` };
  }
  if (NEEDS_SESSION.has(f.type) && (typeof f.sessionId !== "string" || !f.sessionId)) {
    return { code: ErrorCode.MISSING_SESSION, message: `${f.type} needs a sessionId.` };
  }
  if (f.payload !== undefined && (typeof f.payload !== "object" || f.payload === null)) {
    return { code: ErrorCode.BAD_ARGUMENT, message: "payload must be an object when present." };
  }
  return null;
}

/**
 * @param {string} type @param {any} payload
 * @param {{id?: string|null, sessionId?: string|null}} [meta]
 */
export function notify(type, payload = {}, meta = {}) {
  return {
    v: PROTOCOL_VERSION,
    id: meta.id ?? null,
    sessionId: meta.sessionId ?? null,
    type,
    payload,
  };
}

/** @param {string} id @param {string} code @param {string} message */
export function failure(id, code, message, sessionId = null) {
  return {
    v: PROTOCOL_VERSION, id, sessionId,
    type: Notify.TURN_FAILED,
    payload: { code, message },
  };
}

/** One line out. */
export const encode = (frame) => `${JSON.stringify(frame)}\n`;

/**
 * A line-oriented decoder that tolerates chunk boundaries falling anywhere.
 * Malformed lines are surfaced rather than skipped: a silently dropped frame is
 * a request that never happened and never failed.
 * @param {(frame: any) => void} onFrame
 * @param {(line: string, error: Error) => void} onBadLine
 */
export function createDecoder(onFrame, onBadLine) {
  let buffer = "";
  return {
    push(text) {
      buffer += text;
      let cut;
      while ((cut = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (!line) continue;
        try { onFrame(JSON.parse(line)); }
        catch (/** @type {any} */ e) { onBadLine(line, /** @type {Error} */ (e)); }
      }
    },
    /** bytes waiting for their newline, for a "stream ended mid-frame" check */
    get pending() { return buffer.length; },
  };
}
