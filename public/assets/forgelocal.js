/* ForgeLocal prototype interactions.
 *
 * Progressive enhancement over the server-rendered markup. Everything here is
 * real behaviour: focus management, keyboard, persistence. Controls that
 * cannot work in a prototype are marked [data-inert] in the markup and get an
 * explanatory tooltip rather than a silent no-op.
 */
import {
  initialRunState, reduce as reduceRun,
  composerAction, sessionActivity, activeTool, pendingPermission,
  runOutcome, contextPressure,
} from "../core/events.mjs";
import { createFixtureRuntime } from "../core/adapters.mjs";
import { capture as captureReading, restore as restoreReadingPos, remember as rememberPos } from "../core/reading.mjs";
import {
  STORE_KEY, createState as createModelState, reduceModels,
  allModels, installedModels, loadedModels, unloadedInstalled, activeDownloads,
  selectedModel as selectedModelOf, canSend as canSendWith, installedBytes,
  recommendedParams, estimateMemory, validateParams, fitNote, clearLoaded,
  downloadSummary, downloadPercent, isLoaded, isAgentReady,
} from "../core/modelstore.mjs";
import {
  installedSections, installedFooter, installedStats, downloadsHtml, downloadStrip,
  downloadsBadge, downloadsSummary, pickerHtml, composerModelLabel,
} from "../core/modelviews.mjs";
import { THIS_PC } from "../core/machine.mjs";
import { gb, fmtCtx as fmtCtxUI } from "../core/units.mjs";
import { renderCard } from "../core/modelcard.mjs";
import { normalizeMode, modeLabel } from "../core/modes.mjs";
import { readDemoFlag, desktopState, applyDesktopState, NO_HARDWARE_NOTE as NO_HARDWARE } from "../core/localstate.mjs";
import { catalogHtml, modelDetail, loaderRow, isSort, sortedIds, sortLabel } from "../core/catalog.mjs";
import { catalogViewState, localViewState, showsRows, showsDetail, stateBlockHtml } from "../core/viewstate.mjs";
import {
  detectEnvironment, initialRuntime, reduceRuntime, isConnected,
  runtimeLabel, runtimeTone, runtimeDetails, runtimeSettings, contextDisplay, sendBlockedReason,
} from "../core/runtime.mjs";

