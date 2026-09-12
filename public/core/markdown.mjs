// @ts-check
/**
 * One Markdown renderer, shared by the model card and the live transcript.
 *
 * It lived in modelcard.mjs first. When the transcript needed the same thing,
 * a second copy appeared, and the console gate rejected it: two core modules
 * declaring renderMarkdown at module scope. That gate was right for a better
 * reason than name collision. A second renderer is a second escaper, and a
 * second escaper is a second place for an escaping bug to live.
 *
 * The security rule is the whole design: escape first, then transform. Every
 * character goes through escapeHtml before a single pattern is matched, so the
 * only markup in the result is markup this file wrote. Model output, model
 * cards and tool results are all untrusted text, and none of them reaches
 * innerHTML unescaped.
 *
 * Callers differ only in the options below: heading depth, whether links may
 * become anchors, whether a paragraph reflows, and which classes to stamp.
 */

import { escapeHtml as esc } from "./html.mjs";

/**
 * A private-use sentinel for held-back code spans. Escaped text never contains
 * one, and any the input did contain are stripped before it is used.
 */
const MARK = "\uE000";

/**
 * Only these schemes may appear in a rendered link. Everything else — javascript:,
 * data:, vbscript:, and anything unrecognised — is dropped, because a model card
 * is third-party text.
 * @param {string} url
 * @returns {string|null}
 */
export function safeUrl(url) {
  const trimmed = String(url).trim();
  // strip control characters that hide a scheme, e.g. "java\0script:"
  const flat = trimmed.replace(/[\u0000-\u001f\u007f]/g, "");
  if (/^(https?:|mailto:)/i.test(flat)) return flat;
  if (/^[./#]/.test(flat)) return flat;          // relative or fragment
  return null;
}

/**
 * A deliberately small Markdown subset: headings, paragraphs, lists, tables,
 * fenced code, inline code, bold, italic and links. Everything is escaped first,
 * so no raw HTML, script, event handler or unsafe scheme can survive.
 * @param {string} md
 * @returns {string}
 */
export function renderMarkdown(md, opts = {}) {
  const {
    // A model card is a document and starts at h3; a chat reply is shallower
    // and starts at h2. Neither ever emits an h1: the page owns that.
    headingOffset = 2,
    maxHeading = 6,
    // Links belong in a publisher's card. A model's reply is not a place to
    // mint clickable destinations, so the transcript turns them off and the
    // link text survives without its href.
    links = true,
    // The model card reflows a paragraph; a transcript keeps the line breaks
    // the model actually wrote.
    softBreaks = false,
    // The card's own classes. The transcript styles by element inside .prose.
    cls = { p: "mc-p", h: "mc-h", list: "mc-list", code: "mc-code m", table: "mc-table" },
  } = opts;
  const c = (k) => (cls && cls[k] ? ` class="${cls[k]}"` : "");
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  /** @type {string[]} */
  const out = [];
  let i = 0;

  /**
   * Inline spans.
   *
   * Code spans are lifted out before anything else runs and put back after
   * everything else has, so their contents stay exactly as written. Chaining
   * the replaces instead turned `**not bold**` inside backticks into
   * <code><strong>not bold</strong></code>, which is the one thing a code span
   * is for.
   *
   * @param {string} t  raw text; escaped here, before any pattern is matched
   */
  const inline = (t) => {
    /** @type {string[]} */
    const held = [];
    // The sentinel is removed from the input first, so text that contains one
    // cannot collide with the placeholder numbering and swallow a span.
    let s = esc(t).split(MARK).join("").replace(/`([^`]+)`/g, (_, c) => {
      held.push(`<code>${c}</code>`);
      return `${MARK}${held.length - 1}${MARK}`;
    });

    s = s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text, href) => {
        // href arrives escaped, so &amp; must be undone before it is checked
        const url = safeUrl(href.replace(/&amp;/g, "&"));
        // An unsafe link, or any link at all when the caller has turned them
        // off, keeps its words and loses its destination.
        return url && links
          ? `<a href="${esc(url)}" rel="noreferrer noopener" target="_blank">${text}</a>`
          : text;
      });

    // Odd positions are placeholders. Splitting beats a pattern here: there is
    // no escaping to get wrong, and the input is known to alternate.
    return s.split(MARK).map((piece, k) => (k % 2 ? held[Number(piece)] ?? "" : piece)).join("");
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre${c("code")}${lang ? ` data-lang="${esc(lang)}"` : ""}><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = Math.min(maxHeading, heading[1].length + headingOffset);
      out.push(`<h${level}${c("h")}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul${c("list")}>${items.join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol${c("list")}>${items.join("")}</ol>`);
      continue;
    }

    // a table needs a header row and a separator row beneath it
    if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) body.push(cells(lines[i++]));
      out.push(`<table${c("table")}><thead><tr>${
        head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${
        body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")
      }</tbody></table>`);
      continue;
    }

    if (!line.trim()) { i++; continue; }

    // The cursor must always advance. A line that looks like a table row but has
    // no separator beneath it matched none of the branches above and was also
    // excluded from this loop, so `i` never moved and rendering spun forever.
    const para = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*[-*]\s|\s*\d+\.\s|\s*\|)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    const joined = softBreaks
      ? inline(para.join("\n")).split("\n").join("<br>")
      : inline(para.join(" "));
    out.push(`<p${c("p")}>${joined}</p>`);
  }

  return out.join("\n");
}

