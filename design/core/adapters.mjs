// @ts-check
/**
 * The boundary a future Tauri/Rust core will implement. Nothing in the browser
 * runs a command, downloads a file or loads a model; the UI only ever talks to
 * one of these adapters.
 *
 * Two implementations ship today:
 *   DisconnectedRuntime  the honest default on the web deployment
 *   FixtureRuntime       deterministic event sequences for the prototype and
 *                        for tests, which never claim a real effect occurred
 */

/** @typedef {import('./events.mjs').AgentEvent} AgentEvent */
/** @typedef {import('./events.mjs').PermissionDecision} PermissionDecision */
/** @typedef {import('./models.mjs').ModelRecord} ModelRecord */

/**
 * @typedef {object} RuntimeStatus
 * @property {'connected'|'disconnected'} state
 * @property {string} [detail]     one sentence, shown once at system level
 * @property {string} [version]
 */

/**
 * @typedef {object} LocalRuntimeAdapter
 * @property {() => Promise<RuntimeStatus>} status
 * @property {() => Promise<{root: string}>} openWorkspace
 * @property {(listener: (e: AgentEvent) => void) => () => void} subscribe
 * @property {(input: {sessionId: string, prompt: string}) => Promise<{runId: string}>} startRun
 * @property {(runId: string) => Promise<void>} stopRun
 * @property {(input: {runId: string, callId: string, decision: PermissionDecision}) => Promise<void>} decidePermission
 */

/**
 * @typedef {object} ModelRuntimeAdapter
 * @property {() => Promise<ModelRecord[]>} listModels
 * @property {(input: {modelId: string, variant?: string}) => Promise<{downloadId: string}>} downloadModel
 * @property {(input: {modelId: string, contextTokens?: number, gpuLayers?: number}) => Promise<{instanceId: string}>} loadModel
 * @property {(instanceId: string) => Promise<void>} unloadModel
 * @property {(modelId: string) => Promise<{agentReady: boolean, notes: string}>} capabilities
 */

/**
 * @typedef {object} Checkpoint
 * @property {string} id
 * @property {string} sessionId
 * @property {string} at
 * @property {string} label
 */

/**
 * Defined so the UI can be written against it, deliberately not wired to any
 * visible control until a store exists. A restore button with nothing behind it
 * is worse than no button.
 * @typedef {object} CheckpointAdapter
 * @property {(sessionId: string) => Promise<Checkpoint>} createBeforePrompt
 * @property {(sessionId: string) => Promise<Checkpoint[]>} list
 * @property {(id: string, mode: 'code'|'conversation'|'both') => Promise<{restored: string[]}>} restore
 */

/** Thrown by every disconnected method, so callers cannot mistake it for a result. */
export class RuntimeUnavailable extends Error {
  constructor(what = "No local runtime is connected") {
    super(what);
    this.name = "RuntimeUnavailable";
  }
}

/**
 * The web deployment's real state. It reports disconnected and refuses
 * everything rather than simulating success.
 * @returns {LocalRuntimeAdapter & ModelRuntimeAdapter}
 */
export function createDisconnectedRuntime() {
  const reject = () => Promise.reject(new RuntimeUnavailable());
  return {
    /** @returns {Promise<RuntimeStatus>} */
    status: () => Promise.resolve({
      state: /** @type {const} */ ("disconnected"),
      detail: "This is the web preview. Running commands and loading models needs the desktop app.",
    }),
    openWorkspace: reject,
    subscribe: () => () => {},
    startRun: reject,
    stopRun: reject,
    decidePermission: reject,
    listModels: () => Promise.resolve([]),
    downloadModel: reject,
    loadModel: reject,
    unloadModel: reject,
    capabilities: reject,
  };
}

/**
 * Replays a recorded event sequence. Used by the prototype routes and by tests.
 * It emits the same AgentEvent union a real core would, so the reducer and every
 * selector are exercised by the identical code path.
 *
 * @param {AgentEvent[]} script
 * @param {{stepMs?: number, now?: () => string}} [opts]
 */
export function createFixtureRuntime(script, opts = {}) {
  const stepMs = opts.stepMs ?? 0;
  /** @type {Set<(e: AgentEvent) => void>} */
  const listeners = new Set();
  let cursor = 0;
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  /** @type {string} */
  let runId = "fixture-run";

  /** @param {AgentEvent} e */
  const emit = (e) => listeners.forEach((fn) => fn(e));

  const pump = () => {
    if (cursor >= script.length) return;
    const e = script[cursor++];
    // A permission request is the point of the fixture: it waits for a real
    // decision instead of answering itself.
    emit(e);
    if (e.type === "permission.requested") return;
    if (cursor < script.length) timer = setTimeout(pump, stepMs);
  };

  return {
    /** @returns {Promise<RuntimeStatus>} */
    status: () => Promise.resolve({ state: "disconnected", detail: "Prototype fixture. No command, download or file change is real." }),
    openWorkspace: () => Promise.reject(new RuntimeUnavailable()),
    /** @param {(e: AgentEvent) => void} fn */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** @param {{sessionId: string}} input */
    startRun({ sessionId }) {
      runId = "fixture-run";
      cursor = 0;
      emit({ type: "run.started", runId, sessionId, at: new Date().toISOString() });
      timer = setTimeout(pump, stepMs);
      return Promise.resolve({ runId });
    },
    /** @param {string} [id] */
    stopRun(id) {
      if (timer) clearTimeout(timer);
      emit({ type: "run.stopped", runId: id || runId, at: new Date().toISOString() });
      return Promise.resolve();
    },
    /** @param {{runId: string, callId: string, decision: import("./events.mjs").PermissionDecision}} input */
    decidePermission({ runId: rid, callId, decision }) {
      emit({ type: "permission.decided", runId: rid, callId, decision, at: new Date().toISOString() });
      // Allowing resumes the script. Denying does not: the reducer has already
      // blocked the run, and inventing a recovery would be fiction.
      if (decision !== "deny") timer = setTimeout(pump, stepMs);
      return Promise.resolve();
    },
    listModels: () => Promise.resolve([]),
    downloadModel: () => Promise.reject(new RuntimeUnavailable("Downloading needs the desktop app")),
    loadModel: () => Promise.reject(new RuntimeUnavailable("Loading a model needs the desktop app")),
    unloadModel: () => Promise.reject(new RuntimeUnavailable()),
    capabilities: () => Promise.reject(new RuntimeUnavailable()),
  };
}
