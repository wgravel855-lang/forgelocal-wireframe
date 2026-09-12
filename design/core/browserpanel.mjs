// @ts-check
/**
 * Rendering the browser work surface.
 *
 * Everything in this file is derived from the reduced session state, which is
 * derived from runtime events. There is no path by which the panel can show a
 * page the browser is not on, a console error nobody reported, or an action
 * the model merely said it took — if the runtime did not emit it, it is not
 * here. That is the point of a work surface as opposed to a narration.
 *
 * Two states matter as much as the working one:
 *
 *   - the runtime is not connected. Nothing here is live, and the panel says
 *     so rather than showing the last thing it saw.
 *   - the runtime is connected but no browser is open. That is not an error;
 *     it is the ordinary state of a session that has not needed one.
 *
 * A browser-shaped panel that cannot say which of those applies is worse than
 * no panel, because it invites the person to trust a stale picture.
 */

import { escapeHtml as esc, truncate } from "./html.mjs";

/** How many findings of each kind the panel lists. The rest are counted. */
export const SHOWN = 8;

/** The viewports the selector offers, and the one a session starts at. */
export const VIEWPORTS = Object.freeze([
  { id: "desktop", label: "Desktop — 1280 × 800", width: 1280, height: 800 },
  { id: "laptop", label: "Laptop — 1024 × 720", width: 1024, height: 720 },
  { id: "tablet", label: "Tablet — 768 × 1024", width: 768, height: 1024 },
  { id: "phone", label: "Phone — 390 × 844", width: 390, height: 844 },
]);

/** @param {number} w @param {number} h */
export function viewportId(w, h) {
  const hit = VIEWPORTS.find((v) => v.width === w && v.height === h);
  return hit ? hit.id : "custom";
}

/**
 * The panel's body.
 *
 * @param {object} input
 * @param {any} input.browser      state.browser, or null
 * @param {boolean} input.connected  whether the runtime is reachable
 * @param {boolean} [input.busy]     whether a turn is running
 * @returns {string} HTML for [data-bp-body]
 */
export function browserPanelBody({ browser, connected, busy = false }) {
  if (!connected) return unavailable(
    "The runtime is not running, so nothing here is live.",
    "Start the runtime to use a browser. Anything shown before would be a picture of a page that may have closed.",
  );

  if (!browser || browser.closed) {
    return unavailable(
      browser && browser.closed
        ? "The browser session is closed."
        : "No browser is open for this session.",
      browser && browser.closed
        ? "Its cookies and storage were destroyed with it. Ask for a browsing task to start a new one."
        : "Ask for something that needs a page and the agent will open one. It gets its own cookies and storage and is never signed in to your accounts.",
    );
  }

  return [
    liveView(browser),
    viewportPicker(browser),
    statusLine(browser, busy),
    findings("Console", browser.console, "console"),
    findings("Failed requests", browser.network, "network"),
    downloads(browser.downloads),
  ].join("\n");
}

/* --------------------------------------------------------------- pieces */

/** @param {any} b */
function liveView(b) {
  if (!b.preview || !b.preview.image) {
    return `<div class="bp-view"><p class="bp-view-none">${esc(
      b.url
        ? "No picture of this page yet. One arrives the next time it changes."
        : "The browser is open but has not been sent anywhere yet.",
    )}</p></div>`;
  }
  const { mime, image, at, width, height } = b.preview;
  /* The alt text names the page rather than describing the image, because a
     screen reader user gets nothing from "a screenshot" and everything from
     which page the agent is looking at. */
  return `<div class="bp-view">
  <img src="data:${esc(mime || "image/jpeg")};base64,${esc(image)}"
    alt="${esc(b.title || b.url || "the current page")}"
    ${width && height ? `width="${width}" height="${height}"` : ""}>
  <span class="bp-stamp">${esc(clock(at))}</span>
</div>`;
}

/** @param {any} b */
function viewportPicker(b) {
  const vp = b.viewport || { width: 1280, height: 800 };
  const current = viewportId(vp.width, vp.height);
  const options = VIEWPORTS.map((v) =>
    `<option value="${v.id}"${v.id === current ? " selected" : ""}>${esc(v.label)}</option>`);
  if (current === "custom") {
    options.unshift(`<option value="custom" selected>Custom — ${vp.width} × ${vp.height}</option>`);
  }
  return `<div class="bp-vp">
  <label class="lab" for="bp-vp">Viewport</label>
  <select id="bp-vp" data-bp-viewport>${options.join("")}</select>
</div>`;
}

