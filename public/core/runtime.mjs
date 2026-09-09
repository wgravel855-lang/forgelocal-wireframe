// @ts-check
/**
 * One runtime state, and the only thing any surface may consult about whether
 * a local runtime exists.
 *
 * Before this, five surfaces each carried their own answer: the composer said
 * "No model loaded", the loader said no runtime was connected, and the runtime
 * popover and settings both reported a healthy llama.cpp b4021 with 11.1 GB of
 * video memory in use. All of those were on screen at once.
 *
 * Nothing here invents a version, a device, a memory figure or a model name.
 * Those fields exist only on the states an actual handshake can produce, so a
 * disconnected runtime has no field to print them from.
 */

/** @typedef {'web-preview'|'desktop'} HostEnvironment */

/**
 * @typedef {object} DeviceInfo
 * @property {string} name
 * @property {number} [vramBytes]
 * @property {number} [vramUsedBytes]
 */

/**
 * @typedef {object} LoadedModel
 * @property {string} modelId
 * @property {string} displayName
 * @property {number} contextTokens
 * @property {number} [vramBytes]
 */

/**
 * @typedef {{status:'disconnected', environment:HostEnvironment}
 *   | {status:'connecting', environment:'desktop'}
 *   | {status:'ready', environment:'desktop', version:string, device:DeviceInfo}
 *   | {status:'loading', environment:'desktop', version:string, device:DeviceInfo, modelId:string}
 *   | {status:'loaded', environment:'desktop', version:string, device:DeviceInfo, model:LoadedModel}
 *   | {status:'busy', environment:'desktop', version:string, device:DeviceInfo, model:LoadedModel, runId:string}
 *   | {status:'error', environment:HostEnvironment, message:string}
 * } RuntimeConnection
 */

/**
 * The browser cannot open a socket to a local process or read a GPU, so a page
 * served over http(s) is a web preview by construction. The desktop shell sets
 * the flag below on the window it creates; nothing else may claim to be one.
 * @param {{forgelocalDesktop?: unknown}} [host] typically `window`
 * @returns {HostEnvironment}
 */
export const detectEnvironment = (host = {}) =>
  (host.forgelocalDesktop ? "desktop" : "web-preview");

/**
 * @param {HostEnvironment} environment
 * @returns {RuntimeConnection}
 */
export const initialRuntime = (environment) => ({ status: "disconnected", environment });

/**
 * @typedef {{type:'runtime.connecting'}
 *   | {type:'runtime.ready', version:string, device:DeviceInfo}
 *   | {type:'runtime.model.loading', modelId:string}
 *   | {type:'runtime.model.loaded', model:LoadedModel}
 *   | {type:'runtime.model.unloaded'}
 *   | {type:'runtime.run.started', runId:string}
 *   | {type:'runtime.run.ended'}
 *   | {type:'runtime.failed', message:string}
 *   | {type:'runtime.disconnected'}
 * } RuntimeEvent
 */

/**
 * Every transition needs a desktop environment to have produced it. A web
 * preview that received a "ready" event has a bug somewhere, not a runtime, so
 * the reducer refuses rather than upgrading the state.
 * @param {RuntimeConnection} state
 * @param {RuntimeEvent} event
 * @returns {RuntimeConnection}
 */
export function reduceRuntime(state, event) {
  const desktop = state.environment === "desktop";

  switch (event.type) {
    case "runtime.connecting":
      return desktop && state.status === "disconnected"
        ? { status: "connecting", environment: "desktop" } : state;

    case "runtime.ready":
      return desktop
        ? { status: "ready", environment: "desktop", version: event.version, device: event.device }
        : state;

    case "runtime.model.loading":
      return desktop && "version" in state && "device" in state
        ? { status: "loading", environment: "desktop", version: state.version, device: state.device, modelId: event.modelId }
        : state;

    case "runtime.model.loaded":
      return desktop && "version" in state && "device" in state
        ? { status: "loaded", environment: "desktop", version: state.version, device: state.device, model: event.model }
        : state;

    case "runtime.model.unloaded":
      return desktop && "version" in state && "device" in state
        ? { status: "ready", environment: "desktop", version: state.version, device: state.device }
        : state;

    case "runtime.run.started":
      return state.status === "loaded"
        ? { ...state, status: "busy", runId: event.runId } : state;

    case "runtime.run.ended":
      return state.status === "busy"
        ? { status: "loaded", environment: "desktop", version: state.version, device: state.device, model: state.model }
        : state;

    case "runtime.failed":
      return { status: "error", environment: state.environment, message: event.message };

    case "runtime.disconnected":
      return state.status === "disconnected"
        ? state : { status: "disconnected", environment: state.environment };

    default:
      return state;
  }
}

/* -------------------------------------------------------------- selectors -- */

