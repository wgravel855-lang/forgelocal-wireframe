// Round four: the interaction controller additions.
import { readFileSync, writeFileSync } from "node:fs";

const p = "design/assets/forgelocal.js";
let s = readFileSync(p, "utf8");
const swap = (a, b) => { if (!s.includes(a)) throw new Error("no match: " + a.slice(0, 70)); s = s.split(a).join(b); };

swap(
  `  const boot = () => {`,
  `  /* ------------------------------------------------------ download demo */
  function wireDownload() {
    const wrap = $("[data-download]");
    if (!wrap) return;
    const toggle = $("[data-dl-toggle]", wrap);
    const cancel = $("[data-dl-cancel]", wrap);
    const state = $("[data-dl-state]", wrap);
    const dot = $("[data-dl-dot]");
    const bar = $("[data-dl-bar]");
    let paused = false, cancelled = false;

    const paint = () => {
      toggle.textContent = paused ? "Resume" : "Pause";
      toggle.setAttribute("aria-label", paused ? "Resume the download" : "Pause the download");
      state.textContent = cancelled ? "Cancelled" : paused ? "Paused" : "Downloading";
      if (dot) {
        dot.classList.toggle("pulse", !paused && !cancelled);
        dot.className = dot.className.replace(/\\b(acc|warn|bad)\\b/, cancelled ? "bad" : paused ? "warn" : "acc");
      }
      if (bar) bar.style.opacity = paused || cancelled ? ".45" : "1";
    };

    toggle.addEventListener("click", () => {
      if (cancelled) return;
      paused = !paused;
      paint();
      toast(paused ? "Download paused. It resumes from where it stopped." : "Download resumed.");
    });

    cancel.addEventListener("click", () => {
      if (cancelled) return;
      if (!confirm("Cancel this download? The part already downloaded is kept, so resuming later does not start over.")) return;
      cancelled = true; paused = false;
      toggle.disabled = true;
      cancel.disabled = true;
      if (bar) bar.style.width = "0%";
      paint();
      toast("Cancelled. The partial file is kept for a later resume.");
    });

    paint();
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

  const boot = () => {`,
);

swap(
  `    wireReview(); wireFilters(); wireNav(); wirePricing(); wirePlatform(); wireSignin(); wireInert();`,
  `    wireReview(); wireFilters(); wireNav(); wirePricing(); wirePlatform(); wireSignin();
    wireDownload(); wirePresets(); showPreset(); wireInert();`,
);

/* Tabs must move real panels, not just the underline. */
swap(
  `      const select = (tab) => {
        tabs.forEach((t) => {
          const on = t === tab;
          t.setAttribute("aria-selected", String(on));
          t.tabIndex = on ? 0 : -1;
          const panel = t.getAttribute("aria-controls") && document.getElementById(t.getAttribute("aria-controls"));
          if (panel) panel.hidden = !on;
        });
      };`,
  `      const select = (tab) => {
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
      };`,
);

/* One sidebar toggle visible at a time, and Models actually navigates. */
swap(
  `  /* ---------------------------------------------------------------- sidebar */
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
    };`,
  `  /* ---------------------------------------------------------------- sidebar */
  function wireSidebar() {
    const shell = $(".shell");
    const sidebar = $(".sidebar");
    if (!shell || !sidebar) return;
    const inSidebar = $("[data-sidebar-toggle]", sidebar);
    const inTopbar = $$("[data-sidebar-toggle]").find((b) => b !== inSidebar);

    const apply = (collapsed) => {
      shell.classList.toggle("is-collapsed", collapsed);
      // Exactly one toggle is reachable at a time: the sidebar's own control
      // hides it, the top bar's brings it back.
      if (inSidebar) inSidebar.hidden = collapsed;
      if (inTopbar) inTopbar.hidden = !collapsed;
      $$("[data-sidebar-toggle]").forEach((b) => {
        b.setAttribute("aria-expanded", String(!collapsed));
        b.setAttribute("aria-label", collapsed ? "Show sidebar" : "Hide sidebar");
      });
    };`,
);

writeFileSync(p, s);
console.log("patched", p);
