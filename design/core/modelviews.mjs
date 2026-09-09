// @ts-check
/**
 * The markup for the model lists, written once.
 *
 * These are pure string functions over the store's state, with no DOM and no
 * globals, so the build renders the first paint in Node and the controller
 * re-renders the same markup in the browser whenever the store changes. Two
 * renderers over one store drift within a release; one renderer cannot.
 *
 * Every control emits an event name rather than a verb, so a button's markup
 * says exactly what it will dispatch:
 *   data-model-act="model.unloaded" data-model-id="qwen25-coder-14b-q4km"
 * Buttons that need a runtime ForgeLocal does not have carry data-load-model
 * instead and open the loader, which explains why nothing loaded.
 */

import { gb, fmtCtx, commas } from "./units.mjs";
import { escapeHtml as esc } from "./html.mjs";
import {
  allModels, installedModels, installedBytes, isLoaded, isAgentReady,
  runningDownloads, failedDownloads, completedDownloads,
  downloadPercent, downloadSummary, recommendedParams, estimateMemory,
} from "./modelstore.mjs";

/** @typedef {import('./modelstore.mjs').ModelState} ModelState */
/** @typedef {import('./models.mjs').ModelRecord} ModelRecord */
/** @typedef {import('./machine.mjs').MachineProfile} MachineProfile */


/* ------------------------------------------------------------- my models -- */

/**
 * The context a model would actually run at: the loaded instance's real figure
 * when one exists, and the recommended one otherwise. The two are labelled
 * differently, because a prediction is not a measurement.
 * @param {ModelRecord} m
 * @param {MachineProfile} pc
 */
function contextFigure(m, pc) {
  const inst = m.loadedInstances[0];
  if (inst) return { value: fmtCtx(inst.contextTokens), label: "context" };
  return { value: fmtCtx(recommendedParams(m, pc).contextTokens), label: "context, recommended" };
}

/**
 * @param {ModelRecord} m
 * @param {MachineProfile} pc
 */
function memoryFigure(m, pc) {
  const inst = m.loadedInstances[0];
  // Only a runtime that reported its allocation gets the unqualified label.
  // A loaded model whose adapter said nothing is still an estimate, and says so.
  if (inst && inst.vramBytes) return { value: `${gb(inst.vramBytes, 1)} GB`, label: "in video memory" };
  const est = estimateMemory(m, recommendedParams(m, pc));
  return { value: `${gb(est.vramBytes, 1)} GB`, label: inst ? "in memory, estimated" : "when loaded, estimated" };
}

/**
 * One row of /app/models/installed/.
 * @param {ModelRecord} m
 * @param {MachineProfile} pc
 */
export function installedRow(m, pc) {
  const loaded = isLoaded(m);
  const ctx = contextFigure(m, pc);
  const mem = memoryFigure(m, pc);
  // Load cannot happen in a browser, so it opens the loader, which says so.
  // Eject can: it is a local state change with no runtime behind it.
  const action = loaded
    ? `<button class="btn btns" type="button" data-model-act="model.unloaded"
        data-model-id="${esc(m.id)}">Eject</button>`
    : `<button class="btn btns" type="button" data-load-model="${esc(m.id)}">Load</button>`;

  return `<li data-filter-item data-name="${esc(m.displayName)} ${esc(m.publisher)}"
      data-tags="installed${loaded ? " loaded" : ""}${isAgentReady(m) ? " agent" : ""}"
      data-model-item="${esc(m.id)}"${loaded ? ' class="is-current"' : ""}>
      <div class="rrow has-action">
        <div style="min-width:0">
          <button class="rname" type="button" data-model-detail="${esc(m.id)}">${esc(m.displayName)}</button>
          <p class="ruse">${esc(m.bestFor || "")}</p>
          <p class="rmeta"><span data-load-pill>${loaded ? "Loaded" : "On disk"}</span>
            &middot; ${esc(m.quantization || "")} &middot; ${esc(m.publisher)}</p>
        </div>
        <span class="rfit">${loaded ? "In video memory" : "On disk only"}</span>
        <div class="rnums">
          <span class="rnum"><b>${gb(m.fileSizeBytes, 2)} GB</b><span>on disk</span></span>
          <span class="rnum"><b>${esc(mem.value)}</b><span>${esc(mem.label)}</span></span>
          <span class="rnum"><b>${esc(ctx.value)}</b><span>${esc(ctx.label)}</span></span>
        </div>
        ${action}
      </div>
    </li>`;
}

