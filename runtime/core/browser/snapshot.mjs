// @ts-check
/**
 * The page, as something a model without eyes can operate.
 *
 * Playwright's `ariaSnapshot()` produces a good semantic tree but carries no
 * element references, and `_snapshotForAI()` — what Microsoft's own MCP server
 * uses — is internal and absent from playwright-core. So the walk is done here,
 * in the page, which turns out to be the better position anyway: the refs are
 * ours, so their versioning is ours, and a reference from a stale snapshot can
 * be refused rather than silently resolving to whatever now sits at that
 * position.
 *
 * What gets included is a judgement, and it is the whole difference between a
 * snapshot a 30B model can act on and a wall it cannot. Every interactive
 * element, because those are what actions target. Headings and landmarks,
 * because those are how a reader knows where they are. Text only when it is
 * short and not already covered by an element's accessible name — a page's
 * paragraphs belong in `browser_read_text`, not in the thing the model scans to
 * find a button.
 *
 * This source is evaluated inside the page, so it cannot import anything and
 * must not assume anything about the page's own globals.
 */

/**
 * The in-page walker, as source.
 *
 * Kept as a string rather than a function passed to page.evaluate because it
 * has to survive being serialised, and because inlining it here keeps the
 * thing that runs in a hostile page visible in one piece.
 */
export const WALKER = `(version) => {
  const MAX_NODES = 400;
  const MAX_NAME = 120;

  /* Roles worth acting on. Anything here gets a ref; everything else is
     structure the model reads but cannot click. */
  const INTERACTIVE = new Set([
    "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox",
    "listbox", "option", "slider", "spinbutton", "switch", "tab", "menuitem",
    "menuitemcheckbox", "menuitemradio", "treeitem",
  ]);
  const STRUCTURE = new Set([
    "heading", "banner", "navigation", "main", "complementary", "contentinfo",
    "form", "search", "region", "dialog", "alert", "status", "table", "list",
  ]);

  /* An approximation of the accessible-name algorithm. The full spec is long
     and mostly concerns cases that do not arise on pages an agent is asked to
     operate; this covers the ones that do, in specification order. */
  const nameOf = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();

    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const parts = by.split(/\\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => (n.textContent || "").trim());
      if (parts.length) return parts.join(" ");
    }

    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label && label.textContent.trim()) return label.textContent.trim();
    }
    const wrapping = el.closest("label");
    if (wrapping && wrapping.textContent.trim()) return wrapping.textContent.trim();

    if (el.tagName === "INPUT") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "submit" || t === "button" || t === "reset") return el.value || t;
      if (el.placeholder) return el.placeholder;
    }
    if (el.tagName === "IMG") return el.getAttribute("alt") || "";
    const title = el.getAttribute("title");
    if (title) return title;

    /* Own text only, not descendants' — a <div> wrapping the page would
       otherwise be named with the entire document. */
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .trim();
    if (own) return own;

    /* Descendant text is a reasonable name for a button and a terrible one
       for a landmark: <main> was coming back named with every word inside it.
       Only elements that are acted on fall back this far. */
    if (INTERACTIVE.has(roleOf(el))) {
      return (el.textContent || "").trim().slice(0, MAX_NAME);
    }
    return "";
  };

  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.trim().toLowerCase();
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : "generic";
    if (tag === "button") return "button";
    if (tag === "select") return el.multiple ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "search") return "searchbox";
      if (t === "range") return "slider";
      if (t === "number") return "spinbutton";
      if (t === "submit" || t === "button" || t === "reset") return "button";
      if (t === "hidden") return "none";
      return "textbox";
    }
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "nav") return "navigation";
    if (tag === "main") return "main";
    if (tag === "header") return "banner";
    if (tag === "footer") return "contentinfo";
    if (tag === "aside") return "complementary";
    if (tag === "form") return "form";
    if (tag === "dialog") return "dialog";
    if (tag === "table") return "table";
    if (tag === "ul" || tag === "ol") return "list";
    if (tag === "option") return "option";
    return "generic";
  };

  /* Visibility, from the page's own point of view. An element the user cannot
     see is one the agent must not claim to have clicked. */
  const visible = (el) => {
    if (!el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const state = (el, role) => {
    const bits = [];
    if (el.disabled || el.getAttribute("aria-disabled") === "true") bits.push("disabled");
    if (role === "checkbox" || role === "radio" || role === "switch") {
      const on = el.checked ?? el.getAttribute("aria-checked") === "true";
      bits.push(on ? "checked" : "unchecked");
    }
    if (el.getAttribute("aria-expanded")) bits.push("expanded=" + el.getAttribute("aria-expanded"));
    if (role === "heading") {
      const lvl = el.getAttribute("aria-level") || (el.tagName.match(/^H(\\d)$/i) || [])[1];
      if (lvl) bits.push("level=" + lvl);
    }
    if (role === "textbox" || role === "searchbox") {
      if (el.value) bits.push("value=" + JSON.stringify(String(el.value).slice(0, 60)));
      if (el.required) bits.push("required");
    }
    if (el.tagName === "A" && el.getAttribute("href")) {
      bits.push("href=" + JSON.stringify(el.getAttribute("href").slice(0, 120)));
    }
    return bits;
  };

  /* Refs are stamped on the element, so an action resolves by attribute rather
     than by re-walking and hoping the order is the same. */
  document.querySelectorAll("[data-fl-ref]").forEach((el) => el.removeAttribute("data-fl-ref"));

  const nodes = [];
  let n = 0;
  let truncated = false;

  const walk = (el, depth) => {
    if (nodes.length >= MAX_NODES) { truncated = true; return; }
    const role = roleOf(el);
    const isInteractive = INTERACTIVE.has(role);
    const isStructure = STRUCTURE.has(role);

    if ((isInteractive || isStructure) && visible(el)) {
      const name = nameOf(el).replace(/\\s+/g, " ").slice(0, MAX_NAME);
      const entry = { depth, role, name, states: state(el, role), ref: null };
      if (isInteractive) {
        n += 1;
        const ref = version + "-e" + n;
        el.setAttribute("data-fl-ref", ref);
        entry.ref = ref;
      }
      nodes.push(entry);
      depth += 1;
    }
    for (const child of el.children) walk(child, depth);
  };

  walk(document.body, 0);

  return {
    url: location.href,
    title: document.title,
    nodes,
    truncated,
    interactive: n,
  };
}`;

/**
 * Render a snapshot as the indented text the model reads.
 *
 * Indented rather than JSON: a 30B model asked to find "the Save button" scans
 * an indented list far more reliably than it walks a nested object, and the
 * shape costs a third of the tokens.
 *
 * @param {{url: string, title: string, nodes: any[], truncated: boolean}} snap
 */
export function renderSnapshot(snap) {
  const lines = [
    `url: ${snap.url}`,
    `title: ${snap.title || "(untitled)"}`,
    "",
  ];
  for (const node of snap.nodes) {
    const pad = "  ".repeat(Math.min(node.depth, 12));
    const name = node.name ? ` ${JSON.stringify(node.name)}` : "";
    const ref = node.ref ? ` [ref=${node.ref}]` : "";
    const states = node.states.length ? ` [${node.states.join("] [")}]` : "";
    lines.push(`${pad}- ${node.role}${name}${ref}${states}`);
  }
  if (snap.truncated) {
    lines.push("", "(the page has more elements than fit in one snapshot; scroll or narrow the view)");
  }
  return lines.join("\n");
}
