// @ts-check
/**
 * The renderer's end of the host protocol.
 *
 * It holds no authority. It cannot open a file, run a command or name a path:
 * it can send a frame and wait for the reply. Every privileged thing happens in
 * the runtime process, and the Rust host checks each frame before it gets
 * there.
 *
 * The transport is injectable for one honest reason: this same client runs in a
 * plain browser during development, where there is no Tauri and therefore no
 * runtime. In that case it reports *disconnected* and refuses, rather than
 * pretending. A web page with no desktop host cannot run an agent, and saying
 * so is the whole point.
 */

export const PROTOCOL_VERSION = 1;

export const Request = Object.freeze({
  SESSION_CREATE: "session.create",
  SESSION_DISPOSE: "session.dispose",
  TURN_START: "turn.start",
  TURN_CANCEL: "turn.cancel",
  PERMISSION_RESOLVE: "permission.resolve",
  QUESTION_ANSWER: "question.answer",
  PROVIDER_CONNECT: "provider.connect",
  PROVIDER_DISCONNECT: "provider.disconnect",
});

export const Notify = Object.freeze({
  RUNTIME_STATE: "runtime.state",
  PROVIDER_STATE: "provider.state",
  SESSION_CREATED: "session.created",
  AGENT_EVENT: "agent.event",
  PERMISSION_REQUESTED: "permission.requested",
  QUESTION_REQUESTED: "question.requested",
  TURN_COMPLETED: "turn.completed",
  TURN_FAILED: "turn.failed",
});

/** Is a desktop host present at all?
 * @param {any} [w] */
export function hasTauri(w = typeof window === "undefined" ? undefined : window) {
  return !!(w && w.__TAURI_INTERNALS__ && typeof w.__TAURI_INTERNALS__.invoke === "function");
}

/**
 * The Tauri transport. Kept behind the same shape as the test transport so the
 * client has one code path.
 * @param {any} [w]
 */
export function tauriTransport(w = window) {
  const invoke = (cmd, args) => w.__TAURI_INTERNALS__.invoke(cmd, args);

  /**
   * Subscribe to a host event.
   *
   * This goes through the published API (`withGlobalTauri`) rather than the
   * event plugin's internal command. Calling that command directly is how the
   * first version failed: v2 requires a `target` on the payload, the invoke
   * rejected, connect() caught it, and the app sat there having never started
   * the runtime with nothing in any log to say why.
   *
   * @param {string} name @param {(payload: any) => void} fn
   */
  const listen = async (name, fn) => {
    const api = w.__TAURI__;
    if (api && api.event && typeof api.event.listen === "function") {
      return api.event.listen(name, (e) => fn(e.payload));
    }
    throw new Error(
      "The Tauri event API is unavailable. The desktop shell must be built with withGlobalTauri enabled.",
    );
  };

  return {
    async start() { return invoke("runtime_start", {}); },
    async stop() { return invoke("runtime_stop", {}); },
    async info() { return invoke("host_info", {}); },
    async send(frame) { return invoke("runtime_send", { frame }); },
    async chooseProject() { return invoke("choose_project", {}); },
    /** @param {(frame: any) => void} fn */
    onFrame(fn) { return listen("runtime://frame", fn); },
    /** @param {(line: string) => void} fn */
    onLog(fn) { return listen("runtime://log", fn); },
  };
}

/**
 * @param {object} opts
 * @param {any} opts.transport
 * @param {(state: any) => void} [opts.onRuntimeState]
 * @param {(state: any) => void} [opts.onProviderState]
 * @param {(event: any) => void} [opts.onAgentEvent]
 * @param {(card: any) => void} [opts.onPermission]
 * @param {(q: any) => void} [opts.onQuestion]
 * @param {(line: string) => void} [opts.onLog]
 */
