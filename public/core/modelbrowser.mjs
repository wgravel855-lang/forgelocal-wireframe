// @ts-check
/**
 * The model browser: a floating two-pane modal over the application.
 *
 * Pure rendering. Every function here takes a state object and returns HTML,
 * so the whole surface — including the awkward states, which are most of them —
 * can be rendered in a test without a browser, a runtime or a network.
 *
 * The state machine matters more than the markup. A model browser spends most
 * of its life not showing a finished model: it is searching, or the metadata
 * request is in flight, or Hugging Face answered 503, or the download stalled,
 * or the file is on disk but not loaded. Each of those is a different sentence
 * to a person, and rendering them as variations on "nothing here" is how a
 * browser comes to feel broken. They are enumerated in BrowserState and every
 * one has a test.
 *
 * The other rule, inherited from the view model this draws: a field that was
 * not measured is not drawn as if it were. A verified tick appears only where
 * something verified it, a capability badge only where evidence supports it,
 * and a compatibility verdict only where hardware was probed. `unknown` is a
 * state with its own appearance, not a blank.
 */

import { escapeHtml as esc } from "./html.mjs";
import { renderMarkdown } from "./markdown.mjs";
import { sizeLabel } from "./units.mjs";

/** What the list is doing. */
export const ListState = Object.freeze({
  LOADING: "loading",
  READY: "ready",
  EMPTY: "empty",
  ERROR: "error",
  DISCONNECTED: "disconnected",
});

/** What the detail pane is doing. */
export const DetailState = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  READY: "ready",
  ERROR: "error",
});

/** What this machine has done with the selected variant. */
export const InstallState = Object.freeze({
  NONE: "none",
  DOWNLOADING: "downloading",
  PAUSED: "paused",
  FAILED: "failed",
  INSTALLED: "installed",
  LOADING: "loading",
  LOADED: "loaded",
});

/* ------------------------------------------------------------ small parts */

const svg = (d, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;

const MB_ICON = Object.freeze({
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  refresh: svg('<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>'),
  download: svg('<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>'),
  star: svg('<path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.6-.8z"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>'),
  // Capabilities. Deliberately three different shapes, not three dots: they
  // are read at a glance in a 66px row and colour alone is not enough.
  vision: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>'),
  /* A wrench with an open jaw and a straight handle. The previous path was
     neither — two arcs that met wrong and rendered as a blob nobody could name.
     Drawn as one stroke so the jaw stays open at 13px, which is the feature
     that makes it a wrench rather than a lollipop. */
  tool: svg('<path d="M19.4 4.3a5 5 0 0 0-6.6 6.6l-8 8a2.1 2.1 0 0 0 3 3l8-8a5 5 0 0 0 6.6-6.6l-3 3-2.6-.4-.4-2.6z"/>'),
  /* A bulb. This was a circle with an exclamation mark in it, which is the
     universal warning glyph — so a model that supports reasoning was marked
     with the same symbol the interface uses for something being wrong. */
  reasoning: svg('<path d="M12 3a5.5 5.5 0 0 0-3.2 10c.5.4.8 1 .8 1.6v.4h4.8v-.4c0-.6.3-1.2.8-1.6A5.5 5.5 0 0 0 12 3Z"/><path d="M10 19h4"/>'),
  chevron: svg('<path d="m8 10 4-4 4 4"/><path d="m8 14 4 4 4-4"/>'),
  chip: svg('<rect x="7" y="7" width="10" height="10" rx="1.6"/><path d="M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3"/>'),
  external: svg('<path d="M14 5h5v5"/><path d="m19 5-8 8"/><path d="M18 13.5V19H5V6h5.5"/>'),
});

/**
 * A human gap, from an ISO date.
 *
 * Days rather than a precise timestamp: a model updated three months ago is
 * the same fact whichever afternoon it happened, and the row has 80px for it.
 *
 * @param {string|null} iso @param {number} [now]
 */
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const days = Math.floor((now - t) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 45) return `${days} days ago`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} months ago`;
  return `${Math.round(days / 365.25)} years ago`;
}

/** Thousands separators, or a dash when there is no number to show. */
export function countLabel(n) {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : null;
}

/* Bytes become words in units.mjs, for the whole product. */
export { sizeLabel };

/**
 * The square at the left of a row.
 *
 * Real artwork when the runtime fetched some, and a monogram when it did not.
 * The monogram is built from the author because that is the part a person
 * recognises — and it is a fallback, never a substitute for artwork that
 * exists. The hue is derived from the author's name so that the same publisher
 * looks the same in every row, which is most of what artwork is doing here.
 *
 * @param {{dataUri?: string|null, monogram?: string}} artwork @param {string} name
 */
export function artworkHtml(artwork, name) {
  const uri = artwork && artwork.dataUri;
  if (uri) {
    return `<img class="mb-art" src="${esc(uri)}" alt="" width="40" height="40" loading="lazy">`;
  }
  const mono = (artwork && artwork.monogram) || "?";
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="mb-art mb-art-fb" style="--mono-h:${hash}" aria-hidden="true">${esc(mono)}</span>`;
}

