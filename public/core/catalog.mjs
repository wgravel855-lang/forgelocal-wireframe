// @ts-check
/**
 * Explore: a searchable catalog beside one detail surface that answers whether
 * to install a model.
 *
 * This renders from ModelRecord, the same type the picker, the installed page,
 * the downloads page and the loader read, so a row and its detail cannot
 * disagree and no surface carries a catalog of its own. It runs in Node for the
 * first paint and in the browser for every selection after that.
 *
 * Nothing here judges whether a model fits without a hardware profile to judge
 * against. When there is none the row says nothing and the detail explains the
 * absence once.
 */

import { escapeHtml as esc } from "./html.mjs";
import { gb, fmtCtx } from "./units.mjs";
import { isAgentReady, isLoaded } from "./models.mjs";
import { estimateMemory, recommendedParams } from "./modelstore.mjs";
import { canJudgeFit, NO_HARDWARE_NOTE } from "./localstate.mjs";

/** @typedef {import('./models.mjs').ModelRecord} ModelRecord */
/** @typedef {import('./localstate.mjs').DesktopModelState} DesktopModelState */

const CAP_LABEL = {
  tool_use: "Tool use",
  agent_ready: "Agent-ready",
  reasoning: "Reasoning",
  vision: "Vision",
  fim: "Fill-in-the-middle",
  chat: "Chat",
};

/**
 * A publisher mark, generated from the name. ForgeLocal does not ship other
 * companies' logos, and inventing one would be worse than a letterform.
 * @param {string} publisher
 */
export function monogram(publisher) {
  const words = String(publisher || "?").trim().split(/[\s-]+/).filter(Boolean);
  const letters = words.length > 1
    ? words[0][0] + words[1][0]
    : (words[0] || "?").slice(0, 2);
  return letters.toUpperCase();
}

/* --------------------------------------------------------- compatibility -- */

/**
 * One compatibility statement, or null when there is nothing to compare
 * against. A row shows the text alone: a coloured dot beside a word that
 * already says the state is the same fact twice.
 * @param {ModelRecord} m
 * @param {DesktopModelState} desktop
 * @returns {{state: 'fits'|'split'|'over', text: string} | null}
 */
export function fitStatement(m, desktop) {
  if (!canJudgeFit(desktop) || !desktop.hardware) return null;
  const vram = desktop.hardware.vramBytes;
  const est = estimateMemory(m, recommendedParams(m, { vramBytes: vram, threads: 8 }));
  if (est.vramBytes <= vram * 0.92) return { state: "fits", text: "Fits in GPU memory" };
  if (m.fileSizeBytes < vram) return { state: "split", text: "GPU + CPU" };
  return { state: "over", text: "Exceeds available memory" };
}

/* ------------------------------------------------------------------ rows -- */

/**
 * One catalog row. The identity anchors the left, the description carries the
 * middle, and the right column is a fixed track so labels never shift between
 * rows.
 * @param {ModelRecord} m
 * @param {string|null} selectedId
 * @param {DesktopModelState} desktop
 */
export function modelRow(m, selectedId, desktop) {
  const on = m.id === selectedId;
  const fit = fitStatement(m, desktop);
  return `<a class="mrow2${on ? " is-on" : ""}" href="?model=${esc(m.id)}"
    role="option" aria-selected="${on}" data-cat-row="${esc(m.id)}" tabindex="${on ? 0 : -1}">
    <span class="mrow2-mark" aria-hidden="true">${esc(monogram(m.publisher))}</span>
    <span class="mrow2-n">${esc(m.displayName)}</span>
    <span class="mrow2-pub">${esc(m.publisher)}</span>
    <span class="mrow2-use">${esc(m.bestFor || "")}</span>
    <span class="mrow2-right">
      <span class="mrow2-size num">${gb(m.fileSizeBytes, 1)} GB</span>
      ${fit ? `<span class="mrow2-fit is-${fit.state}">${esc(fit.text)}</span>` : ""}
      ${m.installed ? `<span class="mrow2-inst">${CHECK}Installed</span>` : ""}
    </span>
  </a>`;
}