/**
 * @param {ModelState} s
 * @param {MachineProfile} pc
 */
export const installedList = (s, pc) => installedModels(s).map((m) => installedRow(m, pc)).join("\n");

/**
 * The figures above the list. Free space is the machine's, minus what the
 * models in the store take, so deleting one moves both numbers together.
 * @param {ModelState} s
 * @param {MachineProfile} pc
 */
export function installedStats(s, pc) {
  const used = installedBytes(s);
  const count = installedModels(s).length;
  return {
    totalGB: gb(used, 2),
    freeGB: gb(pc.diskFreeBytes - used, 0),
    count,
    countLabel: `${count} model${count === 1 ? "" : "s"}`,
  };
}

/* ------------------------------------------------------------- downloads -- */

/**
 * The detail line under a download. models.mjs owns the wording for every
 * state, so a row here and a row on any other surface cannot phrase the same
 * state two ways.
 * @param {ModelRecord} m
 */
export const downloadDetail = (m) => (m.downloadState ? downloadSummary(m.downloadState) : "");

const STATE_WORD = {
  queued: "Queued", downloading: "Downloading", paused: "Paused",
  verifying: "Verifying", completed: "Installed", failed: "Stopped", canceled: "Cancelled",
};

/** @param {ModelRecord} m */
function runningRow(m) {
  const d = m.downloadState;
  if (!d) return "";
  const running = d.state === "downloading";
  const pct = downloadPercent(d);
  const toggle = d.state === "paused"
    ? `<button class="btn btns" type="button" data-model-act="download.resumed" data-model-id="${esc(m.id)}">Resume</button>`
    : `<button class="btn btns" type="button" data-model-act="download.paused" data-model-id="${esc(m.id)}">Pause</button>`;
  return `<div class="dlrow" data-download-row="${esc(m.id)}">
      <div class="dl-main">
        <span class="dl-n">${esc(m.displayName)} <span class="faint">${esc(m.quantization || "")}</span></span>
        <div class="track dl-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
          aria-valuenow="${pct}" aria-label="${esc(m.displayName)} download progress">
          <div class="fillbar" style="width:${pct}%${running ? "" : ";opacity:.45"}"></div>
        </div>
        <p class="dl-m num">${esc(downloadDetail(m))}</p>
      </div>
      <span class="rfit dl-s"><span class="dot ${running ? "acc pulse" : "warn"}" aria-hidden="true"></span>${STATE_WORD[d.state]}</span>
      <div class="dl-a">
        ${d.state === "verifying" ? "" : toggle}
        <button class="btn btns btnq" type="button" style="border-color:var(--line)"
          data-model-act="download.canceled" data-model-id="${esc(m.id)}">Cancel</button>
      </div>
    </div>`;
}

/** @param {ModelRecord} m */
function failedRow(m) {
  const d = m.downloadState;
  if (!d) return "";
  return `<div class="dlrow" data-download-row="${esc(m.id)}">
      <div class="dl-main">
        <span class="dl-n">${esc(m.displayName)} <span class="faint">${esc(m.quantization || "")}</span></span>
        <p class="dl-m">${esc(downloadDetail(m))}</p>
      </div>
      <span class="rfit dl-s is-bad">Stopped</span>
      <div class="dl-a">
        <button class="btn btns" type="button" data-model-act="download.retried" data-model-id="${esc(m.id)}">Retry</button>
        <button class="btn btns btnq" type="button" style="border-color:var(--line)"
          data-model-act="download.canceled" data-model-id="${esc(m.id)}">Remove</button>
      </div>
    </div>`;
}