/**
 * The three capability marks on a list row.
 *
 * Only drawn where something settled the question. An unknown capability gets
 * no mark at all rather than a greyed one: a row with three dim icons reads as
 * "has all three, disabled", which is the opposite of what is true.
 *
 * @param {any} caps @param {{compact?: boolean}} [opts]
 */
export function capabilityMarks(caps, opts = {}) {
  if (!caps) return "";
  const order = [
    ["vision", "Vision", MB_ICON.vision],
    ["toolUse", "Tool use", MB_ICON.tool],
    ["reasoning", "Reasoning", MB_ICON.reasoning],
  ];
  const marks = order
    .filter(([key]) => caps[key] && caps[key].present === true)
    .map(([key, label, icon]) => `<span class="mb-cap mb-cap-${key}"
      title="${esc(`${label}. ${caps[key].evidence}`)}"
      role="img" aria-label="${esc(label)}">${icon}</span>`);
  return marks.length
    ? `<span class="mb-caps${opts.compact ? " is-compact" : ""}">${marks.join("")}</span>`
    : "";
}

/**
 * The larger capability badges in the summary card.
 *
 * These say all three, including the ones that are absent or unknown, because
 * the card is where somebody decides whether a model suits them and "no
 * vision" is as useful as "vision". The three states look different: present
 * is coloured, absent is struck through in the muted palette, unknown says so.
 *
 * @param {any} caps
 */
export function capabilityBadges(caps) {
  if (!caps) return "";
  const order = [
    ["vision", "Vision", MB_ICON.vision],
    ["toolUse", "Tool Use", MB_ICON.tool],
    ["reasoning", "Reasoning", MB_ICON.reasoning],
  ];
  return order.map(([key, label, icon]) => {
    const c = caps[key] ?? { present: null, evidence: "" };
    const state = c.present === true ? "yes" : c.present === false ? "no" : "unknown";
    const text = state === "unknown" ? `${label}?` : label;
    return `<span class="mb-badge mb-badge-${key} is-${state}"
      title="${esc(c.evidence || label)}">${icon}<span>${esc(text)}</span></span>`;
  }).join("");
}

/** A verified tick, only where something actually verified. @param {boolean|null} verified */
export function verifiedMark(verified) {
  if (verified !== true) return "";
  return `<span class="mb-verified" role="img" aria-label="Verified publisher"
    title="Verified publisher">${svg('<path d="m12 3 2.4 1.8 3-.2.9 2.9 2.4 1.8-1.2 2.7 1.2 2.7-2.4 1.8-.9 2.9-3-.2L12 21l-2.4-1.8-3 .2-.9-2.9L3.3 14.7 4.5 12 3.3 9.3l2.4-1.8.9-2.9 3 .2z" fill="currentColor" stroke="none"/><path d="m8.8 12 2.2 2.2 4.2-4.4" stroke="#fff" stroke-width="2"/>')}</span>`;
}

/* -------------------------------------------------------------- left pane */