/** @param {RuntimeConnection} r */
export const isConnected = (r) =>
  r.status === "ready" || r.status === "loading" || r.status === "loaded" || r.status === "busy";

/** @param {RuntimeConnection} r */
export const loadedModel = (r) =>
  (r.status === "loaded" || r.status === "busy") ? r.model : null;

/**
 * What the composer's runtime control says. "Local" implied a connected local
 * runtime, which is exactly the claim that was false.
 * @param {RuntimeConnection} r
 */
export function runtimeLabel(r) {
  switch (r.status) {
    case "disconnected": return r.environment === "web-preview" ? "Desktop not connected" : "Runtime not running";
    case "connecting": return "Connecting";
    case "ready": return "Runtime ready";
    case "loading": return "Loading model";
    case "loaded": return "Runtime ready";
    case "busy": return "Running";
    case "error": return "Runtime error";
    default: return "Runtime unknown";
  }
}

/** A dot tone, or "" for no dot at all. */
/** @param {RuntimeConnection} r */
export const runtimeTone = (r) =>
  r.status === "error" ? "bad"
    : isConnected(r) ? "ok"
      : "";

/**
 * The rows of the runtime popover. Only fields the state actually carries are
 * returned, so there is no place for a sample version or a sample device to be
 * printed from.
 * @param {RuntimeConnection} r
 * @returns {{title: string, body: string, rows: [string, string][]}}
 */
export function runtimeDetails(r) {
  /** @type {[string, string][]} */
  const rows = [];
  if ("version" in r && r.version) rows.push(["Runtime", r.version]);
  if ("device" in r && r.device) rows.push(["Runs on", r.device.name]);
  const m = loadedModel(r);
  if (m) rows.push(["Loaded model", m.displayName]);
  if (m && m.vramBytes) rows.push(["Video memory", `${(m.vramBytes / 1024 ** 3).toFixed(1)} GB in use`]);

  if (r.status === "error") {
    return { title: "Runtime error", body: r.message, rows };
  }
  if (!isConnected(r)) {
    return {
      title: runtimeLabel(r),
      body: r.environment === "web-preview"
        ? "This is the web preview. Reading files, running commands and loading a model need the desktop app, which is not released yet."
        : "The local runtime is not running. Start it to load a model.",
      rows,
    };
  }
  return { title: runtimeLabel(r), body: "", rows };
}

/**
 * Context usage is a fraction of a real model's window. With no model loaded
 * there is no denominator, so there is no percentage: the control shows an em
 * dash rather than the fixture 34% it used to keep.
 * @param {RuntimeConnection} r
 * @param {{usedTokens?: number}} [usage]
 * @returns {{text: string, percent: number|null, label: string}}
 */
export function contextDisplay(r, usage) {
  const m = loadedModel(r);
  if (!m || !m.contextTokens) {
    return { text: "—", percent: null, label: "Context usage is unavailable until a model is loaded" };
  }
  const used = usage && usage.usedTokens ? usage.usedTokens : 0;
  const percent = Math.min(100, Math.round((used / m.contextTokens) * 100));
  return { text: `${percent}%`, percent, label: `Context used, ${percent} percent` };
}

/**
 * The Models and runtime settings section. A disconnected runtime gets a
 * connection state and what would be needed, not sample hardware: the version,
 * device, model folder and idle policy are facts only a handshake reports.
 * @param {RuntimeConnection} r
 * @returns {{state: string, note: string, rows: [string, string][]}}
 */
export function runtimeSettings(r) {
  /** @type {[string, string][]} */
  const rows = [];
  if ("version" in r && r.version) rows.push(["Runtime", r.version]);
  if ("device" in r && r.device) rows.push(["Device", r.device.name]);
  const m = loadedModel(r);
  if (m) rows.push(["Loaded model", m.displayName]);

  if (isConnected(r)) {
    return { state: runtimeLabel(r), note: "", rows };
  }
  return {
    state: runtimeLabel(r),
    note: r.environment === "web-preview"
      ? "The model folder, runtime version and unload policy are settings of the desktop app. They appear here once it is installed and connected."
      : "Start the local runtime to see its version, device and model folder.",
    rows,
  };
}

/**
 * Why Send is unavailable, in the order the user would have to fix it. The
 * accessible name on a disabled control has to name the missing thing, not
 * merely report that it is disabled.
 * @param {RuntimeConnection} r
 * @param {boolean} hasLoadedModel  from the model store
 */
export function sendBlockedReason(r, hasLoadedModel) {
  if (!isConnected(r)) {
    return r.environment === "web-preview"
      ? "Sending needs the desktop app. This is the web preview, so no runtime is connected."
      : "The local runtime is not running, so there is nothing to send to.";
  }
  if (!hasLoadedModel) return "No model is loaded, so there is nothing to send to.";
  return "";
}
