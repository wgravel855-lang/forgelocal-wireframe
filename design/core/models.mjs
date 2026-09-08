// @ts-check
/**
 * One model record and one download state machine, shared by the composer
 * picker, the loader dialog, the catalog, the installed page and the downloads
 * page. Before this, each of those pages carried its own fixture and they could
 * disagree about whether a model was installed.
 */

/** @typedef {import('./events.mjs').ModelCapability} ModelCapability */

/** @typedef {'queued'|'downloading'|'paused'|'verifying'|'completed'|'failed'|'canceled'} DownloadState */

/**
 * @typedef {object} DownloadView
 * @property {string} modelId
 * @property {DownloadState} state
 * @property {number} receivedBytes
 * @property {number} totalBytes
 * @property {number} [bytesPerSecond]  only when the adapter supplies it
 * @property {number} [etaSeconds]      only when the adapter supplies it
 * @property {string} [failure]         why it failed, in the user's terms
 */

/**
 * @typedef {object} LoadedModelInstance
 * @property {string} instanceId
 * @property {number} contextTokens     effective loaded context, not the max
 * @property {number} [vramBytes]
 */

/**
 * @typedef {object} ModelRecord
 * @property {string} id
 * @property {string} displayName
 * @property {string} publisher
 * @property {string} family
 * @property {string} architecture
 * @property {string} [parameterCount]
 * @property {'GGUF'|'MLX'|'other'} format
 * @property {string} [quantization]
 * @property {number} fileSizeBytes
 * @property {number} [maxContextTokens]
 * @property {ModelCapability[]} capabilities
 * @property {string} [license]
 * @property {string} [sourceUrl]
 * @property {string} [updatedAt]
 * @property {number} [downloadCount]
 * @property {number} [likeCount]
 * @property {boolean} installed
 * @property {DownloadView} [downloadState]
 * @property {LoadedModelInstance[]} loadedInstances
 * @property {'excellent'|'good'|'tight'|'unsupported'|'unknown'} [hardwareFit]
 * @property {string} [bestFor]
 */

/**
 * agent_ready is a claim about tool reliability, not a marketing word. It is
 * only set when the model has a compatible chat template and passed the
 * structured tool-call conformance check. A model without it can still answer
 * questions; the UI must not imply it can safely drive tools.
 * @param {ModelRecord} m
 */
export const isAgentReady = (m) => m.capabilities.includes("agent_ready");

/** @param {ModelRecord} m */
export const isLoaded = (m) => m.loadedInstances.length > 0;

/* -------------------------------------------------- download transitions -- */

/** @type {Record<DownloadState, DownloadState[]>} */
const ALLOWED = {
  queued: ["downloading", "canceled", "failed"],
  downloading: ["paused", "verifying", "failed", "canceled"],
  paused: ["downloading", "canceled"],
  verifying: ["completed", "failed"],
  completed: [],
  failed: ["queued", "canceled"],
  canceled: ["queued"],
};

/**
 * @param {DownloadState} from
 * @param {DownloadState} to
 */
export const canTransition = (from, to) => (ALLOWED[from] || []).includes(to);

/** @typedef {'pause'|'resume'|'cancel'|'retry'|'verify'|'finish'|'fail'} DownloadAction */

/** @type {Record<DownloadAction, DownloadState>} */
const ACTION_TARGET = {
  pause: "paused",
  resume: "downloading",
  cancel: "canceled",
  retry: "queued",
  verify: "verifying",
  finish: "completed",
  fail: "failed",
};

/**
 * Idempotent by construction: an action that is not legal from the current
 * state returns the same object, so a double Pause cannot desynchronise the
 * downloads page from the composer.
 * @param {DownloadView} dl
 * @param {DownloadAction} action
 * @param {{failure?: string}} [meta]
 * @returns {DownloadView}
 */
