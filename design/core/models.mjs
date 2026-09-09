// @ts-check
/**
 * One model record and one download state machine, shared by the composer
 * picker, the loader dialog, the catalog, the installed page and the downloads
 * page. Before this, each of those pages carried its own fixture and they could
 * disagree about whether a model was installed.
 */

import { gb } from "./units.mjs";

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
  const head = `${gb(dl.receivedBytes, 2)} GB of ${gb(dl.totalBytes, 2)} GB · ${downloadPercent(dl)}%`;
  switch (dl.state) {
    case "downloading": {
      // Rate and estimate are printed only when the adapter reported them.
      const parts = [head];
      if (dl.bytesPerSecond) parts.push(`${(dl.bytesPerSecond / 1e6).toFixed(1)} MB/s`);
      if (dl.etaSeconds) parts.push(etaWords(dl.etaSeconds));
      return parts.join(" · ");
    }
    case "paused": return `${head} · Paused, and the bytes so far are kept`;
    case "queued": return `Queued · ${gb(dl.totalBytes, 2)} GB · one download runs at a time`;
    case "verifying": return `${gb(dl.totalBytes, 2)} GB received · Verifying against the publisher's checksum`;
    case "completed": return `${gb(dl.totalBytes, 2)} GB · Verified`;
    case "failed": return `Stopped at ${head} · ${dl.failure || "The reason was not reported."}`;
    case "canceled": return "Cancelled";
    default: return head;
  }
}

/** @param {number} seconds */
function etaWords(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  return seconds < 90 ? `about ${Math.round(seconds)} sec left` : `about ${Math.round(seconds / 60)} min left`;
}

