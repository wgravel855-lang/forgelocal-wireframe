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

    const raw = $("#fl-sessions");
    const data = raw ? JSON.parse(raw.textContent) : { projects: [], chats: [] };
    const projectById = Object.fromEntries(data.projects.map((p) => [p.id, p]));
    const chatById = Object.fromEntries(data.chats.map((c) => [c.id, c]));

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
      const claimed = data.chats.find((c) => c.route && c.route === location.pathname);
      if (claimed && !isGone(claimed.id)) {
        st.activeSessionId = claimed.id;
        st.activeProjectId = projectOf(claimed.id);
      } else {
        const id = st.activeSessionId;
        const ok = id && chatById[id] && !isGone(id) && !isArchived(id) &&
          projectOf(id) === st.activeProjectId &&
          // a chat with its own screen is only "open" on that screen
          !(chatById[id].route && chatById[id].route !== location.pathname);
        if (!ok) st.activeSessionId = null;
      }
      if (!projectById[st.activeProjectId]) st.activeProjectId = data.projects[0]?.id || "";
    };

    /* ---- workspace ------------------------------------------------------ */
    const setHeader = (t) => { $$("[data-ws-title]").forEach((el) => { el.textContent = t; }); };

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

    const paintWorkspace = () => {
      // only the new-session screen swaps; the built screens are their own routes
      if (!view) { setHeader(st.activeSessionId ? titleOf(st.activeSessionId) : "New session"); return; }
      const id = st.activeSessionId;
      const v = id && chatById[id]?.view;
      if (!v) {
        view.hidden = true;
        if (newHeading) newHeading.hidden = false;
        if (starters) starters.hidden = false;
        setHeader(id ? titleOf(id) : "New session");
        return;
      }
      view.hidden = false;
      if (newHeading) newHeading.hidden = true;
      if (starters) starters.hidden = true;
      setHeader(titleOf(id));
      $("[data-sview-prompt]", view).textContent = v.prompt;
      $("[data-sview-reply]", view).textContent = v.reply;
      $("[data-sview-exit]", view).textContent = v.exit || "";
      $("[data-sview-tests]", view).textContent = v.tests || "";
      const files = v.files || [];
      const changed = files.filter((f) => f[1] !== "new").length;
      $("[data-sview-count]", view).textContent =
        `${files.length} file${files.length === 1 ? "" : "s"} ${changed === files.length ? "changed" : "touched"}`;
      $("[data-sview-steps]", view).replaceChildren(...(v.steps || []).map((s) => {
        const d = document.createElement("div");
        d.className = "arow";
        d.textContent = s;
        return d;
      }));
      $("[data-sview-files]", view).replaceChildren(...files.map(([n, a, d]) => {
        const row = document.createElement("div");
        row.className = "sview-file";
        const name = document.createElement("span");
        name.className = "n m";
        name.textContent = n;
        row.append(name);
        if (a) { const s = document.createElement("span"); s.className = a === "new" ? "lab" : "a m"; s.textContent = a; row.append(s); }
        if (d) { const s = document.createElement("span"); s.className = "d m"; s.textContent = d; row.append(s); }
        return row;
      }));
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
      if (data.chats.some((c) => c.route === location.pathname)) { location.href = "/app/"; return; }
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

    menu.addEventListener("click", (e) => {
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
          if (!confirm(`Delete "${title}"? This prototype cannot bring it back.`)) return;
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
  function wireDownload() {
    const wrap = $("[data-download]");
    if (!wrap) return;
    const toggle = $("[data-dl-toggle]", wrap);
    // The My models row offers Pause only; setup step 3 also offers Cancel.
    const cancel = $("[data-dl-cancel]", wrap);
    const state = $("[data-dl-state]", wrap);
    const dot = $("[data-dl-dot]");
    const bar = $("[data-dl-bar]");
    if (!toggle) return;
    let paused = false, cancelled = false;

    const paint = () => {
      toggle.textContent = paused ? "Resume" : "Pause";
      toggle.setAttribute("aria-label", paused ? "Resume the download" : "Pause the download");
      state.textContent = cancelled ? "Cancelled" : paused ? "Paused" : "Downloading";
      if (dot) {
        dot.classList.toggle("pulse", !paused && !cancelled);
        dot.className = dot.className.replace(/\b(acc|warn|bad)\b/, cancelled ? "bad" : paused ? "warn" : "acc");
      }
      if (bar) bar.style.opacity = paused || cancelled ? ".45" : "1";
    };

    toggle.addEventListener("click", () => {
      if (cancelled) return;
      paused = !paused;
      paint();
      toast(paused ? "Download paused. It resumes from where it stopped." : "Download resumed.");
    });

    if (cancel) cancel.addEventListener("click", () => {
      if (cancelled) return;
      if (!confirm("Cancel this download? The part already downloaded is kept, so resuming later does not start over.")) return;
      cancelled = true; paused = false;
      toggle.disabled = true;
      cancel.disabled = true;
      toggle.setAttribute("aria-disabled", "true");
      if (bar) bar.style.width = "0%";
      paint();
      toast("Cancelled. The partial file is kept for a later resume.");
    });

    paint();
  }

  /* ---------------------------------------------- the activity group's fold */
  function wireActivity() {
    $$("[data-act-toggle]").forEach((btn) => {
      const group = btn.closest(".act");
      if (!group) return;
      const rows = [...group.children].filter((el) => el !== btn.parentElement);
      const apply = (open) => {
        btn.setAttribute("aria-expanded", String(open));
        btn.textContent = open ? "Hide" : "Show";
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
    $$("[data-recover]").forEach((b) => b.addEventListener("click", () => {
      const row = b.parentElement;
      if (b.dataset.recover === "restore") {
        if (!confirm("Restore checkpoint 2? Every edit made after it is discarded.")) return;
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
  function wireModelActions() {
    $$("[data-model-use]").forEach((b) => b.addEventListener("click", () => {
      store.set("model", b.dataset.modelId);
      $$("[data-model-label]").forEach((l) => { l.textContent = b.dataset.modelUse; });
      toast(`${b.dataset.modelUse} is the model this project will use.`);
    }));
    $$("[data-model-install]").forEach((b) => b.addEventListener("click", () => {
      b.textContent = "Queued";
      b.disabled = true;
      b.setAttribute("aria-disabled", "true");
      b.title = "Queued for download. Progress appears under My models.";
      toast(`${b.dataset.modelInstall} queued. Progress shows under My models.`);
    }));
  }

  /* ------------------------------------------------ load / eject a model */
  function wireLoadToggle() {
    $$("[data-load-toggle]").forEach((btn) => {
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
    wireDownload(); wireLoadToggle(); wirePresets(); showPreset();
    wireActivity(); wireStopRun(); wirePermission(); wireRecover(); wireSuggest();
    wireModelActions(); wireChats(); wireInert();
    document.documentElement.dataset.reducedMotion = String(reduced);
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
})();