/**
 * One row in the list.
 *
 * The whole row is the control. A 66px row with a separate hit target inside
 * it is a row most people miss.
 *
 * @param {any} m @param {{selected?: boolean}} [opts]
 */
export function browserRow(m, opts = {}) {
  const when = relativeTime(m.updatedAt);
  const desc = m.description || "No description published.";
  return `<button class="mb-row${opts.selected ? " is-on" : ""}" type="button"
    role="option" aria-selected="${opts.selected ? "true" : "false"}"
    data-mb-row="${esc(m.repoId)}">
    ${artworkHtml(m.artwork, m.author || m.repoId)}
    <span class="mb-row-body">
      <span class="mb-row-top">
        <span class="mb-row-name">${esc(m.displayName || m.repoId)}</span>
        ${verifiedMark(m.verified)}
      </span>
      <span class="mb-row-desc">${esc(desc)}</span>
    </span>
    <span class="mb-row-right">
      ${capabilityMarks(m.capabilities, { compact: true })}
      ${when ? `<span class="mb-row-when">${esc(when)}</span>` : ""}
    </span>
  </button>`;
}

/** A skeleton row, for the moment before the first list arrives. */
function skeletonRow() {
  return `<div class="mb-row is-skel" aria-hidden="true">
    <span class="mb-art mb-skel"></span>
    <span class="mb-row-body">
      <span class="mb-skel mb-skel-l"></span>
      <span class="mb-skel mb-skel-s"></span>
    </span>
  </div>`;
}

/** A state block inside a pane: an explanation, not a shrug. */
function paneState({ title, body, action = "" }) {
  return `<div class="mb-state">
    <p class="mb-state-t">${esc(title)}</p>
    ${body ? `<p class="mb-state-b">${esc(body)}</p>` : ""}
    ${action}
  </div>`;
}

/**
 * The list pane: search, collection, sort, rows.
 *
 * The controls stay put while the rows scroll, which is the whole reason the
 * toolbar moved in here from the top of the page.
 *
 * @param {any} s
 */
export function listPane(s) {
  const rows = () => {
    switch (s.listState) {
      case ListState.LOADING:
        return `<div class="mb-rows" aria-busy="true">${skeletonRow().repeat(7)}</div>`;
      case ListState.DISCONNECTED:
        return paneState({
          title: "The desktop app is not connected",
          body: "Model search reads Hugging Face through the runtime. This preview has no runtime, so there is nothing to search.",
        });
      case ListState.ERROR:
        return paneState({
          title: "Models could not be listed",
          body: s.listError || "Something went wrong reaching Hugging Face.",
          action: `<button class="mb-btn" type="button" data-mb-retry-list>Try again</button>`,
        });
      case ListState.EMPTY:
        return paneState({
          title: s.query ? `Nothing matches “${s.query}”` : "No models to show",
          body: s.query
            ? "Try a shorter search, or paste a Hugging Face repository like owner/name."
            : "Search for a model by name, or paste a repository.",
        });
      default: {
        const groups = [];
        const curated = s.models.filter((m) => m.curated);
        const found = s.models.filter((m) => !m.curated);
        const block = (list) => list.map((m) =>
          browserRow(m, { selected: m.repoId === s.selectedId })).join("");
        if (curated.length && found.length) {
          groups.push(`<p class="mb-group">Staff picks</p>${block(curated)}`);
          groups.push(`<p class="mb-group">Search results</p>${block(found)}`);
        } else {
          groups.push(block(s.models));
        }
        return `<div class="mb-rows" role="listbox" aria-label="Models">${groups.join("")}</div>`;
      }
    }
  };

  return `<div class="mb-list">
    <div class="mb-listhead">
      <div class="mb-search">
        <span class="mb-search-i" aria-hidden="true">${MB_ICON.search}</span>
        <input type="search" class="mb-search-in" data-mb-search
          value="${esc(s.query ?? "")}" autocomplete="off" spellcheck="false"
          placeholder="Search models by name or author&hellip;"
          aria-label="Search models by name or author">
        ${s.query ? `<button class="mb-search-x" type="button" data-mb-clear
          aria-label="Clear search">${MB_ICON.close}</button>` : ""}
      </div>
      <div class="mb-collect">
        <span class="mb-collect-n">${esc(s.collection || "Staff picks")}</span>
        <button class="mb-icon-btn" type="button" data-mb-refresh
          aria-label="Refresh the list" title="Refresh">${MB_ICON.refresh}</button>
        <span class="grow"></span>
        <label class="mb-sort">
          <span class="vh">Sort models</span>
          <select data-mb-sort>
            ${["Best Match", "Most Downloads", "Most Likes", "Recently Updated"].map((o) =>
    `<option${o === (s.sort || "Best Match") ? " selected" : ""}>${esc(o)}</option>`).join("")}
          </select>
          <span class="mb-sort-c" aria-hidden="true">${MB_ICON.chevron}</span>
        </label>
      </div>
    </div>
    ${rows()}
  </div>`;
}

