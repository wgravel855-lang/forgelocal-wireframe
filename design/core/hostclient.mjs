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
  BROWSER_CONTROL: "browser.control",
  SESSION_LIST: "session.list",
  SESSION_RESUME: "session.resume",
  MODEL_TEST: "model.test",
  MODEL_TEST_CANCEL: "model.test.cancel",
  MODEL_LIST: "model.list",
  MODEL_DELETE: "model.delete",
  MODEL_SEARCH: "model.search",
  MODEL_DOWNLOAD: "model.download",
  MODEL_DOWNLOAD_CANCEL: "model.download.cancel",
  MODEL_VERIFY: "model.verify",
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
  BROWSER_CONTROLLED: "browser.controlled",
  SESSION_LIST: "session.list",
  SESSION_REPLAYED: "session.replayed",
  MODEL_TEST_PROGRESS: "model.test.progress",
  MODEL_TESTED: "model.tested",
  SESSION_TOOLS: "session.tools",
  ENGINE_READY: "engine.ready",
  MODEL_LIST: "model.list",
  MODEL_SEARCH: "model.search",
  MODEL_DOWNLOAD_PROGRESS: "model.download.progress",
  MODEL_DOWNLOADED: "model.downloaded",
  MODEL_VERIFIED: "model.verified",
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

    /* ForgeLocal's own engine. These are host commands rather than runtime
       requests: the engine is a process the desktop host owns, and its port
       and token are deliberately never returned here. */
    async hardware() { return invoke("hardware_probe", {}); },
    async engineInstalled() { return invoke("engine_installed", {}); },
    async engineStatus() { return invoke("engine_status", {}); },
    async engineLog() { return invoke("engine_log", {}); },
    async engineStart(params) { return invoke("engine_start", { params }); },
    async engineStop() { return invoke("engine_stop", {}); },
    onEngineState(fn) { return listen("engine://state", fn); },
    onEngineLog(fn) { return listen("engine://log", fn); },
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
 * @param {(type: string, payload: any) => void} [opts.onModelTest]
 * @param {(type: string, payload: any) => void} [opts.onModelEvent]
 * @param {(available: boolean) => void} [opts.onEngineReady]
 * @param {(line: string) => void} [opts.onLog]
 */
