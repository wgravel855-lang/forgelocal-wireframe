/* ForgeLocal prototype interactions.
 *
 * Progressive enhancement over the server-rendered markup. Everything here is
 * real behaviour: focus management, keyboard, persistence. Controls that
 * cannot work in a prototype are marked [data-inert] in the markup and get an
 * explanatory tooltip rather than a silent no-op.
 */
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
          if (empty) empty.hidden = shown > 0;
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
      // Exactly one toggle is reachable at a time: the sidebar's own control
      // hides it, the top bar's brings it back.
      if (inSidebar) inSidebar.hidden = collapsed;
      if (inTopbar) inTopbar.hidden = !collapsed;
      $$("[data-sidebar-toggle]").forEach((b) => {
        b.setAttribute("aria-expanded", String(!collapsed));
        b.setAttribute("aria-label", collapsed ? "Show sidebar" : "Hide sidebar");
      });
    };
    // Narrow windows start collapsed regardless of the stored preference.
    const narrow = innerWidth <= 1180;
    apply(narrow ? true : store.get("sidebar-collapsed", false));
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

  /* -------------------------------------------------------- model details */
  /* Model details open inside the app shell. The public /models/<id>/ page
     stays for visitors; it is not the app's management surface, because
     leaving the shell threw away the tab, query, filters and scroll. */
  function wireModelDetail() {
    const rows = $$("[data-model-detail]");
    if (!rows.length) return;
    const raw = $("#fl-sessions");
    const data = raw ? JSON.parse(raw.textContent) : {};
    const byId = Object.fromEntries((data.models || []).map((m) => [m.id, m]));

    let host = $(".mdrawer-host");
    if (!host) {
      host = document.createElement("div");
      host.className = "mdrawer-host";
      host.hidden = true;
      $(".app").appendChild(host);
    }
    let opener = null;
    let restore = null;

    const close = () => {
      host.hidden = true;
      host.innerHTML = "";
      document.removeEventListener("keydown", onKey, true);
      // the list comes back exactly as it was left
      if (restore) {
        const s = $(".scroll", $(".main"));
        if (s) s.scrollTop = restore.scroll;
        restore = null;
      }
      if (opener && opener.isConnected) opener.focus();
      opener = null;
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== "Tab") return;
      const items = $$("a[href], button, [tabindex]:not([tabindex='-1'])", host)
        .filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!host.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };

    const open = (id, trigger) => {
      const m = byId[id];
      if (!m) return;
      opener = trigger;
      const s = $(".scroll", $(".main"));
      restore = { scroll: s ? s.scrollTop : 0 };

      const state = m.loaded ? ["ok", "Loaded in video memory"]
        : m.installed ? ["ok", "Installed, not loaded"]
          : ["", "Not installed"];
      const action = m.loaded
        ? `<button class="btn btns" type="button" data-load-toggle data-model="${esc(m.name)}">Eject</button>`
        : m.installed
          ? `<button class="btn btnp btns" type="button" data-load-toggle data-model="${esc(m.name)}">Load</button>`
          : `<button class="btn btnp btns" type="button" data-model-install="${esc(m.name)}">Install</button>`;

      host.innerHTML = `
        <div class="mdrawer-scrim" data-md-scrim></div>
        <aside class="mdrawer" role="dialog" aria-modal="true" aria-labelledby="md-t">
          <header class="mdrawer-h">
            <h2 class="h2" id="md-t">${esc(m.name)}</h2>
            <span class="grow"></span>
            <button class="btn btnq ico btns" type="button" data-md-close aria-label="Close model details">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </header>
          <div class="mdrawer-b">
            <p class="mdrawer-s"><span class="dot ${state[0]}" aria-hidden="true"></span>${state[1]}</p>
            <p class="ruse" style="margin:10px 0 0">${esc(m.strength)}</p>

            <dl class="specs" style="margin-top:18px;gap:14px 24px">
              <div><dt>Publisher</dt><dd>${esc(m.publisher)}</dd></div>
              <div><dt>Quantization</dt><dd>${esc(m.quant)} &middot; ${esc(m.format)}</dd></div>
              <div><dt>Download</dt><dd>${esc(m.downloadGB)} GB</dd></div>
              <div><dt>On disk</dt><dd>${esc(m.diskGB)} GB</dd></div>
              <div><dt>License</dt><dd>${esc(m.license)}</dd></div>
              <div><dt>Runtime</dt><dd>${esc(m.runtime)}</dd></div>
            </dl>

            <h3 class="set-h3" style="margin-top:22px">Fit on this PC</h3>
            <p class="dl-m" style="margin-top:6px">${esc(m.fitReason)}</p>
            <table class="tbl flat" style="margin-top:12px">
              <thead><tr><th>Context</th><th>Needs</th><th>Fit</th></tr></thead>
              <tbody>${m.contexts.map((c) => `<tr>
                <td class="num">${esc(c.ctx)}</td>
                <td class="num">${esc(c.need)} GB</td>
                <td><span class="rfit"><span class="dot ${esc({ ok: "ok", warn: "warn", bad: "bad" }[c.tone] || "")}" aria-hidden="true"></span>${esc(c.label)}</span></td>
              </tr>`).join("")}</tbody>
            </table>
            <p class="dl-m" style="margin-top:10px">Weights plus the key-value cache at that context
              plus runtime overhead, against ${esc(m.vramGB)} GB of video memory. Throughput is not
              shown because nothing here has been benchmarked.</p>

            <h3 class="set-h3" style="margin-top:22px">Current defaults</h3>
            <p class="dl-m" style="margin:6px 0 0">Read-only here. Change them in
              <a class="link" href="/app/settings/#models">Settings, under Models and runtime</a>.</p>
            <div class="setrow" style="border-top:1px solid var(--line);margin-top:10px">
              <div><span class="set-l">Context</span>
                <p class="set-d">Used when this model is loaded.</p></div>
              <span class="set-v num">${esc(m.context)}</span>
            </div>
            <div class="setrow">
              <div><span class="set-l">GPU offload</span>
                <p class="set-d">Layers placed on the GPU. The rest run on the CPU.</p></div>
              <span class="set-v num">${esc(m.offload)}</span>
            </div>
            <div class="setrow">
              <div><span class="set-l">Stored in</span>
                <p class="set-d">Changing the model folder is not built yet.</p></div>
              <span class="set-v m">${esc(m.store)}</span>
            </div>

            <h3 class="set-h3" style="margin-top:22px">Source</h3>
            <div class="setrow" style="border-top:1px solid var(--line);margin-top:10px">
              <div><span class="set-l">Repository</span>
                <p class="set-d">Weights come from the publisher, not from ForgeLocal.</p></div>
              <a class="set-v link" href="${esc(m.source)}" rel="noreferrer noopener" target="_blank">
                ${esc(String(m.source).replace("https://huggingface.co/", ""))}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-left:5px"><path d="M14 5h5v5"/><path d="M19 5 11 13"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg></a>
            </div>
            <div class="setrow">
              <div><span class="set-l">Revision</span>
                <p class="set-d">Pinned, so an upstream change cannot alter what is installed.</p></div>
              <span class="set-v m">${esc(m.revision)}</span>
            </div>
          </div>
          <footer class="mdrawer-f">
            ${action}
            <a class="btn btns" href="/models/${esc(m.id)}/">Public page</a>
            <span class="grow"></span>
            <button class="btn btns btnq" type="button" data-md-close style="border-color:var(--line)">Close</button>
          </footer>
        </aside>`;
      host.hidden = false;
      $$("[data-md-close], [data-md-scrim]", host).forEach((b) =>
        b.addEventListener("click", close));
      document.addEventListener("keydown", onKey, true);
      $("[data-md-close]", host).focus();
      wireModelActions(host);
      wireLoadToggle(host);
    };

    rows.forEach((b) => b.addEventListener("click", () => open(b.dataset.modelDetail, b)));
  }

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
      const pick = () => {
        // at the very bottom the last section can never reach the top line, so
        // it would never highlight however far you scrolled
        const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
        if (atEnd) return paint(cols[cols.length - 1].id);
        const top = scroller.getBoundingClientRect().top + 80;
        let current = cols[0];
        cols.forEach((sec) => { if (sec.getBoundingClientRect().top <= top) current = sec; });
        paint(current.id);
      };
      scroller.addEventListener("scroll", pick, { passive: true });
      links.forEach((a) => a.addEventListener("click", () =>
        paint(a.getAttribute("href").slice(1))));
      pick();
      if (location.hash) paint(location.hash.slice(1));
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
        const home = wantPinned ? pinnedGroup : $(`.cgroup[data-group="${row.dataset.bucket}"]`, list);
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

    /* ---- selection ------------------------------------------------------ */
    const openChat = (id) => {
      const c = chatById[id];
      if (!c) return;
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
    done: () => svg('<path d="M20 6 9 17l-5-5"/>', "var(--ok)", "2.6"),
    fail: () => svg('<path d="M18 6 6 18M6 6l12 12"/>', "var(--bad)", "2.3"),
    running: () => '<span class="spin" aria-hidden="true"></span>',
    todo: () => '<span class="box-todo" aria-hidden="true"></span>',
    now: () => '<span class="dot acc" aria-hidden="true"></span>',
  };


  /* ---- pieces --------------------------------------------------------- */
  const userMessage = (t, i) => `
    <article class="turn turn-user" data-turn="${i}">
      <div class="umsg" data-umsg><div class="umsg-body" data-umsg-text>${esc(t.text)}</div></div>
      <div class="mactions" data-user-actions data-actions-for="${i}">
        ${mactCopy(t.text, "Copy message")}
        <button class="mact" type="button" data-edit-msg aria-label="Edit message"><span class="mact-i">${svg('<path d="M12 20h9"/><path d="M16.6 3.6a2.1 2.1 0 0 1 3 3L7.4 18.8 3.5 20l1.2-3.9z"/>', "currentColor", "1.8")}</span><span class="mact-t">Edit</span></button>
      </div>
    </article>`;

  const planBlock = (b) => `
      <div class="plan">
        ${b.title ? `<div class="plan-h">${esc(b.title)}</div>` : ""}
        ${b.items.map((it) => `<div class="plan-row is-${it.state}">
          <span class="plan-i">${(ICON[it.state] || ICON.todo)()}</span>
          <span>${esc(it.label)}</span></div>`).join("")}
      </div>`;

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

  const blocks = (list) => (list || []).map((b) =>
    b.t === "plan" ? planBlock(b)
      : b.t === "code" ? codeBlock(b)
        : b.t === "note" ? noteBlock(b)
          : `<p>${esc(b.text)}</p>`).join("");

  const activityRow = (r) => `
        <div class="arow2 is-${esc(r.icon)}">
          <span class="arow2-i">${(ICON[r.icon] || ICON.done)()}</span>
          <span class="arow2-t${r.mono ? " m" : ""}" title="${esc(r.label)}">${esc(r.label)}</span>
          ${r.add ? `<span class="num add">${esc(r.add)}</span>` : ""}
          ${r.del ? `<span class="num del">${esc(r.del)}</span>` : ""}
          ${r.meta ? `<span class="num arow2-m">${esc(r.meta)}</span>` : ""}
        </div>${r.output ? `<pre class="m arow2-out">${esc(r.output)}</pre>` : ""}`;

  const fileRows = (files) => (files || []).map(([n, a, d]) => `
        <div class="frow">
          <span class="frow-n m" title="${esc(n)}">${esc(n)}</span>
          ${a === "new" ? '<span class="lab-fn frow-new">new file</span>'
    : a ? `<span class="num add">${esc(a)}</span>` : ""}
          ${d ? `<span class="num del">${esc(d)}</span>` : ""}
        </div>`).join("");

  // "Working · 3 actions · 14s" / "Completed · 4 files changed · tests passed"
  const summaryOf = (a) => {
    const bits = [];
    if (a.state === "running") bits.push(`${a.rows.length} action${a.rows.length === 1 ? "" : "s"}`);
    if (a.files?.length) bits.push(`${a.files.length} file${a.files.length === 1 ? "" : "s"} changed`);
    if (a.summary) bits.push(a.summary);
    if (a.tests) bits.push(a.tests.toLowerCase());
    if (a.elapsed) bits.push(a.elapsed);
    return bits.join(" · ");
  };

  const activityGroup = (a, i) => {
    if (!a) return "";
    const open = CONVO.open[i] ?? (a.state === "running" || a.state === "paused" || a.state === "stopped");
    const mark = { running: ICON.running(), complete: ICON.done(), stopped: ICON.fail(),
      paused: svg('<path d="M12 9.5v4.2M12 17.4h.01M10.4 4.2 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.6 4.2a2 2 0 0 0-3.2 0z"/>', "var(--warn-line)") }[a.state] || ICON.done();
    return `
      <section class="agroup is-${esc(a.state)}" aria-label="Agent activity">
        <button class="agroup-h" type="button" data-act-toggle="${i}" aria-expanded="${open}">
          <span class="agroup-i">${mark}</span>
          <span class="agroup-l">${esc(a.label)}</span>
          <span class="agroup-s num">${esc(summaryOf(a))}</span>
          <span class="agroup-c">${svg('<path d="m6 9.5 6 6 6-6"/>', "currentColor", "2")}</span>
        </button>
        <div class="agroup-b"${open ? "" : " hidden"}>
          ${a.rows.map(activityRow).join("")}
          ${a.files?.length ? `<div class="agroup-files">${fileRows(a.files)}</div>` : ""}
          ${a.tests || a.exit ? `<div class="arow2 is-done">
            <span class="arow2-i">${ICON.done()}</span>
            <span class="arow2-t">${esc(a.tests || "")}</span>
            <span class="num arow2-m">${esc(a.exit || "")}</span></div>` : ""}
          ${a.diagnostics ? `<details class="adiag">
            <summary>${esc(a.diagnostics.label)}</summary>
            <pre class="m">${esc(a.diagnostics.text)}</pre></details>` : ""}
        </div>
      </section>`;
  };

  const permissionBlock = (p, i) => {
    if (!p) return "";
    const done = CONVO.perm?.[i];
    if (done) {
      return `<div class="permdone">${done.ok ? ICON.done() : ICON.fail()}
        <span>${esc(done.text)}</span>
        <span class="m permdone-c" title="${esc(p.command)}">${esc(p.command)}</span></div>`;
    }
    return `
      <section class="perm" aria-labelledby="perm-h-${i}">
        <div class="perm-h">
          ${svg('<path d="M12 9.5v4.2M12 17.4h.01M10.4 4.2 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.6 4.2a2 2 0 0 0-3.2 0z"/>', "var(--warn-line)")}
          <h3 class="h3" id="perm-h-${i}">${esc(p.title)}</h3>
          <span class="pill warn">${esc(p.scopeTag)}</span>
        </div>
        <pre class="m perm-c">${esc(p.command)}</pre>
        <dl class="perm-kv">
          <dt>Why</dt><dd>${esc(p.why)}</dd>
          <dt>Working dir</dt><dd><span class="m">${esc(p.cwd)}</span></dd>
          <dt>Scope</dt><dd>${esc(p.scope)}</dd>
          <dt>Reversible</dt><dd class="perm-rev">${ICON.done()}${esc(p.reversible)}</dd>
        </dl>
        <div class="perm-a">
          <button class="btn btnp" type="button" data-perm="once" data-turn="${i}">Allow once</button>
          <button class="btn" type="button" data-perm="always" data-turn="${i}">Always allow this here</button>
          <button class="btn btnq" type="button" style="border-color:var(--line)" data-perm="deny" data-turn="${i}">Deny</button>
          <span class="grow"></span>
          <button class="btnq hit perm-x" type="button" data-inert="Editing the proposed command is not built in this prototype.">Edit command</button>
        </div>
      </section>`;
  };

  const recoveryBlock = (r) => r ? `
      <div class="recover">
        <button class="btn btnp" type="button" data-recover="${esc(r.primary.action)}">${esc(r.primary.label)}</button>
        ${r.alternatives.map((a) => a.href
    ? `<a class="btn" href="${esc(a.href)}">${esc(a.label)}</a>`
    : `<button class="btn" type="button" data-recover="${esc(a.action)}">${esc(a.label)}</button>`).join("")}
        <span class="grow"></span>
        <button class="btnq hit recover-x" type="button" data-diagnostics>${esc(r.text.label)}</button>
      </div>` : "";

  // Capabilities, not decoration: an action is only drawn when something real
  // is behind it. This prototype has no regeneration callback and no overflow
  // menu items, so Retry and More are absent rather than inert.
  const CAPS = { copy: true, feedback: true, onRetry: null, moreItems: [] };
  const mactCopy = (text, label) =>
    `<button class="mact" type="button" data-copy="${esc(text)}" aria-label="${esc(label)}"><span class="mact-i">${svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15"/>', "currentColor", "1.8")}</span><span class="mact-t">Copy</span></button>`;

  const messageActions = (i, text) => {
    const parts = [];
    if (CAPS.copy) parts.push(mactCopy(text, "Copy response"));
    if (CAPS.feedback) parts.push(
      `<button class="mact" type="button" data-vote="up" data-turn="${i}" aria-pressed="false" aria-label="Helpful"><span class="mact-i">${svg('<path d="M7 20V10M7 10l4.2-6.2a1.8 1.8 0 0 1 3 1.9L13 10h5.2a2 2 0 0 1 2 2.4l-1.3 6A2 2 0 0 1 17 20H7z"/>', "currentColor", "1.7")}</span></button>`,
      `<button class="mact" type="button" data-vote="down" data-turn="${i}" aria-pressed="false" aria-label="Not helpful"><span class="mact-i">${svg('<path d="M17 4v10M17 14l-4.2 6.2a1.8 1.8 0 0 1-3-1.9L11 14H5.8a2 2 0 0 1-2-2.4l1.3-6A2 2 0 0 1 7 4h10z"/>', "currentColor", "1.7")}</span></button>`);
    if (CAPS.onRetry) parts.push(`<button class="mact" type="button" data-retry aria-label="Retry this response"><span class="mact-i">${svg('<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 5v6h-6"/>', "currentColor", "1.8")}</span></button>`);
    if (CAPS.moreItems.length) parts.push(`<button class="mact" type="button" data-more aria-label="More actions"><span class="mact-i">${svg('<circle cx="5" cy="12" r=".9"/><circle cx="12" cy="12" r=".9"/><circle cx="19" cy="12" r=".9"/>', "currentColor", "2.2")}</span></button>`);
    return parts.length ? `<div class="mactions" data-assistant-actions>${parts.join("")}</div>` : "";
  };

  const assistantTurn = (t, i, state) => {
    const settled = state === "complete" || state === "stopped" || state === "error";
    const text = (t.blocks || []).filter((b) => b.t === "p" || b.t === "note")
      .map((b) => b.text).join("\n\n");
    // Whatever text arrived is kept; the stopped status sits after it, so a
    // stopped turn is a durable record in the thread rather than only a
    // composer state and an announcement.
    const halted = t.stopped
      ? `<p class="haltnote">${svg('<rect x="7" y="7" width="10" height="10" rx="2"/>', "currentColor", "1.8")}<span>You stopped this response</span></p>`
      : "";
    return `
    <article class="turn turn-assistant" data-turn="${i}">
      ${(t.blocks || []).length ? `<div class="prose amsg" data-amsg>${blocks(t.blocks)}</div>` : ""}
      ${halted}
      ${activityGroup(t.activity, i)}
      ${permissionBlock(t.permission, i)}
      ${recoveryBlock(t.recovery)}
      ${settled && text ? messageActions(i, text) : ""}
    </article>`;
  };

  const thinkingTurn = () => `
    <article class="turn turn-assistant" data-turn="pending">
      <p class="thinking"><span class="spin" aria-hidden="true"></span><span data-thinking-label>Thinking</span></p>
    </article>`;

  const emptyState = () => {
    const p = CONVO.project || {};
    return `
    <div class="empty" data-empty>
      <h1 class="h1">What do you want to build or change?</h1>
      <p class="empty-meta">
        <span class="m faint" data-project-path>${esc(p.path || "")}</span>
        <span class="faint" aria-hidden="true">·</span>
        <span class="mut" data-project-branch>${esc(p.branch || "")}</span>
        <span class="faint" aria-hidden="true">·</span>
        <span class="mut" data-project-stack>${esc(p.stack || "")}</span>
      </p>
      <div class="starters">
        <button type="button" data-starter="Explain how this project is organised">
          <span class="s-t">Explain how this project is organised</span>
          <span class="s-d">Reads the tree and the entry points. Changes nothing.</span>
        </button>
        <button type="button" data-starter="Fix the failing test in src/App.test.jsx">
          <span class="s-t">Fix a failing test</span>
          <span class="s-d">Runs the suite first, then edits behind a checkpoint.</span>
        </button>
        <button type="button" data-starter="Add a small feature">
          <span class="s-t">Add a small feature</span>
          <span class="s-d">Plans it, asks before installing anything.</span>
        </button>
      </div>
    </div>`;
  };

  /* ---- render --------------------------------------------------------- */
  function renderThread() {
    const el = CONVO.el;
    if (!el) return;
    const t = CONVO.thread;
    if (!t || !t.turns?.length) {
      el.innerHTML = emptyState();
      el.classList.add("is-empty");
      wireStarters(el);
      return;
    }
    el.classList.remove("is-empty");
    const state = CONVO.state === "idle" ? (t.state || "complete") : CONVO.state;
    // A transcript carries no visible heading of its own, so it gets a hidden
    // one naming the conversation. The empty state has its own visible h1, so
    // exactly one h1 exists either way.
    const title = ($("[data-ws-title]") || {}).textContent || "Conversation";
    el.innerHTML = `<h1 class="vh">${esc(title.trim())}</h1>`
      + t.turns.map((turn, i) =>
        turn.role === "user" ? userMessage(turn, i) : assistantTurn(turn, i, state)).join("")
      + (CONVO.state === "thinking" || CONVO.state === "submitting" ? thinkingTurn() : "");
  }

  function wireStarters(root) {
    $$("[data-starter]", root).forEach((b) => b.addEventListener("click", () => {
      const ta = $("[data-composer] textarea");
      if (!ta) return;
      ta.value = b.dataset.starter;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.focus();
    }));
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
      renderThread();
      setState(CONVO.thread?.state || "idle");
      if (CONVO.thread?.composer && ta) {
        ta.placeholder = CONVO.thread.composer.placeholder;
        const mode = $("[data-mode-label]", form);
        if (mode) mode.textContent = CONVO.thread.composer.mode;
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
      const t = e.target.closest("[data-act-toggle]");
      if (!t) return;
      const i = t.dataset.actToggle;
      const body = t.nextElementSibling;
      const open = t.getAttribute("aria-expanded") !== "true";
      // hold the reading position: expanding must not throw the page around
      const s = CONVO.scroll, before = s.scrollHeight - s.scrollTop;
      CONVO.open[i] = open;
      t.setAttribute("aria-expanded", String(open));
      body.hidden = !open;
      if (!CONVO.follow) s.scrollTop = s.scrollHeight - before;
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
      CONVO.perm[i] = kind === "deny"
        ? { ok: false, text: "Denied. The package was not installed." }
        : { ok: true, text: kind === "always"
          ? "Allowed here from now on. Installed" : "Allowed once. Installed" };
      renderThread();
      const next = $(".permdone", el);
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
      renderThread();
      setState(CONVO.thread?.state || "idle");
      requestAnimationFrame(() => toBottom(false));

      let composing = false;
      ta.addEventListener("compositionstart", () => { composing = true; });
      ta.addEventListener("compositionend", () => { composing = false; });
      ta.addEventListener("input", () => {
        if (!el.dataset.state?.match(/submitting|thinking|tool-running|streaming/))
          send.disabled = !ta.value.trim();
      });

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (composing) return;
        const text = ta.value.trim();
        if (!text || CONVO.state === "submitting") return;
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
        const turns = CONVO.thread?.turns;
        if (turns?.length) {
          // the pending turn becomes a real stopped turn, and one is created if
          // nothing arrived, so a user message is never left hanging
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
        ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
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
    $$("[data-drawer-open]").forEach((b) => b.addEventListener("click", () => {
      drawer.hidden = false;
      shell.classList.remove("no-drawer");
      const tab = $('[role="tab"][aria-selected="true"]', drawer);
      if (tab) tab.focus();
    }));
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
  function wireFilters() {
    const root = $("[data-filter-root]");
    if (!root) return;
    const rows = $$("[data-filter-item]", root);
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
      rows.forEach((r) => {
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
    };

    $$("[data-filter]", root).forEach((b) => b.addEventListener("click", () => {
      active.has(b.dataset.filter) ? active.delete(b.dataset.filter) : active.add(b.dataset.filter);
      paint();
    }));
    const clear = $("[data-filter-clear]", root);
    if (clear) clear.addEventListener("click", () => { active.clear(); if (search) search.value = ""; paint(); });
    if (search) { let t; search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(paint, 120); }); }
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
    $$("[data-model-install]", root).forEach((b) => b.addEventListener("click", () => {
      b.textContent = "Queued";
      b.disabled = true;
      b.setAttribute("aria-disabled", "true");
      b.title = "Queued for download. Progress appears under My models.";
      toast(`${b.dataset.modelInstall} queued. Progress shows under My models.`);
    }));
  }

  /* ------------------------------------------------ load / eject a model */
  function wireLoadToggle(root = document) {
    $$("[data-load-toggle]", root).forEach((btn) => {
      const row = btn.closest("li");
      const pill = row && $("[data-load-pill]", row);
      btn.addEventListener("click", () => {
        const loading = btn.textContent.trim() === "Load";
        btn.textContent = loading ? "Eject" : "Load";
        if (pill) { pill.textContent = loading ? "Loaded" : "Idle"; pill.classList.toggle("ok", loading); }
        if (row) row.style.borderColor = loading ? "var(--acc)" : "";
        toast(loading
          ? `${btn.dataset.model} is loaded into video memory.`
          : `${btn.dataset.model} was ejected. Video memory is free again.`);
      });
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

  /* --------------------------------------------- reflect the chosen preset */
  function showPreset() {
    const label = store.get("preset", "balanced");
    const nice = { ask: "Ask every time", balanced: "Balanced", autopilot: "Autopilot" }[label] || "Balanced";
    $$("[data-preset-label]").forEach((el) => { el.textContent = nice; });
  }

  const boot = () => {
    wireSidebar(); wireComposer(); wireModelPicker(); wireTabs(); wireDrawer();
    wireReview(); wireFilters(); wireNav(); wirePricing(); wirePlatform(); wireSignin();
    wireDownloadRows(); wireFilesTab(); wireLoadToggle(); wirePresets(); showPreset();
    wireActivity(); wireStopRun(); wirePermission(); wireRecover(); wireSuggest();
    wireModelActions(); wireConversation(); wireChats();
    wireWaitlist(); wireModelDetail(); wireDiagnostics(); wireComposerDraft(); wireSettings(); wireShortcuts(); wireDownloadRow(); wireInert();
    document.documentElement.dataset.reducedMotion = String(reduced);
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
})();
