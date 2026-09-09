// @ts-check
/**
 * The one model store, and the only thing any surface reads.
 *
 * ForgeLocal serves separate HTML documents, so module memory dies on every
 * navigation. The store therefore persists under a versioned namespace and is
 * rehydrated before the first render. Seed data initialises it once; navigating
 * never re-seeds, or a paused download would restart itself every time the user
 * opened another page.
 */

import { applyDownloadAction, downloadSummary, downloadPercent, isLoaded, isAgentReady } from "./models.mjs";

/** @typedef {import('./models.mjs').ModelRecord} ModelRecord */
/** @typedef {import('./models.mjs').DownloadView} DownloadView */
/** @typedef {import('./models.mjs').DownloadState} DownloadState */

export const STORE_KEY = "forgelocal:model-store:v1";

/**
 * @typedef {object} ModelState
 * @property {number} version
 * @property {Record<string, ModelRecord>} byId
 * @property {string|null} selectedId     the model the composer will send to
 * @property {string[]} order             catalog order, kept out of the records
 */

const VERSION = 1;

/**
 * @typedef {{type:'download.queued', modelId:string}
 *   | {type:'download.started', modelId:string}
 *   | {type:'download.progress', modelId:string, receivedBytes:number, bytesPerSecond?:number, etaSeconds?:number}
 *   | {type:'download.retried', modelId:string}
 *   | {type:'download.paused', modelId:string}
 *   | {type:'download.resumed', modelId:string}
 *   | {type:'download.verifying', modelId:string}
 *   | {type:'download.completed', modelId:string}
 *   | {type:'download.failed', modelId:string, reason:string}
 *   | {type:'download.canceled', modelId:string}
 *   | {type:'model.load.requested', modelId:string, params?:LoadParams}
 *   | {type:'model.load.completed', modelId:string, instanceId:string, contextTokens:number, vramBytes?:number}
 *   | {type:'model.load.failed', modelId:string, reason:string}
 *   | {type:'model.unloaded', modelId:string}
 *   | {type:'model.deleted', modelId:string}
 *   | {type:'model.selected', modelId:string}
 * } ModelEvent
 */

/**
 * @typedef {object} LoadParams
 * @property {number} contextTokens
 * @property {number} gpuLayers
 * @property {boolean} flashAttention
 * @property {'f16'|'q8_0'} kvCacheType
 * @property {number} cpuThreads
 * @property {number} batchSize
 */

/**
 * @param {ModelRecord[]} seed
 * @returns {ModelState}
 */
export function createState(seed) {
  /** @type {Record<string, ModelRecord>} */
  const byId = {};
  for (const m of seed) byId[m.id] = m;
  const loaded = seed.find(isLoaded);
  return { version: VERSION, byId, selectedId: loaded ? loaded.id : null, order: seed.map((m) => m.id) };
}

/* ---------------------------------------------------------------- reducer -- */

/** @param {ModelState} s @param {string} id @param {(m: ModelRecord) => ModelRecord} fn */
const mapModel = (s, id, fn) => {
  const m = s.byId[id];
  if (!m) return s;
  const next = fn(m);
  return next === m ? s : { ...s, byId: { ...s.byId, [id]: next } };
};

/**
 * Apply a download action, returning the SAME record when the transition is not
 * legal. Identity is what makes an event idempotent for every consumer, not
 * just for the download itself.
 * @param {ModelRecord} m
 * @param {import("./models.mjs").DownloadAction} action
 * @param {{failure?: string}} [meta]
 * @returns {ModelRecord}
 */
const withDownload = (m, action, meta) => {
  if (!m.downloadState) return m;
  const next = applyDownloadAction(m.downloadState, action, meta);
  return next === m.downloadState ? m : { ...m, downloadState: next };
};

/** @param {ModelRecord} m @param {DownloadState} state */
const startDownload = (m, state) => ({
  ...m,
  downloadState: m.downloadState || {
    modelId: m.id, state, receivedBytes: 0, totalBytes: m.fileSizeBytes,
  },
});

/**
 * @param {ModelState} state
 * @param {ModelEvent} event
 * @returns {ModelState}
 */
