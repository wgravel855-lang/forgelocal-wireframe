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
  function openPopover(trigger, pop) {
    closePop(false);
    pop.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    openPop = { pop, trigger };
    const first = pop.querySelector('[data-autofocus], input, [role="menuitemradio"], button');
    if (first) first.focus();
  }
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
    const apply = (collapsed) => {
      shell.classList.toggle("is-collapsed", collapsed);
      $$("[data-sidebar-toggle]").forEach((b) => {
        b.setAttribute("aria-expanded", String(!collapsed));
        b.setAttribute("aria-label", collapsed ? "Show sidebar" : "Hide sidebar");
      });
    };
    // Narrow windows start collapsed regardless of the stored preference.
    const narrow = innerWidth < 1024;
    apply(narrow ? true : store.get("sidebar-collapsed", false));
    $$("[data-sidebar-toggle]").forEach((b) =>
      b.addEventListener("click", () => {
        const now = !shell.classList.contains("is-collapsed");
        apply(now);
        if (innerWidth >= 1024) store.set("sidebar-collapsed", now);
      }));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && innerWidth < 1024 && !shell.classList.contains("is-collapsed")) apply(true);
    });

    // The collapse decision has to be re-made when the window crosses the
    // breakpoint, not only at load: a window that starts narrow and is then
    // widened should get its sidebar back.
    let wasNarrow = narrow;
    addEventListener("resize", () => {
      const isNarrow = innerWidth < 1024;
      if (isNarrow === wasNarrow) return;
      wasNarrow = isNarrow;
      apply(isNarrow ? true : store.get("sidebar-collapsed", false));
    });
  }

  /* --------------------------------------------------------------- composer */
  function wireComposer() {
    $$("[data-composer]").forEach((form) => {
      const ta = $("textarea", form);
      const send = $("[data-send]", form);
      if (!ta) return;
      const grow = () => {
        ta.style.height = "auto";
        ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
      };
      ta.addEventListener("input", () => {
        grow();
        if (send && !form.dataset.running) send.disabled = ta.value.trim() === "";
      });
      grow();
      if (send && !form.dataset.running) send.disabled = ta.value.trim() === "";

      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }));
        }
      });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (form.dataset.running) return;
        const v = ta.value.trim();
        if (!v) return;
        toast("Prototype: messages are not sent to a model yet");
        ta.value = ""; grow();
        if (send) send.disabled = true;
      });
    });

    // starter prompts fill the composer rather than doing nothing
    $$("[data-starter]").forEach((b) => b.addEventListener("click", () => {
      const ta = $("[data-composer] textarea");
      if (!ta) return;
      ta.value = b.dataset.starter || b.textContent.trim();
      ta.dispatchEvent(new Event("input"));
      ta.focus();
    }));
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
          const panel = t.getAttribute("aria-controls") && document.getElementById(t.getAttribute("aria-controls"));
          if (panel) panel.hidden = !on;
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
    $$("[data-drawer-max]").forEach((b) => b.addEventListener("click", () => {
      drawer.classList.toggle("is-max");
      b.setAttribute("aria-pressed", String(drawer.classList.contains("is-max")));
    }));

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

    $$("[data-review-action]").forEach((b) => b.addEventListener("click", () => {
      const act = b.dataset.reviewAction;
      if (act === "revert-all" || act === "revert-file") {
        if (!confirm(act === "revert-all"
          ? "Revert every change this task made? Work you made before the task started is not affected."
          : "Revert this file to how the task found it? Your own earlier edits to it are kept.")) return;
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
    const active = new Set(store.get("filters", []));

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
      store.set("filters", [...active]);
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
    const t = $("[data-billing-toggle]");
    if (!t) return;
    const knob = t.querySelector("span");
    const apply = () => {
      const yearly = t.getAttribute("aria-checked") === "true";
      if (knob) knob.style.transform = yearly ? "translateX(26px)" : "";
      t.style.background = yearly ? "var(--acc)" : "var(--sunk)";
      t.style.borderColor = yearly ? "var(--acc)" : "var(--line-strong)";
      $$("[data-price-monthly]").forEach((el) => {
        const m = Number(el.dataset.priceMonthly);
        el.textContent = yearly ? `$${Math.round(m * 10)}` : `$${m}`;
      });
      $$("[data-price-period]").forEach((el) => { el.textContent = yearly ? "/year" : "/month"; });
      $$("[data-price-note]").forEach((el) => { el.hidden = !yearly; });
    };
    t.addEventListener("click", () => { t.setAttribute("aria-checked", String(t.getAttribute("aria-checked") !== "true")); apply(); });
    t.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); t.click(); } });
    apply();
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

  const boot = () => {
    wireSidebar(); wireComposer(); wireModelPicker(); wireTabs(); wireDrawer();
    wireReview(); wireFilters(); wireNav(); wirePricing(); wirePlatform(); wireSignin(); wireInert();
    document.documentElement.dataset.reducedMotion = String(reduced);
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
})();