/** @param {ModelRecord} m */
function completedRow(m) {
  const d = m.downloadState;
  if (!d) return "";
  const gone = !m.installed;
  return `<div class="dlrow" data-download-row="${esc(m.id)}">
      <div class="dl-main">
        <span class="dl-n">${esc(m.displayName)} <span class="faint">${esc(m.quantization || "")}</span></span>
        <p class="dl-m num">${gb(d.totalBytes, 2)} GB &middot; checksum verified &middot;
          ${gone ? "deleted from disk" : "C:\\Users\\you\\ForgeLocal\\models"}</p>
      </div>
      <span class="rfit dl-s">${gone ? "Deleted" : "Installed"}</span>
      <div class="dl-a">
        ${gone || isLoaded(m) ? "" : `<button class="btn btns" type="button" data-load-model="${esc(m.id)}">Load</button>`}
      </div>
    </div>`;
}

/**
 * The whole Downloads page body. Empty groups are omitted rather than shown
 * with a zero, and when every group is empty the page says so once.
 * @param {ModelState} s
 */
export function downloadsHtml(s) {
  const running = runningDownloads(s);
  const failed = failedDownloads(s);
  const done = completedDownloads(s);

  const section = (id, title, rows) => rows.length
    ? `<section aria-labelledby="dl-${id}" data-dl-group="${id}">
        <h2 class="lab" id="dl-${id}" style="margin:0 0 8px">${title}</h2>
        <div class="index">${rows.join("\n")}</div>
      </section>`
    : "";

  const body = [
    section("active", "Active", running.map(runningRow)),
    section("failed", "Stopped", failed.map(failedRow)),
    section("done", "Completed", done.map(completedRow)),
  ].filter(Boolean).join("\n");

  return body || `<p class="chat-empty" style="padding:36px 2px">Nothing is downloading.
    Start one from <a class="link" href="/app/models/">Explore</a> and it appears here with its progress.</p>`;
}

/**
 * The count beside the Downloads tab. Only in-flight work counts: a finished
 * download is not something waiting for the user.
 * @param {ModelState} s
 */
export const downloadsBadge = (s) => runningDownloads(s).length + failedDownloads(s).length;

/**
 * The single-line strip on the installed page. It shows the one download that
 * is running, because only one runs at a time, and nothing at all when none is.
 * @param {ModelState} s
 */
export function downloadStrip(s) {
  const [m] = runningDownloads(s);
  if (!m || !m.downloadState) return "";
  const d = m.downloadState;
  const pct = downloadPercent(d);
  const running = d.state === "downloading";
  const toggle = d.state === "paused" ? "download.resumed" : "download.paused";
  return `<div class="box" style="padding:12px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span class="dot ${running ? "acc pulse" : "warn"}" aria-hidden="true"></span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13.5px;font-weight:600">${STATE_WORD[d.state]} ${esc(m.displayName)}</div>
        <div class="lab num" style="margin-top:2px">${esc(downloadDetail(m))}</div>
      </div>
      <div class="track" style="width:120px;flex-shrink:0" role="progressbar" aria-valuemin="0"
        aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(m.displayName)} download progress">
        <div class="fillbar" style="width:${pct}%${running ? "" : ";opacity:.45"}"></div>
      </div>
      <button class="btn btnq btns" type="button" style="border-color:var(--line);flex-shrink:0"
        data-model-act="${toggle}" data-model-id="${esc(m.id)}">${d.state === "paused" ? "Resume" : "Pause"}</button>
    </div>`;
}

/* ------------------------------------------------------------- summaries -- */

/**
 * One line of prose for the top of the Downloads page, so the state is legible
 * without reading every row.
 * @param {ModelState} s
 */