/**
 * What the browser is doing.
 *
 * Sourced from browser_action events, so it reports the last thing that
 * actually happened to the page. When a turn is running and nothing has
 * happened yet it says exactly that rather than inventing progress.
 * @param {any} b @param {boolean} busy
 */
function statusLine(b, busy) {
  const a = b.lastAction;
  if (!a) {
    return `<p class="bp-status">${esc(busy ? "Working. No page action yet." : "Idle.")}</p>`;
  }
  const what = a.target ? `<b>${esc(a.action)}</b> ${esc(truncate(a.target, 60))}` : `<b>${esc(a.action)}</b>`;
  return `<p class="bp-status${a.ok ? "" : " is-bad"}">${what}${
    a.ok ? "" : " — did not succeed"}<span style="flex:1"></span>${esc(clock(a.at))}</p>`;
}

/**
 * @param {string} title @param {any[]} list
 * @param {"console"|"network"} kind
 */
function findings(title, list, kind) {
  const rows = Array.isArray(list) ? list : [];
  const bad = rows.filter((r) => r.level === "error").length;
  const head = `<h3>${esc(title)}<span class="bp-n${bad ? " is-bad" : ""}">${rows.length}</span></h3>`;

  if (!rows.length) {
    return `<section class="bp-sec">${head}<p class="bp-empty">${esc(
      kind === "console" ? "No errors or warnings." : "Every request succeeded.",
    )}</p></section>`;
  }

  // Newest last is how a console reads; newest first is how a panel is
  // skimmed. The panel wins, and the count says what was left out.
  const shown = rows.slice(-SHOWN).reverse();
  const items = shown.map((r) => {
    const cls = r.level === "error" ? " class=\"is-bad\"" : r.level === "warning" ? " class=\"is-warn\"" : "";
    return `<li${cls}>${esc(truncate(r.text, 220))}</li>`;
  });
  if (rows.length > shown.length) {
    items.push(`<li class="bp-empty" style="border:0;background:none;padding:2px 0">${
      rows.length - shown.length} earlier not shown</li>`);
  }
  return `<section class="bp-sec">${head}<ul class="bp-list">${items.join("")}</ul></section>`;
}

/**
 * Anything the page saved.
 *
 * Listed because a file arriving on the machine is something the person should
 * know about, and worded around where it is NOT: nothing here has been run and
 * nothing has been moved into the project. There is deliberately no button to
 * move one — that is a decision made through an approval, not a panel control.
 * @param {any[]} list
 */
function downloads(list) {
  const rows = Array.isArray(list) ? list : [];
  if (!rows.length) return "";
  return `<section class="bp-sec">
  <h3>Downloads<span class="bp-n">${rows.length}</span></h3>
  <ul class="bp-list">${rows.slice(-SHOWN).reverse().map((r) =>
    `<li class="bp-dl">${esc(truncate(r.text, 220))}</li>`).join("")}</ul>
  <p class="bp-empty">Held in this session's quarantine folder. Nothing has been run, and nothing is in your project.</p>
</section>`;
}

/** @param {string} headline @param {string} detail */
function unavailable(headline, detail) {
  return `<div class="bp-off">
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18"/><path d="M9.5 13.5l5 3.5M14.5 13.5l-5 3.5"/></svg>
  <p><strong>${esc(headline)}</strong></p>
  <p>${esc(detail)}</p>
</div>`;
}

/* ---------------------------------------------------------------- bits */

/** @param {number} at */
function clock(at) {
  if (!at) return "";
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${
    String(d.getSeconds()).padStart(2, "0")}`;
}

/**
 * The header's URL and title, which live outside the body so the panel's
 * chrome does not flicker on every preview.
 * @param {any} browser @param {boolean} connected
 */
export function browserPanelHeader(browser, connected) {
  if (!connected) return { title: "Runtime offline", url: "", isolated: false, open: false };
  if (!browser) return { title: "No page", url: "", isolated: false, open: false };
  return {
    title: browser.closed ? "Session closed" : (browser.title || "Untitled page"),
    url: browser.closed ? "" : (browser.url || ""),
    isolated: !browser.closed && browser.isolated !== false,
    open: !browser.closed,
  };
}
