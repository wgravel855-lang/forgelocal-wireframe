// @ts-check
/**
 * My Models: the page for files that are already on this computer.
 *
 * A different question from the model browser. The browser asks Hugging Face
 * about a repository somebody might download; this asks the disk about a file
 * they have. So every number here comes from the filesystem or from the GGUF
 * header, and where the two could disagree — a renamed file, a model that was
 * never in a repository — the file wins, because the file is what gets loaded.
 *
 * Three panes: what kind of model, which model, and everything about the one
 * selected. Pure rendering, as with the browser, so the states that are hard
 * to reach by hand — no models, a corrupt file, an engine that will not start,
 * a delete in progress — are all reachable in a test.
 *
 * Two rules carried over and worth restating, because this surface is denser
 * and the temptation is greater. A capability is drawn only where the file's
 * own header supports it. And a control is rendered only where the runtime
 * can honour it: the categories ForgeLocal cannot identify are visibly
 * unavailable rather than absent, and the load settings it does not pass to
 * llama.cpp are not shown at all.
 */

import { escapeHtml as esc } from "./html.mjs";
import { sizeLabel } from "./units.mjs";
import { quantOf } from "./liveModels.mjs";
import { loadTab, inferenceTab } from "./mymodels-tabs.mjs";

/** What the centre pane is doing. */
export const TableState = Object.freeze({
  LOADING: "loading",
  READY: "ready",
  EMPTY: "empty",
  NO_MATCH: "no_match",
  DISCONNECTED: "disconnected",
  ERROR: "error",
});

/** What this machine is doing with the selected file. */
export const LoadState = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  LOADED: "loaded",
  FAILED: "failed",
  NO_ENGINE: "no_engine",
});

/** The inspector's three tabs. */
export const Tab = Object.freeze({ INFO: "info", LOAD: "load", INFERENCE: "inference" });

/**
 * The left pane's categories.
 *
 * Two of these ForgeLocal cannot identify. An embedding model and a draft
 * model are both GGUF files and nothing in the header says which is which
 * without reading the architecture against a list this project does not keep —
 * so they are shown, disabled, saying so. Hiding them would imply the
 * distinction does not exist; enabling them would imply we can make it.
 */
export const CATEGORIES = Object.freeze([
  { id: "all", label: "View All", enabled: true },
  { id: "llm", label: "LLMs", enabled: true },
  {
    id: "embedding",
    label: "Text Embedding",
    enabled: false,
    why: "Not supported yet. ForgeLocal cannot tell an embedding model from a chat model by its header, and will not guess.",
  },
  {
    id: "drafter",
    label: "Drafters",
    enabled: false,
    why: "Not supported yet. Speculative decoding needs a draft model paired to a main one, which ForgeLocal does not do.",
  },
]);

/* ------------------------------------------------------------------ icons */

/**
 * One icon set, drawn in the Lucide idiom: 24-unit box, 2px stroke scaled to
 * the rendered size, round caps and joins. Previously these were a mix of
 * hand-drawn paths at different weights, which is what made the capability
 * marks look pixelated beside everything else.
 */