/* ------------------------------------------------------------- right pane */

/** The statistics strip under the repository name. */
function statsRow(m) {
  const bits = [];
  const d = countLabel(m.downloads);
  const l = countLabel(m.likes);
  const when = relativeTime(m.updatedAt);
  if (d) bits.push(`<span class="mb-stat">${MB_ICON.download}${esc(d)}</span>`);
  if (l) bits.push(`<span class="mb-stat">${MB_ICON.star}${esc(l)}</span>`);
  if (when) bits.push(`<span class="mb-stat mb-stat-when">Last updated: ${esc(when)}</span>`);
  /* Nothing rather than zeroes. A model with no reported downloads has not
     been downloaded zero times; the number was not published. */
  if (!bits.length) bits.push(`<span class="mb-stat is-none">No statistics published</span>`);
  return `<div class="mb-stats">${bits.join("")}</div>`;
}

/**
 * The badge at the right of the statistics strip.
 *
 * Only one, and it is not ours. "Verified" is Hugging Face's own flag, read
 * from the publisher's profile — Google carries it, Qwen does not.
 *
 * There is deliberately no "staff pick" badge. Every model in the default
 * collection is one, so the badge was on almost every model anyone looked at
 * and distinguished nothing; the collection heading already says what the list
 * is. The reasons are still carried in `pickReasons` and still shown, as the
 * tooltip on the row rather than as a second badge competing with a claim
 * somebody else made.
 */
function badgeRow(m) {
  if (m.verified !== true) return "";
  return `<span class="mb-badgerow"><span class="mb-staff is-verified"
    title="Hugging Face lists this publisher as verified.">${verifiedMark(true)}Verified</span></span>`;
}

/**
 * The summary card: description, metadata, capabilities.
 *
 * Every value here can be missing, and each says so in place rather than
 * collapsing the row — a card whose shape changes with what happened to be
 * published is harder to read than one with a stated gap.
 */
export function summaryCard(m) {
  const kv = (label, value, extra = "") => `<span class="mb-kv">
    <span class="mb-kv-k">${esc(label)}</span>
    <span class="mb-kv-v${value ? "" : " is-none"}">${esc(value || "unknown")}${extra}</span>
  </span>`;

  const formats = (m.formats ?? []).length
    ? m.formats.map((f) => `<span class="mb-pill is-fmt">${esc(f)}</span>`).join("")
    : `<span class="mb-kv-v is-none">unknown</span>`;

  return `<div class="mb-card mb-summary">
    ${m.description
    ? `<p class="mb-lede">${esc(m.description)}</p><div class="mb-rule"></div>`
    : `<p class="mb-lede is-none">This repository publishes no description.</p><div class="mb-rule"></div>`}
    <div class="mb-meta">
      ${kv("Params", m.parameters?.label)}
      ${kv("Arch", m.architecture)}
      ${kv("Domain", m.domain)}
      <span class="mb-kv">
        <span class="mb-kv-k">Format</span>
        <span class="mb-kv-v">${formats}</span>
      </span>
    </div>
    <div class="mb-meta mb-meta-caps">
      <span class="mb-kv-k">Capabilities</span>
      ${capabilityBadges(m.capabilities)}
    </div>
  </div>`;
}