export function downloadsSummary(s) {
  // Each state counts as itself. Pausing a download used to leave the sentence
  // reading "1 download in progress" while both rows below said Paused.
  /** @type {Record<string, ModelRecord[]>} */
  const by = { downloading: [], paused: [], queued: [], verifying: [], failed: [] };
  for (const m of runningDownloads(s).concat(failedDownloads(s))) {
    const state = m.downloadState && m.downloadState.state;
    if (state && by[state]) by[state].push(m);
  }

  const outstanding = [...by.downloading, ...by.paused, ...by.queued, ...by.verifying];
  if (!outstanding.length && !by.failed.length) return "No active downloads.";

  const parts = [];
  if (by.downloading.length) parts.push(`${by.downloading.length} download${by.downloading.length === 1 ? "" : "s"} in progress`);
  if (by.paused.length) parts.push(`${by.paused.length} paused`);
  if (by.queued.length) parts.push(`${by.queued.length} queued`);
  if (by.verifying.length) parts.push(`${by.verifying.length} verifying`);

  // The remaining bytes cover everything still owed, so the sentence names that
  // scope rather than implying it belongs to the downloads that are running.
  const remaining = outstanding.reduce((n, m) =>
    n + (m.downloadState ? m.downloadState.totalBytes - m.downloadState.receivedBytes : 0), 0);
  if (remaining > 0) parts.push(`${gb(remaining, 1)} GB remaining`);

  if (by.failed.length) parts.push(`${by.failed.length} stopped`);
  return parts.join(" · ") + ".";
}

/** @param {ModelState} s */
export const totalModelsLine = (s) => `${commas(allModels(s).length)} in the catalog`;

/* ---------------------------------------------------------------- picker -- */

const TICK = '<svg class="tick" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/**
 * One row of the composer's model picker. A loaded model can be selected; an
 * installed one opens the loader instead, because selecting a model that is not
 * resident would enable Send with nothing to send to.
 * @param {ModelRecord} m
 * @param {string|null} selectedId
 * @param {MachineProfile} pc
 */
function pickerRow(m, selectedId, pc) {
  const on = m.id === selectedId;
  const loaded = isLoaded(m);
  const ctx = contextFigure(m, pc);
  const meta = loaded
    ? `${esc(m.quantization || "")} &middot; ${esc(ctx.value)} context &middot; ${memoryFigure(m, pc).value} in use`
    : `${esc(m.quantization || "")} &middot; ${gb(m.fileSizeBytes, 1)} GB on disk`;
  const attrs = loaded
    ? `data-model-row data-model-id="${esc(m.id)}" data-model-name="${esc(m.displayName)}" data-state="loaded"`
    : `data-load-model="${esc(m.id)}" data-state="installed"`;
  return `<button role="menuitemradio" aria-checked="${on}" class="mpick-row"
    ${attrs} title="${esc(m.displayName)}">
    <span class="ic"><span class="dot${loaded ? " ok" : ""}" aria-hidden="true"></span></span>
    <span class="n">${esc(m.displayName)}</span>
    ${isAgentReady(m) ? '<span class="badge-agent">Agent-ready</span>' : ""}
    <span class="meta">${meta}</span>
    ${on ? TICK : ""}
  </button>`;
}

/**
 * The composer's model picker, rendered from the store so the section a model
 * appears in always matches what the installed and downloads pages say.
 * @param {ModelState} s
 * @param {MachineProfile} pc
 */
export function pickerHtml(s, pc) {
  const installed = installedModels(s);
  const loaded = installed.filter(isLoaded);
  const idle = installed.filter((m) => !isLoaded(m));

  const section = (label, list) => list.length
    ? `<span class="mpick-h">${label}</span>${list.map((m) => pickerRow(m, s.selectedId, pc)).join("\n")}`
    : "";

  return `${section("Loaded", loaded)}
    ${section("Installed", idle)}
    ${loaded.length ? "" : `<p class="pd-note" style="padding:8px 9px">No model is loaded, so nothing can be sent yet.</p>`}
    <div class="mpick-foot">
      <a class="btn btns" href="/app/models/installed/" data-open-manager>Model manager</a>
      <a class="btn btns btnq" href="/app/models/" style="border-color:var(--line)">Find a model</a>
    </div>`;
}

/**
 * What the composer's model button says. With nothing loaded it must not name a
 * model, because naming one implies it could be sent to.
 * @param {ModelState} s
 */
export function composerModelLabel(s) {
  const m = s.selectedId ? s.byId[s.selectedId] : null;
  return m && isLoaded(m) ? m.displayName : "No model loaded";
}