const ico = (d, size = 15) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const MM_ICON = Object.freeze({
  search: ico('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  wrench: ico('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>'),
  settings2: ico('<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>'),
  more: ico('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'),
  external: ico('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  folderOpen: ico('<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>'),
  download: ico('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'),
  play: ico('<path d="m6 3 14 9-14 9z"/>'),
  info: ico('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  sliders: ico('<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>'),
  activity: ico('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  chevron: ico('<path d="m9 18 6-6-6-6"/>'),
  chevronDown: ico('<path d="m6 9 6 6 6-6"/>'),
  copy: ico('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  trash: ico('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  check: ico('<path d="M20 6 9 17l-5-5"/>'),
  alert: ico('<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  pin: ico('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>'),
  file: ico('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>'),
  box: ico('<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>'),
});

/* ----------------------------------------------------------------- format */

/* Bytes become words in units.mjs, and file names are read in liveModels.mjs,
   for the whole product. This page had its own copy of each, which is how the
   Explore modal and this table came to round the same file differently. */
export { sizeLabel, quantOf };

/** A gap in words. @param {number|null} ms @param {number} [now] */
export function whenLabel(ms, now = Date.now()) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const days = Math.floor((now - ms) / 86400000);
  if (days <= 0) {
    const hours = Math.floor((now - ms) / 3600000);
    if (hours <= 0) return "just now";
    return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 45) return `${days} days ago`;
  const months = Math.round(days / 30.44);
  return months < 24 ? `${months} months ago` : `${Math.round(days / 365.25)} years ago`;
}

/**
 * The parameter badge, from the header's own size label or its tensor shape.
 *
 * Null rather than a guess. A file whose header says nothing about its size
 * gets no badge; reading "7B" out of the file name would be reading the name,
 * which is the thing this page exists not to do.
 */
export function paramBadge(meta) {
  const label = meta?.summary?.sizeLabel ?? meta?.sizeLabel ?? null;
  if (typeof label === "string" && /\d/.test(label)) return label.toUpperCase();
  return null;
}

/** The name without extension, for display. */
export function displayName(name) {
  return String(name).replace(/\.gguf$/i, "");
}

/* ------------------------------------------------------------- left pane */

/** @param {any} s */
export function navPane(s) {
  const items = CATEGORIES.map((c) => {
    const on = c.id === s.category;
    const count = s.counts?.[c.id];
    return `<button class="mm-nav-i${on ? " is-on" : ""}" type="button"
      data-mm-cat="${esc(c.id)}"
      ${c.enabled ? "" : `disabled aria-disabled="true" title="${esc(c.why)}"`}
      aria-current="${on ? "page" : "false"}">
      <span>${esc(c.label)}</span>
      ${typeof count === "number" && c.enabled
    ? `<span class="mm-nav-n">${count}</span>` : ""}
    </button>`;
  }).join("");
  return `<nav class="mm-nav" aria-label="Model types">
    <p class="mm-nav-h">My Models</p>
    ${items}
  </nav>`;
}

/* ----------------------------------------------------------- centre pane */

/** A state block: an explanation rather than a blank. */
function block({ title, body, action = "" }) {
  return `<div class="mm-state">
    <p class="mm-state-t">${esc(title)}</p>
    ${body ? `<p class="mm-state-b">${esc(body)}</p>` : ""}
    ${action}
  </div>`;
}

/** One row. The whole row selects; the two controls at the end do not. */
export function tableRow(m, s) {
  const on = m.name === s.selected;
  const params = paramBadge(s.meta?.[m.name]);
  const cap = s.meta?.[m.name]?.summary?.toolUse;
  return `<tr class="mm-row${on ? " is-on" : ""}${m.usable ? "" : " is-bad"}"
    data-mm-row="${esc(m.name)}" aria-selected="${on ? "true" : "false"}" tabindex="0">
    <td class="mm-c-params">${params
    ? `<span class="mm-badge">${esc(params)}</span>`
    : `<span class="mm-badge is-none" title="The file's header does not state a parameter count.">—</span>`}</td>
    <td class="mm-c-name"><span class="mm-nameline">
      <span class="mm-name" title="${esc(m.name)}">${esc(displayName(m.name))}</span>
      ${cap?.present === true
    ? `<span class="mm-cap-i" role="img" aria-label="Supports tool use"
        title="Tool use. ${esc(cap.evidence)}">${MM_ICON.wrench}</span>` : ""}
      ${m.usable ? "" : `<span class="mm-bad" title="${esc(m.problem || "")}">${MM_ICON.alert}Unreadable</span>`}
    </span></td>
    <td class="mm-c-size">${esc(sizeLabel(m.bytes) ?? "—")}</td>
    <td class="mm-c-when">${esc(whenLabel(m.modifiedMs) ?? "—")}</td>
    <td class="mm-c-act">
      <button class="mm-ico" type="button" data-mm-menu="${esc(m.name)}"
        aria-haspopup="menu" aria-label="More actions for ${esc(displayName(m.name))}"
        title="More actions">${MM_ICON.more}</button>
      <button class="mm-ico" type="button" data-mm-inspect="${esc(m.name)}"
        aria-label="Settings for ${esc(displayName(m.name))}"
        title="Model settings">${MM_ICON.settings2}</button>
    </td>
  </tr>`;
}

/** @param {any} s */
export function tablePane(s) {
  const head = `<div class="mm-head">
    <h1 class="mm-h1">My Models</h1>
    <div class="mm-filter">
      <span class="mm-filter-i" aria-hidden="true">${MM_ICON.search}</span>
      <input type="search" class="mm-filter-in" data-mm-filter
        value="${esc(s.query ?? "")}" autocomplete="off" spellcheck="false"
        placeholder="Filter models&hellip; (Ctrl + F)"
        aria-label="Filter models by name">
    </div>
  </div>`;

  /* Every state fills the space the table would have filled. Returned
     bare, a state card left the footer floating in the middle of the
     pane with the window empty below it — the footer belongs at the
     bottom whether there are forty models or none. */
  const fills = (b) => `<div class="mm-fill">${b}</div>`;

  let body;
  switch (s.tableState) {
    case TableState.LOADING:
      body = `<div class="mm-rows" aria-busy="true">${
        '<div class="mm-skel"></div>'.repeat(5)}</div>`;
      break;
    case TableState.DISCONNECTED:
      body = fills(block({
        title: "The desktop app is not connected",
        body: "This page lists the model files on your computer, which needs the runtime. The web preview has none.",
      }));
      break;
    case TableState.ERROR:
      body = fills(block({
        title: "The models folder could not be read",
        body: s.error || "Something went wrong reading the folder.",
        action: `<button class="mm-btn" type="button" data-mm-refresh>Try again</button>`,
      }));
      break;
    case TableState.EMPTY:
      body = fills(block({
        title: "No models yet",
        body: "Downloaded models appear here. Nothing is bundled with the app.",
        action: `<button class="mm-btn mm-btn-p" type="button" data-open-models>Browse models</button>`,
      }));
      break;
    case TableState.NO_MATCH:
      body = fills(block({
        title: "No results found for this filter",
        body: s.category !== "all" && s.category !== "llm"
          ? "ForgeLocal does not identify this kind of model yet."
          : `Nothing on this computer matches “${s.query}”.`,
      }));
      break;
    default:
      body = `<div class="mm-rows"><table class="mm-table">
        <thead><tr>
          ${[["params", "Params"], ["name", "Model"], ["size", "Size"], ["when", "Modified"]]
    .map(([id, label]) => `<th class="mm-c-${id === "name" ? "name" : id}"
            ><button type="button" data-mm-sort="${id}" class="mm-sortb">${esc(label)}${
  s.sort === id ? `<span class="mm-sort-a">${s.desc ? "▾" : "▴"}</span>` : ""}</button></th>`).join("")}
          <th class="mm-c-act">Actions</th>
        </tr></thead>
        <tbody>${s.rows.map((m) => tableRow(m, s)).join("")}</tbody>
      </table></div>`;
  }

  return `<section class="mm-centre">${head}${body}${footer(s)}</section>`;
}

/**
 * The footer: how many, how big, and where.
 *
 * Every figure is counted from the files listed above it rather than kept as a
 * separate total, so the two cannot disagree.
 */
export function footer(s) {
  const n = s.total ?? 0;
  const bytes = s.totalBytes ?? 0;
  const summary = s.tableState === TableState.DISCONNECTED
    ? "No runtime, so nothing has been counted."
    : `You have ${n} local model${n === 1 ? "" : "s"}${
      bytes ? `, taking up ${sizeLabel(bytes)} of disk space` : ""}`;

  return `<div class="mm-foot">
    <span class="mm-foot-s">${esc(summary)}</span>
    <span class="grow"></span>
    ${s.dir ? `<button class="mm-dir" type="button" data-mm-open-dir
      title="Open the models folder">${esc(s.dir)}</button>` : ""}
    <button class="mm-ico" type="button" data-mm-dir-menu
      aria-haspopup="menu" aria-label="Folder actions" title="Folder actions">${MM_ICON.more}</button>
  </div>`;
}

/* ------------------------------------------------------------ the actions */

/**
 * The row menu.
 *
 * Every entry does something. "Open on Hugging Face" appears only where the
 * file's header names a repository, because a link built from a file name
 * would be a guess at somebody else's URL — and a 404 in a browser is a worse
 * answer than no menu item.
 */
export function rowMenu(m, s) {
  const meta = s.meta?.[m.name];
  const repo = meta?.summary?.repo ?? null;
  const pinned = (s.pinned ?? []).includes(m.name);
  const item = (action, label, icon, extra = "") =>
    `<button class="mm-mi" type="button" role="menuitem" data-mm-do="${action}" ${extra}>
      ${icon}<span>${esc(label)}</span></button>`;

  return `<div class="mm-menu" role="menu" aria-label="Actions for ${esc(displayName(m.name))}">
    ${item("reveal", "Open in File Explorer", MM_ICON.folderOpen,
    s.desktop ? "" : 'disabled aria-disabled="true" title="Needs the desktop app."')}
    ${item(pinned ? "unpin" : "pin", pinned ? "Unpin" : "Pin to Top", MM_ICON.pin)}
    <div class="mm-sep"></div>
    ${item("copy-id", "Copy Default Identifier", MM_ICON.copy)}
    ${item("copy-path", "Copy Absolute Path", MM_ICON.copy)}
    ${item("raw", "Show Raw Metadata", MM_ICON.file)}
    ${repo ? item("hf", "Open on Hugging Face", MM_ICON.external) : ""}
    <div class="mm-sep"></div>
    ${item("verify", "Verify File", MM_ICON.check)}
    ${item("delete", "Delete…", MM_ICON.trash, 'class="mm-mi is-bad"')}
  </div>`;
}

/* ------------------------------------------------------------- inspector */

/** A label/value row with the value as a pill, as the reference shows. */
function kv(label, value, opts = {}) {
  const known = value !== null && value !== undefined && value !== "";
  return `<div class="mm-kv${opts.long ? " is-long" : ""}">
    <span class="mm-kv-k">${esc(label)}</span>
    <span class="mm-kv-v${known ? "" : " is-none"}"${opts.title ? ` title="${esc(opts.title)}"` : ""}
      >${known ? esc(String(value)) : "unknown"}</span>
  </div>`;
}

/** The Info tab: what the file says about itself. */
export function infoTab(s) {
  const m = s.rows.find((x) => x.name === s.selected);
  const meta = s.meta?.[s.selected];
  if (!m) return block({ title: "Choose a model", body: "Its details appear here." });

  if (meta && meta.ok === false) {
    return `<div class="mm-pane">${block({
      title: "This file could not be read",
      body: meta.reason,
      action: `<button class="mm-btn" type="button" data-mm-do="reveal">Show it in the folder</button>`,
    })}</div>`;
  }
  if (!meta) {
    return `<div class="mm-pane" aria-busy="true">
      <div class="mm-skel"></div><div class="mm-skel"></div><div class="mm-skel"></div></div>`;
  }

  const sum = meta.summary ?? {};
  const cap = sum.toolUse ?? { present: null, evidence: "" };
  const capPill = cap.present === true
    ? `<span class="mm-cap" title="${esc(cap.evidence)}">${MM_ICON.wrench}<span>Tool use</span></span>`
    : cap.present === false
      ? `<span class="mm-kv-v is-none" title="${esc(cap.evidence)}">none detected</span>`
      : `<span class="mm-kv-v is-none" title="${esc(cap.evidence)}">unknown</span>`;

  return `<div class="mm-pane">
    <p class="mm-sec-h">${MM_ICON.info}Model Information</p>
    ${kv("Model", sum.name ?? displayName(m.name), { title: sum.name ?? m.name, long: true })}
    ${kv("File", m.name, { title: m.path, long: true })}
    ${kv("Format", `GGUF v${meta.version}`)}
    ${kv("Quantization", quantOf(m.name))}
    ${kv("Arch", sum.architecture)}
    <div class="mm-kv"><span class="mm-kv-k">Capabilities</span>${capPill}</div>
    ${kv("Context", sum.contextLength ? `${(sum.contextLength / 1024).toFixed(0)}k tokens` : null)}
    ${kv("Layers", sum.blockCount)}
    ${kv("Size on disk", sizeLabel(m.bytes))}
    ${kv("Verified", s.verified?.[m.name] ?? null,
    { title: "A checksum is only known for a file ForgeLocal downloaded." })}
    <p class="mm-note">Read from the file's own GGUF header, not from a repository.</p>
  </div>`;
}

/** The inspector header and tabs. */
export function inspector(s) {
  const m = s.rows.find((x) => x.name === s.selected);
  if (!m) {
    return `<aside class="mm-side">${block({
      title: "No model selected",
      body: "Choose one from the list to see its details, load settings and inference options.",
    })}</aside>`;
  }

  const loaded = s.load?.state === LoadState.LOADED;
  const busy = s.load?.state === LoadState.LOADING;
  const tab = s.tab ?? Tab.INFO;

  const action = busy
    ? `<button class="mm-btn mm-btn-p" type="button" disabled aria-disabled="true">
        <span class="mm-spin" aria-hidden="true"></span>Loading&hellip;</button>`
    : loaded
      ? `<button class="mm-btn" type="button" data-mm-unload>Unload</button>`
      : `<button class="mm-btn mm-btn-p" type="button" data-mm-load
          ${s.desktop ? "" : 'disabled aria-disabled="true" title="Needs the desktop app."'}
          >${MM_ICON.download}Load Model</button>`;

  return `<aside class="mm-side">
    <header class="mm-side-h">
      ${MM_ICON.box}
      <h2 class="mm-side-t" title="${esc(m.name)}">${esc(displayName(m.name))}</h2>
    </header>
    <div class="mm-side-a">
      <button class="mm-btn" type="button" data-mm-use
        ${s.desktop ? "" : 'disabled aria-disabled="true" title="Needs the desktop app."'}
        >${MM_ICON.play}Use in New Chat</button>
      ${action}
    </div>
    ${s.load?.state === LoadState.FAILED
    ? `<p class="mm-err">${MM_ICON.alert}${esc(s.load.reason || "The engine would not start.")}</p>` : ""}
    ${loaded && s.load.detail ? `<p class="mm-ok">${MM_ICON.check}${esc(s.load.detail)}</p>` : ""}
    <div class="mm-tabs" role="tablist">
      ${[[Tab.INFO, "Info", MM_ICON.info], [Tab.LOAD, "Load", MM_ICON.sliders],
    [Tab.INFERENCE, "Inference", MM_ICON.activity]].map(([id, label, icon]) =>
    `<button class="mm-tab${tab === id ? " is-on" : ""}" type="button" role="tab"
        aria-selected="${tab === id}" data-mm-tab="${id}">${icon}${esc(label)}</button>`).join("")}
    </div>
    <div class="mm-side-b" role="tabpanel">
      ${tab === Tab.INFO ? infoTab(s) : tab === Tab.LOAD ? loadTab(s) : inferenceTab(s)}
    </div>
  </aside>`;
}

/* ---------------------------------------------------------------- the page */

/** @param {any} s */
export function myModelsPage(s) {
  return `<div class="mm" data-mm-root>
    ${navPane(s)}
    ${tablePane(s)}
    ${inspector(s)}
  </div>`;
}

/** A starting state, so every caller begins from one shape. */
export function initialMyModels(opts = {}) {
  return {
    desktop: false,
    category: "all",
    query: "",
    sort: "when",
    desc: true,
    tableState: TableState.LOADING,
    error: null,
    rows: [],
    total: 0,
    totalBytes: 0,
    dir: null,
    selected: null,
    tab: Tab.INFO,
    /** name -> model.meta payload */
    meta: {},
    /** name -> verification words */
    verified: {},
    pinned: [],
    load: { state: LoadState.IDLE, reason: null, detail: null },
    settings: {},
    hardware: null,
    ...opts,
  };
}