/**
 * How the selected variant would run here.
 *
 * The five verdicts are the runtime's, not this file's, so the browser cannot
 * disagree with the model list about whether something fits. "Hardware
 * unknown" is one of them and looks like a state rather than like a failure:
 * in the web preview nothing has been measured and that is simply true.
 */
export function compatibilityBadge(compat) {
  if (!compat || !compat.verdict || compat.verdict === "unknown") {
    return `<span class="mb-compat is-unknown" title="${esc(
      compat?.detail || "Nothing has measured this computer, so this cannot be answered.")}">
      ${MB_ICON.chip}Hardware unknown</span>`;
  }
  const map = {
    fits: ["good", "Runs well"],
    partial: ["ok", "Partial GPU offload possible"],
    tight: ["warn", "Tight fit"],
    cpu: ["ok", "CPU only"],
    no: ["bad", "Does not fit"],
  };
  const [tone, label] = map[compat.verdict] ?? ["unknown", "Hardware unknown"];
  return `<span class="mb-compat is-${tone}" title="${esc(compat.detail || label)}">
    ${MB_ICON.chip}${esc(label)}</span>`;
}

/**
 * The download row, as three fixed slots rather than one variable blob.
 *
 * The button used to live inside a group that also held the status text, and
 * the group's width followed the length of that text — so cancelling a
 * download moved the button sideways, because "Paused at 0%" and "Download
 * stopped. It can be resumed." are different lengths. A control that moves
 * when you press it is a control you then press again by accident.
 *
 * So the slots are: the compatibility badge and the status message on the
 * left, growing and truncating as they like, and the action hard against the
 * right edge where it does not move between any two states. The progress bar
 * is a full-width row underneath rather than a third thing competing for the
 * same line.
 *
 * @returns {{status: string, action: string, bar: string}}
 */
function downloadSlots(s, variant) {
  const size = sizeLabel(variant?.bytes);
  const total = s.install?.total || variant?.bytes || 0;
  const pct = total ? Math.min(100, Math.round(((s.install?.bytes ?? 0) / total) * 100)) : 0;
  const btn = (attr, body, cls = "mb-btn mb-btn-p") =>
    `<button class="${cls}" type="button" ${attr}>${body}</button>`;

  switch (s.install?.state) {
    case InstallState.DOWNLOADING:
      return {
        status: `<span class="mb-dl-pct">${pct}%${size ? ` of ${esc(size)}` : ""}</span>`,
        action: btn("data-mb-cancel", "Cancel", "mb-btn"),
        bar: `<div class="mb-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100"
          aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>`,
      };
    case InstallState.PAUSED:
      return {
        /* Says where it stopped, because that is what makes resuming worth
           doing rather than starting again. */
        status: `<span class="mb-dl-pct">Paused at ${pct}%${size ? ` of ${esc(size)}` : ""}</span>`,
        action: btn("data-mb-download", "Resume"),
        bar: pct > 0 ? `<div class="mb-prog is-paused" role="progressbar" aria-valuemin="0"
          aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>` : "",
      };
    case InstallState.FAILED:
      return {
        status: `<span class="mb-dl-pct is-bad">${esc(s.install.reason || "The download failed.")}</span>`,
        action: btn("data-mb-download", "Try again"),
        bar: "",
      };
    case InstallState.INSTALLED:
      return {
        status: "",
        action: btn("data-mb-load", `Load${size ? ` <span class="mb-btn-sz">${esc(size)}</span>` : ""}`),
        bar: "",
      };
    case InstallState.LOADING:
      return {
        status: "",
        action: btn('disabled aria-disabled="true"',
          '<span class="mb-spin" aria-hidden="true"></span>Loading&hellip;'),
        bar: "",
      };
    case InstallState.LOADED:
      return {
        status: "",
        action: `<span class="mb-loaded">${svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>')}Loaded</span>`,
        bar: "",
      };
    default:
      return {
        status: "",
        action: btn(
          `data-mb-download ${s.desktop ? "" : 'disabled aria-disabled="true" title="Downloading needs the desktop app."'}`,
          `${MB_ICON.download}Download${size ? ` <span class="mb-btn-sz">${esc(size)}</span>` : ""}`),
        bar: "",
      };
  }
}

