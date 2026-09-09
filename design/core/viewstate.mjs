// @ts-check
/**
 * Which single state a model view is in.
 *
 * Three views kept rendering two states at once: My models said both "No models
 * are installed on this device" and "No installed model matches that search",
 * and Explore showed "No model matches that search" beside a selected model's
 * detail. Each of those is two answers to one question.
 *
 * So the decision is made here, once, and returns exactly one state. A view
 * renders what it is given and has no branch of its own to disagree with.
 *
 * The disconnected case is not an empty case. "No models installed" is a fact
 * about a disk this preview has never read; "the desktop app is not connected"
 * is a fact about this page, and is the only one of the two it can state.
 */

/** @typedef {import('./localstate.mjs').DesktopModelState} DesktopModelState */

/**
 * @typedef {object} ViewState
 * @property {'disconnected'|'connecting'|'error'|'empty'|'no-results'|'ready'} kind
 * @property {string} [heading]
 * @property {string} [body]
 * @property {{label: string, href?: string, action?: string}} [action]
 * @property {boolean} searchable  whether a search control has anything to search
 */

const DISCONNECTED = {
  installed: {
    heading: "Desktop app not connected",
    body: "Connect the desktop app to view, load, and manage models stored on this computer.",
  },
  downloads: {
    heading: "Desktop app not connected",
    body: "Downloads and progress will appear here after you connect the desktop app.",
  },
};

const EMPTY = {
  installed: {
    heading: "No models installed yet",
    body: "Browse the catalog to download your first model.",
  },
  downloads: {
    heading: "No downloads yet",
    body: "Browse models to choose one for this computer.",
  },
};

/**
 * @param {'installed'|'downloads'} view
 * @param {DesktopModelState} desktop
 * @param {number} total     rows the runtime reported, before searching
 * @param {number} matches   rows still visible after the query
 * @param {string} query
 * @returns {ViewState}
 */
export function localViewState(view, desktop, total, matches, query = "") {
  const q = query.trim();

  if (desktop.connection === "connecting") {
    return { kind: "connecting", heading: "Connecting to the desktop app", searchable: false };
  }
  if (desktop.connection === "error") {
    return {
      kind: "error",
      heading: "The desktop app could not be reached",
      body: "Reconnect from the runtime menu to try again.",
      searchable: false,
    };
  }
  // Demo mode supplies a local dataset, so the view has rows to show. The
  // connection stays honestly disconnected and the model centre carries the
  // "Demo data" label; what must not happen is fixtures rendering beside a
  // "not connected" message, which is two answers to one question.
  if (desktop.connection === "disconnected" && !desktop.demo) {
    // There is no local dataset, so there is nothing for a search box to search.
    return { ...DISCONNECTED[view], kind: "disconnected", searchable: false,
      action: { label: "Browse models", href: "/app/models/" } };
  }

  if (total === 0) {
    return { ...EMPTY[view], kind: "empty", searchable: false,
      action: { label: "Browse models", href: "/app/models/" } };
  }
  if (q && matches === 0) {
    return {
      kind: "no-results",
      heading: `No ${view === "installed" ? "installed models" : "downloads"} match “${q}”.`,
      searchable: true,
      action: { label: "Clear search", action: "clear-search" },
    };
  }
  return { kind: "ready", searchable: true };
}

/**
 * Explore is a catalog, which a browser can serve, so it has no disconnected
 * state. It has results or it does not.
 * @param {number} total
 * @param {number} matches
 * @param {string} query
 * @returns {ViewState}
 */
export function catalogViewState(total, matches, query = "") {
  const q = query.trim();
  if (total === 0) {
    return { kind: "empty", heading: "The catalog is empty.", searchable: false };
  }
  if (matches === 0) {
    return {
      kind: "no-results",
      // A zero-result list cannot also have a selected result, so the caller
      // hides the detail on this state rather than leaving the last one up.
      heading: q ? `No models match “${q}”.` : "No models match those filters.",
      searchable: true,
      action: { label: "Clear search", action: "clear-search" },
    };
  }
  return { kind: "ready", searchable: true };
}

/** Whether the view should render its rows at all. */
/** @param {ViewState} s */
export const showsRows = (s) => s.kind === "ready";

/** Whether a detail pane may show a selected model. */
/** @param {ViewState} s */
export const showsDetail = (s) => s.kind === "ready";

/**
 * The one block a view renders instead of its rows. One heading, one sentence,
 * at most one action, aligned to the content column: not a bordered card, not
 * centred in the viewport, and not two lines a hundred pixels apart.
 * @param {ViewState} s
 * @param {(v: unknown) => string} esc
 */
export function stateBlockHtml(s, esc) {
  if (s.kind === "ready") return "";
  const action = s.action
    ? (s.action.href
      ? `<a class="vstate-a" href="${esc(s.action.href)}">${esc(s.action.label)}</a>`
      : `<button class="vstate-a" type="button" data-view-action="${esc(s.action.action)}">${esc(s.action.label)}</button>`)
    : "";
  return `<div class="vstate" data-view-state="${esc(s.kind)}">
    ${s.heading ? `<p class="vstate-h">${esc(s.heading)}</p>` : ""}
    ${s.body ? `<p class="vstate-b">${esc(s.body)}</p>` : ""}
    ${action}
  </div>`;
}