export function reduceModels(state, event) {
  switch (event.type) {
    case "download.queued":
      return mapModel(state, event.modelId, (m) =>
        m.installed || m.downloadState ? m : startDownload(m, "queued"));

    case "download.started":
    case "download.resumed":
      return mapModel(state, event.modelId, (m) => withDownload(m, "resume"));

    case "download.progress":
      return mapModel(state, event.modelId, (m) => {
        const dl = m.downloadState;
        if (!dl || dl.state !== "downloading") return m;
        // Progress never moves backward. Only a retry, which resets to queued,
        // may lower the byte count.
        if (event.receivedBytes < dl.receivedBytes) return m;
        return { ...m, downloadState: {
          ...dl,
          receivedBytes: Math.min(event.receivedBytes, dl.totalBytes),
          bytesPerSecond: event.bytesPerSecond,
          etaSeconds: event.etaSeconds,
        } };
      });

    case "download.retried":
      // Retry is not a fresh queue: the bytes already on disk are kept, and the
      // failure message goes with the state that produced it.
      return mapModel(state, event.modelId, (m) => {
        const next = withDownload(m, "retry");
        if (next === m || !next.downloadState) return next;
        const { failure, ...rest } = next.downloadState;
        return { ...next, downloadState: rest };
      });

    case "download.paused":
      return mapModel(state, event.modelId, (m) => withDownload(m, "pause"));

    case "download.verifying":
      return mapModel(state, event.modelId, (m) => withDownload(m, "verify"));

    case "download.completed":
      return mapModel(state, event.modelId, (m) => {
        if (!m.downloadState) return m;
        const next = applyDownloadAction(m.downloadState, "finish");
        if (next === m.downloadState) return m;
        // A completed download is what makes a model installed; nothing else does.
        return { ...m, downloadState: next, installed: true };
      });

    case "download.failed":
      return mapModel(state, event.modelId, (m) => withDownload(m, "fail", { failure: event.reason }));

    case "download.canceled":
      // A cancel does not install anything, whatever had been received.
      return mapModel(state, event.modelId, (m) => withDownload(m, "cancel"));

    case "model.load.requested":
      // Requesting is not loading. Nothing changes until an adapter reports back.
      return state;

    case "model.load.completed": {
      const next = mapModel(state, event.modelId, (m) => m.installed ? {
        ...m,
        loadedInstances: [{
          instanceId: event.instanceId,
          contextTokens: event.contextTokens,
          vramBytes: event.vramBytes,
        }],
      } : m);
      if (next === state) return state;
      // Only one model is resident at a time, so loading one evicts the rest.
      const byId = { ...next.byId };
      for (const id of Object.keys(byId)) {
        if (id !== event.modelId && byId[id].loadedInstances.length) {
          byId[id] = { ...byId[id], loadedInstances: [] };
        }
      }
      return { ...next, byId, selectedId: event.modelId };
    }

    case "model.load.failed":
      return state;

    case "model.unloaded": {
      const next = mapModel(state, event.modelId, (m) =>
        m.loadedInstances.length ? { ...m, loadedInstances: [] } : m);
      if (next === state) return state;
      return { ...next, selectedId: fallbackSelection(next, event.modelId) };
    }

    case "model.deleted": {
      const next = mapModel(state, event.modelId, (m) => m.installed
        // The file goes; the catalog entry stays, so the model is still
        // discoverable and can be downloaded again.
        ? { ...m, installed: false, loadedInstances: [], downloadState: undefined }
        : m);
      if (next === state) return state;
      return { ...next, selectedId: fallbackSelection(next, event.modelId) };
    }

    case "model.selected":
      // A model can only be selected when there is a loaded instance to send to.
      return isLoaded(state.byId[event.modelId] || { loadedInstances: [] })
        ? { ...state, selectedId: event.modelId }
        : state;

    default:
      return state;
  }
}

/**
 * When the selected model stops being usable, fall back to any other loaded
 * model, or to nothing. Never to an unloaded one.
 * @param {ModelState} s @param {string} removedId
 */
function fallbackSelection(s, removedId) {
  if (s.selectedId !== removedId) return s.selectedId;
  const other = Object.values(s.byId).find((m) => isLoaded(m));
  return other ? other.id : null;
}

/** @param {ModelState} s @param {ModelEvent[]} events */
export const reduceAllModels = (s, events) => events.reduce(reduceModels, s);

/**
 * Drop every loaded instance, and any selection that depended on one.
 *
 * A loaded instance is a claim that a runtime is holding weights in memory.
 * With no runtime connected that cannot be true of any model, however the
 * store was seeded, so the seed's own "loaded" flag is cleared rather than
 * left to contradict the runtime on the same screen.
 * @param {ModelState} s
 * @returns {ModelState}
 */
export function clearLoaded(s) {
  const ids = Object.keys(s.byId).filter((id) => s.byId[id].loadedInstances.length);
  if (!ids.length && s.selectedId === null) return s;
  const byId = { ...s.byId };
  for (const id of ids) byId[id] = { ...byId[id], loadedInstances: [] };
  return { ...s, byId, selectedId: null };
}

/* -------------------------------------------------------------- selectors -- */

/** @param {ModelState} s */
export const allModels = (s) => s.order.map((id) => s.byId[id]).filter(Boolean);
/** @param {ModelState} s */
export const installedModels = (s) => allModels(s).filter((m) => m.installed);
/** @param {ModelState} s */
export const loadedModels = (s) => allModels(s).filter(isLoaded);
/** @param {ModelState} s */
export const unloadedInstalled = (s) => installedModels(s).filter((m) => !isLoaded(m));
/** Everything the Downloads page still owes the user an outcome for. */
/** @param {ModelState} s */
export const activeDownloads = (s) => allModels(s)
  .filter((m) => m.downloadState && !["completed", "canceled"].includes(m.downloadState.state));