export function createHostClient({
  transport, onRuntimeState, onProviderState, onAgentEvent, onPermission, onQuestion, onLog,
  onModelTest, onModelEvent, onEngineReady,
}) {
  /** @type {any} */
  const io = transport;
  /** Whether the host has an engine running. Set by the runtime, never guessed. */
  let engineAvailable = false;
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

      case Notify.ENGINE_READY:
        engineAvailable = frame.payload.available === true;
        if (onEngineReady) onEngineReady(engineAvailable);
        break;

      case Notify.MODEL_DOWNLOAD_PROGRESS:
      case Notify.MODEL_DOWNLOADED:
      case Notify.MODEL_VERIFIED:
      case Notify.MODEL_LIST:
      case Notify.MODEL_SEARCH:
        if (onModelEvent) onModelEvent(frame.type, frame.payload);
        break;

      case Notify.MODEL_TEST_PROGRESS:
      case Notify.MODEL_TESTED:
        /* The verdict is also merged into the provider state, so anything
           already reading that gets it without a second subscription and
           cannot end up a grade behind. */
        if (frame.type === Notify.MODEL_TESTED && frame.payload.profile) {
          providerState = {
            ...providerState,
            profile: frame.payload.profile,
            agentReady: frame.payload.agentReady === true,
          };
          if (onProviderState) onProviderState(providerState);
        }
        if (onModelTest) onModelTest(frame.type, frame.payload);
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

    get engineAvailable() { return engineAvailable; },

    /**
     * Point the runtime at a model.
     *
     * For ForgeLocal's own engine the renderer names the source and nothing
     * else: it has never been told the address or the token, which is the
     * point. For an external server it passes the URL the user typed.
     *
     * @param {string|null} baseUrl  null for the internal engine
     * @param {string} model
     * @param {number} [contextWindow]
     */
    connectProvider(baseUrl, model, contextWindow) {
      return request(Request.PROVIDER_CONNECT, baseUrl
        ? { baseUrl, model, contextWindow }
        : { source: "internal", model, contextWindow }, 20000);
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

    /**
     * @param {string} text @param {string} [mode] @param {string} [effort]
     * @param {string} [style] @param {string[]} [groups]
     */
    startTurn(text, mode, effort, style, groups) {
      return request(Request.TURN_START, { text, mode, effort, style, groups });
    },
    cancelTurn() { return request(Request.TURN_CANCEL, {}, 5000); },
    resolvePermission(requestId, decision) {
      return request(Request.PERMISSION_RESOLVE, { requestId, decision });
    },
    answerQuestion(text) { return request(Request.QUESTION_ANSWER, { text }); },

    /**
     * Press one of the browser panel's controls.
     *
     * Resolves with what the browser did, not with what was asked for: the
     * reply carries `ok` and, for back and forward, whether it actually
     * `moved`. A Back at the start of history is a no-op, and a panel that
     * drew it as a navigation would be lying about a page nobody left.
     * @param {"back"|"forward"|"reload"|"close"|"viewport"|"refresh"} action
     * @param {{width?: number, height?: number}} [opts]
     */
    browserControl(action, opts = {}) {
      return request(Request.BROWSER_CONTROL, { action, ...opts }, 20000);
    },

    /**
     * Run the conformance suite against the connected model.
     *
     * Long: about ten real model turns, which on local hardware is a minute
     * or two. Progress arrives as model.test.progress and the verdict as
     * model.tested; both are routed to onModelTest.
     */
    testModel() { return request(Request.MODEL_TEST, {}, 20 * 60 * 1000); },
    cancelModelTest() { return request(Request.MODEL_TEST_CANCEL, {}, 5000); },

    /* -------------------------------------------------- the local engine */

    /** What this machine has, measured by the host. Null without one. */
    async hardware() {
      if (!io.hardware) return null;
      try { return await io.hardware(); } catch { return null; }
    },

    async engineInstalled() {
      if (!io.engineInstalled) return false;
      try { return await io.engineInstalled(); } catch { return false; }
    },

    async engineStatus() {
      if (!io.engineStatus) return { state: "stopped" };
      try { return await io.engineStatus(); } catch { return { state: "stopped" }; }
    },

    /** The engine's own last lines, for a failure the user can act on. */
    async engineLog() {
      if (!io.engineLog) return [];
      try { return await io.engineLog(); } catch { return []; }
    },

    /**
     * Load a model.
     *
     * Resolves when it is answering or when it has failed; either way the
     * state that came back says which, and the host has already told the
     * runtime where to reach it. The renderer never sees the endpoint.
     * @param {any} params
     */
    async engineStart(params) {
      if (!io.engineStart) throw new Error("Loading a model needs the desktop app.");
      return io.engineStart(params);
    },

    async engineStop() {
      if (!io.engineStop) return null;
      return io.engineStop();
    },

    /* ------------------------------------------------------ model weights */

    /**
     * What is on disk, with whether each will run here.
     *
     * The hardware is passed through from the host's probe rather than
     * measured again: the arithmetic lives in the runtime so there is one
     * answer to "will this fit".
     * @param {any} hardware
     */
    listModels(hardware) {
      return request(Request.MODEL_LIST, { hardware }, 15000);
    },
    deleteModel(name) { return request(Request.MODEL_DELETE, { name }, 15000); },
    searchModels(repo) { return request(Request.MODEL_SEARCH, { repo }, 30000); },
    /** Long: these files are tens of gigabytes. Progress arrives as events. */
    downloadModel(file) {
      return request(Request.MODEL_DOWNLOAD, file, 24 * 60 * 60 * 1000);
    },
    cancelDownload(name) { return request(Request.MODEL_DOWNLOAD_CANCEL, { name }, 5000); },
    verifyModel(file) { return request(Request.MODEL_VERIFY, file, 60 * 60 * 1000); },

    /** What is on disk. Rows only: no events, no payloads. */
    listSessions(limit = 50) {
      return request(Request.SESSION_LIST, { limit }, 10000);
    },

    /**
     * Reopen a stored session.
     *
     * Its events arrive afterwards as ordinary agent events carrying
     * `replayed: true`, so the transcript is rebuilt by the same reducer
     * that built it live and cannot disagree with what happened. The promise
     * resolves on session.created; session.replayed marks the end of the
     * replay.
     * @param {string} id
     */
    resumeSession(id) {
      sessionId = id;
      return request(Request.SESSION_RESUME, { sessionId: id }, 30000);
    },

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