/**
 * Which variant to open on.
 *
 * Not the first one. Hugging Face lists a repository's files in its own
 * order, which for Qwen2.5-Coder-7B-Instruct-GGUF puts Q2_K at the top — so
 * the picker opened on the most degraded build in the repository, and a
 * person who pressed Download without opening the list got that. Q2_K is a
 * deliberate choice for a machine that cannot hold anything larger, not a
 * default.
 *
 * Q4_K_M is the conventional default and what most publishers recommend, so
 * it is preferred where it exists, then the nearest of the usual ladder, and
 * only then the first file. Nothing here consults the hardware: a default
 * that quietly dropped to a smaller quantisation on a small machine would be
 * making that choice without saying so, and the compatibility badge beside
 * the picker already reports the fit honestly.
 *
 * @param {{quantization?: string|null}[]} variants
 * @returns {number} an index into `variants`, 0 when none is recognised
 */
export function defaultVariantIndex(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return 0;
  const ladder = ["Q4_K_M", "Q4_K_S", "Q5_K_M", "Q5_K_S", "Q4_0", "Q6_K", "Q8_0", "Q3_K_M"];
  for (const want of ladder) {
    const i = variants.findIndex((v) => (v.quantization ?? "").toUpperCase() === want);
    if (i >= 0) return i;
  }
  return 0;
}

/** The variant picker and the action beside it. */
export function downloadOptions(s) {
  const m = s.detail?.model;
  const variants = m?.variants ?? [];
  if (!variants.length) {
    return `<section class="mb-sec">
      <h3 class="mb-h3">Download Options</h3>
      ${paneState({
    title: "No GGUF files here",
    body: "This repository publishes no GGUF weights, so ForgeLocal cannot run it.",
  })}
    </section>`;
  }

  const i = Math.min(s.variantIndex ?? 0, variants.length - 1);
  const v = variants[i];
  const size = sizeLabel(v.bytes);
  const family = m.displayName || m.repoId;

  return `<section class="mb-sec">
    <h3 class="mb-h3">Download Options</h3>
    <div class="mb-varrow">
      <label class="mb-var">
        <span class="vh">Choose a file</span>
        <span class="mb-var-face" aria-hidden="true">
          <span class="mb-pill is-fmt">${esc(v.format || "GGUF")}</span>
          <span class="mb-var-name">${esc(family)}</span>
          <span class="mb-pill">${esc(v.quantization)}</span>
          ${v.parts ? `<span class="mb-pill is-mut">${v.parts.count} files</span>` : ""}
          <span class="grow"></span>
          <span class="mb-var-size">${esc(size || "size unknown")}</span>
          <span class="mb-var-c">${MB_ICON.chevron}</span>
        </span>
        <select data-mb-variant ${variants.length > 1 ? "" : "disabled"}>
          ${variants.map((x, n) => `<option value="${n}"${n === i ? " selected" : ""}>${
    esc(`${x.quantization} · ${sizeLabel(x.bytes) || "?"}${x.parts ? ` · ${x.parts.count} files` : ""}`)
  }</option>`).join("")}
        </select>
      </label>
    </div>
    ${(() => {
    const slot = downloadSlots(s, v);
    return `<div class="mb-dlbar">
      ${compatibilityBadge(s.compat)}
      ${slot.status}
      <span class="grow"></span>
      ${slot.action}
    </div>
    ${slot.bar}`;
  })()}
    ${v.sha256 ? "" : `<p class="mb-note">Hugging Face publishes no checksum for this file. It will be checked for size and format only.</p>`}
  </section>`;
}

/**
 * The README, rendered and contained.
 *
 * Through the same sanitising renderer the rest of the app uses: this is
 * somebody else's Markdown, arriving over the network, and it is the one place
 * in the browser where remote text becomes markup.
 */