const CHECK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

const EXTERNAL = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5"/><path d="M19 5 11 13"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>';

/* ---------------------------------------------------------------- detail -- */

/**
 * What the primary action is allowed to say. Download and Load both need a
 * desktop app that does not exist yet, so the web preview states that plainly
 * rather than offering a button that only produces a toast.
 * @param {ModelRecord} m
 * @param {DesktopModelState} desktop
 */
export function primaryAction(m, desktop) {
  const d = m.downloadState;
  if (d && (d.state === "downloading" || d.state === "paused" || d.state === "queued")) {
    const pct = d.totalBytes ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0;
    return { label: `${d.state === "paused" ? "Paused" : "Downloading"} · ${pct}%`,
      href: "/app/models/downloads/", kind: "link" };
  }
  if (m.installed && isLoaded(m)) return { label: "Loaded", kind: "state" };
  if (m.installed && desktop.connection === "ready") {
    return { label: "Load", kind: "load", modelId: m.id };
  }
  if (m.installed) return { label: "Installed", kind: "state" };
  if (desktop.connection === "ready") {
    return { label: `Download ${gb(m.fileSizeBytes, 1)} GB`, kind: "download", modelId: m.id };
  }
  return { label: "Desktop app required", kind: "unavailable" };
}

/** @param {ModelRecord} m @param {DesktopModelState} desktop */
function actionHtml(m, desktop) {
  const a = primaryAction(m, desktop);
  if (a.kind === "unavailable") {
    return `<button class="btn btns" type="button" disabled aria-disabled="true"
      title="Downloading and loading need the desktop app, which is not released yet.">${esc(a.label)}</button>`;
  }
  if (a.kind === "state") {
    return `<span class="mdet-state">${CHECK}${esc(a.label)}</span>
      <a class="btn btns" href="/app/models/installed/">Open in My models</a>`;
  }
  if (a.kind === "link") {
    return `<a class="btn btns" href="${esc(a.href)}">${esc(a.label)}</a>`;
  }
  if (a.kind === "load") {
    return `<button class="btn btnp btns" type="button" data-load-model="${esc(m.id)}">${esc(a.label)}</button>`;
  }
  return `<button class="btn btnp btns" type="button" data-model-install="${esc(m.displayName)}"
    data-model-id="${esc(m.id)}">${esc(a.label)}</button>`;
}

/**
 * The compatibility module. With a hardware profile it compares the two
 * figures that decide the answer; without one it says what would be needed to
 * produce them, and shows no numbers at all.
 * @param {ModelRecord} m
 * @param {DesktopModelState} desktop
 */
function compatibility(m, desktop) {
  if (!desktop.hardware) {
    return `<section class="mdet-sec">
      <h3 class="mdet-h3">Compatibility</h3>
      <p class="mdet-note">${esc(NO_HARDWARE_NOTE)}</p>
    </section>`;
  }
  const hw = desktop.hardware;
  const params = recommendedParams(m, { vramBytes: hw.vramBytes, threads: 8 });
  const est = estimateMemory(m, params);
  const fit = fitStatement(m, desktop);
  const pct = Math.min(100, Math.round((est.vramBytes / hw.vramBytes) * 100));
  return `<section class="mdet-sec">
    <h3 class="mdet-h3">Compatibility</h3>
    <p class="mdet-fitline is-${fit ? fit.state : "over"}">${fit ? esc(fit.text) : ""}</p>
    <div class="track" style="height:4px;margin:8px 0 10px" role="progressbar"
      aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"
      aria-label="Estimated video memory use">
      <div class="fillbar" style="width:${pct}%"></div>
    </div>
    <dl class="mdet-kv">
      <dt>Video memory</dt><dd class="num">${gb(hw.vramBytes, 0)} GB on ${esc(hw.label)}</dd>
      <dt>Estimated use</dt><dd class="num">${gb(est.vramBytes, 1)} GB at ${esc(fmtCtx(params.contextTokens))} context</dd>
      <dt>Disk needed</dt><dd class="num">${gb(m.fileSizeBytes, 2)} GB</dd>
    </dl>
  </section>`;
}