export function applyDownloadAction(dl, action, meta = {}) {
  const to = ACTION_TARGET[action];
  if (!to || !canTransition(dl.state, to)) return dl;
  const next = { ...dl, state: to };
  // A stalled transfer has no speed and no estimate. Dropping them here means
  // no surface has to remember to stop showing them.
  if (to !== "downloading") {
    delete next.bytesPerSecond;
    delete next.etaSeconds;
  }
  if (to === "canceled" || to === "queued") next.receivedBytes = to === "queued" ? dl.receivedBytes : 0;
  if (to === "failed") next.failure = meta.failure || dl.failure;
  if (to === "completed") next.receivedBytes = dl.totalBytes;
  return next;
}

/** @param {DownloadView} dl */
export const downloadPercent = (dl) =>
  dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;

/**
 * The one place that decides what a download row says, so onboarding, My models
 * and Downloads cannot word the same state three ways.
 * @param {DownloadView} dl
 * @returns {string}
 */
export function downloadSummary(dl) {
  const gb = (b) => (b / 1e9).toFixed(2);
  const head = `${gb(dl.receivedBytes)} GB of ${gb(dl.totalBytes)} GB · ${downloadPercent(dl)}%`;
  switch (dl.state) {
    case "downloading":
      return dl.bytesPerSecond
        ? `${head} · ${(dl.bytesPerSecond / 1e6).toFixed(1)} MB/s${dl.etaSeconds ? ` · about ${Math.round(dl.etaSeconds / 60)} min left` : ""}`
        : head;
    case "paused": return `${head} · Paused`;
    case "queued": return `Queued · ${gb(dl.totalBytes)} GB`;
    case "verifying": return `${gb(dl.totalBytes)} GB · Verifying`;
    case "completed": return `${gb(dl.totalBytes)} GB · Verified`;
    case "failed": return `${head} · ${dl.failure || "Failed"}`;
    case "canceled": return "Canceled";
    default: return head;
  }
}

/* ------------------------------------------------------------ model store -- */

/**
 * @typedef {object} ModelStore
 * @property {Record<string, ModelRecord>} byId
 * @property {string|null} selectedId    the model the composer will use
 */

/**
 * @param {ModelRecord[]} records
 * @returns {ModelStore}
 */
export function createStore(records) {
  /** @type {Record<string, ModelRecord>} */
  const byId = {};
  for (const r of records) byId[r.id] = r;
  const loaded = records.find(isLoaded);
  return { byId, selectedId: loaded ? loaded.id : null };
}

/** @param {ModelStore} s */
export const allModels = (s) => Object.values(s.byId);

/** @param {ModelStore} s */
export const loadedModels = (s) => allModels(s).filter(isLoaded);

/** @param {ModelStore} s */
export const installedUnloaded = (s) => allModels(s).filter((m) => m.installed && !isLoaded(m));

/** @param {ModelStore} s */
export const selectedModel = (s) => (s.selectedId ? s.byId[s.selectedId] || null : null);

/**
 * With nothing loaded there is no model to send to, so the composer must not
 * pretend otherwise.
 * @param {ModelStore} s
 */
export const canSend = (s) => {
  const m = selectedModel(s);
  return !!m && isLoaded(m);
};

/**
 * @param {ModelStore} s
 * @param {string} modelId
 * @param {DownloadAction} action
 * @returns {ModelStore}
 */
export function downloadAction(s, modelId, action) {
  const m = s.byId[modelId];
  if (!m || !m.downloadState) return s;
  const next = applyDownloadAction(m.downloadState, action);
  if (next === m.downloadState) return s;
  const installed = next.state === "completed" ? true : m.installed;
  return { ...s, byId: { ...s.byId, [modelId]: { ...m, downloadState: next, installed } } };
}

/**
 * Deleting an installed file removes the file, not the catalog entry: the model
 * is still discoverable and re-downloadable.
 * @param {ModelStore} s
 * @param {string} modelId
 * @returns {ModelStore}
 */
export function deleteInstalled(s, modelId) {
  const m = s.byId[modelId];
  if (!m || !m.installed) return s;
  const next = { ...m, installed: false, loadedInstances: [], downloadState: undefined };
  const selectedId = s.selectedId === modelId ? null : s.selectedId;
  return { ...s, byId: { ...s.byId, [modelId]: next }, selectedId };
}