export function readmePanel(md) {
  if (!md) {
    return `<section class="mb-sec mb-readme-sec">
      <h3 class="mb-h3">README</h3>
      ${paneState({
    title: "No README",
    body: "This repository does not publish one.",
  })}
    </section>`;
  }
  const body = renderMarkdown(md, {
    cls: { p: "mb-p", h: "mb-mdh", list: "mb-ul", code: "mb-code", table: "mb-table" },
  });
  return `<section class="mb-sec mb-readme-sec">
    <h3 class="mb-h3">README</h3>
    <div class="mb-card mb-readme">${body}</div>
  </section>`;
}

/** The detail pane: header, summary, downloads, README. */
export function detailPane(s) {
  if (s.detail?.state === DetailState.IDLE || !s.selectedId) {
    return `<div class="mb-detail">${paneState({
      title: "Choose a model",
      body: "Its description, files and README appear here.",
    })}</div>`;
  }

  if (s.detail?.state === DetailState.LOADING) {
    return `<div class="mb-detail" aria-busy="true">
      <div class="mb-dhead">
        <span class="mb-skel mb-skel-title"></span>
      </div>
      <div class="mb-card mb-summary">
        <span class="mb-skel mb-skel-l"></span>
        <span class="mb-skel mb-skel-s"></span>
      </div>
      <div class="mb-card mb-readme"><span class="mb-skel mb-skel-l"></span>
        <span class="mb-skel mb-skel-l"></span><span class="mb-skel mb-skel-s"></span></div>
    </div>`;
  }

  if (s.detail?.state === DetailState.ERROR) {
    return `<div class="mb-detail">${paneState({
      title: "That model could not be read",
      body: s.detail.reason || "Hugging Face did not answer.",
      action: `<button class="mb-btn mb-btn-p" type="button" data-mb-retry-detail>Try again</button>`,
    })}</div>`;
  }

  const m = s.detail.model;
  return `<div class="mb-detail">
    <div class="mb-dhead">
      <h2 class="mb-title" title="${esc(m.repoId)}">${esc(m.repoId)}</h2>
      <button class="mb-icon-btn" type="button" data-mb-copy="${esc(m.repoId)}"
        aria-label="Copy the repository name" title="Copy">${MB_ICON.copy}</button>
    </div>
    <div class="mb-substats">
      ${statsRow(m)}
      ${badgeRow(m)}
    </div>
    ${summaryCard(m)}
    ${downloadOptions(s)}
    ${readmePanel(m.readme)}
    ${(m.notes ?? []).length
    ? `<p class="mb-note">${esc(m.notes.join(" "))}</p>` : ""}
  </div>`;
}

/**
 * The whole modal.
 *
 * A dialog over a dimmed application, not a page. The route renders the same
 * component, so `/app/models/` and the composer's model control cannot drift
 * into two different browsers.
 *
 * @param {any} s
 */
export function modelBrowser(s) {
  return `<div class="mb-scrim" data-mb-scrim></div>
  <div class="mb-modal" role="dialog" aria-modal="true" aria-label="Model browser">
    <button class="mb-close" type="button" data-mb-close aria-label="Close">${MB_ICON.close}</button>
    <div class="mb-panes">
      ${listPane(s)}
      <div class="mb-div" aria-hidden="true"></div>
      ${detailPane(s)}
    </div>
  </div>`;
}

/** A starting state, so every caller begins from the same shape. */
export function initialBrowserState(opts = {}) {
  return {
    query: "",
    collection: "Staff picks",
    sort: "Best Match",
    /** repoId -> why it is a staff pick, so the badge can say. */
    pickReasons: {},
    listState: ListState.LOADING,
    listError: null,
    models: [],
    selectedId: null,
    detail: { state: DetailState.IDLE, model: null, reason: null },
    variantIndex: 0,
    compat: null,
    install: { state: InstallState.NONE, bytes: 0, total: 0, reason: null },
    desktop: false,
    ...opts,
  };
}
