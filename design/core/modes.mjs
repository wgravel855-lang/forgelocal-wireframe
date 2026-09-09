// @ts-check
/**
 * The permission mode, as one enum with one label map.
 *
 * A stored session carried the legacy value "normal", which no menu offered,
 * and the composer rendered it raw: the control read "normal" in lower case
 * next to Plan, Manual, Allow edits and Auto. Persisted values are now
 * normalised at the boundary, so an unknown value can never reach the DOM.
 */

/** @typedef {'plan'|'manual'|'allow_edits'|'auto'} PermissionMode */

/** @type {PermissionMode} */
export const DEFAULT_MODE = "allow_edits";

/** @type {Record<PermissionMode, string>} */
export const MODE_LABELS = {
  plan: "Plan",
  manual: "Manual",
  allow_edits: "Allow edits",
  auto: "Auto",
};

/** @type {Record<PermissionMode, string>} */
export const MODE_DESCRIPTIONS = {
  plan: "Reads and proposes. Changes nothing.",
  manual: "Asks before every edit, command and network call.",
  allow_edits: "Edits inside the project. Commands and network still ask.",
  auto: "Requires an isolated runtime.",
};

/**
 * Auto is listed so its absence is explained rather than hidden, but it cannot
 * be selected: nothing isolates the process it would run unattended.
 * @param {PermissionMode} mode
 */
export const isSelectable = (mode) => mode !== "auto";

/** Older builds wrote these; each maps to the mode that behaved the same way. */
const LEGACY = {
  normal: "allow_edits",       // the old default, which permitted project edits
  balanced: "allow_edits",
  ask: "manual",
  autopilot: "auto",
  "allow edits": "allow_edits",
};

/**
 * Normalise anything that may have been persisted, typed into storage by hand,
 * or read from an older session file.
 * @param {unknown} value
 * @param {(message: string) => void} [warn] called once for a value that had to be repaired
 * @returns {PermissionMode}
 */
export function normalizeMode(value, warn) {
  if (typeof value === "string") {
    const key = value.trim().toLowerCase();
    if (key in MODE_LABELS) return /** @type {PermissionMode} */ (key);
    if (key in LEGACY) return /** @type {PermissionMode} */ (LEGACY[key]);
    // A label rather than an id, e.g. "Allow edits" straight from the DOM.
    const byLabel = Object.keys(MODE_LABELS).find(
      (id) => MODE_LABELS[/** @type {PermissionMode} */ (id)].toLowerCase() === key);
    if (byLabel) return /** @type {PermissionMode} */ (byLabel);
  }
  if (value !== undefined && value !== null && warn) {
    warn(`Unknown permission mode ${JSON.stringify(value)}; using ${DEFAULT_MODE}.`);
  }
  return DEFAULT_MODE;
}

/**
 * The human label, always from the map. No surface formats a mode itself.
 * @param {unknown} value
 */
export const modeLabel = (value) => MODE_LABELS[normalizeMode(value)];

/** @param {unknown} value */
export const modeDescription = (value) => MODE_DESCRIPTIONS[normalizeMode(value)];

/** The order the menu lists them in: least capable first. */
/** @type {PermissionMode[]} */
export const MODE_ORDER = ["plan", "manual", "allow_edits", "auto"];

const KEYS = { plan: "Ctrl 1", manual: "Ctrl 2", allow_edits: "Ctrl 3", auto: "" };

/**
 * The mode menu, from the enum. The markup used to list four modes by hand,
 * which is how a fifth value ended up selectable in storage but not in the menu.
 * @param {PermissionMode} current
 */
export const modeMenuHtml = (current = DEFAULT_MODE) => MODE_ORDER.map((id) => {
  const on = id === current;
  const off = !isSelectable(id);
  return `<button role="menuitemradio" aria-checked="${on}" class="srow mrow${on ? " on" : ""}"
      type="button" data-mode="${id}"${off ? " disabled aria-disabled=\"true\"" : ""}>
      <span class="mrow-t">${MODE_LABELS[id]}${KEYS[id] ? `<span class="kbd">${KEYS[id]}</span>` : ""}</span>
      <span class="mrow-d">${MODE_DESCRIPTIONS[id]}</span>
    </button>`;
}).join("\n");