/** @type {DownloadState[]} */
const RUNNING = ["queued", "downloading", "paused", "verifying"];
/** In flight, including paused: the download is still going to finish. */
/** @param {ModelState} s */
export const runningDownloads = (s) => allModels(s)
  .filter((m) => m.downloadState && RUNNING.includes(m.downloadState.state));
/** Stopped with a reason, and retryable. */
/** @param {ModelState} s */
export const failedDownloads = (s) => allModels(s)
  .filter((m) => m.downloadState && m.downloadState.state === "failed");
/** Finished and verified, which is the only way a model becomes installed. */
/** @param {ModelState} s */
export const completedDownloads = (s) => allModels(s)
  .filter((m) => m.downloadState && m.downloadState.state === "completed");
/** @param {ModelState} s */
export const selectedModel = (s) => (s.selectedId ? s.byId[s.selectedId] || null : null);
/** @param {ModelState} s */
export const canSend = (s) => { const m = selectedModel(s); return !!m && isLoaded(m); };
/** @param {ModelState} s */
export const installedBytes = (s) =>
  installedModels(s).reduce((n, m) => n + m.fileSizeBytes, 0);

export { downloadSummary, downloadPercent, isLoaded, isAgentReady };

/* ------------------------------------------------- load parameter defaults -- */

/**
 * Recommended parameters for one model. The loader dialog reads these rather
 * than carrying its own constants, so Reset restores what the store says is
 * right for that exact model.
 * @param {ModelRecord} m
 * @param {{vramBytes: number, threads: number}} pc
 * @returns {LoadParams}
 */
export function recommendedParams(m, pc) {
  const max = m.maxContextTokens || 8192;
  // Weights plus a KV cache that grows with context, against usable memory.
  const perToken = m.fileSizeBytes / 2e6;
  const room = Math.max(0, pc.vramBytes - m.fileSizeBytes - 6e8);
  const fits = Math.floor(room / Math.max(perToken, 1));
  const context = Math.min(max, Math.max(4096, 1 << Math.floor(Math.log2(Math.max(fits, 4096)))));
  return {
    contextTokens: context,
    gpuLayers: m.fileSizeBytes < pc.vramBytes ? 99 : Math.floor(99 * (pc.vramBytes / m.fileSizeBytes)),
    flashAttention: true,
    kvCacheType: "f16",
    cpuThreads: Math.max(4, Math.floor(pc.threads / 2)),
    batchSize: 512,
  };
}

/**
 * @param {ModelRecord} m
 * @param {LoadParams} p
 * @returns {{vramBytes:number, ramBytes:number}}
 */
export function estimateMemory(m, p) {
  const onGpu = Math.min(1, p.gpuLayers / 99);
  const kv = p.contextTokens * (m.fileSizeBytes / 2e6) * (p.kvCacheType === "q8_0" ? 0.5 : 1);
  const overhead = 4e8 + p.batchSize * 2e5;
  return {
    vramBytes: Math.round(m.fileSizeBytes * onGpu + kv * onGpu + overhead),
    ramBytes: Math.round(m.fileSizeBytes * (1 - onGpu) + kv * (1 - onGpu) + 3e8),
  };
}

/**
 * Field-level validation, so the dialog can explain a problem next to the input
 * that caused it rather than showing one generic alert.
 * @param {ModelRecord} m
 * @param {LoadParams} p
 * @returns {Record<string, string>} field name to message, empty when valid
 */
export function validateParams(m, p) {
  /** @type {Record<string, string>} */
  const errors = {};
  const max = m.maxContextTokens || 8192;
  if (!Number.isFinite(p.contextTokens) || p.contextTokens < 512) {
    errors.contextTokens = "Must be at least 512 tokens.";
  } else if (p.contextTokens > max) {
    errors.contextTokens = `This model supports up to ${max.toLocaleString()} tokens.`;
  }
  if (!Number.isFinite(p.gpuLayers) || p.gpuLayers < 0 || p.gpuLayers > 99) {
    errors.gpuLayers = "Between 0 and 99.";
  }
  if (!Number.isFinite(p.cpuThreads) || p.cpuThreads < 1 || p.cpuThreads > 64) {
    errors.cpuThreads = "Between 1 and 64.";
  }
  if (!Number.isFinite(p.batchSize) || p.batchSize < 32 || p.batchSize > 4096) {
    errors.batchSize = "Between 32 and 4096.";
  }
  return errors;
}

/**
 * A calm, specific note when the configuration exceeds the machine. Not an
 * error: the configuration is legal, it will just be slower.
 * @param {ModelRecord} m @param {LoadParams} p @param {{vramBytes:number}} pc
 * @returns {string|null}
 */
export function fitNote(m, p, pc) {
  const est = estimateMemory(m, p);
  if (est.vramBytes <= pc.vramBytes * 0.9) return null;
  if (est.vramBytes <= pc.vramBytes) {
    return "This leaves almost no video memory for anything else on the GPU.";
  }
  return `Needs about ${(est.vramBytes / 1e9).toFixed(1)} GB of video memory and this PC has `
    + `${(pc.vramBytes / 1e9).toFixed(0)} GB. The rest would run on the processor, which is slower.`;
}