/**
 * Known specifications only. A row whose value is missing is omitted rather
 * than printed as an em dash: "Architecture —" exposes a gap in the catalog
 * without telling the reader anything.
 * @param {ModelRecord} m
 */
function specification(m) {
  const rows = [
    ["Architecture", m.architecture || m.family],
    ["Parameters", m.parameterCount],
    ["Format", [m.format, m.quantization].filter(Boolean).join(" · ")],
    ["Max context", m.maxContextTokens ? fmtCtx(m.maxContextTokens) : ""],
  ].filter(([, v]) => v && String(v).trim() && String(v).trim() !== "—");
  if (!rows.length) return "";
  return `<section class="mdet-sec">
    <h3 class="mdet-h3">Specification</h3>
    <dl class="mdet-kv">
      ${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("\n      ")}
    </dl>
  </section>`;
}

/**
 * The detail pane.
 * @param {ModelRecord} m
 * @param {DesktopModelState} desktop
 */
export function modelDetail(m, desktop) {
  // Only the two that decide whether this model can drive ForgeLocal. The
  // others are specification and live in the table below, rather than as a
  // row of pills whose length varies per model.
  const SHOWN = ["tool_use", "agent_ready"];
  const caps = (m.capabilities || []).filter((c) => SHOWN.includes(c));
  return `<div class="mdet" data-cat-detail data-model-id="${esc(m.id)}">
    <a class="mdet-back" href="/app/models/">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
      Back to models</a>

    <header class="mdet-h">
      <span class="mdet-mark" aria-hidden="true">${esc(monogram(m.publisher))}</span>
      <div class="mdet-id">
        <h2 class="mdet-name">${esc(m.displayName)}</h2>
        <p class="mdet-sub">${esc(m.publisher)}${m.license ? ` &middot; ${esc(m.license)}` : ""}${
  m.sourceUrl ? ` &middot; <a class="link" href="${esc(m.sourceUrl)}" rel="noreferrer noopener" target="_blank" aria-label="Source model card for ${esc(m.displayName)}, opens the publisher page in a new tab">Source model card ${EXTERNAL}</a>` : ""}</p>
      </div>
      <div class="mdet-act">${actionHtml(m, desktop)}</div>
    </header>

    ${m.bestFor ? `<p class="mdet-desc">${esc(m.bestFor)}</p>` : ""}

    ${caps.length ? `<ul class="mdet-caps">
      ${caps.map((c) => `<li${c === "agent_ready" ? ' class="is-verified"' : ""}>${esc(CAP_LABEL[c] || c)}</li>`).join("")}
    </ul>` : ""}
    <!-- The definition is available on demand rather than spending a paragraph
         on every model in the catalog. -->
    <details class="mdet-help">
      <summary>What Agent-ready means</summary>
      <p>${isAgentReady(m)
    ? "This model produced valid structured tool calls in ForgeLocal's conformance check."
    : "This model has not passed ForgeLocal's tool-call conformance check. It can answer questions about code, but ForgeLocal will not let it drive tools."}</p>
    </details>

    <!-- The one bordered surface in the pane: the artifact being decided on.
         One artifact means one compact row; several would mean a real selector. -->
    <section class="mdet-variant">
      <h3 class="mdet-h3">Download</h3>
      <div class="mvar">
        <span class="mvar-q">${esc(m.format || "GGUF")} &middot; ${esc(m.quantization || "")}</span>
        <span class="mvar-m">${esc(m.parameterCount || "")} &middot; ${esc(fmtCtx(m.maxContextTokens || 8192))} context</span>
        <span class="mvar-s num">${gb(m.fileSizeBytes, 2)} GB</span>
      </div>
    </section>

    ${compatibility(m, desktop)}

    ${specification(m)}
  </div>`;
}

/* ------------------------------------------------------------------ view -- */

/**
 * @param {ModelRecord[]} models
 * @param {string|null} selectedId
 * @param {DesktopModelState} desktop
 */