export function createHostClient({
  transport, onRuntimeState, onProviderState, onAgentEvent, onPermission, onQuestion, onLog,
}) {
  /** @type {any} */
  const io = transport;
  let seq = 0;
  /** id -> {resolve, reject} */
  const waiting = new Map();
  let runtime = { connected: false };
  let providerState = { connected: false, models: [], model: null };
  /** @type {string|null} */
  let sessionId = null;
  /** @type {(() => void)|null} */
  let detach = null;

  const nextId = () => `ui-${Date.now().toString(36)}-${++seq}`;

  function handle(frame) {
    if (!frame || frame.v !== PROTOCOL_VERSION) return;

    switch (frame.type) {
      case Notify.RUNTIME_STATE:
        runtime = { ...runtime, ...frame.payload };
        if (frame.payload.fatal) {
          // A dead runtime fails every request in flight. Leaving them pending
          // would show a composer that never comes back.
          const err = new Error(frame.payload.error?.message || "The runtime stopped.");
          for (const [, w] of waiting) w.reject(err);
          waiting.clear();
          sessionId = null;
        }
        if (onRuntimeState) onRuntimeState(runtime);
        break;

      case Notify.PROVIDER_STATE:
        providerState = { ...frame.payload };
        if (onProviderState) onProviderState(providerState);
        break;

      case Notify.SESSION_CREATED:
        sessionId = frame.payload.sessionId;
        break;

      case Notify.AGENT_EVENT:
        if (onAgentEvent) onAgentEvent(frame.payload);
        break;

      case Notify.PERMISSION_REQUESTED:
        if (onPermission) onPermission(frame.payload);
        break;

      case Notify.QUESTION_REQUESTED:
        if (onQuestion) onQuestion(frame.payload);
        break;

      default:
        break;
    }

    // Replies carry the id of the request that caused them.
    if (frame.id && waiting.has(frame.id)) {
      const w = waiting.get(frame.id);
      waiting.delete(frame.id);
      if (frame.type === Notify.TURN_FAILED) {
        const e = /** @type {any} */ (new Error(frame.payload?.message || "The runtime refused that."));
        e.code = frame.payload?.code;
        w.reject(e);
      } else {
        w.resolve(frame);
      }
    }
  }

  /** @param {string} type @param {any} payload */
  function request(type, payload = {}, timeoutMs = 0) {
    const id = nextId();
    const frame = {
      v: PROTOCOL_VERSION, id, type,
      sessionId: payload.sessionId ?? sessionId ?? null,
      payload,
    };
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      // A turn has no useful timeout: it takes as long as the model takes. The
      // Stop button is the way out, not a timer that lies about what happened.
      if (timeoutMs > 0) {
        setTimeout(() => {
          if (!waiting.has(id)) return;
          waiting.delete(id);
          reject(new Error("The runtime did not answer in time."));
        }, timeoutMs);
      }
      Promise.resolve(io.send(frame)).catch((e) => {
        waiting.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  return {
    get runtime() { return runtime; },
    get provider() { return providerState; },
    get sessionId() { return sessionId; },

    /** Attach to the host and start the runtime. */
    async connect() {
      if (detach) { try { detach(); } catch { /* already gone */ } detach = null; }
      const off = await io.onFrame(handle);
      detach = typeof off === "function" ? off : null;
      if (onLog && io.onLog) await io.onLog(onLog);
      const pid = await io.start();
      return { pid };
    },

    async info() { return io.info(); },

    /** The native folder dialog. The renderer never names a path itself. */
    async chooseProject() { return io.chooseProject(); },

    connectProvider(baseUrl, model, contextWindow) {
      return request(Request.PROVIDER_CONNECT, { baseUrl, model, contextWindow }, 20000);
    },
    disconnectProvider() { return request(Request.PROVIDER_DISCONNECT, {}, 5000); },

    createSession(root, mode) {
      return request(Request.SESSION_CREATE, { root, mode }, 20000);
    },
    disposeSession() {
      if (!sessionId) return Promise.resolve(null);
      const id = sessionId;
      sessionId = null;
      return request(Request.SESSION_DISPOSE, { sessionId: id }, 5000);
    },

    startTurn(text, mode) { return request(Request.TURN_START, { text, mode }); },
    cancelTurn() { return request(Request.TURN_CANCEL, {}, 5000); },
    resolvePermission(requestId, decision) {
      return request(Request.PERMISSION_RESOLVE, { requestId, decision });
    },
    answerQuestion(text) { return request(Request.QUESTION_ANSWER, { text }); },

    async dispose() {
      try { await this.disposeSession(); } catch { /* the runtime may be gone */ }
      if (detach) { try { detach(); } catch { /* already gone */ } detach = null; }
      try { await io.stop(); } catch { /* already stopped */ }
    },
  };
}

/**
 * What the interface says when there is no desktop host.
 *
 * This is the honest disconnected state, and it is the only thing a browser
 * preview can show. It never becomes "idle" or "ready".
 */
export const NO_HOST = Object.freeze({
  connected: false,
  reason: "Desktop not connected",
  detail: "The agent runs in the ForgeLocal desktop app. This preview can show the interface but cannot read your files or run anything.",
});