(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get(k, d) { try { const v = localStorage.getItem("fl:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("fl:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  /* ---------------------------------------------------------------- toasts */
  let toastHost;
  function toast(msg, tone = "") {
    if (!toastHost) {
      toastHost = document.createElement("div");
      toastHost.className = "toast-host";
      toastHost.setAttribute("role", "status");
      toastHost.setAttribute("aria-live", "polite");
      document.body.appendChild(toastHost);
    }
    const t = document.createElement("div");
    t.className = "toast " + tone;
    t.textContent = msg;
    toastHost.appendChild(t);
    setTimeout(() => t.classList.add("in"), 10);
    setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 200); }, 3200);
  }
  window.flToast = toast;

  /* ------------------------------------------------------------- dialog */
  /* One accessible dialog for every destructive or scoped decision. Native
   * confirm() blocks the whole browsing session and cannot say what a choice
   * actually costs, so nothing in the product uses it.
   *
   *   flConfirm({ title, body, scope, confirm, cancel, tone, danger })
   *     -> Promise<boolean>
   *
   * Focus starts on the safe action, is trapped while open, and returns to
   * whatever opened the dialog.
   */
  let dlgHost = null;
  function flConfirm(opts) {
    return new Promise((resolve) => {
      const trigger = document.activeElement;
      if (!dlgHost) {
        dlgHost = document.createElement("div");
        dlgHost.className = "dlg-host";
        document.body.appendChild(dlgHost);
      }
      dlgHost.innerHTML = `
        <div class="dlg-scrim" data-dlg-scrim></div>
        <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-t"
          ${opts.body || opts.scope ? 'aria-describedby="dlg-b"' : ""}>
          <h2 class="dlg-t" id="dlg-t">${esc(opts.title)}</h2>
          <div class="dlg-b" id="dlg-b">
            ${opts.body ? `<p>${esc(opts.body)}</p>` : ""}
            ${opts.scope ? `<dl class="dlg-scope">${opts.scope.map(([k, v]) =>
              `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
          </div>
          <div class="dlg-a">
            <button class="btn" type="button" data-dlg-cancel>${esc(opts.cancel || "Cancel")}</button>
            <button class="btn ${opts.danger ? "btnd" : "btnp"}" type="button" data-dlg-ok>${esc(opts.confirm || "Confirm")}</button>
          </div>
        </div>`;
      dlgHost.hidden = false;
      document.body.classList.add("has-dlg");

      const dlg = $(".dlg", dlgHost);
      const ok = $("[data-dlg-ok]", dlgHost);
      const cancel = $("[data-dlg-cancel]", dlgHost);
      // the safe action holds focus, so Enter never destroys anything by reflex
      cancel.focus();

      const close = (answer) => {
        document.removeEventListener("keydown", onKey, true);
        dlgHost.hidden = true;
        dlgHost.innerHTML = "";
        document.body.classList.remove("has-dlg");
        if (trigger && trigger.isConnected) trigger.focus();
        resolve(answer);
      };
      const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false); return; }
        if (e.key !== "Tab") return;
        const items = $$("button", dlg);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!dlg.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      };
      document.addEventListener("keydown", onKey, true);
      ok.addEventListener("click", () => close(true));
      cancel.addEventListener("click", () => close(false));
      $("[data-dlg-scrim]", dlgHost).addEventListener("click", () => close(false));
    });
  }
  window.flConfirm = flConfirm;

  /* --------------------------------------------------------------- popovers */
  let openPop = null;
  function closePop(restore = true) {
    if (!openPop) return;
    const { pop, trigger } = openPop;
    pop.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    openPop = null;
    if (restore) trigger.focus();
  }
  /* A panel is positioned against its trigger, and a trigger near either
     gutter pushes it off screen: the runtime panel lost 174px off the right at
     1363px wide. Neither CSS side can be right for every trigger, so the panel
     opens where its markup says and is then nudged back inside the viewport. */
  const GUTTER = 8;
  function clampPopover(pop) {
    pop.style.left = "";
    pop.style.right = "";
    pop.style.marginLeft = "";
    const host = pop.offsetParent || document.documentElement;
    const hostBox = host.getBoundingClientRect();
    const r = pop.getBoundingClientRect();
    const limit = document.documentElement.clientWidth - GUTTER;
    let shift = 0;
    if (r.right > limit) shift = limit - r.right;
    if (r.left + shift < GUTTER) shift = GUTTER - r.left;
    if (!shift) return;
    // offsetLeft is relative to the positioned ancestor, so shift in that frame.
    // Floor rather than round: rounding up puts the edge back over the gutter.
    const base = r.left - hostBox.left;
    pop.style.left = Math.floor(base + shift) + "px";
    pop.style.right = "auto";
  }

  function openPopover(trigger, pop) {
    closePop(false);
    pop.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    openPop = { pop, trigger };
    clampPopover(pop);
    const first = pop.querySelector('[data-autofocus], input, [role="menuitemradio"], button');
    if (first) first.focus();
  }
  addEventListener("resize", () => { if (openPop) clampPopover(openPop.pop); });
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-popover]");
    if (trigger) {
      e.preventDefault();
      const pop = document.getElementById(trigger.getAttribute("data-popover"));
      if (!pop) return;
      pop.hidden ? openPopover(trigger, pop) : closePop();
      return;
    }
    if (openPop && !e.target.closest(".popover")) closePop(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openPop) { e.stopPropagation(); closePop(); return; }
    if (!openPop) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const items = $$('[role="menuitemradio"], [role="menuitem"], button', openPop.pop)
        .filter((el) => !el.disabled && el.offsetParent !== null);
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next].focus();
    }
  });

  /* ------------------------------------------------------------ model picker */
  function wireModelPicker() {
    const pop = $("#model-pop");
    if (!pop) return;
    const search = $("[data-model-search]", pop);
    const rows = $$("[data-model-row]", pop);

    if (search) {
      let t;
      search.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const q = search.value.trim().toLowerCase();
          let shown = 0;
          rows.forEach((r) => {
            const hit = !q || r.dataset.modelName.toLowerCase().includes(q);
            r.hidden = !hit;
            if (hit) shown++;
          });
          $$("[data-model-group]", pop).forEach((g) => {
            g.hidden = !$$("[data-model-row]", g).some((r) => !r.hidden);
          });
          const empty = $("[data-model-empty]", pop);
          // "No match" only when there was something to match against: an empty
      // list has its own message and does not need a search failure too.
      const total = $("[data-filter-item]", root).length;
      if (empty) empty.hidden = shown > 0 || total === 0;
        }, 120);
      });
    }

    rows.forEach((row) => {
      row.addEventListener("click", () => {
        if (row.dataset.state === "unavailable") return;
        if (row.dataset.state === "notinstalled") {
          toast(`${row.dataset.modelName} queued for download`);
          return;
        }
        rows.forEach((r) => r.setAttribute("aria-checked", String(r === row)));
        $$("[data-model-label]").forEach((l) => { l.textContent = row.dataset.modelName; });
        store.set("model", row.dataset.modelId);
        closePop();
        toast(`Switched to ${row.dataset.modelName}`);
      });
    });
  }

  /* ---------------------------------------------------------------- sidebar */
  function wireSidebar() {
    const shell = $(".shell");
    const sidebar = $(".sidebar");
    if (!shell || !sidebar) return;
    const inSidebar = $("[data-sidebar-toggle]", sidebar);
    const inTopbar = $$("[data-sidebar-toggle]").find((b) => b !== inSidebar);

    // Below 1180 the sidebar is a drawer over the workspace. It needs its own
    // open flag and a scrim: the collapse class alone left it display:none, so
    // the toggle did nothing at all on a phone.
    let scrim = $(".side-scrim");
    if (!scrim) {
      scrim = document.createElement("div");
      scrim.className = "side-scrim";
      scrim.hidden = true;
      scrim.addEventListener("click", () => apply(true));
      sidebar.parentElement.insertBefore(scrim, sidebar);
    }

    const apply = (collapsed) => {
      shell.classList.toggle("is-collapsed", collapsed);
      const drawer = innerWidth <= 1180;
      if (drawer && !collapsed) sidebar.setAttribute("data-open", "");
      else sidebar.removeAttribute("data-open");
      scrim.hidden = !(drawer && !collapsed);
      // Exactly one toggle is reachable at a time, and it lives wherever the
      // user is looking. While the collapsed rail is on screen the rail owns
      // it, so history is reachable from the rail itself; when the rail is
      // gone entirely the top bar owns it.
      const railVisible = innerWidth >= 1024;
      const inRail = collapsed && railVisible;
      if (inSidebar) inSidebar.hidden = collapsed && !railVisible;
      if (inTopbar) inTopbar.hidden = !collapsed || inRail;
      if (inSidebar) {
        inSidebar.title = collapsed ? "Show chats" : "Hide chats";
      }
      $$("[data-sidebar-toggle]").forEach((b) => {
        b.setAttribute("aria-expanded", String(!collapsed));
        b.setAttribute("aria-label", collapsed ? "Show sidebar" : "Hide sidebar");
      });
    };
    // Narrow windows start collapsed regardless of the stored preference. On a
    // wide display a first-time user also starts collapsed, so the canvas
    // belongs to the work rather than to an empty session list; an explicit
    // choice is remembered and never overridden.
    const narrow = innerWidth <= 1180;
    apply(narrow ? true : store.get("sidebar-collapsed", true));
    $$("[data-sidebar-toggle]").forEach((b) =>
      b.addEventListener("click", () => {
        const now = !shell.classList.contains("is-collapsed");
        apply(now);
        if (innerWidth > 1180) store.set("sidebar-collapsed", now);
      }));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && innerWidth <= 1180 && !shell.classList.contains("is-collapsed")) apply(true);
    });

    // The collapse decision has to be re-made when the window crosses the
    // breakpoint, not only at load: a window that starts narrow and is then
    // widened should get its sidebar back.
    let wasNarrow = narrow;
    addEventListener("resize", () => {
      const isNarrow = innerWidth <= 1180;
      if (isNarrow === wasNarrow) return;
      wasNarrow = isNarrow;
      apply(isNarrow ? true : store.get("sidebar-collapsed", false));
    });
  }

  /* ---------------------------------------------------------- diagnostics */
  /* What a stopped run actually needs: the error, the context it happened in,
     the log that shows it, and what to try next. Nothing is transmitted. */
  const DIAG_LOG = [
    '[14:22:07] task  start  "Switch the date helper to Temporal"',
    "[14:22:09] read  6 files                                  1.8s",
    "[14:22:31] edit  src/lib/date.js  +21 -19",
    "[14:22:33] run   npm test -- --run",
    "[14:22:36] fail  TypeError: Temporal.PlainDate.from is not a function",
    "[14:22:36]         at formatDue (src/lib/date.js:14:26)",
    "[14:23:02] retry 2 of 3  same edit, same failure",
    "[14:24:18] retry 3 of 3  same edit, same failure",
    "[14:24:18] stop  no progress after 3 attempts",
  ].join("\n");

  function wireDiagnostics() {
    const open = (trigger) => {
      let host = $(".mdrawer-host");
      if (!host) {
        host = document.createElement("div");
        host.className = "mdrawer-host";
        $(".app").appendChild(host);
      }
      const close = () => {
        host.hidden = true;
        host.innerHTML = "";
        document.removeEventListener("keydown", onKey, true);
        if (trigger && trigger.isConnected) trigger.focus();
      };
      const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
        if (e.key !== "Tab") return;
        const items = $$("a[href], button", host).filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!host.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      };
      host.innerHTML = `
        <div class="mdrawer-scrim" data-md-scrim></div>
        <aside class="mdrawer" role="dialog" aria-modal="true" aria-labelledby="dg-t">
          <header class="mdrawer-h">
            <h2 class="h2" id="dg-t">Diagnostics</h2>
            <span class="grow"></span>
            <button class="btn btnq ico btns" type="button" data-md-close aria-label="Close diagnostics">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </header>
          <div class="mdrawer-b">
            <p class="mdrawer-s"><span class="dot bad" aria-hidden="true"></span>Stopped: no progress after 3 attempts</p>
            <p class="ruse" style="margin:10px 0 0">The same edit produced the same failure three
              times. Temporal is not available in this Node version and no polyfill is installed,
              which is a project fact the agent cannot fix by editing the file again.</p>

            <h3 class="set-h3" style="margin-top:22px">Context</h3>
            <dl class="specs" style="margin-top:10px;gap:14px 24px">
              <div><dt>Project</dt><dd>task-tracker</dd></div>
              <div><dt>Model</dt><dd>Qwen2.5 Coder 14B Q4_K_M</dd></div>
              <div><dt>Runtime</dt><dd>llama.cpp b4021</dd></div>
              <div><dt>Node</dt><dd>v20.11.1</dd></div>
              <div><dt>Mode</dt><dd>Build</dd></div>
              <div><dt>Checkpoint</dt><dd>2, before the first edit</dd></div>
            </dl>

            <h3 class="set-h3" style="margin-top:22px">Log</h3>
            <figure class="cblock" style="margin-top:10px">
              <figcaption class="cblock-h">
                <span class="m">task.log &middot; last 9 lines</span>
                <button class="mact" type="button" data-diag-copy aria-label="Copy log"><span class="mact-t">Copy</span></button>
              </figcaption>
              <pre class="m"><code>${esc(DIAG_LOG)}</code></pre>
            </figure>

            <h3 class="set-h3" style="margin-top:22px">What to try</h3>
            <ol class="diag-steps">
              <li>Install a Temporal polyfill, then run the edit again. That needs one package, so
                it stops and asks first.</li>
              <li>Keep the existing date helper and revisit when the project moves to a Node version
                that ships Temporal.</li>
              <li>Restore checkpoint 2 to put the file back the way the task found it.</li>
            </ol>
            <p class="dl-m" style="margin-top:16px">Nothing here is transmitted. This log lives in
              your app data folder and no send action exists.</p>
          </div>
          <footer class="mdrawer-f">
            <a class="btn btns" href="/app/permission/">Install a polyfill</a>
            <a class="btn btns" href="/app/settings/#privacy">Where logs live</a>
            <span class="grow"></span>
            <button class="btn btns btnq" type="button" data-md-close style="border-color:var(--line)">Close</button>
          </footer>
        </aside>`;
      host.hidden = false;
      $$("[data-md-close], [data-md-scrim]", host).forEach((b) => b.addEventListener("click", close));
      $("[data-diag-copy]", host).addEventListener("click", (e) => {
        const t = $(".mact-t", e.currentTarget);
        if (navigator.clipboard) navigator.clipboard.writeText(DIAG_LOG).catch(() => {});
        t.textContent = "Copied";
        setTimeout(() => { t.textContent = "Copy"; }, 1500);
      });
      document.addEventListener("keydown", onKey, true);
      $("[data-md-close]", host).focus();
    };
    // the recovery block is rendered after boot, so this is delegated
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-diagnostics]");
      if (b) open(b);
    });
  }

  /* ------------------------------------------------------- model catalog */
  /* The detail pane is rendered from the same record the row came from, and the
     selection lives in the URL so a refresh keeps it. Search and filter state
     survive selecting a model, because the list is never re-created. */
  /* --------------------------------------------------------- model catalog */
  /* Explore renders from the shared store through core/catalog.mjs, the same
     module the build used for the first paint. Selection lives in the URL, so
     a refresh and the back button both restore it.

     The default selection is a replaceState, not a push: landing on the page
     is not a navigation the user made, and it should not need a Back press to
     leave. */
  function wireCatalog() {
    const root = $("[data-catalog]");
    if (!root) return;
    hydrateModels();

    const models = () => allModels(MODELS.state);
    const has = (id) => !!(id && MODELS.state.byId[id]);
    const firstVisible = () => {
      const row = $$("[data-cat-row]", root).find((a) => a.offsetParent !== null);
      return row ? row.dataset.catRow : (models()[0] || {}).id || null;
    };

    // mode: how the URL should change. explicit: whether the user chose this
    // model, which is what decides the narrow-screen list/detail view.
    const paint = (id, mode, explicit = mode === "push") => {
      const rows = $$("[data-cat-row]", root);
      rows.forEach((a) => {
        const on = a.dataset.catRow === id;
        a.classList.toggle("is-on", on);
        a.setAttribute("aria-selected", String(on));
        a.tabIndex = on ? 0 : -1;
      });
      // On a narrow screen the list is the page and a selection opens its own
      // detail view. A default selection is not a selection the user made, so
      // it does not navigate them away from the list.
      // On a narrow screen the list is the page and a selection opens its own
      // detail view. A default selection is not a selection the user made, so
      // it does not navigate them away from the list.
      root.toggleAttribute("data-selected", !!id && explicit);

      const wrap = $("[data-cat-detail-wrap]", root);
      const m = id ? MODELS.state.byId[id] : null;
      if (wrap) wrap.innerHTML = m ? modelDetail(m, DESKTOP) : "";

      const url = id ? `?model=${encodeURIComponent(id)}` : location.pathname;
      if (mode === "push") history.pushState({ model: id }, "", url);
      else if (mode === "replace") history.replaceState({ model: id }, "", url);
      // Focus moves to the detail only when the user chose it, never when the
      // page picked a default or a search narrowed the list.
      if (mode === "push") {
        const h = $(".mdet-name", root);
        if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
      }
    };

    root.addEventListener("click", (e) => {
      const row = e.target.closest("[data-cat-row]");
      if (!row) return;
      e.preventDefault();
      paint(row.dataset.catRow, "push");
    });

    root.addEventListener("keydown", (e) => {
      const rows = $$("[data-cat-row]", root).filter((r) => r.offsetParent !== null);
      const current = document.activeElement.closest("[data-cat-row]");
      const i = rows.indexOf(current);
      if (e.key === "Enter" && current) { e.preventDefault(); paint(current.dataset.catRow, "push"); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (i < 0) return;
      e.preventDefault();
      const next = rows[e.key === "ArrowDown" ? Math.min(i + 1, rows.length - 1) : Math.max(i - 1, 0)];
      next.focus();
      paint(next.dataset.catRow, "replace");
    });

    addEventListener("popstate", () => {
      const id = new URLSearchParams(location.search).get("model");
      paint(has(id) ? id : firstVisible(), null, has(id));
    });

    /* One state at a time. With no results there is no selected result either:
       the detail is removed and no option stays selected in the accessibility
       tree, rather than a stale pane sitting beside "no matches". */
    const stateHost = $("[data-cat-state]", root);
    const searchBox = $("[data-filter-search]");
    let lastGood = null;

    onFilter(() => {
      const rows = $$("[data-filter-item]", root);
      const visible = rows.filter((r) => !r.hidden);
      const view = catalogViewState(rows.length, visible.length, searchBox ? searchBox.value : "");
      if (stateHost) stateHost.innerHTML = stateBlockHtml(view, esc);

      if (!showsDetail(view)) {
        const wrap = $("[data-cat-detail-wrap]", root);
        if (wrap) wrap.innerHTML = "";
        $$("[data-cat-row]", root).forEach((a) => {
          a.classList.remove("is-on");
          a.setAttribute("aria-selected", "false");
        });
        root.removeAttribute("data-selected");
        return;
      }

      const selected = $(".mrow2.is-on");
      if (selected && selected.offsetParent !== null) { lastGood = selected.dataset.catRow; return; }
      // Clearing the query restores what was selected before it, when that
      // model is back; otherwise the first remaining result takes over.
      const restore = lastGood && visible.some((r) => $("[data-cat-row]", r)?.dataset.catRow === lastGood)
        ? lastGood : firstVisible();
      if (restore) paint(restore, "replace");
    });

    /* Sort reorders the rows already in the DOM rather than re-rendering them,
       so the selected row keeps its element, its focus and its selection. The
       order is remembered, because a list the user arranged should still be
       arranged when they come back to it. */
    const rowsHost = $("[data-cat-rows]", root);
    const applySort = (id, remember) => {
      const sort = isSort(id) ? id : "recommended";
      // The sort controls live in the shared header, outside [data-catalog].
      $$("[data-sort]").forEach((b) => {
        const on = b.dataset.sort === sort;
        b.setAttribute("aria-checked", String(on));
        b.classList.toggle("on", on);
      });
      $$("[data-sort-label]").forEach((l) => { l.textContent = sortLabel(sort); });
      if (rowsHost) {
        const order = sortedIds(allModels(MODELS.state), sort);
        const wrapperOf = (id) => {
          const a = $(`[data-cat-row="${CSS.escape(id)}"]`, rowsHost);
          return a ? a.closest("[data-filter-item]") : null;
        };
        for (const id of order) {
          const w = wrapperOf(id);
          if (w) rowsHost.appendChild(w);
        }
      }
      if (remember) store.set("model-sort", sort);
    };

    $$("[data-sort]").forEach((b) => b.addEventListener("click", () => {
      applySort(b.dataset.sort, true);
      closePop();
      announce(`Sorted by ${sortLabel(b.dataset.sort)}.`);
    }));
    applySort(store.get("model-sort", "recommended"), false);

    // Clear search from the no-results block, without touching the query text
    // for any other reason.
    root.addEventListener("click", (e) => {
      const b = e.target.closest('[data-view-action="clear-search"]');
      if (!b || !searchBox) return;
      searchBox.value = "";
      searchBox.dispatchEvent(new Event("input", { bubbles: true }));
      searchBox.focus();
    });

    const initial = new URLSearchParams(location.search).get("model");
    // A model named in the URL is an explicit choice and opens its detail on
    // every width. Otherwise desktop opens on the first result, and narrow
    // screens open on the list.
    if (has(initial)) paint(initial, null, true);
    else paint(firstVisible(), "replace");
  }

  const CAP_PATHS = {
    chat: ['<path d="M20 15.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5z"/>', "1.8"],
    tool_use: ['<path d="M14.7 6.3a4 4 0 0 1-5 5L5 16v3h3l4.7-4.7a4 4 0 0 0 5-5z"/>', "1.8"],
    agent_ready: ['<path d="M20 6 9 17l-5-5"/>', "2.2"],
    fim: ['<path d="M4 7h6M4 12h16M4 17h9"/>', "1.8"],
  };
  const capIcon = (k) => svg(CAP_PATHS[k][0], "currentColor", CAP_PATHS[k][1]);

  /* ------------------------------------------------- Surface B: the loader */
  /* Every entry point passes a model ID and nothing else. The dialog resolves
     the record from the store each time it paints, so it can never render a
     stale clone that a page happened to be holding. */
  const LOADER = { open: false, modelId: null, opener: null, params: null, sort: "recent", query: "" };

  function openLoader(modelId, opener) {
    // A modal is the only active floating layer. The model picker stayed open
    // behind the dialog, so two menus were open at once and Escape was
    // ambiguous about which one it would close.
    //
    // Focus returns to the row that opened the dialog, unless that row lives
    // inside the popover being closed: then it returns to the popover's
    // trigger, which is the control still on screen.
    const inPopover = openPop && opener && openPop.pop.contains(opener);
    const returnTo = inPopover ? openPop.trigger : opener;
    closePop(false);
    hydrateModels();
    LOADER.open = true;
    LOADER.modelId = modelId || null;
    LOADER.opener = returnTo || null;
    LOADER.params = null;               // an unsubmitted dialog restores defaults
    LOADER.query = "";
    paintLoader();
  }

  function closeLoader() {
    if (!LOADER.open) return;
    LOADER.open = false;
    const host = $(".loader-host");
    if (host) { host.hidden = true; host.innerHTML = ""; }
    document.removeEventListener("keydown", loaderKeys, true);
    const back = LOADER.opener;
    LOADER.opener = null;
    if (back && back.isConnected) back.focus();
  }

  function loaderKeys(e) {
    if (!LOADER.open) return;
    const host = $(".loader-host");
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeLoader(); return; }
    if (e.key !== "Tab" || !host) return;
    const items = $$("a[href], button:not([disabled]), input, select, summary", host)
      .filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!host.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }

  const SORTS = [["recent", "Recent"], ["size", "Size"], ["downloaded", "Downloaded"]];

  function loaderRows() {
    const s = MODELS.state;
    let list = installedModels(s);
    const q = LOADER.query.trim().toLowerCase();
    if (q) list = list.filter((m) =>
      (m.displayName + " " + m.publisher + " " + m.quantization).toLowerCase().includes(q));
    if (LOADER.sort === "size") list = [...list].sort((a, b) => b.fileSizeBytes - a.fileSizeBytes);
    if (LOADER.sort === "downloaded") list = [...list].sort((a, b) => a.displayName.localeCompare(b.displayName));
    return list;
  }

  function paintLoader() {
    if (!LOADER.open) return;
    let host = $(".loader-host");
    if (!host) {
      host = document.createElement("div");
      host.className = "loader-host";
      ($(".app") || document.body).appendChild(host);
    }
    const s = MODELS.state;
    // resolved fresh from the store on every paint, never cached
    const m = LOADER.modelId ? s.byId[LOADER.modelId] : null;
    const params = LOADER.params || (m ? recommendedParams(m, THIS_PC) : null);
    const errors = m && params ? validateParams(m, params) : {};
    const est = m && params ? estimateMemory(m, params) : null;
    const note = m && params ? fitNote(m, params, THIS_PC) : null;
    const invalid = Object.keys(errors).length > 0;
    // The dialog asks the one runtime store, like every other surface.
    const connected = isConnected(RUNTIME.state);

    host.innerHTML = `
      <div class="loader-scrim" data-loader-close></div>
      <div class="loader" role="dialog" aria-modal="true" aria-labelledby="loader-t">
        <header class="loader-h">
          <h2 class="h2" id="loader-t">Load a model</h2>
          <span class="grow"></span>
          <button class="btn btnq ico btns" type="button" data-loader-close aria-label="Close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>

        <div class="loader-b">
          <div class="loader-list">
            <label class="field loader-search">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="flex-shrink:0"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
              <span class="vh">Search installed models</span>
              <input type="search" data-loader-search placeholder="Search installed models" value="${esc(LOADER.query)}">
            </label>
            <div class="loader-sort" role="group" aria-label="Sort by">
              ${SORTS.map(([id, label]) => `<button class="lsort" type="button" data-loader-sort="${id}"
                aria-pressed="${LOADER.sort === id}">${label}</button>`).join("")}
            </div>
            <div class="loader-rows" role="listbox" aria-label="Installed models">
              ${loaderRows().map((r) => loaderRow(r, LOADER.modelId)).join("")
    || `<p class="pd-note" style="padding:10px">No installed model matches that search.</p>`}
            </div>
          </div>

          <div class="loader-cfg">
            ${m ? `
              <h3 class="loader-n">${esc(m.displayName)}</h3>
              <p class="loader-sub">${esc(m.publisher)} &middot; ${esc(m.quantization || "")} &middot; <span class="num">${gb(m.fileSizeBytes, 2)} GB</span></p>

              <!-- The pane always carries the model's facts, so it is never a
                   half-empty modal waiting for a control the runtime cannot
                   accept. Compatibility appears only with hardware to judge. -->
              <!-- Known values only. A row the catalog has no value for is
                   omitted, the same rule the Explore detail follows: an em
                   dash reports a gap in the data, not a fact about the model. -->
              <dl class="loader-facts">
                ${[
    ["Format", [m.format, m.quantization].filter(Boolean).join(" · ")],
    ["Parameters", m.parameterCount],
    ["Max context", m.maxContextTokens ? fmtCtxUI(m.maxContextTokens) : ""],
    ["Architecture", m.architecture || m.family],
  ].filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("\n                ")}
              </dl>
              ${connected ? "" : `<p class="loader-why" style="margin-top:14px">${esc(NO_HARDWARE)}</p>`}

              <details class="loader-params"${LOADER.params ? " open" : ""}>
                <summary>Customize load parameters</summary>

                ${numField("Context length", "contextTokens", params.contextTokens, errors.contextTokens,
    `Up to ${(m.maxContextTokens || 8192).toLocaleString()}`)}
                ${numField("GPU offload, layers", "gpuLayers", params.gpuLayers, errors.gpuLayers, "0 to 99")}

                <div class="lfield lfield-row">
                  <label for="lp-flash">Flash attention</label>
                  <button class="switch" type="button" id="lp-flash" role="switch"
                    aria-checked="${params.flashAttention}" data-loader-flash><span></span></button>
                </div>

                <div class="lfield lfield-row">
                  <label for="lp-kv">KV cache type</label>
                  <select id="lp-kv" data-loader-kv>
                    <option value="f16"${params.kvCacheType === "f16" ? " selected" : ""}>f16, full precision</option>
                    <option value="q8_0"${params.kvCacheType === "q8_0" ? " selected" : ""}>q8_0, half the memory</option>
                  </select>
                </div>

                <details class="loader-adv">
                  <summary>Advanced</summary>
                  ${numField("CPU threads", "cpuThreads", params.cpuThreads, errors.cpuThreads, "1 to 64")}
                  ${numField("Batch size", "batchSize", params.batchSize, errors.batchSize, "32 to 4096")}
                </details>

                <div class="loader-est">
                  <span>Estimated video memory <b class="num">${gb(est.vramBytes, 1)} GB</b></span>
                  <span>Estimated system memory <b class="num">${gb(est.ramBytes, 1)} GB</b></span>
                </div>
                ${note ? `<p class="loader-note">${esc(note)}</p>` : ""}
                <button class="btn btns btnq" type="button" data-loader-reset
                  style="border-color:var(--line);margin-top:10px">Reset to recommended</button>
              </details>
            ` : `<p class="pd-note">Choose an installed model to configure how it loads.</p>`}
          </div>
        </div>

        <footer class="loader-f">
          <p class="loader-why">${connected
    ? "These parameters are sent to the local runtime when you load."
    : "Loading a model needs the desktop app, which is not released yet. Nothing here can load one."}</p>
          <span class="grow"></span>
          ${connected
    ? `<button class="btn btns btnq" type="button" data-loader-close style="border-color:var(--line)">Cancel</button>
       <button class="btn btnp btns" type="button" data-loader-load
         ${!m || invalid ? "disabled" : ""}>Load model</button>`
    // No primary button, because there is no primary action to take. A purple
    // button whose only effect is a toast promises a connection that never
    // happens.
    : `<button class="btn btns" type="button" disabled aria-disabled="true"
         title="The desktop app is not released yet.">Desktop app required</button>
       <button class="btn btnp btns" type="button" data-loader-close>Close</button>`}
        </footer>
      </div>`;

    host.hidden = false;
    wireLoaderControls(host);
    if (!host.contains(document.activeElement)) {
      const first = $("[data-loader-search]", host) || $("[data-loader-close]", host);
      if (first) first.focus();
    }
    document.addEventListener("keydown", loaderKeys, true);
  }

  const numField = (label, name, value, error, hint) => `
    <div class="lfield">
      <label for="lp-${name}">${label}</label>
      <input id="lp-${name}" type="number" inputmode="numeric" data-loader-num="${name}"
        value="${esc(String(value))}" ${error ? 'aria-invalid="true"' : ""}
        aria-describedby="lp-${name}-h">
      <span class="lfield-h" id="lp-${name}-h">${error ? `<span class="lfield-e">${esc(error)}</span>` : esc(hint)}</span>
    </div>`;

  function wireLoaderControls(host) {
    $$("[data-loader-close]", host).forEach((b) => b.addEventListener("click", closeLoader));

    const search = $("[data-loader-search]", host);
    if (search) search.addEventListener("input", () => {
      LOADER.query = search.value;
      const at = search.selectionStart;
      paintLoader();
      const again = $("[data-loader-search]");
      if (again) { again.focus(); again.setSelectionRange(at, at); }
    });

    $$("[data-loader-sort]", host).forEach((b) => b.addEventListener("click", () => {
      LOADER.sort = b.dataset.loaderSort;
      paintLoader();
      const again = $(`[data-loader-sort="${LOADER.sort}"]`);
      if (again) again.focus();
    }));

    $$("[data-loader-pick]", host).forEach((b) => b.addEventListener("click", () => {
      LOADER.modelId = b.dataset.loaderPick;
      LOADER.params = null;              // parameters are per model
      paintLoader();
    }));

    const m = LOADER.modelId ? MODELS.state.byId[LOADER.modelId] : null;
    const current = () => LOADER.params || (m ? recommendedParams(m, THIS_PC) : null);

    $$("[data-loader-num]", host).forEach((input) => input.addEventListener("input", () => {
      const next = { ...current(), [input.dataset.loaderNum]: Number(input.value) };
      LOADER.params = next;
      const at = input.selectionStart;
      const name = input.dataset.loaderNum;
      paintLoader();
      const again = $(`[data-loader-num="${name}"]`);
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch { /* number input */ } }
    }));

    const flash = $("[data-loader-flash]", host);
    if (flash) flash.addEventListener("click", () => {
      LOADER.params = { ...current(), flashAttention: flash.getAttribute("aria-checked") !== "true" };
      paintLoader();
      const again = $("[data-loader-flash]");
      if (again) again.focus();
    });

    const kv = $("[data-loader-kv]", host);
    if (kv) kv.addEventListener("change", () => {
      LOADER.params = { ...current(), kvCacheType: kv.value };
      paintLoader();
      const again = $("[data-loader-kv]");
      if (again) again.focus();
    });

    const reset = $("[data-loader-reset]", host);
    if (reset) reset.addEventListener("click", () => {
      LOADER.params = null;              // back to what the store recommends
      paintLoader();
      toast("Reset to the recommended parameters for this model.");
    });

    // Only rendered when a runtime is connected, so the request has somewhere
    // to go. A model becomes loaded when the adapter reports it, never here.
    const load = $("[data-loader-load]", host);
    if (load) load.addEventListener("click", () => {
      dispatchModel({ type: "model.load.requested", modelId: LOADER.modelId, params: current() });
      dispatchRuntime({ type: "runtime.model.loading", modelId: LOADER.modelId });
      closeLoader();
    });
  }

  function wireLoaderEntryPoints() {
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-load-model]");
      if (!b) return;
      e.preventDefault();
      openLoader(b.dataset.loadModel, b);
    });
  }

  /* -------------------------------------------------------- model details */
  /* Model details open inside the app shell. The public /models/<id>/ page
     stays for visitors; it is not the app's management surface, because
     leaving the shell threw away the tab, query, filters and scroll. */
  /* The model detail drawer is gone. Explore now has a real detail pane, and
     the drawer was the only consumer of the legacy `models` payload: a second
     model schema carrying machine facts (vramGB, fitReason, local paths) that
     the web preview cannot know. A row title links to the catalog detail. */

  /* ------------------------------------------------------------- settings */
  /* Toggles, and the revocation path that every "always allow this here"
     decision promises. Choices persist in the same local state the rest of the
     prototype uses. */
  function wireSettings() {
    $$(".switch").forEach((b) => {
      const key = "switch:" + (b.getAttribute("aria-label") || "");
      // Each state carries its own sentence, because swapping only the leading
      // "Off." produced "On. The app only runs when you open it."
      const sync = (on) => {
        const row = b.closest(".setrow");
        const d = row && $(".set-d", row);
        if (!d) return;
        const txt = on ? d.dataset.on : d.dataset.off;
        if (txt) d.textContent = txt;
        else d.textContent = d.textContent.replace(/^(On|Off)\./, on ? "On." : "Off.");
      };
      const saved = store.get(key, null);
      if (saved !== null) {
        b.setAttribute("aria-checked", String(saved));
        sync(saved === true || saved === "true");
      }
      b.addEventListener("click", () => {
        const on = b.getAttribute("aria-checked") !== "true";
        b.setAttribute("aria-checked", String(on));
        store.set(key, on);
        sync(on);
      });
    });

    const list = $("[data-approvals]");
    if (list) {
      const empty = $("[data-approvals-empty]");
      const revoked = new Set(store.get("revoked", []));
      const paint = () => {
        let left = 0;
        $$("[data-approval]", list).forEach((row) => {
          const gone = revoked.has(row.dataset.approval);
          row.hidden = gone;
          if (!gone) left++;
        });
        list.hidden = left === 0;
        if (empty) empty.hidden = left > 0;
      };
      $$("[data-revoke]", list).forEach((b) => b.addEventListener("click", async () => {
        const what = b.dataset.revoke;
        if (!(await flConfirm({
          title: `Revoke "${what}"?`,
          body: "The next time the agent needs this command it stops and asks again.",
          scope: [["Scope", "This project only"],
            ["Effect", "The command still works, it just needs approval each time"],
            ["Reversible", "Yes. Choose Always allow again at the next prompt."]],
          confirm: "Revoke approval", cancel: "Keep approval" }))) return;
        revoked.add(b.closest("[data-approval]").dataset.approval);
        store.set("revoked", [...revoked]);
        paint();
        toast(`Revoked. "${what}" will ask again.`);
      }));
      paint();
    }

    // The settings nav highlighted the visible section but never told an
    // assistive client which one, and never updated as the column scrolled.
    const nav = $(".setnav");
    const cols = $(".setwrap .setcol") ? $$(".setsec") : [];
    if (nav && cols.length) {
      const links = $$("a[href^='#']", nav);
      const paint = (id) => links.forEach((a) => {
        const on = a.getAttribute("href") === "#" + id;
        a.classList.toggle("is-on", on);
        if (on) a.setAttribute("aria-current", "location");
        else a.removeAttribute("aria-current");
      });
      const scroller = $(".setwrap");
      const show = (id) => {
        cols.forEach((sec) => { sec.hidden = sec.id !== id; });
        paint(id);
        scroller.scrollTop = 0;
        // the document title follows the section, so a browser tab and the
        // page heading say the same thing
        const name = $("h1", $("#" + id));
        if (name) document.title = name.textContent.trim() + " settings — ForgeLocal";
      };
      links.forEach((a) => a.addEventListener("click", (e) => {
        e.preventDefault();
        const id = a.getAttribute("href").slice(1);
        history.replaceState(null, "", "#" + id);
        show(id);
        const h = $("h1, h2", $("#" + id));
        if (h) { h.setAttribute("tabindex", "-1"); h.focus(); }
      }));
      show(location.hash ? location.hash.slice(1) : cols[0].id);
    }

    const rm = $("[data-reduced-state]");
    if (rm) rm.textContent = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "On, from your system" : "Off, from your system";

    $$("[data-open-folder]").forEach((b) => b.addEventListener("click", () => {
      toast("A wireframe cannot open a folder. The path is shown above so it can be copied.");
    }));
  }

  /* ---------------------------------------------------------- shortcuts */
  const SHORTCUTS = [
    ["New chat", "Ctrl N"],
    ["Search chats", "Ctrl K"],
    ["Focus composer", "Ctrl L"],
    ["Send", "Enter"],
    ["New line", "Shift Enter"],
    ["Toggle sidebar", "Ctrl B"],
    ["Close a menu or dialog", "Esc"],
    ["Keyboard shortcuts", "?"],
  ];
  function showShortcuts() {
    flConfirm({
      title: "Keyboard shortcuts",
      scope: SHORTCUTS,
      confirm: "Close", cancel: "Back",
    });
  }
  function wireShortcuts() {
    $$("[data-shortcuts]").forEach((b) => b.addEventListener("click", () => {
      closePop();
      showShortcuts();
    }));
    document.addEventListener("keydown", (e) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      showShortcuts();
    });
  }

  /* ------------------------------------------------------------ downloads */
  function wireDownloadRow() {
    $$("[data-dl-remove]").forEach((b) => b.addEventListener("click", async () => {
      if (!(await flConfirm({
        title: "Remove this failed download?",
        body: "The 6.20 GB already on disk is deleted and the entry leaves this list.",
        scope: [["Frees", "6.20 GB"],
          ["Kept", "Nothing. A retry starts from the beginning."],
          ["Reversible", "No, but the model can be downloaded again"]],
        confirm: "Remove and delete", cancel: "Keep it", danger: true }))) return;
      const row = b.closest(".dlrow");
      row.replaceChildren(Object.assign(document.createElement("p"), {
        className: "dl-m", style: "margin:0",
        textContent: "Removed. 6.20 GB freed.",
      }));
      toast("Removed. 6.20 GB freed.");
    }));
    // Retry cannot run without a network layer, so it says so rather than
    // pretending to start
    $$("[data-inert-note]").forEach((b) => b.addEventListener("click", () => {
      toast("A wireframe has no network layer, so a retry cannot actually run.");
    }));
  }

  /* ------------------------------------------------------------- waitlist */
  /* The page reads its intent from the URL so a Pro CTA, a Team CTA and a
     download CTA each land somewhere that says the right thing. Nothing is
     sent: the success state says so rather than implying an email went out. */
  const WL_MODES = {
    pro: { kicker: "Pro", h1: "Join the Pro waitlist",
      lede: "Pro is not open yet. Leave an address and we will write once when it is, and not otherwise.",
      cta: "Join the Pro waitlist", done: "You are on the Pro waitlist." },
    team: { kicker: "Team", h1: "Join the Team waitlist",
      lede: "Team plans are not open yet. Leave an address and we will write once shared profiles, policies and billing exist.",
      cta: "Join the Team waitlist", done: "You are on the Team waitlist." },
    beta: { kicker: "Windows beta", h1: "Join the Windows beta",
      lede: "No installer is published yet. Leave an address and we will write once there is a signed build to download.",
      cta: "Notify me when the build is ready", done: "You are on the Windows beta list." },
  };

  function wireWaitlist() {
    const form = $("[data-waitlist]");
    if (!form) return;
    const q = new URLSearchParams(location.search);
    const key = q.get("team") === "1" ? "team" : (q.get("plan") || "pro").toLowerCase();
    const mode = WL_MODES[key] || WL_MODES.pro;

    $("[data-wl-kicker]").textContent = mode.kicker;
    $("[data-wl-h1]").textContent = mode.h1;
    $("[data-wl-lede]").textContent = mode.lede;
    $("[data-wl-cta]").textContent = mode.cta;
    $("[data-wl-done-t]").textContent = mode.done;
    document.title = mode.h1 + " — ForgeLocal";

    const input = $("input[type=email]", form);
    const submit = $("[data-wl-submit]", form);
    const err = $("[data-wl-error]");
    const done = $("[data-wl-done]");
    const ok = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
    const setError = (msg) => {
      err.textContent = msg || "";
      err.hidden = !msg;
      input.setAttribute("aria-invalid", msg ? "true" : "false");
    };

    input.addEventListener("input", () => {
      submit.disabled = !ok(input.value);
      if (!err.hidden && ok(input.value)) setError("");
    });
    input.addEventListener("blur", () => {
      const v = input.value.trim();
      if (v && !ok(v)) setError("That does not look like an email address.");
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return setError("Enter an email address.");
      if (!ok(v)) return setError("That does not look like an email address.");
      setError("");
      submit.disabled = true;
      $("[data-wl-cta]").textContent = "Adding you…";
      // the wireframe has no backend; the delay is the submit state, not a fake request
      setTimeout(() => {
        form.hidden = true;
        done.hidden = false;
        done.setAttribute("tabindex", "-1");
        done.focus();
      }, 380);
    });
  }

  /* ----------------------------------------------------------- chat list */
  /* One state model drives the selector and the workspace together:
   *
   *   activeProjectId   the project the sidebar is scoped to
   *   activeSessionId   the open chat, or null for a new session
   *   over[id]          per-chat overrides: title, project, pinned, archived, deleted
   *   groups[id]        collapsed group state
   *
   * Every render goes through reconcile() -> paint(), so the sidebar, the
   * header, the project path and the workspace body can never disagree. On a
   * project switch the rule is always the same: open a clean new session,
   * because carrying a selection across projects is what left one project's
   * content under another project's name.
   */
  function wireChats() {
    const list = $(".chat-list");
    if (!list) return;
    // A first run has no history to select from, so the selector does not run.
    if ($(".sidebar")?.dataset.mode === "first-run") {
      const fr = $("[data-first-run]");
      if (fr) fr.hidden = false;
      $$(".chat", list).forEach((r) => r.remove());
      return;
    }

    const raw = $("#fl-sessions");
    const data = raw ? JSON.parse(raw.textContent) : { projects: [], chats: [] };
    const projectById = Object.fromEntries(data.projects.map((p) => [p.id, p]));
    const chatById = Object.fromEntries(data.chats.map((c) => [c.id, c]));
    // Conversation routes own a thread, and each thread names the chat it
    // belongs to. /app/permission/ is c1's screen even though c1's row links
    // to /app/running/.
    const ROUTE_THREAD = { "/app/running/": "route:running",
      "/app/permission/": "route:permission", "/app/stopped/": "route:stopped" };
    const threadHere = ROUTE_THREAD[location.pathname] || null;
    const chatHere = threadHere ? (data.threads?.[threadHere]?.chat || null) : null;

    const rows = () => $$(".chat", list);
    const menu = $("#chat-menu");
    const search = $("[data-chat-search]");
    const empty = $("[data-chat-empty]");
    const pinnedGroup = $('.cgroup[data-group="pinned"]', list);
    const archWrap = $("[data-archived-wrap]");
    const archToggle = $("[data-archived-toggle]");
    const archLabel = $("[data-archived-label]");
    const view = $("[data-session-view]");
    const newHeading = $("[data-new-heading]");
    const starters = $(".starters");

    const st = store.get("chats", {});
    st.over ??= {};
    st.groups ??= {};
    st.activeProjectId ??= data.projects[0]?.id || "";
    if (!("activeSessionId" in st)) st.activeSessionId = null;
    const save = () => store.set("chats", st);
    const of = (id) => (st.over[id] ??= {});

    const titleOf = (id) => st.over[id]?.title || chatById[id]?.title || "";
    const projectOf = (id) => st.over[id]?.project || chatById[id]?.project || "";
    const isGone = (id) => !!(st.over[id]?.deleted);
    const isArchived = (id) => !!(st.over[id]?.archived);
    let showArchived = false;
    let openFor = null;

    /* ---- reconcile ------------------------------------------------------ */
    /* The route wins: landing on a chat's own screen makes that chat active and
       drags the project with it. Otherwise an active session that this project
       can no longer show is dropped rather than left open behind the scenes. */
    const reconcile = () => {
      const claimed = chatHere ? chatById[chatHere] : null;
      if (claimed && !isGone(claimed.id)) {
        st.activeSessionId = claimed.id;
        st.activeProjectId = projectOf(claimed.id);
      } else {
        const id = st.activeSessionId;
        const ok = id && chatById[id] && !isGone(id) && !isArchived(id) &&
          projectOf(id) === st.activeProjectId &&
          // a chat with its own screen is only "open" on that screen
          !(chatById[id].route && !threadHere);
        if (!ok) st.activeSessionId = null;
      }
      if (!projectById[st.activeProjectId]) st.activeProjectId = data.projects[0]?.id || "";
    };

    /* ---- workspace ------------------------------------------------------ */
    // Only a conversation route names itself after the open chat. Models,
    // downloads and settings carry their own title and must keep it.
    const ownsHeader = !!$("[data-thread]");
    const setHeader = (t) => {
      if (!ownsHeader) return;
      $$("[data-ws-title]").forEach((el) => { el.textContent = t; });
    };

    const paintProject = () => {
      const p = projectById[st.activeProjectId];
      if (!p) return;
      $$("[data-project-label]").forEach((el) => { el.textContent = p.name; });
      $$("[data-project-path]").forEach((el) => { el.textContent = p.path; });
      $$("[data-project-branch]").forEach((el) => { el.textContent = p.branch; });
      $$("[data-project-stack]").forEach((el) => { el.textContent = p.stack; });
      $$("[data-project-pick]").forEach((b) =>
        b.setAttribute("aria-checked", String(b.dataset.projectPick === st.activeProjectId)));
    };

    // The conversation renderer owns the thread; this only says which one and
    // keeps the header in step with it.
    const paintWorkspace = () => {
      const id = st.activeSessionId;
      setHeader(id ? titleOf(id) : "New session");
      if (!CONVO.load) return;
      // the route's own thread wins; otherwise the open chat renders its own
      const c = id ? chatById[id] : null;
      const threadId = threadHere || (c && !c.route ? id : null);
      CONVO.load(threadId, projectById[st.activeProjectId]);
    };

    /* ---- sidebar -------------------------------------------------------- */
    const paint = () => {
      const q = (search?.value || "").trim().toLowerCase();
      let shown = 0, archived = 0;

      rows().forEach((row) => {
        const id = row.dataset.chat;
        if (isGone(id)) { row.remove(); return; }
        const inProject = projectOf(id) === st.activeProjectId;
        const hit = !q || titleOf(id).toLowerCase().includes(q);
        if (isArchived(id) && inProject) archived++;

        const visible = inProject && hit && (showArchived ? isArchived(id) : !isArchived(id));
        row.hidden = !visible;
        if (visible) shown++;

        const wantPinned = st.over[id]?.pinned ?? row.hasAttribute("data-pinned");
        // The open session takes its group from the run reducer, not from the
        // fixture it was built with, so stopping a run moves it out of Working
        // in the same transition that settles its tools.
        const isOpen = st.activeSessionId === id;
        const live = isOpen ? sessionActivity(RUN.state) : null;
        const stateGroup = live
          ? (live === "working" ? "working"
            : live === "needs-input" || live === "failed" ? "needs" : "recent")
          : row.dataset.bucket;
        if (isOpen) {
          const glyph = $(".ic", row);
          if (glyph) glyph.dataset.live = live;
          const openBtn = $(".chat-open", row);
          const word = { working: "running", "needs-input": "needs input", failed: "stopped", idle: "idle" }[live];
          if (openBtn) openBtn.setAttribute("aria-label", $(".t", row).textContent.trim() + ", " + word);
        }
        const target = (stateGroup === "needs" || stateGroup === "working") ? stateGroup
          : wantPinned ? "pinned" : "recent";
        const home = $(`.cgroup[data-group="${target}"]`, list) || pinnedGroup;
        const body = $(".cgroup-body", home);
        if (row.parentElement !== body) body.appendChild(row);

        // aria-current marks the open chat and only when it is on screen
        const on = visible && st.activeSessionId === id;
        row.classList.toggle("is-on", on);
        const btn = $(".chat-open", row);
        if (on) btn.setAttribute("aria-current", "true");
        else btn.removeAttribute("aria-current");
      });

      $$(".cgroup", list).forEach((g) => {
        g.hidden = !$$(".chat", g).some((r) => !r.hidden);
        const btn = $("[data-group-toggle]", g);
        const openState = st.groups[g.dataset.group] !== false;
        btn.setAttribute("aria-expanded", String(openState));
        $(".cgroup-body", g).hidden = !openState;
      });

      if (empty) empty.hidden = shown > 0;
      if (archWrap) {
        archWrap.hidden = archived === 0 && !showArchived;
        archToggle.setAttribute("aria-expanded", String(showArchived));
        archLabel.textContent = showArchived ? "Back to active chats" : `Archived (${archived})`;
      }
    };

    const render = () => { reconcile(); save(); paintProject(); paint(); paintWorkspace(); };
    // one subscription, so a run transition repaints the session list too
    onRun(() => { reconcile(); paint(); });

    /* ---- selection ------------------------------------------------------ */
    const openChat = (id) => {
      const c = chatById[id];
      if (!c) return;
      rememberReading(CONVO.sessionId ?? st.activeSessionId);
      st.activeSessionId = id;
      st.activeProjectId = projectOf(id);
      save();
      // a chat with a built screen opens that screen; the rest render in place,
      // and if we are not on the screen that can render them, go there first
      if (c.route && c.route !== location.pathname) { location.href = c.route; return; }
      if (!c.route && !view) { location.href = "/app/"; return; }
      render();
    };

    const newSession = () => {
      st.activeSessionId = null;
      save();
      if (!view) { location.href = "/app/"; return; }
      render();
    };

    // A recent row on the start canvas opens the same session the sidebar row
    // does, through the same function; it is a second entry point, not a
    // second implementation.
    document.addEventListener("click", (e) => {
      const row = e.target.closest("[data-open-chat]");
      if (!row) return;
      e.preventDefault();
      openChat(row.dataset.openChat);
    });

    list.addEventListener("click", (e) => {
      const open = e.target.closest(".chat-open");
      if (open) { openChat(open.closest(".chat").dataset.chat); return; }
      const g = e.target.closest("[data-group-toggle]");
      if (g) {
        const sec = g.closest(".cgroup");
        st.groups[sec.dataset.group] = g.getAttribute("aria-expanded") !== "true";
        save(); paint();
      }
    });

    // New chat keeps the project and clears the session
    $$('a[aria-label="New chat"]').forEach((a) => a.addEventListener("click", (e) => {
      if (view) { e.preventDefault(); newSession(); }
      else { st.activeSessionId = null; save(); }
    }));

    /* ---- search --------------------------------------------------------- */
    if (search) {
      let t;
      search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(paint, 100); });
      search.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && search.value) { e.stopPropagation(); search.value = ""; paint(); }
      });
    }

    /* ---- project scope -------------------------------------------------- */
    $$("[data-project-pick]").forEach((b) => b.addEventListener("click", () => {
      st.activeProjectId = b.dataset.projectPick;
      st.activeSessionId = null;          // one rule: a project switch opens a new session
      save();
      closePop();
      if (search) search.value = "";
      showArchived = false;
      // a built screen belongs to one project, so leaving that project leaves it
      if (threadHere) { location.href = "/app/"; return; }
      render();
    }));

    /* ---- row menu ------------------------------------------------------- */
    const closeMenu = (restore = true) => {
      if (!openFor) return;
      const trigger = $(".chat-more", openFor);
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      openFor = null;
      if (restore) trigger.focus();
    };

    const openMenu = (row) => {
      closeMenu(false);
      openFor = row;
      const id = row.dataset.chat;
      const pinned = st.over[id]?.pinned ?? row.hasAttribute("data-pinned");
      $('[data-chat-action="pin"]', menu).textContent = pinned ? "Unpin" : "Pin to top";
      $$("[data-move-to]", menu).forEach((b) =>
        b.setAttribute("aria-checked", String(b.dataset.moveTo === projectOf(id))));

      menu.hidden = false;
      const r = row.getBoundingClientRect();
      const host = row.closest(".sidebar").getBoundingClientRect();
      const top = Math.min(r.bottom - host.top + 4, host.height - menu.offsetHeight - 8);
      menu.style.top = Math.max(8, top) + "px";
      menu.style.left = Math.max(8, r.right - host.left - menu.offsetWidth) + "px";
      $(".chat-more", row).setAttribute("aria-expanded", "true");
      $("button", menu).focus();
    };

    list.addEventListener("click", (e) => {
      const more = e.target.closest(".chat-more");
      if (!more) return;
      e.stopPropagation();
      const row = more.closest(".chat");
      openFor === row ? closeMenu() : openMenu(row);
    });

    document.addEventListener("click", (e) => {
      if (openFor && !e.target.closest("#chat-menu") && !e.target.closest(".chat-more"))
        closeMenu(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !openFor) return;
      e.stopPropagation();
      closeMenu();
    });
    menu.addEventListener("keydown", (e) => {
      const items = $$("button", menu).filter((b) => b.offsetParent !== null);
      const i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    });

    /* ---- inline rename -------------------------------------------------- */
    const rename = (row) => {
      const span = $("[data-chat-title]", row);
      if ($(".chat-rename", row)) return;
      const id = row.dataset.chat;
      const was = titleOf(id);
      const input = document.createElement("input");
      input.className = "chat-rename";
      input.value = was;
      input.setAttribute("aria-label", "Rename chat");
      span.replaceWith(input);
      input.focus();
      input.select();

      let settled = false;
      const finish = (commit) => {
        if (settled) return;
        settled = true;
        const next = commit && input.value.trim() ? input.value.trim() : was;
        span.textContent = next;
        input.replaceWith(span);
        if (next !== was) {
          of(id).title = next;
          save();
          const open = $(".chat-open", row);
          open.title = next;
          open.setAttribute("aria-label", next);
          $(".chat-more", row).setAttribute("aria-label", `Actions for ${next}`);
          if (st.activeSessionId === id) paintWorkspace();
          toast("Chat renamed.");
        }
        $(".chat-more", row).focus();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
      });
      input.addEventListener("blur", () => finish(true));
    };

    /* ---- menu actions --------------------------------------------------- */
    /* Anything that hides or removes the open chat has to hand the workspace
       back to a new session rather than leave it showing a chat that is no
       longer in this project's list. */
    const afterMutation = (id) => {
      const stillHere = !isGone(id) && !isArchived(id) && projectOf(id) === st.activeProjectId;
      if (st.activeSessionId === id && !stillHere) {
        st.activeSessionId = null;
        if (!view) { save(); location.href = "/app/"; return true; }
      }
      return false;
    };

    menu.addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b || !openFor) return;
      const row = openFor, id = row.dataset.chat;
      const title = titleOf(id);

      if (b.dataset.moveTo) {
        of(id).project = b.dataset.moveTo;
        closeMenu();
        if (afterMutation(id)) return;
        render();
        toast(`Moved "${title}" to ${b.dataset.moveTo}.`);
        return;
      }
      switch (b.dataset.chatAction) {
        case "rename":
          closeMenu(false);
          rename(row);
          break;
        case "pin":
          of(id).pinned = !(st.over[id]?.pinned ?? row.hasAttribute("data-pinned"));
          closeMenu(); render();
          toast(st.over[id].pinned ? `Pinned "${title}".` : `Unpinned "${title}".`);
          break;
        case "archive":
          of(id).archived = true;
          closeMenu();
          if (afterMutation(id)) return;
          render();
          toast(`Archived "${title}". It is under Archived at the end of the list.`);
          break;
        case "delete":
          if (!(await flConfirm({
            title: `Delete "${title}"?`,
            body: "The chat and its transcript leave this prototype's local state.",
            scope: [["Scope", "This chat only"],
              ["Kept", "Every other chat in this project"],
              ["Reversible", "No. Archive it instead if you may want it back."]],
            confirm: "Delete chat", cancel: "Keep chat", danger: true }))) return;
          of(id).deleted = true;
          closeMenu(false);
          if (afterMutation(id)) return;
          render();
          toast(`Deleted "${title}".`);
          break;
      }
    });

    if (archToggle) archToggle.addEventListener("click", () => { showArchived = !showArchived; paint(); });

    /* ---- boot ----------------------------------------------------------- */
    rows().forEach((row) => {
      const t = st.over[row.dataset.chat]?.title;
      if (!t) return;
      $("[data-chat-title]", row).textContent = t;
      const open = $(".chat-open", row);
      open.title = t;
      open.setAttribute("aria-label", t);
      $(".chat-more", row).setAttribute("aria-label", `Actions for ${t}`);
    });
    render();
  }

  /* --------------------------------------------------------- model store */
  /* ForgeLocal serves separate documents, so module memory dies on every
     navigation. The store is persisted under a versioned namespace, hydrated
     and validated before the first render, and seeded only when there is no
     valid state. Navigating never re-seeds, or a paused download would restart
     itself every time the user opened another page. */
  const MODELS = {
    /** @type {any} */ state: null,
    /** @type {Set<() => void>} */ subs: new Set(),
  };

  function hydrateModels() {
    if (MODELS.state) return MODELS.state;
    let saved = null;
    try {
      const raw = localStorage.getItem(MODEL_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch { saved = null; }

    // Validate rather than trust: a partial or older shape is discarded and
    // reseeded, which is safer than rendering half a store.
    const valid = saved && saved.version === 1
      && saved.byId && typeof saved.byId === "object"
      && Array.isArray(saved.order) && saved.order.length
      && saved.order.every((id) => saved.byId[id] && typeof saved.byId[id].id === "string");

    // A loaded instance means a runtime is holding weights in memory. With none
    // connected that cannot be true of any model, whether the claim came from
    // the seed or from a store persisted by an earlier visit.
    const resident = isConnected(RUNTIME.state);
    if (valid) {
      // A cached store is not evidence either. Outside demo mode a disconnected
      // preview has no local state, whatever an earlier visit wrote.
      const trusted = (resident || DESKTOP.demo)
        ? saved
        : createModelState(applyDesktopState(Object.values(saved.byId), DESKTOP));
      MODELS.state = resident ? trusted : clearLoaded(trusted);
      if (MODELS.state !== saved) persistModels();
      return MODELS.state;
    }

    // The seed carries catalog facts and, in demo mode, local ones. Outside
    // demo mode every local claim is stripped before the store ever sees it,
    // so no surface can read an installed model this device does not have.
    const raw = $("#fl-sessions");
    const seed = raw ? (JSON.parse(raw.textContent).modelSeed || []) : [];
    const fresh = createModelState(applyDesktopState(seed, DESKTOP));
    MODELS.state = resident ? fresh : clearLoaded(fresh);
    persistModels();
    return MODELS.state;
  }

  function persistModels() {
    try { localStorage.setItem(MODEL_KEY, JSON.stringify(MODELS.state)); } catch { /* private mode */ }
  }

  /** @param {any} event */
  function dispatchModel(event) {
    const before = MODELS.state;
    const next = reduceModels(before, event);
    if (next === before) return before;      // idempotent: no write, no repaint
    MODELS.state = next;
    persistModels();
    MODELS.subs.forEach((fn) => fn());
    return next;
  }
  const onModels = (fn) => { MODELS.subs.add(fn); fn(); return () => MODELS.subs.delete(fn); };

  /* Filter repaints, so a surface that renders rows can re-select after one. */
  /** @type {Set<() => void>} */
  const FILTER_SUBS = new Set();
  const onFilter = (fn) => { FILTER_SUBS.add(fn); return () => FILTER_SUBS.delete(fn); };

  /* ------------------------------------------------------- runtime state */
  /* One answer to "is a local runtime connected", for every surface that used
     to carry its own. The environment is detected once, here; no component
     asks again, and nothing may substitute a fixture when the answer is no. */
  const RUNTIME = {
    state: initialRuntime(detectEnvironment(window)),
    /** @type {Set<() => void>} */ subs: new Set(),
  };

  /* What this machine can be said to have. Demo mode is opt-in per visit and
     the model center labels itself when it is on, so a fixture is never
     mistaken for a measurement. */
  const DEMO = readDemoFlag(location, window.localStorage);
  const DESKTOP = desktopState(RUNTIME.state, DEMO);
  if (DEMO) { try { localStorage.setItem("forgelocal:demo", "1"); } catch { /* private mode */ } }
  /* Demo state is stored under its own key. A normal visit cannot read a store
     a demo visit wrote, so leaving demo mode leaves its fixtures behind too. */
  const MODEL_KEY = STORE_KEY + (DEMO ? ":demo" : "");
  /** @param {any} event */
  function dispatchRuntime(event) {
    const next = reduceRuntime(RUNTIME.state, event);
    if (next === RUNTIME.state) return RUNTIME.state;
    RUNTIME.state = next;
    RUNTIME.subs.forEach((fn) => fn());
    return next;
  }
  const onRuntime = (fn) => { RUNTIME.subs.add(fn); fn(); return () => RUNTIME.subs.delete(fn); };

  /* Every runtime-dependent control, painted from that one state. */
  function wireRuntimeSurfaces() {
    const paint = () => {
      const r = RUNTIME.state;

      $$("[data-env-label]").forEach((el) => { el.textContent = runtimeLabel(r); });
      const tone = runtimeTone(r);
      $$("[data-runtime-word]").forEach((el) => { el.textContent = runtimeLabel(r); });
      $$("[data-runtime-pill] .dot").forEach((d) => {
        d.className = "dot" + (tone ? " " + tone : "");
      });

      const pop = $("[data-runtime-pop]");
      if (pop) {
        const d = runtimeDetails(r);
        pop.innerHTML = `
          <p class="pd-h">${tone ? `<span class="dot ${tone}" aria-hidden="true"></span>` : ""}${esc(d.title)}</p>
          ${d.body ? `<p class="pd-note" style="margin-top:6px">${esc(d.body)}</p>` : ""}
          ${d.rows.length ? `<dl class="pd-kv" style="margin-top:10px">${d.rows.map(([k, v]) =>
    `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
          <div class="sep" style="margin-top:12px"></div>
          <div class="pd-a">
            <a class="btn btns" href="/app/models/installed/">My models</a>
            <a class="btn btns" href="/app/settings/#models">Runtime settings</a>
          </div>`;
      }

      // Context: a percentage needs a loaded model's window to be a fraction of.
      const ctx = contextDisplay(r);
      // With no loaded model there is no denominator, so the control is absent
      // rather than showing an em dash the user cannot act on.
      $$("[data-ctx-wrap]").forEach((el) => { el.hidden = ctx.percent === null; });
      $$("[data-ctx-pct]").forEach((el) => { el.textContent = ctx.text; });
      $$("[data-ctx-ring]").forEach((el) => {
        if (ctx.percent !== null) el.style.setProperty("--pct", String(ctx.percent));
      });
      $$("[data-ctx-btn]").forEach((el) => { el.setAttribute("aria-label", ctx.label); });
      const ctxPop = $("[data-ctx-pop]");
      if (ctxPop) {
        ctxPop.innerHTML = ctx.percent === null
          ? `<p class="pd-h">Context</p>
             <p class="pd-note" style="margin-top:6px">No model is loaded, so there is no context
             window to measure against. The budget appears here once one is.</p>`
          : `<p class="pd-h">Context</p>
             <div class="pd-bar"><div class="track"><div class="fillbar" style="width:${ctx.percent}%"></div></div></div>`;
      }

      const rs = $("[data-runtime-settings]");
      if (rs) {
        const s = runtimeSettings(r);
        rs.innerHTML = `
          <div class="setrow">
            <div><span class="set-l">Connection</span>
              ${s.note ? `<p class="set-d">${esc(s.note)}</p>` : ""}</div>
            <span class="set-v">${esc(s.state)}</span>
          </div>
          ${s.rows.map(([k, v]) => `<div class="setrow">
            <div><span class="set-l">${esc(k)}</span></div>
            <span class="set-v">${esc(v)}</span>
          </div>`).join("")}`;
      }

      // Send: disabled, and its accessible name names the missing thing.
      const why = sendBlockedReason(r, canSendWith(MODELS.state || { byId: {}, order: [], selectedId: null }));
      $$("[data-send][type=submit]").forEach((b) => {
        b.disabled = !!why;
        b.setAttribute("aria-disabled", String(!!why));
        b.setAttribute("aria-label", why || "Send");
        if (why) b.title = why;
      });
    };
    onRuntime(paint);
    onModels(paint);          // send also depends on whether a model is loaded
  }

  /* --------------------------------------------------- reading position */
  /* Where each session was left. Coming back to a finished chat should return
     you to what you were reading, not throw you to the end of it. Only a chat
     you were pinned to the bottom of keeps following new content. */
  const READING = {
    key: "reading",
    /** @returns {Record<string, {top:number, pinned:boolean, lastId:string|null}>} */
    all() { return store.get(this.key, {}) || {}; },
    get(id) { return id ? this.all()[id] || null : null; },
    set(id, pos) {
      if (!id) return;
      const all = this.all();
      all[id] = pos;
      store.set(this.key, all);
    },
  };

  const metrics = (s) => ({ scrollTop: s.scrollTop, scrollHeight: s.scrollHeight, clientHeight: s.clientHeight });

  /** Capture the current position for a session before leaving it. */
  function rememberReading(id) {
    const s = CONVO.scroll;
    if (!id || !s) return;
    const top = s.getBoundingClientRect().top + 80;
    const seen = $$("[data-turn]", CONVO.el).filter((t) => t.getBoundingClientRect().top <= top);
    const pos = captureReading(metrics(s), seen.length ? seen[seen.length - 1].dataset.turn : null);
    store.set(READING.key, rememberPos(READING.all(), id, pos));
  }

  /** Put a session back where it was. Returns true when a position was used. */
  function restoreReading(id) {
    const s = CONVO.scroll;
    const pos = READING.get(id);
    if (!s || !pos) return false;
    const anchor = pos.lastId != null && $(`[data-turn="${pos.lastId}"]`, CONVO.el);
    // Sum offsetTop up to the scroller. A rect-based measurement moves with the
    // current scroll position, so re-running the restore compounded its own
    // error instead of converging.
    let anchorTop = null;
    if (anchor) {
      anchorTop = 0;
      for (let n = anchor; n && n !== s; n = n.offsetParent) {
        anchorTop += n.offsetTop;
        if (n.offsetParent === null) { anchorTop = null; break; }
      }
    }
    const target = restoreReadingPos(pos, metrics(s), anchorTop);
    if (!target) return false;
    s.scrollTop = target.top;
    CONVO.follow = target.follow;
    return true;
  }

  /* ---------------------------------------------------------- run state */
  /* One reducer, one transition, every consumer derived. Before this, Stop set
     a status here and a class there, and a tool row could keep spinning under a
     transcript that already said the run had stopped. */
  const RUN = {
    state: initialRunState(),
    /** @type {Set<() => void>} */
    subs: new Set(),
  };

  function dispatch(event) {
    const next = reduceRun(RUN.state, event);
    if (next === RUN.state) return RUN.state;   // idempotent by identity
    RUN.state = next;
    RUN.subs.forEach((fn) => fn());
    return next;
  }
  const onRun = (fn) => { RUN.subs.add(fn); fn(); return () => RUN.subs.delete(fn); };

  /* Build the run state a route starts in from its fixture, so the reducer is
     the source of truth on a static page too rather than a second description
     of the same thing. */
  function seedRunFromThread(thread) {
    if (!thread) return;
    const at = new Date().toISOString();
    const runId = "seed";
    /** @type {any[]} */
    const events = [{ type: "run.started", runId, sessionId: thread.chat || "s", at }];
    const last = [...(thread.turns || [])].reverse()
      .find((t) => t.role === "assistant" && t.activity);
    const act = last && last.activity;
    (act ? act.rows : []).forEach((r, i) => {
      const callId = "seed-" + i;
      events.push({
        type: "tool.requested", runId, at,
        call: { callId, name: r.mono ? "run_command" : "read_file", label: r.label, command: r.mono ? r.label : undefined },
      });
      if (r.icon === "done") {
        events.push({ type: "tool.started", runId, callId, at });
        if (r.output) events.push({ type: "tool.stdout", runId, callId, chunk: r.output, at });
        events.push({ type: "tool.completed", runId, callId, at, result: { exitCode: 0 } });
      } else if (r.icon === "fail") {
        events.push({ type: "tool.started", runId, callId, at });
        events.push({ type: "tool.completed", runId, callId, at, result: { exitCode: 1 } });
      } else if (r.icon === "running") {
        events.push({ type: "tool.started", runId, callId, at });
        if (r.output) events.push({ type: "tool.stdout", runId, callId, chunk: r.output, at });
      }
    });
    // a permission request attaches to the tool it is blocking
    const perm = (thread.turns || []).find((t) => t.permission);
    if (perm) {
      const callId = "seed-perm";
      events.push({
        type: "tool.requested", runId, at,
        call: { callId, name: "run_command", label: perm.permission.command, command: perm.permission.command },
      });
      events.push({
        type: "permission.requested", runId, callId, at,
        risk: { scopeTag: perm.permission.scopeTag, scope: perm.permission.scope,
          why: perm.permission.why, cwd: perm.permission.cwd, reversible: perm.permission.reversible },
      });
    }
    if (thread.state === "complete") events.push({ type: "run.completed", runId, at });
    if (thread.state === "stopped") events.push({ type: "run.stopped", runId, at });
    RUN.state = initialRunState();
    for (const e of events) RUN.state = reduceRun(RUN.state, e);
    RUN.subs.forEach((fn) => fn());
  }

  /* --------------------------------------------------------- conversation */
  /* One renderer for every route and every saved chat.
   *
   * Conversation states: idle, submitting, thinking, tool-running, streaming,
   * complete, stopped, error. The composer, the activity group and the
   * message actions all read from this one value rather than their own flags.
   */
  const CONVO = {
    el: null, scroll: null, data: null, thread: null,
    state: "idle", follow: true, open: {},
  };

  const svg = (d, stroke, w = "2", extra = "") =>
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
  const ICON = {
    // A muted check, not a green one. Every read, search and edit succeeding is
    // the ordinary case; painting each one green made success the loudest thing
    // in the transcript and left nothing for a real result to say.
    done: () => svg('<path d="M20 6 9 17l-5-5"/>', "var(--faint)", "2.2"),
    fail: () => svg('<path d="M18 6 6 18M6 6l12 12"/>', "var(--bad)", "2.3"),
    running: () => '<span class="spin" aria-hidden="true"></span>',
    todo: () => '<span class="box-todo" aria-hidden="true"></span>',
    now: () => '<span class="dot acc" aria-hidden="true"></span>',
    stop: () => svg('<rect x="7" y="7" width="10" height="10" rx="2"/>', "var(--warn-line)", "1.9"),
    stopped: () => svg('<rect x="7" y="7" width="10" height="10" rx="2"/>', "var(--faint)", "1.9"),
    plan: () => svg('<path d="M4 6h16M4 12h16M4 18h9"/>', "currentColor", "1.9"),
  };
  const CHEV = svg('<path d="m6 9.5 6 6 6-6"/>', "currentColor", "2");


  /* ---- transcript density ---------------------------------------------- */
  /* Three modes over one event stream, not three renderers.
   *   summary  prompts, outcomes, changed files, tests, pending decisions
   *   normal   the above plus compact activity rows and the active action
   *   verbose  every row expanded, with output, timing and exit codes
   * Normal is the first-run default and the choice is remembered. */
  const MODES = ["summary", "normal", "verbose"];
  let DENSITY = MODES.includes(store.get("density", "")) ? store.get("density", "") : "normal";

  /* ---- stream pieces --------------------------------------------------- */
  /* One component per event kind, each with its own states, so a route never
     hand-writes a variant of the same thing. */

  const userMessage = (t, i) => `
    <article class="turn turn-user" data-turn="${i}">
      <div class="umsg" data-umsg><div class="umsg-body" data-umsg-text>${esc(t.text)}</div></div>
      <div class="mactions" data-user-actions data-actions-for="${i}">
        ${mactCopy(t.text, "Copy message")}
        ${CAPS.checkpoints ? `<button class="mact" type="button" data-rewind="${i}" aria-label="Rewind from here"><span class="mact-i">${svg('<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 5v6h-6"/>', "currentColor", "1.8")}</span><span class="mact-t">Rewind</span></button>` : ""}
      </div>
    </article>`;

  // Plan is a one-line row that opens a checklist, not a permanent block.
  const planBlock = (b, i) => {
    const done = b.items.filter((it) => it.state === "done").length;
    const open = CONVO.open["plan" + i] === true;
    return `
      <div class="ev ev-plan">
        <button class="evrow" type="button" data-plan-toggle="${i}" aria-expanded="${open}">
          <span class="evrow-i">${ICON.plan()}</span>
          <span class="evrow-t">Plan</span>
          <span class="evrow-m num">${done} of ${b.items.length} complete</span>
          <span class="evrow-c">${CHEV}</span>
        </button>
        <div class="evbody"${open ? "" : " hidden"}>
          ${b.items.map((it) => `<div class="plan-row is-${it.state}">
            <span class="plan-i">${(ICON[it.state] || ICON.todo)()}</span>
            <span>${esc(it.label)}</span></div>`).join("")}
        </div>
      </div>`;
  };

  const codeBlock = (b) => `
      <figure class="cblock">
        <figcaption class="cblock-h">
          <span class="m" title="${esc(b.file || b.lang || "")}">${esc(b.file || b.lang || "code")}</span>
          <button class="mact" type="button" data-copy="${esc(b.code)}" aria-label="Copy code"><span class="mact-t">Copy</span></button>
        </figcaption>
        <pre class="m"><code>${esc(b.code)}</code></pre>
      </figure>`;

  const noteBlock = (b) => `
      <p class="tnote is-${esc(b.tone || "ok")}">
        ${b.tone === "ok" ? ICON.done() : ICON.fail()}<span>${esc(b.text)}</span></p>`;

  const blocks = (list, i) => (list || []).map((b) =>
    b.t === "plan" ? planBlock(b, i)
      : b.t === "code" ? codeBlock(b)
        : b.t === "note" ? noteBlock(b)
          : `<p>${esc(b.text)}</p>`).join("");

  // Present tense while it runs, past tense once it has.
  const rowLabel = (r) => {
    if (r.icon !== "running") return r.label;
    return /^(Read|Searched|Edited|Ran)\b/.test(r.label)
      ? r.label.replace(/^Read\b/, "Reading").replace(/^Searched\b/, "Searching")
        .replace(/^Edited\b/, "Editing").replace(/^Ran\b/, "Running")
      : r.label;
  };

  // A tool row: 34px, unboxed, and its evidence lives behind the row itself.
  const toolRow = (r, i, k) => {
    const key = `r${i}-${k}`;
    // the reducer owns whether this step is still going
    const live = RUN.state.tools[k];
    if (live) {
      const map = { running: "running", succeeded: "done", failed: "fail",
        interrupted: "stopped", denied: "stopped", pending: "todo",
        "awaiting-permission": "todo" };
      r = { ...r, icon: map[live.state] || r.icon };
      if (live.state === "interrupted") r = { ...r, meta: "interrupted" };
    }
    const has = !!(r.output || r.cwd || r.exit);
    const open = CONVO.open[key] ?? (DENSITY === "verbose" && has);
    const target = r.files ? ` data-open-pane="diff"` : r.output ? ` data-open-pane="terminal"` : "";
    return `
      <div class="ev ev-tool is-${esc(r.icon)}">
        <${has ? "button" : "div"} class="evrow"${has ? ` type="button" data-row-toggle="${key}" aria-expanded="${open}"` : ""}${target}>
          <span class="evrow-i">${(ICON[r.icon] || ICON.done)()}</span>
          <span class="evrow-t${r.mono ? " m" : ""}" title="${esc(r.label)}">${esc(rowLabel(r))}</span>
          ${r.add ? `<span class="num add">${esc(r.add)}</span>` : ""}
          ${r.del ? `<span class="num del">${esc(r.del)}</span>` : ""}
          ${r.meta ? `<span class="evrow-m num">${esc(r.meta)}</span>` : ""}
          ${has ? `<span class="evrow-c">${CHEV}</span>` : ""}
        </${has ? "button" : "div"}>
        ${has ? `<div class="evbody"${open ? "" : " hidden"}>
          ${r.cwd ? `<p class="evkv"><span>Working dir</span><span class="m">${esc(r.cwd)}</span></p>` : ""}
          ${r.exit ? `<p class="evkv"><span>Exit</span><span class="m">${esc(r.exit)}</span></p>` : ""}
          ${r.output ? `<pre class="m evout">${esc(r.output)}</pre>` : ""}
        </div>` : ""}
      </div>`;
  };

  const thinkingRow = (a, i) => {
    if (!a.thinking) return "";
    const active = a.state === "running";
    return `<div class="ev ev-think"><div class="evrow">
      <span class="evrow-i">${active ? ICON.running() : ICON.done()}</span>
      <span class="evrow-t">${active ? "Thinking" : "Thought for " + esc(a.thinking)}</span>
      ${active ? `<span class="evrow-m num">${esc(a.thinking)}</span>` : ""}
    </div></div>`;
  };

  /* Activity in Normal is the rows themselves, compact and unboxed. In Summary
     it collapses to nothing: the outcome line below already carries the result.
     In Verbose every row opens with its output. */
  const activityGroup = (a, i) => {
    if (!a) return "";
    if (DENSITY === "summary") return "";
    return `<div class="acts" data-acts="${i}">
      ${thinkingRow(a, i)}
      ${a.rows.map((r, k) => toolRow(r, i, k)).join("")}
    </div>`;
  };

  /* The outcome: one status line, then evidence as two compact rows, then one
     route into the work pane. Not five restatements of "done". */
  const outcome = (a, i) => {
    if (!a || a.state === "running") return "";
    const files = a.files || [];
    const adds = files.reduce((n, f) => n + (parseInt(f[1], 10) || 0), 0);
    const dels = files.reduce((n, f) => n + (parseInt(String(f[2]).replace(/[^\d]/g, ""), 10) || 0), 0);
    const stopped = a.state === "stopped";
    // A run that is waiting for an answer is not done. "Done 22s" used to sit
    // directly above an unanswered "Run this command?", which made it ambiguous
    // whether the task had finished. The rows below keep their own marks: the
    // edit batch did complete, the run did not.
    const waiting = a.state === "paused" || a.state === "awaiting";
    const head = stopped ? esc(a.label) : waiting ? "Waiting for approval" : "Done";
    return `
      <div class="done is-${esc(a.state)}">
        <p class="done-h">
          <span class="done-i">${stopped ? ICON.stop() : waiting ? ICON.stop() : ICON.done()}</span>
          <span>${head}</span>
          ${a.elapsed ? `<span class="num done-t">${esc(a.elapsed)}</span>` : ""}
        </p>
        ${files.length ? `<button class="evidence" type="button" data-open-pane="diff">
          <span>${files.length} file${files.length === 1 ? "" : "s"} changed</span>
          ${adds ? `<span class="num add">+${adds}</span>` : ""}
          ${dels ? `<span class="num del">&minus;${dels}</span>` : ""}
        </button>` : ""}
        ${a.tests ? `<button class="evidence" type="button" data-open-pane="problems">
          <span>${esc(a.tests)}</span>${a.exit ? `<span class="num">${esc(a.exit)}</span>` : ""}
        </button>` : ""}
      </div>`;
  };

  /* Permission: the question, the command, one scope line, the choices.
     Everything else is evidence and lives under Details. */
  const permissionBlock = (p, i) => {
    if (!p) return "";
    const done = CONVO.perm?.[i];
    if (done) {
      return `<div class="ev ev-audit"><div class="evrow">
        <span class="evrow-i">${done.ok ? ICON.done() : ICON.fail()}</span>
        <span class="evrow-t">${esc(done.text)}</span>
      </div></div>`;
    }
    return `
      <section class="perm" aria-labelledby="perm-h-${i}">
        <h3 class="perm-q" id="perm-h-${i}">Run this command?</h3>
        <p class="perm-cmd">${esc(p.command)}</p>
        <p class="perm-scope">${esc(p.scope)}</p>
        <div class="perm-a">
          <button class="btn btnp" type="button" data-perm="once" data-turn="${i}">Allow once</button>
          <button class="btn btnq" type="button" style="border-color:var(--line)" data-perm="always" data-turn="${i}">Always allow here</button>
          <button class="btn btnq" type="button" data-perm="deny" data-turn="${i}">Deny</button>
        </div>
        <details class="perm-d">
          <summary>Details</summary>
          <dl class="perm-kv">
            <dt>Why</dt><dd>${esc(p.why)}</dd>
            <dt>Working dir</dt><dd><span class="m">${esc(p.cwd)}</span></dd>
            <dt>Reversible</dt><dd>${esc(p.reversible)}</dd>
          </dl>
        </details>
      </section>`;
  };

  const recoveryBlock = (r) => r ? `
      <div class="recover">
        ${r.primary.href
    ? `<a class="btn btnp" href="${esc(r.primary.href)}">${esc(r.primary.label)}</a>`
    : `<button class="btn btnp" type="button" data-recover="${esc(r.primary.action)}">${esc(r.primary.label)}</button>`}
        ${r.alternatives.map((a) => a.href
    ? `<a class="btn" href="${esc(a.href)}">${esc(a.label)}</a>`
    : `<button class="btn" type="button" data-recover="${esc(a.action)}">${esc(a.label)}</button>`).join("")}
        <button class="btnq hit recover-x" type="button" data-diagnostics>View attempts</button>
      </div>` : "";

  // Capability flags: a control only renders when something real is behind it.
  // checkpoints stays false until a CheckpointAdapter is connected.
  const CAPS = { copy: true, feedback: true, onRetry: null, moreItems: [],
    checkpoints: new URLSearchParams(location.search).has("dev-checkpoints") };
  const mactCopy = (text, label) =>
    `<button class="mact" type="button" data-copy="${esc(text)}" aria-label="${esc(label)}"><span class="mact-i">${svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15"/>', "currentColor", "1.8")}</span><span class="mact-t">Copy</span></button>`;

  const messageActions = (i, text) => {
    const parts = [];
    if (CAPS.copy) parts.push(mactCopy(text, "Copy response"));
    if (CAPS.feedback) parts.push(
      `<button class="mact" type="button" data-vote="up" data-turn="${i}" aria-pressed="false" aria-label="Helpful"><span class="mact-i">${svg('<path d="M7 20V10M7 10l4.2-6.2a1.8 1.8 0 0 1 3 1.9L13 10h5.2a2 2 0 0 1 2 2.4l-1.3 6A2 2 0 0 1 17 20H7z"/>', "currentColor", "1.7")}</span></button>`,
      `<button class="mact" type="button" data-vote="down" data-turn="${i}" aria-pressed="false" aria-label="Not helpful"><span class="mact-i">${svg('<path d="M17 4v10M17 14l-4.2 6.2a1.8 1.8 0 0 1-3-1.9L11 14H5.8a2 2 0 0 1-2-2.4l1.3-6A2 2 0 0 1 7 4h10z"/>', "currentColor", "1.7")}</span></button>`);
    return parts.length ? `<div class="mactions" data-assistant-actions>${parts.join("")}</div>` : "";
  };

  const assistantTurn = (t, i, state) => {
    const settled = state === "complete" || state === "stopped" || state === "error";
    const list = t.blocks || [];
    // Summary keeps the prose and drops the plan; the outcome carries the rest.
    const shown = DENSITY === "summary" ? list.filter((b) => b.t !== "plan") : list;
    const text = list.filter((b) => b.t === "p" || b.t === "note").map((b) => b.text).join("\n\n");
    const halted = t.stopped
      ? `<p class="haltnote">${svg('<rect x="7" y="7" width="10" height="10" rx="2"/>', "currentColor", "1.8")}<span>You stopped this response</span></p>`
      : "";
    return `
    <article class="turn turn-assistant" data-turn="${i}">
      ${shown.length ? `<div class="prose amsg" data-amsg>${blocks(shown, i)}</div>` : ""}
      ${halted}
      ${activityGroup(t.activity, i)}
      ${outcome(t.activity, i)}
      ${permissionBlock(t.permission, i)}
      ${recoveryBlock(t.recovery)}
      ${settled && text ? messageActions(i, text) : ""}
    </article>`;
  };

  const thinkingTurn = () => `
    <article class="turn turn-assistant" data-turn="pending">
      <div class="ev ev-think"><div class="evrow">
        <span class="evrow-i">${ICON.running()}</span>
        <span class="evrow-t" data-thinking-label>Thinking</span>
      </div></div>
    </article>`;

  /* One question above the input, and nothing else. Suggestion bars filled the
     canvas with three guesses about the user's work and pushed the greeting to
     the bottom of the viewport; the composer already says what to do. */
  const emptyState = () => `
    <div class="empty" data-empty>
      <span class="empty-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true"><rect x="2.4" y="2.4" width="19.2" height="19.2" rx="5.6" stroke="currentColor" stroke-width="1.7"/><path d="M8.6 8.9 11.7 12l-3.1 3.1" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.6 15.1h3.3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg></span>
      <h2 class="empty-q">What do you want to build?</h2>
    </div>`;

  /* Up to three stored sessions, as plain rows under the composer.
   *
   * These are the same sessions the sidebar lists and each one opens its real
   * transcript. Nothing invented: with no stored session the area is absent
   * rather than filled with sample prompts. */
  function renderRecents() {
    const host = $("[data-recents]");
    if (!host) return;
    const raw = $("#fl-sessions");
    if (!raw) return;
    let chats = [];
    try { chats = JSON.parse(raw.textContent).chats || []; } catch { chats = []; }
    const rows = chats.filter((c) => c.hasThread).slice(0, 3);
    host.innerHTML = rows.length ? rows.map((c) => `
      <a href="/app/" data-open-chat="${esc(c.id)}">
        ${ICON.plan()}<span class="t">${esc(c.title)}</span>
      </a>`).join("") : "";
    host.hidden = rows.length === 0;
  }

  /* Which of the two workspace compositions is showing.
   *
   *   start    a session with no messages: the composer is the subject, and
   *            heading, composer, context and recents form one centred cluster
   *   session  a session with messages: the transcript is the subject and the
   *            composer is a compact bar at the bottom
   *
   * Derived from session state, never from the route. Every fixture route and
   * every saved chat picks its composition from the same rule, and the shared
   * markup, draft, popovers and handlers survive the change.
   */
  function setComposition(hasMessages) {
    const app = $(".app");
    if (!app) return;
    const next = hasMessages ? "session" : "start";
    if (app.dataset.composition === next) return;
    app.dataset.composition = next;

    // The context strip renders below the composer in start and above it in
    // session. Moving the node, rather than reordering with CSS, keeps the tab
    // order matching what is on screen in both compositions.
    const form = $("[data-composer]");
    const strip = form && $(".cstrip", form);
    const recents = form && $("[data-recents]", form);
    if (form && strip) {
      if (next === "start") {
        form.appendChild(strip);
        if (recents) form.appendChild(recents);
      } else {
        form.insertBefore(strip, form.firstElementChild);
      }
    }
    // A short cross-fade only, so the change reads as one layout settling
    // rather than the composer travelling across the screen.
    if (!reduced) {
      app.classList.add("is-recomposing");
      setTimeout(() => app.classList.remove("is-recomposing"), 240);
    }
  }

  /* ---- render --------------------------------------------------------- */
  function renderThread() {
    const el = CONVO.el;
    if (!el) return;
    const t = CONVO.thread;
    const hasMessages = !!(t && t.turns && t.turns.length);
    setComposition(hasMessages);
    if (!hasMessages) {
      el.innerHTML = emptyState();
      el.classList.add("is-empty");
      return;
    }
    el.classList.remove("is-empty");
    const state = CONVO.state === "idle" ? (t.state || "complete") : CONVO.state;
    // A transcript carries no visible heading of its own, so it gets a hidden
    // one naming the conversation. The empty state has its own visible h1, so
    // exactly one h1 exists either way.
    el.innerHTML = t.turns.map((turn, i) =>
        turn.role === "user" ? userMessage(turn, i) : assistantTurn(turn, i, state)).join("")
      + (CONVO.state === "thinking" || CONVO.state === "submitting" ? thinkingTurn() : "");
  }


  function wireConversation() {
    const el = $("[data-thread]");
    if (!el) return;
    CONVO.el = el;
    CONVO.scroll = $("[data-thread-scroll]");
    const status = $("[data-thread-status]");
    const jump = $("[data-jump]");
    const form = $("[data-composer]");
    const ta = form && $("textarea", form);
    const send = form && $("[data-send]", form);
    const raw = $("#fl-sessions");
    CONVO.data = raw ? JSON.parse(raw.textContent) : { threads: {}, projects: [] };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const say = (msg) => { if (status) status.textContent = msg; };

    /* ---- state ------------------------------------------------------- */
    const setState = (next) => {
      CONVO.state = next;
      el.dataset.state = next;
      if (form) form.dataset.state = next;
      const running = next === "submitting" || next === "thinking" ||
        next === "tool-running" || next === "streaming";
      if (send) {
        send.dataset.stop = running ? "true" : "false";
        send.setAttribute("aria-label", running ? "Stop generating" : "Send");
        send.type = running ? "button" : "submit";
        send.disabled = running ? false : !(ta && ta.value.trim());
      }
      // the composer edge reads this attribute for its working state
      if (form) form.toggleAttribute("data-running", running);
      if (running) say(next === "tool-running" ? "Running a tool" : "Working on it");
      if (next === "complete") say("Response complete");
      if (next === "stopped") say("Task stopped");
    };

    /* ---- scroll ------------------------------------------------------ */
    const AWAY = 112;   // px from the bottom before the reader counts as away
    const distanceFromBottom = () => {
      const s = CONVO.scroll;
      return s.scrollHeight - s.scrollTop - s.clientHeight;
    };
    const atBottom = () => distanceFromBottom() < 48;
    const showJump = (on) => { if (jump) jump.hidden = !on; };
    const syncJump = () => { showJump(distanceFromBottom() > AWAY); };
    const toBottom = (smooth) => {
      CONVO.scroll.scrollTo({ top: CONVO.scroll.scrollHeight,
        behavior: smooth && !reduced ? "smooth" : "auto" });
    };
    const follow = () => { if (CONVO.follow) toBottom(true); };
    CONVO.syncJump = syncJump;
    CONVO.toBottom = toBottom;

    let lastTop = CONVO.scroll.scrollTop;
    CONVO.scroll.addEventListener("scroll", () => {
      const s = CONVO.scroll;
      // scrolling up by any real amount hands control back to the reader, and
      // the button tracks position rather than waiting for new output
      if (s.scrollTop < lastTop - 4) CONVO.follow = false;
      if (atBottom()) CONVO.follow = true;
      syncJump();
      lastTop = s.scrollTop;
    }, { passive: true });

    const jumpToLatest = () => {
      CONVO.follow = true;
      const target = CONVO.scroll;
      const land = () => { target.scrollTop = target.scrollHeight - target.clientHeight; };
      if (reduced) { land(); syncJump(); }
      else {
        target.scrollTo({ top: target.scrollHeight, behavior: "smooth" });
        // a smooth scroll can be interrupted by focus or a rerender, so the
        // landing is confirmed rather than assumed
        clearTimeout(CONVO.jumpTimer);
        CONVO.jumpTimer = setTimeout(() => {
          if (distanceFromBottom() > 2) land();
          syncJump();
        }, 420);
      }
      // focusing must not scroll the composer back into view mid-flight
      if (ta) ta.focus({ preventScroll: true });
    };
    // Enter and Space fire click on a button, so one handler covers both
    if (jump) jump.addEventListener("click", jumpToLatest);

    /* ---- load a thread ----------------------------------------------- */
    const load = (id, project) => {
      CONVO.thread = id ? CONVO.data.threads[id] : null;
      CONVO.project = project || CONVO.project;
      CONVO.open = {};
      CONVO.perm = {};
      CONVO.state = "idle";
      seedRunFromThread(CONVO.thread);
      // The follow flag has to be decided BEFORE the render: the observer that
      // watches the transcript scrolls to the end while it is true, which was
      // undoing the restore a frame later.
      CONVO.sessionId = id;
      const saved = READING.get(id);
      CONVO.follow = saved ? saved.pinned : true;
      renderThread();
      setState(CONVO.thread?.state || "idle");
      // a historical chat comes back where it was left, not at its end
      const settle = () => {
        if (!restoreReading(id)) CONVO.toBottom?.(false);
        CONVO.syncJump?.();
      };
      requestAnimationFrame(settle);
      setTimeout(settle, 60);
      setTimeout(settle, 220);
      if (CONVO.thread?.composer && ta) {
        ta.placeholder = CONVO.thread.composer.placeholder;
        // A session's stored mode is normalised before it can reach the label,
        // so switching to an older chat cannot show a raw enum value.
        const mode = $("[data-mode-label]", form);
        if (mode) mode.textContent = modeLabel(CONVO.thread.composer.mode);
      }
      // Artifacts is only offered when the open turn actually produced some
      const files = (CONVO.thread?.turns || [])
        .reduce((n, t) => n + (t.activity?.files?.length || 0), 0);
      $$("[data-artifacts]").forEach((el) => { el.hidden = files === 0; });
      $$("[data-artifacts-n]").forEach((el) => { el.textContent = String(files); });
      CONVO.follow = true;
      showJump(false);
      requestAnimationFrame(() => { toBottom(false); syncJump(); });
    };
    CONVO.load = load;

    /* ---- activity disclosure ----------------------------------------- */
    el.addEventListener("click", (e) => {
      const t = e.target.closest("[data-row-toggle], [data-plan-toggle]");
      if (!t) return;
      const key = t.dataset.rowToggle || ("plan" + t.dataset.planToggle);
      const body = t.nextElementSibling;
      const open = t.getAttribute("aria-expanded") !== "true";
      // hold the reading position: expanding must not throw the page around
      const s = CONVO.scroll, before = s ? s.scrollHeight - s.scrollTop : 0;
      CONVO.open[key] = open;
      t.setAttribute("aria-expanded", String(open));
      if (body) body.hidden = !open;
      if (s && !CONVO.follow) s.scrollTop = s.scrollHeight - before;
    });

    /* ---- message actions --------------------------------------------- */
    el.addEventListener("click", (e) => {
      const copy = e.target.closest("[data-copy]");
      if (copy) {
        const label = $(".mact-t", copy);
        navigator.clipboard?.writeText(copy.dataset.copy).catch(() => {});
        copy.classList.add("is-done");
        const was = label ? label.textContent : "";
        if (label) label.textContent = "Copied";
        copy.setAttribute("aria-label", "Copied");
        setTimeout(() => {
          copy.classList.remove("is-done");
          if (label) label.textContent = was;
          copy.setAttribute("aria-label", was ? `${was} message` : "Copy");
        }, 1500);
        return;
      }
      const vote = e.target.closest("[data-vote]");
      if (vote) {
        const on = vote.getAttribute("aria-pressed") !== "true";
        const row = vote.closest(".mactions");
        $$("[data-vote]", row).forEach((b) => b.setAttribute("aria-pressed", "false"));
        vote.setAttribute("aria-pressed", String(on));
        say(on ? (vote.dataset.vote === "up" ? "Marked helpful" : "Marked not helpful") : "Rating cleared");
        return;
      }
      const retry = e.target.closest("[data-retry]");
      if (retry && CAPS.onRetry) { CAPS.onRetry(retry.closest(".turn")); return; }
    });

    /* ---- inline edit of a user message ------------------------------- */
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-edit-msg]");
      if (!b) return;
      const turn = b.closest(".turn");
      const body = $("[data-umsg-text]", turn);
      if ($(".uedit", turn)) return;
      const was = body.textContent;
      const actions = $(`[data-actions-for="${turn.dataset.turn}"]`, turn);
      const actionsHome = actions && actions.nextSibling;
      if (actions) actions.remove();
      const wrap = document.createElement("div");
      wrap.className = "uedit";
      wrap.innerHTML = `<textarea class="uedit-t" aria-label="Edit message"></textarea>
        <div class="uedit-a"><button class="btn btns btnp" type="button" data-edit-save>Save</button>
        <button class="btn btns" type="button" data-edit-cancel>Cancel</button></div>`;
      const input = $("textarea", wrap);
      input.value = was;
      body.hidden = true;
      body.after(wrap);
      input.style.height = Math.min(input.scrollHeight + 2, 200) + "px";
      input.focus();
      input.setSelectionRange(was.length, was.length);

      const close = (commit) => {
        const next = commit && input.value.trim() ? input.value.trim() : was;
        if (commit && input.value.trim() && next !== was) {
          body.textContent = next;
          say("Message updated");
        }
        wrap.remove();
        body.hidden = false;
        if (actions) {
          const c = $("[data-copy]", actions);
          if (c) c.dataset.copy = next;
          turn.insertBefore(actions, actionsHome);
          $("[data-edit-msg]", actions).focus();
        }
      };
      $("[data-edit-save]", wrap).addEventListener("click", () => close(true));
      $("[data-edit-cancel]", wrap).addEventListener("click", () => close(false));
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(false); }
        if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); close(true); }
      });
    });

    /* ---- permission resolves into an immutable row ------------------- */
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-perm]");
      if (!b) return;
      const i = b.dataset.turn;
      const kind = b.dataset.perm;
      const pending = pendingPermission(RUN.state);
      dispatch({
        type: "permission.decided",
        runId: RUN.state.runId || "seed",
        callId: pending ? pending.callId : "seed-perm",
        decision: kind === "deny" ? "deny" : kind === "always" ? "always" : "once",
        at: new Date().toISOString(),
      });
      CONVO.perm[i] = kind === "deny"
        ? { ok: false, text: "Denied. The command was not run." }
        // Allowed is not Installed. Only a completed tool may say that, and
        // this prototype has no runtime to complete one.
        : { ok: true, text: kind === "always"
          ? "Allowed in this project. Waiting for the runtime to run it."
          : "Allowed once. Waiting for the runtime to run it." };
      if (kind !== "deny") {
        // The grant is real; the execution is not, because no runtime is
        // connected to run it. The run blocks on that rather than inventing
        // an outcome the permission never produced.
        dispatch({
          type: "run.blocked", runId: RUN.state.runId || "seed",
          reason: "Waiting for a local runtime to run the approved command.",
          at: new Date().toISOString(),
        });
      }
      CONVO.thread.state = kind === "deny" ? "stopped" : "blocked";
      setState(kind === "deny" ? "stopped" : "idle");
      renderThread();
      const next = $(".ev-audit", el);
      if (next) next.setAttribute("tabindex", "-1"), next.focus();
      say(CONVO.perm[i].text);
    });

    /* ---- recovery ----------------------------------------------------- */
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-recover]");
      if (!b) return;
      if (b.dataset.recover === "restore" && !(await flConfirm({
        title: "Restore checkpoint 2?",
        body: "Every edit made after that checkpoint is discarded.",
        scope: [["Files affected", "src/lib/date.js"],
          ["Kept", "Everything changed before this task started"],
          ["Reversible", "No. The discarded edits cannot be recovered."]],
        confirm: "Restore checkpoint", cancel: "Keep the edits", danger: true }))) return;
      const row = b.closest(".recover");
      row.replaceChildren(Object.assign(document.createElement("span"), {
        className: "recover-done",
        textContent: b.dataset.recover === "restore"
          ? "Restored to checkpoint 2." : "Left as it is. The edits are still on disk.",
      }), Object.assign(document.createElement("a"),
        { className: "btn btns", href: "/app/", textContent: "Start a new session" }));
      say("Recovery applied");
    });

    /* ---- composer send / stop ---------------------------------------- */
    if (form && ta) {
      // a running route starts in its running state
      const initial = el.dataset.threadId;
      const proj = CONVO.data.projects?.[0];
      CONVO.project = proj;
      CONVO.thread = initial ? CONVO.data.threads[initial] : null;
      seedRunFromThread(CONVO.thread);
      renderThread();
      setState(CONVO.thread?.state || "idle");
      requestAnimationFrame(() => toBottom(false));

      let composing = false;
      ta.addEventListener("compositionstart", () => { composing = true; });
      ta.addEventListener("compositionend", () => { composing = false; });
      ta.addEventListener("input", () => {
        // Stop is always available; Send is gated on a real draft
        if (send.dataset.stop !== "true") send.disabled = !ta.value.trim();
      });

      const working = () => /submitting|thinking|tool-running|streaming/.test(CONVO.state);

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (composing) return;
        const text = ta.value.trim();
        if (!text) return;
        if (working()) {
          queueMessage(text);
          ta.value = "";
          ta.style.height = "";
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          return;
        }
        submit(text);
      });

      send.addEventListener("click", (e) => {
        if (send.dataset.stop !== "true") return;
        e.preventDefault();
        stop();
      });

      const submit = (text) => {
        setState("submitting");
        CONVO.thread = CONVO.thread || { turns: [], state: "idle" };
        CONVO.thread.turns = [...CONVO.thread.turns, { role: "user", text }];
        ta.value = "";
        ta.style.height = "";
        ta.focus();
        CONVO.follow = true;
        renderThread();
        toBottom(true);
        setState("thinking");
        // the prototype has no model behind it, so it says so rather than
        // inventing an answer
        CONVO.timer = setTimeout(() => {
          CONVO.thread.turns = [...CONVO.thread.turns, { role: "assistant", blocks: [
            { t: "p", text: "This prototype has no model behind the composer, so there is no reply to stream. The conversation, activity and review surfaces around it are real." },
          ] }];
          CONVO.thread.state = "complete";
          setState("complete");
          renderThread();
          follow();
        }, reduced ? 300 : 1100);
      };

      const stop = () => {
        clearTimeout(CONVO.timer);
        // idempotent: a settled run returns the same state and nothing repaints
        const before = RUN.state;
        dispatch({ type: "run.stopped", runId: RUN.state.runId || "seed", at: new Date().toISOString() });
        if (RUN.state === before) return;
        const turns = CONVO.thread?.turns;
        if (turns?.length) {
          const last = turns[turns.length - 1];
          if (last.role === "assistant") last.stopped = true;
          else turns.push({ role: "assistant", blocks: [], stopped: true });
          CONVO.thread.state = "stopped";
        }
        setState("stopped");
        renderThread();
        say("Stopped");
      };
      CONVO.stop = stop;
    }

    // new content while the reader is away from the bottom offers a way back
    const io = new MutationObserver(() => {
      if (CONVO.follow) toBottom(!reduced);
      requestAnimationFrame(syncJump);
    });
    io.observe(el, { childList: true, subtree: true });
  }

  /* --------------------------------------------------------------- composer */
  function wireComposer() {
    // Geometry and keys only: the conversation owns send, stop and the
    // starters, so there is one place that decides what a submit means.
    $$("[data-composer]").forEach((form) => {
      const ta = $("textarea", form);
      if (!ta) return;
      const grow = () => {
        ta.style.height = "auto";
        ta.style.height = Math.min(ta.scrollHeight, 176) + "px";
      };
      ta.addEventListener("input", grow);
      grow();
      let composing = false;
      ta.addEventListener("compositionstart", () => { composing = true; });
      ta.addEventListener("compositionend", () => { composing = false; });
      ta.addEventListener("keydown", (e) => {
        // Enter sends, Shift+Enter breaks the line, and an IME composition
        // always wins over both.
        if (e.key !== "Enter" || e.shiftKey || composing || e.isComposing) return;
        e.preventDefault();
        form.requestSubmit ? form.requestSubmit()
          : form.dispatchEvent(new Event("submit", { cancelable: true }));
      });
    });
  }

  /* ------------------------------------------------- composer, no thread */
  /* /setup/5/ and /app/review/ have a real composer but no transcript, so
     wireConversation bails on them and nothing gated Send or handled submit.
     The button was enabled on an empty draft, and pressing it ran a native
     form submission: the page reloaded, which is what made a closed artifact
     panel appear to reopen itself. Same rules as the chat routes, one owner
     per route. */
  function wireComposerDraft() {
    if ($("[data-thread]")) return;          // the conversation owns those
    $$("[data-composer]").forEach((form) => {
      const ta = $("textarea", form);
      const send = $("[data-send]", form);
      if (!ta || !send) return;

      const sync = () => {
        const empty = !ta.value.trim();
        send.disabled = empty;
        send.setAttribute("aria-disabled", String(empty));
      };
      ta.addEventListener("input", sync);
      sync();

      const fill = (text) => {
        ta.value = text;
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        sync();
      };
      $$("[data-starter], [data-suggest]").forEach((b) =>
        b.addEventListener("click", () => fill(b.dataset.starter || b.dataset.suggest)));

      form.addEventListener("submit", (e) => {
        // Always: a rejected submit must not navigate, because a reload here
        // silently resets every other panel on the route.
        e.preventDefault();
        if (!ta.value.trim()) return;
        toast("No model is connected in this wireframe, so nothing is sent. Your draft is kept.");
      });
    });
  }

  /* One live region for state transitions. Working, Needs input, Stopped and
     Done are announced; nothing announces a timer. */
  function announce(msg) {
    const el = $("[data-thread-status]") || $("[data-live]");
    if (el) el.textContent = msg;
  }

  /* --------------------------------------------------- composer controls */
  /* Mode, effort and the model shortcut. Each writes one value and closes its
     own popover; none of them claims anything ran. */
  function wireComposerControls() {
    // Ctrl/Cmd+L opens the model picker from anywhere that is not a text field.
    document.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() !== "l" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const trigger = $('[data-popover="model-pop"]');
      if (!trigger) return;
      e.preventDefault();
      trigger.click();
    });

    // Ctrl+1..3 switch mode, matching the shortcuts the menu shows.
    const modeKeys = { 1: "plan", 2: "manual", 3: "allow_edits" };
    document.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const want = modeKeys[e.key];
      if (!want) return;
      const btn = $(`[data-mode-pop] [data-mode="${want}"]`);
      if (!btn || btn.disabled) return;
      e.preventDefault();
      btn.click();
    });

    const pickOne = (attr, labelSel, onPick) => {
      $$(`[${attr}]`).forEach((b) => b.addEventListener("click", () => {
        if (b.disabled) return;
        const value = b.getAttribute(attr);
        $$(`[${attr}]`).forEach((x) => {
          const on = x === b;
          x.setAttribute("aria-checked", String(on));
          x.classList.toggle("on", on);
        });
        $$(labelSel).forEach((l) => { l.textContent = value; });
        store.set(attr, value);
        closePop();
        if (onPick) onPick(value);
      }));
      const saved = store.get(attr, null);
      if (saved) {
        const b = $(`[${attr}="${saved}"]`);
        if (b && !b.disabled) {
          $$(`[${attr}]`).forEach((x) => {
            const on = x === b;
            x.setAttribute("aria-checked", String(on));
            x.classList.toggle("on", on);
          });
          $$(labelSel).forEach((l) => { l.textContent = saved; });
        }
      }
    };

    /* The mode is an enum, not a label. Every read goes through normalizeMode
       and every write is an id, so a stored "normal" from an older build
       migrates instead of appearing in the control. */
    const setMode = (value) => {
      const id = normalizeMode(value, (m) => console.debug("[forgelocal] " + m));
      $$("[data-mode-pop] [data-mode]").forEach((x) => {
        const on = x.getAttribute("data-mode") === id;
        x.setAttribute("aria-checked", String(on));
        x.classList.toggle("on", on);
      });
      $$("[data-mode-label]").forEach((l) => { l.textContent = modeLabel(id); });
      store.set("mode", id);
      return id;
    };
    $$("[data-mode-pop] [data-mode]").forEach((b) => b.addEventListener("click", () => {
      if (b.disabled) return;
      const id = setMode(b.getAttribute("data-mode"));
      closePop();
      announce(`Mode: ${modeLabel(id)}.${id === "plan" ? " Nothing will be changed." : ""}`);
    }));
    // Legacy key: older builds stored the visible label under "data-mode".
    setMode(store.get("mode", null) ?? store.get("data-mode", null));

    pickOne("data-effort", "[data-effort-label]");

    // Auto needs a sandbox this build does not have, so it says why rather
    // than looking available.
    $$("[data-mode-pop] [data-mode][disabled]").forEach((b) => {
      b.title = "Auto needs an isolated runtime. Not available in the web preview.";
    });
  }

  /* ------------------------------------------------------ transcript detail */
  /* A pending permission is the loudest thing on screen; the composer edge
     steps back while one is open. */
  function wireAwaiting() {
    const form = $("[data-composer]");
    if (!form) return;
    const sync = () => {
      const pending = !!$(".perm");
      form.toggleAttribute("data-awaiting", pending);
    };
    sync();
    new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
  }

  function wireDensity() {
    const paint = () => $$("[data-density]").forEach((b) =>
      b.setAttribute("aria-checked", String(b.dataset.density === DENSITY)));
    $$("[data-density]").forEach((b) => b.addEventListener("click", () => {
      DENSITY = b.dataset.density;
      store.set("density", DENSITY);
      paint();
      closePop();
      if (CONVO.el) renderThread();
      toast(`Transcript detail: ${DENSITY}.`);
    }));
    paint();
  }

  /* ------------------------------------------------------- queued messages */
  /* While the agent is working, Enter queues rather than discarding. A queued
     item is an editable row: it can be pulled back into the composer or
     dropped. Nothing is sent, because there is no adapter to send it to. */
  const QUEUE = [];
  function paintQueue() {
    const host = $("[data-queue]");
    if (!host) return;
    host.hidden = QUEUE.length === 0;
    host.innerHTML = QUEUE.map((text, i) => `
      <div class="qrow">
        <span class="qrow-i" aria-hidden="true">${svg('<path d="M4 7h16M4 12h16M4 17h10"/>', "currentColor", "1.8")}</span>
        <span class="qrow-t" title="${esc(text)}">${esc(text)}</span>
        <button class="mact" type="button" data-queue-edit="${i}" aria-label="Edit this queued message"><span class="mact-t">Edit</span></button>
        <button class="mact" type="button" data-queue-drop="${i}" aria-label="Remove this queued message"><span class="mact-i">${svg('<path d="M18 6 6 18M6 6l12 12"/>', "currentColor", "2")}</span></button>
      </div>`).join("");
  }
  function queueMessage(text) {
    QUEUE.push(text);
    paintQueue();
    announce(`Queued. ${QUEUE.length} message${QUEUE.length === 1 ? "" : "s"} waiting.`);
  }
  function wireQueue() {
    const host = $("[data-queue]");
    if (!host) return;
    host.addEventListener("click", (e) => {
      const edit = e.target.closest("[data-queue-edit]");
      const drop = e.target.closest("[data-queue-drop]");
      const ta = $("[data-composer] textarea");
      if (edit) {
        const i = +edit.dataset.queueEdit;
        const text = QUEUE.splice(i, 1)[0];
        if (ta) {
          ta.value = ta.value ? ta.value + "\n" + text : text;
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          ta.focus();
        }
        paintQueue();
      } else if (drop) {
        QUEUE.splice(+drop.dataset.queueDrop, 1);
        paintQueue();
      }
    });
  }

  /* ------------------------------------------------ slash and at menus */
  /* Both open at the caret, filter as you type, and are keyboard operable.
     They insert text; nothing here executes. */
  const SLASH = [
    ["/plan", "Switch to Plan mode for the next message"],
    ["/build", "Switch to Build mode"],
    ["/ask", "Switch to Ask mode, which changes nothing"],
    ["/rewind", "Rewind to an earlier checkpoint"],
    ["/review", "Open the diff for this task"],
    ["/clear", "Start a new session in this project"],
  ];
  const MENTIONS = [
    ["src/App.jsx", "file"], ["src/useTasks.js", "file"], ["src/index.css", "file"],
    ["src/App.test.jsx", "file"], ["package.json", "file"], ["src/", "folder"],
  ];

  function wireCaretMenus() {
    const form = $("[data-composer]");
    const ta = form && $("textarea", form);
    if (!ta) return;
    let host = $(".caret-menu");
    if (!host) {
      host = document.createElement("div");
      host.className = "caret-menu menu";
      host.hidden = true;
      host.setAttribute("role", "listbox");
      form.appendChild(host);
    }
    let items = [], active = 0, trigger = "", start = -1;

    const close = () => { host.hidden = true; items = []; trigger = ""; start = -1; };
    const paint = () => {
      host.innerHTML = items.map(([a, b], i) => `
        <button class="srow" type="button" role="option" aria-selected="${i === active}"
          data-caret-pick="${esc(a)}"${i === active ? ' class="srow on"' : ""}>
          <span class="t${trigger === "@" ? " m" : ""}">${esc(a)}</span>
          <span class="lab">${esc(b)}</span></button>`).join("");
      $$("[aria-selected=true]", host).forEach((el) => el.classList.add("on"));
      host.hidden = items.length === 0;
    };
    const pick = (value) => {
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(ta.selectionStart);
      ta.value = before + value + " " + after;
      const caret = (before + value + " ").length;
      ta.setSelectionRange(caret, caret);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      close();
      ta.focus();
    };

    ta.addEventListener("input", () => {
      const caret = ta.selectionStart;
      const upto = ta.value.slice(0, caret);
      const m = upto.match(/(^|\s)([/@])([\w./-]*)$/);
      if (!m) return close();
      trigger = m[2];
      start = caret - m[3].length - 1;
      const q = m[3].toLowerCase();
      const source = trigger === "/" ? SLASH : MENTIONS;
      items = source.filter(([a]) => a.toLowerCase().includes(q)).slice(0, 6);
      active = 0;
      paint();
    });
    ta.addEventListener("keydown", (e) => {
      if (host.hidden) return;
      if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % items.length; paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + items.length) % items.length; paint(); }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); pick(items[active][0]); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    }, true);
    host.addEventListener("click", (e) => {
      const b = e.target.closest("[data-caret-pick]");
      if (b) pick(b.dataset.caretPick);
    });
    ta.addEventListener("blur", () => setTimeout(close, 120));
  }

  /* Long pastes become one disclosure rather than a wall in the input. */
  function wirePaste() {
    const ta = $("[data-composer] textarea");
    if (!ta) return;
    ta.addEventListener("paste", (e) => {
      const text = (e.clipboardData || window.clipboardData).getData("text");
      const lines = text.split("\n").length;
      if (lines < 12) return;
      e.preventDefault();
      const host = $("[data-queue]");
      const chip = document.createElement("div");
      chip.className = "qrow is-paste";
      chip.innerHTML = `<span class="qrow-i" aria-hidden="true">${svg('<path d="M9 4h6v3H9z"/><path d="M7 6H5.5A1.5 1.5 0 0 0 4 7.5v11A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 18.5 6H17"/>', "currentColor", "1.7")}</span>
        <span class="qrow-t">Pasted text &middot; <span class="num">${lines} lines</span></span>
        <button class="mact" type="button" data-paste-drop aria-label="Remove pasted text"><span class="mact-i">${svg('<path d="M18 6 6 18M6 6l12 12"/>', "currentColor", "2")}</span></button>`;
      chip.querySelector("[data-paste-drop]").addEventListener("click", () => {
        chip.remove();
        if (host && !host.querySelector(".qrow")) host.hidden = true;
      });
      if (host) { host.hidden = false; host.appendChild(chip); }
      toast(`Attached as ${lines} lines instead of filling the composer.`);
    });
  }

  /* ------------------------------------------------------------------- tabs */
  function wireTabs() {
    $$('[role="tablist"]').forEach((list) => {
      const tabs = $$('[role="tab"]', list);
      const select = (tab) => {
        tabs.forEach((t) => {
          const on = t === tab;
          t.setAttribute("aria-selected", String(on));
          t.tabIndex = on ? 0 : -1;
          const id = t.getAttribute("aria-controls");
          const panel = id && document.getElementById(id);
          if (panel) {
            panel.hidden = !on;
            // a hidden panel must not keep focusable children in the tab order
            $$("a, button, input, textarea, select, [tabindex]", panel)
              .forEach((el) => { el.tabIndex = on ? 0 : -1; });
          }
        });
      };
      tabs.forEach((t) => {
        t.addEventListener("click", () => select(t));
        t.addEventListener("keydown", (e) => {
          const i = tabs.indexOf(t);
          let j = null;
          if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
          if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
          if (e.key === "Home") j = 0;
          if (e.key === "End") j = tabs.length - 1;
          if (j !== null) { e.preventDefault(); tabs[j].focus(); select(tabs[j]); }
        });
      });
    });
  }

  /* ----------------------------------------------------------------- drawer */
  function wireDrawer() {
    const shell = $(".shell");
    const drawer = $(".drawer");
    if (!shell || !drawer) return;

    const setW = (px) => {
      const min = 380, max = Math.min(720, innerWidth - 420);
      const w = Math.max(min, Math.min(max, px));
      drawer.style.width = w + "px";
      store.set("drawer-w", w);
    };
    const stored = store.get("drawer-w", null);
    if (stored && innerWidth > 1080) setW(stored);

    $$("[data-drawer-close]").forEach((b) => b.addEventListener("click", () => {
      drawer.hidden = true;
      shell.classList.add("no-drawer");
      const opener = $("[data-drawer-open]");
      if (opener) opener.focus();
    }));
    const openPane = (which, focusTab) => {
      drawer.hidden = false;
      shell.classList.remove("no-drawer");
      const tab = which && $("#tab-" + which, drawer);
      if (tab) tab.click();
      const target = tab || $('[role="tab"][aria-selected="true"]', drawer);
      if (target && focusTab !== false) target.focus();
    };
    $$("[data-drawer-open]").forEach((b) => b.addEventListener("click", () =>
      openPane(b.dataset.pane)));
    // rows inside the transcript name the tab they belong to
    document.addEventListener("click", (e) => {
      const t = e.target.closest("[data-open-pane]");
      if (!t || t.hasAttribute("data-drawer-open")) return;
      openPane(t.dataset.openPane);
    });
    // Maximizing hides the conversation pane outright. Leaving it on screen at
    // 60px showed clipped paragraphs and half a Send button down the left edge,
    // and kept the transcript in the tab order.
    const conversation = $(".main", shell);
    const setMax = (on, btn) => {
      drawer.classList.toggle("is-max", on);
      shell.classList.toggle("is-max", on);
      if (conversation) conversation.inert = on;
      $$("[data-drawer-max]").forEach((b) => {
        b.setAttribute("aria-pressed", String(on));
        const label = on ? "Restore split view" : "Maximize the artifacts panel";
        b.setAttribute("aria-label", label);
        b.title = label;
      });
      if (btn) btn.focus();
    };
    $$("[data-drawer-max]").forEach((b) => b.addEventListener("click", () => {
      setMax(!drawer.classList.contains("is-max"), b);
    }));
    // Escape restores the split rather than closing the panel, because the
    // panel was already open before it was maximized.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !drawer.classList.contains("is-max")) return;
      e.preventDefault();
      setMax(false, $("[data-drawer-max]"));
    });

    const handle = $(".drawer-handle", drawer);
    if (handle) {
      let startX = 0, startW = 0, dragging = false;
      const move = (e) => { if (dragging) setW(startW + (startX - (e.touches ? e.touches[0].clientX : e.clientX))); };
      const up = () => { dragging = false; document.body.style.userSelect = ""; };
      handle.addEventListener("pointerdown", (e) => {
        dragging = true; startX = e.clientX; startW = drawer.getBoundingClientRect().width;
        document.body.style.userSelect = "none"; handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("keydown", (e) => {
        const w = drawer.getBoundingClientRect().width;
        if (e.key === "ArrowLeft") { e.preventDefault(); setW(w + 24); }
        if (e.key === "ArrowRight") { e.preventDefault(); setW(w - 24); }
      });
    }

    // unified / split changes the actual presentation
    $$("[data-diff-mode]").forEach((b) => b.addEventListener("click", () => {
      const mode = b.dataset.diffMode;
      $$("[data-diff-mode]").forEach((x) => {
        const on = x === b;
        x.classList.toggle("btnq", !on);
        x.setAttribute("aria-pressed", String(on));
      });
      const view = $("[data-diff-view]");
      if (view) view.dataset.mode = mode;
      store.set("diff-mode", mode);
    }));
  }

  /* ---------------------------------------------------------------- reviews */
  /* A Files row that is a focusable button has to do something. A changed file
     opens its diff and keeps a selected state on both lists; a file this task
     did not touch has no diff to open, so it is a listed row, not a button. */
  function wireFilesTab() {
    const rows = $$("[data-file-open]");
    if (!rows.length) return;
    const mark = (path) => rows.forEach((r) => {
      const on = r.dataset.fileOpen === path;
      r.setAttribute("aria-current", String(on));
      r.classList.toggle("on", on);
    });
    rows.forEach((row) => row.addEventListener("click", () => {
      const path = row.dataset.fileOpen;
      mark(path);
      const target = $('[data-review-file][data-path="' + path + '"]');
      if (target) target.click();
      const diffTab = $("#tab-diff");
      if (diffTab) diffTab.click();
      if (target) target.focus();
    }));
    // coming back to Files keeps the row that was opened selected
    const filesTab = $("#tab-files");
    if (filesTab) filesTab.addEventListener("click", () => {
      const open = $('[data-review-file][aria-current="true"]');
      if (open && open.dataset.path) mark(open.dataset.path);
    });
  }

  function wireReview() {
    const counter = $("[data-review-count]");
    const files = $$("[data-review-file]");
    const update = () => {
      if (!counter) return;
      const done = files.filter((f) => f.dataset.reviewed === "true").length;
      counter.textContent = `${done} of ${files.length} reviewed`;
    };
    const current = () =>
      $('[data-review-file][aria-current="true"]') || files.find((f) => f.dataset.reviewed !== "true");

    $$("[data-review-action]").forEach((b) => b.addEventListener("click", async () => {
      const act = b.dataset.reviewAction;
      if (act === "revert-all" || act === "revert-file") {
        const all = act === "revert-all";
        if (!(await flConfirm({
          title: all ? "Revert every change this task made?" : "Revert this file?",
          body: all
            ? "Both files go back to how the task found them."
            : "This file goes back to how the task found it.",
          scope: [["Scope", all ? "2 files changed by this task" : "The file open in the diff"],
            ["Kept", "Work you made before the task started"],
            ["Checkpoint", "Checkpoint 4 was taken before these edits"],
            ["Reversible", "Yes, restore checkpoint 4 to bring them back"]],
          confirm: all ? "Revert all files" : "Revert file", cancel: "Keep changes", danger: true }))) return;
      }
      // file-scoped actions live in the drawer footer, not inside the row, so
      // they apply to the file currently open in the diff.
      const target = b.closest("[data-review-file]")
        || (act.endsWith("-file") || act.endsWith("-hunk") ? current() : null);
      if (act.endsWith("-all")) files.forEach((f) => { f.dataset.reviewed = "true"; });
      else if (target) target.dataset.reviewed = "true";
      update();
      toast(act.startsWith("revert") ? "Reverted. Your pre-existing edits were left alone." : "Kept");
    }));

    // selecting a file in the list makes it the current one
    files.forEach((f) => f.addEventListener("click", () => {
      files.forEach((x) => x.removeAttribute("aria-current"));
      f.setAttribute("aria-current", "true");
      files.forEach((x) => x.classList.toggle("on", x === f));
    }));
    update();
  }

  /* ---------------------------------------------------------------- filters */
  /* Set by wireFilters so a store repaint can re-apply the current search and
     chips to rows that did not exist when the filter was wired. */
  let repaintFilters = () => {};

  function wireFilters() {
    const root = $("[data-filter-root]");
    if (!root) return;
    const count = $("[data-filter-count]");
    const empty = $("[data-filter-empty]");
    const search = $("[data-filter-search]", root);
    // Each surface keeps its own selection, so filters chosen on Explore do not
    // silently hide rows on a page that has no chips to clear them with.
    const key = "filters:" + (root.dataset.filterRoot || "default");
    const active = new Set(store.get(key, []));

    const paint = () => {
      $$("[data-filter]", root).forEach((b) => {
        const on = active.has(b.dataset.filter);
        b.setAttribute("aria-pressed", String(on));
        b.classList.toggle("is-on", on);
      });
      const q = (search?.value || "").trim().toLowerCase();
      let shown = 0;
      // re-queried every paint: the installed list is re-rendered from the
      // store, so holding the original elements would filter a dead list
      $$("[data-filter-item]", root).forEach((r) => {
        const tags = (r.dataset.tags || "").split(" ");
        const okTags = [...active].every((f) => tags.includes(f));
        const okText = !q || (r.dataset.name || "").toLowerCase().includes(q);
        const hit = okTags && okText;
        r.hidden = !hit;
        if (hit) shown++;
      });
      if (count) count.textContent = `${shown} model${shown === 1 ? "" : "s"}`;
      if (empty) empty.hidden = shown > 0;
      const clear = $("[data-filter-clear]", root);
      if (clear) clear.hidden = active.size === 0 && !q;
      store.set(key, [...active]);
      // A list that re-rendered may have hidden the selected row.
      FILTER_SUBS.forEach((fn) => fn());
    };

    $$("[data-filter]", root).forEach((b) => b.addEventListener("click", () => {
      active.has(b.dataset.filter) ? active.delete(b.dataset.filter) : active.add(b.dataset.filter);
      paint();
    }));
    const clear = $("[data-filter-clear]", root);
    if (clear) clear.addEventListener("click", () => { active.clear(); if (search) search.value = ""; paint(); });
    if (search) { let t; search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(paint, 120); }); }
    repaintFilters = paint;
    paint();
  }

  /* ------------------------------------------------------------------ inert */
  function wireInert() {
    $$("[data-inert]").forEach((el) => {
      if (el.tagName === "BUTTON") el.disabled = true;
      el.setAttribute("aria-disabled", "true");
      if (!el.title) el.title = el.dataset.inert || "Not available in this prototype";
    });
  }

  /* ----------------------------------------------------------- mobile nav */
  function wireNav() {
    const btn = $("[data-nav-toggle]");
    const nav = $("[data-nav]");
    if (!btn || !nav) return;
    const set = (open) => {
      nav.dataset.open = open ? "true" : "false";
      btn.setAttribute("aria-expanded", String(open));
      document.body.style.overflow = open ? "hidden" : "";
    };
    btn.addEventListener("click", () => set(nav.dataset.open !== "true"));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") set(false); });
    nav.addEventListener("click", (e) => { if (e.target.tagName === "A") set(false); });
  }

  /* -------------------------------------------------------------- pricing */
  function wirePricing() {
    const btns = $$("[data-billing]");
    if (!btns.length) return;
    const apply = (period) => {
      btns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.billing === period)));
      const yearly = period === "yearly";
      $$("[data-price-monthly]").forEach((el) => {
        const m = Number(el.dataset.priceMonthly);
        el.textContent = yearly ? `$${Math.round(m * 10)}` : `$${m}`;
      });
      $$("[data-price-period]").forEach((el) => { el.textContent = yearly ? "/year" : "/month"; });
      $$("[data-price-note]").forEach((el) => { el.style.visibility = yearly ? "visible" : "hidden"; });
      store.set("billing", period);
    };
    btns.forEach((b) => b.addEventListener("click", () => apply(b.dataset.billing)));
    apply(store.get("billing", "monthly"));
  }

  /* -------------------------------------------------------------- platform */
  function wirePlatform() {
    // The CTA label is stable and never changes after paint. Only the note
    // below it gains a detected-platform sentence, and it never promises a
    // build that does not exist.
    const ua = navigator.userAgent;
    const os = /Mac/.test(ua) ? "macOS" : /Linux|X11/.test(ua) ? "Linux" : "Windows";
    if (os === "Windows") return;
    $$("[data-platform-note]").forEach((note) => {
      note.textContent = `Detected ${os}. Only a Windows build exists today; ${os} is not available yet.`;
    });
  }

  /* -------------------------------------------------------------- sign in */
  function wireSignin() {
    const form = $("[data-signin]");
    if (!form) return;
    const input = $("input[type=email]", form);
    const submit = $("[data-signin-submit]", form);
    const error = $("[data-signin-error]", form);
    // Deliberately permissive: reject what is obviously not an address rather
    // than trying to out-clever the RFC.
    const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

    const setError = (msg) => {
      if (!error) return;
      error.textContent = msg || "";
      error.hidden = !msg;
      input.setAttribute("aria-invalid", msg ? "true" : "false");
    };

    input.addEventListener("input", () => {
      submit.disabled = !looksLikeEmail(input.value);
      if (error && !error.hidden && looksLikeEmail(input.value)) setError("");
    });
    input.addEventListener("blur", () => {
      const v = input.value.trim();
      if (v && !looksLikeEmail(v)) setError("That does not look like an email address.");
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return setError("Enter an email address.");
      if (!looksLikeEmail(v)) return setError("That does not look like an email address.");
      setError("");
      submit.disabled = true;
      submit.textContent = "Noted";
      toast("Accounts are not open yet. Nothing was sent and nothing was stored.");
    });
  }

  /* ------------------------------------------------------ download demo */
  /* --------------------------------------------------- download progress */
  /* One state formatter for every download surface. Onboarding, My models and
     Downloads each rendered their own copy, so pausing on Downloads left
     "28.6 MB/s - about 3 min left" next to the word Paused. A paused transfer
     has no speed and no estimate, and it says so everywhere. */
  function dlFormat(row, state) {
    const done = row.dataset.dlDone;      // one stored byte value, one precision
    const total = row.dataset.dlTotal;
    const pct = row.dataset.dlPct;
    const speed = row.dataset.dlRate;
    const left = row.dataset.dlLeft;
    const head = `${done} GB of ${total} GB · ${pct}%`;
    if (state === "cancelled") return `${head} · Cancelled`;
    if (state === "paused") return `${head} · Paused`;
    return `${head} · ${speed} · ${left}`;
  }

  function wireDownloadRows() {
    $$("[data-download]").forEach((row) => {
      const toggle = $("[data-dl-toggle]", row);
      if (!toggle) return;
      const cancel = $("[data-dl-cancel]", row);
      const state = $("[data-dl-state]", row);
      const scope = row.closest(".dlrow, .ob-col, .index, body") || document;
      const dot = $("[data-dl-dot]", scope);
      const bar = $("[data-dl-bar]", scope);
      const detail = $("[data-dl-detail]", scope);
      const verb = $("[data-dl-verb]", scope);
      const speedEl = $("[data-dl-speed]", scope);
      const remainEl = $("[data-dl-remain]", scope);
      const foot = $("[data-dl-foot]");
      const progress = $("[role=progressbar]", scope);
      let st = "downloading";

      const paint = () => {
        const paused = st === "paused", cancelled = st === "cancelled";
        const word = cancelled ? "Cancelled" : paused ? "Paused" : "Downloading";
        toggle.textContent = paused ? "Resume" : "Pause";
        toggle.setAttribute("aria-label", paused ? "Resume the download" : "Pause the download");
        if (state) state.textContent = word;
        if (verb) verb.textContent = word;
        if (dot) {
          dot.classList.toggle("pulse", st === "downloading");
          dot.className = dot.className.replace(/\b(acc|warn|bad)\b/,
            cancelled ? "bad" : paused ? "warn" : "acc");
        }
        if (bar) bar.style.opacity = st === "downloading" ? "1" : ".45";
        if (detail) detail.textContent = dlFormat(row, st);
        if (speedEl) speedEl.textContent = cancelled ? "Stopped" : paused ? "Paused" : row.dataset.dlRate;
        if (remainEl) remainEl.textContent = st === "downloading" ? row.dataset.dlLeft : "Not counting";
        if (foot) {
          foot.textContent = cancelled
            ? "Cancelled. The partial file is kept, so resuming does not start over."
            : paused
              ? `Paused. Resume to continue from ${row.dataset.dlDone} GB.`
              : `Downloading, ${row.dataset.dlLeft}. Step 4 opens while it runs.`;
        }
        if (progress) {
          progress.setAttribute("aria-label",
            cancelled ? "Download cancelled"
              : paused ? `Download paused at ${row.dataset.dlPct} percent`
                : "Download progress");
        }
      };

      toggle.addEventListener("click", () => {
        if (st === "cancelled") return;
        st = st === "paused" ? "downloading" : "paused";
        paint();
        toast(st === "paused"
          ? `Paused. It resumes from ${row.dataset.dlDone} GB.`
          : "Download resumed.");
      });

      if (cancel) cancel.addEventListener("click", async () => {
        if (st === "cancelled") return;
        const ok = await flConfirm({
          title: "Cancel this download?",
          body: "The part already downloaded stays on disk, so resuming later does not start over.",
          scope: [["Downloaded so far", `${row.dataset.dlDone} GB, kept on disk`],
            ["Setup progress", "Kept. You can resume from this step."],
            ["Reversible", "Yes, the download can be restarted at any time"]],
          confirm: "Cancel download", cancel: "Keep downloading", danger: true });
        if (!ok) return;
        st = "cancelled";
        toggle.disabled = true;
        toggle.setAttribute("aria-disabled", "true");
        cancel.disabled = true;
        if (bar) bar.style.width = "0%";
        paint();
        toast("Cancelled. The partial file is kept for a later resume.");
      });

      paint();
    });
  }

  /* ---------------------------------------------- the activity group's fold */
  function wireActivity() {
    $$("[data-act-toggle]").forEach((btn) => {
      const group = btn.closest(".act");
      if (!group) return;
      const rows = [...group.children].filter((el) => el !== btn.parentElement);
      const apply = (open) => {
        btn.setAttribute("aria-expanded", String(open));
        btn.textContent = open ? "Hide activity" : "Show activity";
        rows.forEach((el) => { el.hidden = !open; });
      };
      apply(btn.getAttribute("aria-expanded") === "true");
      btn.addEventListener("click", () => apply(btn.getAttribute("aria-expanded") !== "true"));
    });
  }

  /* ------------------------------------------------------ stopping a run */
  function wireStopRun() {
    const btn = $("[data-stop-run]");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const pill = $("[data-run-pill]");
      if (pill) pill.classList.remove("acc", "pulse");
      $$("[data-run-state]").forEach((el) => { el.textContent = "Stopped by you"; });
      $$(".act .dot.pulse").forEach((d) => d.classList.remove("pulse"));
      // the composer goes back to accepting a new instruction
      $$("[data-composer]").forEach((form) => {
        delete form.dataset.running;
        const send = $("[data-send]", form);
        const ta = $("textarea", form);
        if (send && ta) send.disabled = ta.value.trim() === "";
      });
      btn.replaceWith(Object.assign(document.createElement("a"),
        { className: btn.className, href: "/app/review/", textContent: "See what changed" }));
      toast("Stopped. The work already done is kept, and nothing was rolled back.");
    });
  }

  /* -------------------------------------------------- permission decision */
  function wirePermission() {
    const btns = $$("[data-perm]");
    if (!btns.length) return;
    const row = btns[0].parentElement;
    btns.forEach((b) => b.addEventListener("click", () => {
      const kind = b.dataset.perm;
      if (kind === "deny") {
        row.replaceChildren(Object.assign(document.createElement("span"), {
          className: "mut", style: "font-size:13.5px;line-height:20px",
          textContent: "Denied. The package was not installed, and the run stopped here.",
        }), Object.assign(document.createElement("a"),
          { className: "btn btns", href: "/app/stopped/", textContent: "See where it stopped" }));
        toast("Denied. Nothing was installed.");
        return;
      }
      if (kind === "always") store.set("rule:npm-install", true);
      toast(kind === "always"
        ? "Allowed. npm install will not ask again in this project."
        : "Allowed once. The next install will ask again.");
      setTimeout(() => { location.href = "/app/running/"; }, 350);
    }));
  }

  /* ------------------------------------------------------ recovery choices */
  function wireRecover() {
    $$("[data-recover]").forEach((b) => b.addEventListener("click", async () => {
      const row = b.parentElement;
      if (b.dataset.recover === "restore") {
        if (!(await flConfirm({
          title: "Restore checkpoint 2?",
          body: "Every edit made after that checkpoint is discarded.",
          scope: [["Files affected", "src/lib/date.js"],
            ["Kept", "Everything changed before this task started"],
            ["Reversible", "No. The discarded edits cannot be recovered."]],
          confirm: "Restore checkpoint", cancel: "Keep the edits", danger: true }))) return;
        toast("Restored checkpoint 2. The working tree matches it again.");
      } else {
        toast("Stopped here. The edits are still on disk and nothing was rolled back.");
      }
      row.replaceChildren(Object.assign(document.createElement("span"), {
        className: "mut", style: "font-size:13.5px;line-height:20px",
        textContent: b.dataset.recover === "restore"
          ? "Restored to checkpoint 2."
          : "Left as it is. The edits are still on disk.",
      }), Object.assign(document.createElement("a"),
        { className: "btn btns", href: "/app/", textContent: "Start a new session" }));
    }));
  }

  /* ------------------------------------- a follow-up drops in the composer */
  function wireSuggest() {
    $$("[data-suggest]").forEach((b) => b.addEventListener("click", () => {
      const ta = $("[data-composer] textarea");
      if (!ta) return;
      ta.value = b.dataset.suggest;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.focus();
    }));
  }

  /* --------------------------------------------- Explore: use and install */
  function wireModelActions(root = document) {
    $$("[data-model-use]", root).forEach((b) => b.addEventListener("click", () => {
      store.set("model", b.dataset.modelId);
      $$("[data-model-label]").forEach((l) => { l.textContent = b.dataset.modelUse; });
      toast(`${b.dataset.modelUse} is the model this project will use.`);
    }));
    // Queueing is a real store transition; downloading is not, and the toast
    // says which of the two just happened.
    $$("[data-model-install]", root).forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.modelId;
      if (id) dispatchModel({ type: "download.queued", modelId: id });
      b.textContent = "Queued";
      b.disabled = true;
      b.setAttribute("aria-disabled", "true");
      b.title = "Queued. Downloading needs the desktop app.";
      toast(`${b.dataset.modelInstall} is queued and listed under Downloads. Downloading needs the desktop app, so no bytes are being fetched.`);
    }));
  }

  /* ---------------------------------------- the model pages, from the store */
  /* Every model surface renders from MODELS.state through core/modelviews.mjs,
     which is the same module the build used for the first paint. A page holds
     no list of its own, so a pause on the downloads page and the strip on the
     installed page cannot disagree.

     Buttons name the event they dispatch rather than a verb, so what a control
     does is readable in the markup:
       data-model-act="download.paused" data-model-id="..."
     Anything that would need a local runtime carries data-load-model instead
     and opens the loader, which explains why nothing was loaded. */
  function wireModelPages() {
    const demoFlag = document.querySelector("[data-demo-flag]");
    if (demoFlag) demoFlag.hidden = !DEMO;
    const mounts = $$("[data-models-mount]");
    const stats = $("[data-mine-stats]");
    if (!mounts.length && !stats) return;
    hydrateModels();

    const paint = () => {
      const s = MODELS.state;
      for (const el of mounts) {
        const kind = el.dataset.modelsMount;
        const q = (document.querySelector("[data-filter-search]") || {}).value || "";
        const matched = kind === "installed"
          ? $$("[data-filter-item]", el).filter((r) => !r.hidden).length : null;
        const html = kind === "installed" ? installedSections(s, THIS_PC, DESKTOP, q, matched)
          : kind === "downloads" ? downloadsHtml(s, DESKTOP)
            : kind === "strip" ? downloadStrip(s)
              : kind === "picker" ? pickerHtml(s, THIS_PC) : null;
        if (html !== null && el.innerHTML !== html) el.innerHTML = html;
      }
      // The composer must not name a model it cannot send to.
      const label = $("[data-model-label]");
      if (label) label.textContent = composerModelLabel(s);
      const st = installedStats(s, THIS_PC);
      if (stats) stats.textContent = installedFooter(s, DESKTOP);
      // A search control implies a local dataset to search. While the desktop
      // app is disconnected there is none, so the control is removed from the
      // page and from the accessibility tree rather than left inert.
      const localView = $("[data-filter-root=mine]") || $("[data-models-mount=downloads]");
      if (localView) {
        const searchWrap = $(".mc-search");
        if (searchWrap) searchWrap.hidden = DESKTOP.connection !== "ready" && !DESKTOP.demo;
      }

      // The count is decorative in the tab's name, which read "Downloads0";
      // it is hidden from the accessibility tree and the tab carries the
      // number in words instead. A zero count shows nothing at all.
      const badge = $("[data-downloads-badge]");
      const tab = $("[data-downloads-tab]");
      if (badge) {
        const n = downloadsBadge(s);
        // Cleared rather than left at 0 behind a hidden attribute, so the
        // element carries no stale value in any text extraction.
        badge.textContent = n === 0 ? "" : String(n);
        badge.hidden = n === 0;
        if (tab) {
          if (n === 0) tab.removeAttribute("aria-label");
          else tab.setAttribute("aria-label", `Downloads, ${n} needing attention`);
        }
      }
      // The state block is the message when there are no rows; a summary line
      // above it would be a second answer to the same question.
      const summary = $("[data-downloads-summary]");
      if (summary) {
        const hasRows = !$("[data-models-mount=downloads] [data-view-state]");
        summary.hidden = !hasRows;
        if (hasRows) summary.textContent = downloadsSummary(s);
      }
      // Rows are new elements after a repaint, so the search and chips are
      // re-applied here rather than only at boot.
      repaintFilters();
    };

    onModels(paint);

    /* A search hides rows without changing the store, so the state block is
       recomputed here rather than by re-rendering the list: re-rendering would
       destroy the rows the filter had just hidden and run the filter again. */
    const installedMount = $('[data-models-mount="installed"]');
    if (installedMount) {
      let stateHost = $("[data-local-state]");
      if (!stateHost) {
        stateHost = document.createElement("div");
        stateHost.setAttribute("data-local-state", "");
        installedMount.after(stateHost);
      }
      onFilter(() => {
        const rows = $$("[data-filter-item]", installedMount);
        if (!rows.length) { stateHost.innerHTML = ""; return; }
        const visible = rows.filter((r) => !r.hidden).length;
        const q = ($("[data-filter-search]") || {}).value || "";
        const view = localViewState("installed", DESKTOP, rows.length, visible, q);
        stateHost.innerHTML = showsRows(view) ? "" : stateBlockHtml(view, esc);
      });
    }
  }

  /* Clear search, wherever a state block offers it. */
  function wireClearSearch() {
    document.addEventListener("click", (e) => {
      const b = e.target.closest('[data-view-action="clear-search"]');
      if (!b) return;
      const box = $("[data-filter-search]");
      if (!box) return;
      box.value = "";
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.focus();
    });
  }

  /* Actions on those pages. One listener, delegated, so it keeps working
     across the repaints above. */
  function wireStoreActions() {
    document.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-model-act]");
      if (!b) return;
      const type = b.dataset.modelAct;
      const modelId = b.dataset.modelId;
      const m = MODELS.state && MODELS.state.byId[modelId];
      if (!m) return;

      if (type === "download.canceled") {
        const failed = m.downloadState && m.downloadState.state === "failed";
        const ok = await flConfirm({
          title: failed ? `Remove ${m.displayName} from the list?` : `Cancel this download?`,
          body: failed
            ? "The partial file is deleted. Downloading again starts from the beginning."
            : "The part already downloaded stays on disk, so resuming later does not start over.",
          scope: failed
            ? [["Partial file", `${gb(m.downloadState.receivedBytes, 2)} GB, deleted`],
              ["The model", "Stays in the catalog and can be downloaded again"]]
            : [["Downloaded so far", `${gb(m.downloadState.receivedBytes, 2)} GB, kept on disk`],
              ["Reversible", "Yes, the download can be restarted at any time"]],
          confirm: failed ? "Remove" : "Cancel download",
          cancel: failed ? "Keep it listed" : "Keep downloading",
          danger: true });
        if (!ok) return;
      }

      const before = MODELS.state;
      dispatchModel({ type, modelId });
      if (MODELS.state === before) return;   // an illegal transition says nothing

      if (type === "download.paused") toast(`Paused. ${m.displayName} resumes from ${gb(m.downloadState.receivedBytes, 2)} GB.`);
      if (type === "download.resumed") toast("Download resumed.");
      if (type === "download.canceled") toast("Cancelled. Nothing else was changed.");
      if (type === "download.retried") toast(`${m.displayName} is queued again. Downloading needs the desktop app, so it will not start here.`);
      if (type === "model.unloaded") toast(`${m.displayName} was ejected. Video memory is free again.`);
    });
  }

  /* ------------------------------------------- onboarding permission preset */
  function wirePresets() {
    const group = $("[data-presets]");
    if (!group) return;
    const radios = $$('input[type="radio"]', group);
    const saved = store.get("preset", "balanced");
    const select = (value, focus) => {
      radios.forEach((r) => {
        const on = r.value === value;
        r.checked = on;
        r.closest("label").style.borderColor = on ? "var(--acc)" : "";
        if (on && focus) r.focus();
      });
      store.set("preset", value);
    };
    if (radios.some((r) => r.value === saved)) select(saved, false);
    radios.forEach((r) => r.addEventListener("change", () => select(r.value, false)));

    // native radios already handle arrows; this keeps the card styling in step
    group.addEventListener("keyup", () => {
      const checked = radios.find((r) => r.checked);
      if (checked) select(checked.value, false);
    });

    // carry the choice into the workspace for this demo session
    const go = $("[data-preset-continue]");
    if (go) go.addEventListener("click", () => {
      const checked = radios.find((r) => r.checked);
      if (checked) store.set("preset", checked.value);
    });
  }

  /* Motion belongs to a window the user is looking at. The composer edge is
     the only thing that animates for more than a moment, so it stops when the
     window loses focus rather than spinning behind another application. */
  function wireWindowFocus() {
    const sync = () => document.body.classList.toggle("is-blurred", !document.hasFocus());
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
  }

  /* --------------------------------------------- reflect the chosen preset */
  function showPreset() {
    const label = store.get("preset", "balanced");
    const nice = { ask: "Ask every time", balanced: "Balanced", autopilot: "Autopilot" }[label] || "Balanced";
    $$("[data-preset-label]").forEach((el) => { el.textContent = nice; });
  }

  const boot = () => {
    wireSidebar(); wireComposer(); wireModelPicker(); wireTabs(); wireDrawer();
    wireReview(); wireFilters(); wireNav(); wirePricing(); wirePlatform(); wireSignin();
    wireDownloadRows(); wireFilesTab(); wirePresets(); showPreset();
    wireActivity(); wireStopRun(); wirePermission(); wireRecover(); wireSuggest();
    wireModelActions(); wireConversation(); wireChats(); renderRecents();
    hydrateModels(); wireLoaderEntryPoints(); wireModelPages(); wireStoreActions();
    wireRuntimeSurfaces(); wireClearSearch(); wireWindowFocus();
    wireWaitlist(); wireCatalog(); wireDiagnostics(); wireComposerDraft();
    wireAwaiting(); wireComposerControls(); wireDensity(); wireQueue(); wireCaretMenus(); wirePaste();
    // the one setup-specific element on /setup/5/
    const sd = $("[data-setup-done]");
    if (sd) {
      const hide = () => { sd.hidden = true; };
      $("[data-setup-dismiss]", sd).addEventListener("click", hide);
      const ta = $("[data-composer] textarea");
      if (ta) ta.addEventListener("input", () => { if (ta.value.trim()) hide(); }, { once: true });
    } wireSettings(); wireShortcuts(); wireDownloadRow(); wireInert();
    document.documentElement.dataset.reducedMotion = String(reduced);
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
})();