export function catalogHtml(models, selectedId, desktop) {
  // Desktop opens on a decision, not on an instruction: the first result is
  // selected when the URL names nothing usable.
  const selected = models.find((m) => m.id === selectedId) || models[0] || null;
  const id = selected ? selected.id : null;

  return `<div class="cat" data-catalog>
    <div class="cat-list">
      <div class="cat-rows" role="listbox" aria-label="Models" data-cat-rows>
        ${models.map((m) => `<div data-filter-item
          data-name="${esc(m.displayName + " " + m.publisher)}"
          data-tags="${(m.capabilities || []).join(" ")}${m.installed ? " installed" : ""}"
          >${modelRow(m, id, desktop)}</div>`).join("\n")}
      </div>
      <!-- Filled by the controller when a search empties the list. A zero-result
           list cannot also have a selected result, so the detail is removed
           rather than left showing the last selection. -->
      <div data-cat-state></div>
    </div>
    <div class="cat-detail-wrap" data-cat-detail-wrap>${selected ? modelDetail(selected, desktop) : ""}</div>
  </div>`;
}

/* ------------------------------------------------------------------ sort -- */

/**
 * How Explore may be ordered.
 *
 * "Recommended" is the catalog's own order, which is curated, so it is the
 * identity comparator rather than a score invented here. Every other order is
 * a fact the catalog already carries: nothing sorts by a popularity or
 * download count the catalog does not publish.
 *
 * @type {Record<string, {label: string, compare: ((a: ModelRecord, b: ModelRecord) => number) | null}>}
 */
export const SORTS = {
  recommended: { label: "Recommended", compare: null },
  smallest: { label: "Smallest download", compare: (a, b) => a.fileSizeBytes - b.fileSizeBytes },
  context: {
    label: "Largest context",
    compare: (a, b) => (b.maxContextTokens || 0) - (a.maxContextTokens || 0),
  },
  name: { label: "Name", compare: (a, b) => a.displayName.localeCompare(b.displayName) },
};

/** @param {unknown} id */
export const isSort = (id) => typeof id === "string" && id in SORTS;

/** @param {unknown} id */
export const sortLabel = (id) => (isSort(id) ? SORTS[/** @type {string} */(id)].label : SORTS.recommended.label);

/**
 * Sorted ids, so a caller can reorder rows it already has without re-rendering
 * them. Ties keep catalog order, which makes every sort stable.
 * @param {ModelRecord[]} models
 * @param {unknown} id
 * @returns {string[]}
 */
export function sortedIds(models, id) {
  const sort = isSort(id) ? SORTS[/** @type {string} */(id)] : SORTS.recommended;
  const compare = sort.compare;
  if (!compare) return models.map((m) => m.id);
  return models
    .map((m, i) => ({ m, i }))
    .sort((x, y) => compare(x.m, y.m) || x.i - y.i)
    .map(({ m }) => m.id);
}

/**
 * A row in the loader's installed list.
 *
 * It uses the catalog row's markup and CSS so the two lists share one identity
 * system: the same monogram, the same name and publisher metrics, the same
 * neutral selected fill. What differs is the element, because this one selects
 * within a dialog rather than navigating, and the right column, which carries
 * residency rather than a download size alone.
 * @param {ModelRecord} m
 * @param {string|null} selectedId
 */
export function loaderRow(m, selectedId) {
  const on = m.id === selectedId;
  return `<button class="mrow2${on ? " is-on" : ""}" type="button" role="option"
    aria-selected="${on}" data-loader-pick="${esc(m.id)}" tabindex="${on ? 0 : -1}">
    <span class="mrow2-mark" aria-hidden="true">${esc(monogram(m.publisher))}</span>
    <span class="mrow2-n">${esc(m.displayName)}</span>
    <span class="mrow2-pub">${esc(m.publisher)}${m.quantization ? ` &middot; ${esc(m.quantization)}` : ""}</span>
    <span class="mrow2-right">
      <span class="mrow2-size num">${gb(m.fileSizeBytes, 2)} GB</span>
      ${isLoaded(m) ? `<span class="mrow2-inst">${CHECK}Loaded</span>` : ""}
    </span>
  </button>`;
}
