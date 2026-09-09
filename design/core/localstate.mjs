// @ts-check
/**
 * The line between what a catalog knows and what only a machine knows.
 *
 * A catalog is a document: it can be served to a browser, and its facts stay
 * true there. Model identity, publisher, licence, source, artifact size and
 * declared capabilities are all catalog facts.
 *
 * Everything else on the model surfaces was a claim about a computer. "On this
 * PC", "6.1 GB of 12 GB", "Runs well", "28.6 MB/s", "checksum verified" and the
 * local model folder are facts only a desktop runtime can report, and the web
 * preview has none. They were rendering anyway, from fixtures.
 *
 * So local state is empty unless something produced it. Demo mode restores the
 * fixtures for visual QA and says so once, at the top of the model center,
 * rather than marking every row.
 */

/** @typedef {import('./models.mjs').ModelRecord} ModelRecord */

/**
 * @typedef {object} HardwareProfile
 * @property {string} label
 * @property {number} vramBytes
 * @property {number} ramBytes
 * @property {number} diskFreeBytes
 */

/**
 * @typedef {object} DesktopModelState
 * @property {'disconnected'|'connecting'|'ready'|'error'} connection
 * @property {HardwareProfile|null} hardware   null until a runtime measures it
 * @property {boolean} demo                    fixtures on, and labelled
 */

/** Demo mode is opt-in per visit and never the default a visitor lands on. */
export const DEMO_KEY = "forgelocal:demo";

/**
 * @param {{search?: string}} loc  typically window.location
 * @param {{getItem: (k: string) => string|null}|null} storage
 * @returns {boolean}
 */
export function readDemoFlag(loc, storage) {
  const search = (loc && loc.search) || "";
  if (/[?&]demo=1\b/.test(search)) return true;
  if (/[?&]demo=0\b/.test(search)) return false;
  try { return storage ? storage.getItem(DEMO_KEY) === "1" : false; } catch { return false; }
}

/**
 * @param {import('./runtime.mjs').RuntimeConnection} runtime
 * @param {boolean} demo
 * @returns {DesktopModelState}
 */
export function desktopState(runtime, demo) {
  const connected = runtime.status !== "disconnected" && runtime.status !== "error";
  return {
    connection: runtime.status === "error" ? "error"
      : runtime.status === "connecting" ? "connecting"
        : connected ? "ready" : "disconnected",
    // A hardware profile is a measurement. Demo mode supplies a labelled one;
    // a disconnected preview has none, and no surface may invent one.
    hardware: demo ? DEMO_HARDWARE : null,
    demo,
  };
}

/**
 * The machine the demo fixtures describe. It exists only in demo mode, and the
 * model center says so, so no figure derived from it can be mistaken for a
 * measurement of the reader's own computer.
 * @type {HardwareProfile}
 */
export const DEMO_HARDWARE = {
  label: "RTX 4070 12 GB, 32 GB RAM",
  vramBytes: 12 * 1024 ** 3,
  ramBytes: 32 * 1024 ** 3,
  diskFreeBytes: 248 * 1024 ** 3,
};

/**
 * Strip every local claim from a catalog record.
 *
 * The model stays in the catalog with its identity, size and capabilities. What
 * goes is the assertion that this computer has it: installed, resident, or
 * part-way through a download.
 * @param {ModelRecord} m
 * @returns {ModelRecord}
 */
export const catalogOnly = (m) => ({
  ...m, installed: false, loadedInstances: [], downloadState: undefined,
});

/**
 * @param {ModelRecord[]} seed
 * @param {DesktopModelState} desktop
 * @returns {ModelRecord[]}
 */
export const applyDesktopState = (seed, desktop) =>
  (desktop.demo ? seed : seed.map(catalogOnly));

/**
 * Whether a compatibility statement may be rendered at all. Without a hardware
 * profile there is no memory to compare a model against, so a row says nothing
 * rather than guessing.
 * @param {DesktopModelState} desktop
 */
export const canJudgeFit = (desktop) => desktop.hardware !== null;

/**
 * One sentence where a fit verdict would go, when there is nothing to judge
 * against. The absence is explained once, in the detail pane, not per row.
 */
export const NO_HARDWARE_NOTE =
  "Connect the desktop app to estimate memory use and performance on this device.";
