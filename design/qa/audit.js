/* ForgeLocal QA gate.
 *
 * Runs in a browser against the built site. Paste into the console, or drive it
 * with automation, then call:  await flQA()
 *
 * Fails on:
 *   - customer-facing text below 12px
 *   - functional text (label/button/tab/filter/link/status/help) below 13px
 *   - dense icon/action targets below 32px
 *   - standard controls and nav links below 36px (true inline links exempt)
 *   - horizontal page overflow, composer below the fold
 *   - missing semantic textarea / inputs
 *   - primary navigation pointing at "#"
 *   - text below WCAG AA contrast
 */
(() => {
  const ROUTES = {
    app: ["/app/", "/app/running/", "/app/permission/", "/app/review/", "/app/stopped/",
      "/app/models/", "/app/models/installed/",
      "/setup/1/", "/setup/2/", "/setup/3/", "/setup/4/", "/setup/5/"],
    site: ["/", "/product/", "/models/", "/models/qwen25-coder-14b-q4km/", "/download/",
      "/pricing/", "/security/", "/docs/", "/changelog/", "/privacy/", "/terms/",
      "/status/", "/signin/", "/404.html"],
  };
  const VIEWPORTS = {
    app: [[1440, 900], [1366, 768], [1024, 768], [768, 1024]],
    site: [[1440, 900], [1366, 768], [1024, 768], [768, 1024], [390, 844], [375, 812]],
  };

  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
  const rgb = (s) => (s.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  const ratio = (f, b) => { const a = lum(rgb(f)), z = lum(rgb(b)); const [h, l] = a > z ? [a, z] : [z, a]; return (h + .05) / (l + .05); };

  // A control is anything a user is meant to click. An <a> inside a paragraph
  // or sentence is an inline link and keeps the paragraph line-height.
  const inlineLink = (el, W) => {
    if (el.tagName !== "A") return false;
    const p = el.parentElement;
    if (!p) return false;
    if (/^(P|LI|SPAN|DD|TD|SMALL)$/.test(p.tagName)) {
      const own = [...p.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 12);
      if (own) return true;
    }
    return W.getComputedStyle(el).display === "inline";
  };

  const visible = (el, W) => {
    const cs = W.getComputedStyle(el), r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };

  async function auditDoc(d, W, route, w) {
    const fail = [];
    const add = (rule, detail) => fail.push({ route, w, rule, detail });

    if (d.documentElement.scrollWidth - W.innerWidth > 1)
      add("overflow", `+${d.documentElement.scrollWidth - W.innerWidth}px`);

    const isApp = W.getComputedStyle(d.body).overflow === "hidden";
    const comp = isApp ? d.querySelector(".composer") : null;
    if (comp && Math.round(comp.getBoundingClientRect().bottom) > W.innerHeight + 1)
      add("composer-below-fold", "");

    // ---- text size ----
    for (const el of d.querySelectorAll("*")) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own.length || !visible(el, W)) continue;
      const cs = W.getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      const txt = own.map((n) => n.textContent.trim()).join(" ").slice(0, 30);
      if (size < 12) add("text<12", `${size}px "${txt}"`);
      else if (size < 13 && el.closest("button,a,[role=tab],label,summary,th,.pill,.lab-fn"))
        add("functional-text<13", `${size}px "${txt}"`);

      const need = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight) >= 700) ? 3 : 4.5;
      let bgEl = el, bg = "rgb(255,255,255)";
      while (bgEl && bgEl !== d.documentElement) {
        const c = W.getComputedStyle(bgEl).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; }
        bgEl = bgEl.parentElement;
      }
      if (ratio(cs.color, bg) < need) add("contrast", `${ratio(cs.color, bg).toFixed(2)} "${txt}"`);
    }

    // ---- control sizing ----
    for (const el of d.querySelectorAll('button, a, [role="tab"], input, textarea, select, summary')) {
      if (!visible(el, W)) continue;
      if (el.closest(".vh")) continue;
      const r = el.getBoundingClientRect();
      const h = Math.round(r.height), wd = Math.round(r.width);
      const label = (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 28);
      if (inlineLink(el, W)) continue;
      const iconOnly = !el.textContent.trim() && wd <= 44;
      const min = iconOnly ? 32 : 36;
      if (h < min) add(`control<${min}`, `${wd}x${h} "${label}"`);
      if (iconOnly && wd < 32) add("icon-width<32", `${wd}x${h} "${label}"`);
    }

    // ---- semantics ----
    if (isApp && /\/app\/(?!models)/.test(route) && !d.querySelector("textarea"))
      add("no-textarea", "workspace must contain a real textarea");
    if (/\/models\/$|\/app\/models\//.test(route) && !d.querySelector('input[type="search"], input'))
      add("no-input", "model surface must contain a real input");
    for (const a of d.querySelectorAll('.mhead a[href="#"], .mfoot a[href="#"]'))
      add("nav-href-hash", (a.textContent || "").trim().slice(0, 24));

    return fail;
  }

  // flQA(kind)                -> every route of that kind
  // flQA(kind, [a, b])        -> just those routes, same viewport set
  window.flQA = async function flQA(only, subset) {
    const f = document.createElement("iframe");
    f.style.cssText = "position:fixed;left:-9999px;top:0;border:0";
    document.body.appendChild(f);
    let n = 0;
    const all = [];
    const groups = only ? { [only]: subset ?? ROUTES[only] } : ROUTES;
    for (const [kind, list] of Object.entries(groups)) {
      for (const route of list) {
        for (const [w, h] of VIEWPORTS[kind]) {
          await new Promise((res) => {
            f.style.width = w + "px"; f.style.height = h + "px";
            f.onload = () => setTimeout(res, 70);
            f.src = route + (route.includes("?") ? "&" : "?") + "qa=" + (++n);
          });
          all.push(...await auditDoc(f.contentDocument, f.contentWindow, route, w));
        }
      }
    }
    f.remove();
    const byRule = {};
    for (const x of all) (byRule[x.rule] ??= []).push(`${x.route}@${x.w} ${x.detail}`);
    return { total: all.length, byRule: Object.fromEntries(Object.entries(byRule).map(([k, v]) => [k, { count: v.length, examples: v.slice(0, 6) }])) };
  };
  return "flQA ready";
})();
