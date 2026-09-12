// @ts-check
/**
 * Output styles, for the interface.
 *
 * The runtime owns what a style actually does — prompt.mjs builds the layer
 * the model reads. This is the same four styles with the same words, because
 * the renderer is a static site that cannot import from the runtime tree.
 *
 * The duplication is deliberate and it is checked: styles.test.mjs imports
 * runtime/core/prompt.mjs and asserts the two agree, id for id and word for
 * word. A settings page that promises "explains its reasoning" while the
 * prompt layer says something else is a claim the user cannot verify, and two
 * copies with no test between them drift on the first edit.
 */

export const OutputStyle = Object.freeze({
  ADAPTIVE: "adaptive",
  CONCISE: "concise",
  EXPLANATORY: "explanatory",
  LEARNING: "learning",
});

export const STYLE_ORDER = Object.freeze([
  OutputStyle.ADAPTIVE,
  OutputStyle.CONCISE,
  OutputStyle.EXPLANATORY,
  OutputStyle.LEARNING,
]);

export const STYLE_COPY = Object.freeze({
  [OutputStyle.ADAPTIVE]: {
    label: "Adaptive",
    summary: "Match the answer to the question.",
    detail:
      "A one-line question gets a one-line answer; a change to your code gets "
      + "what changed and what verified it. This is the default because most "
      + "sessions are a mix of both.",
  },
  [OutputStyle.CONCISE]: {
    label: "Concise",
    summary: "The result, and what proves it.",
    detail:
      "No preamble, no restating the request, no summary of work you watched "
      + "happen. Evidence is never trimmed: a command and its exit code are the "
      + "answer, not decoration around it.",
  },
  [OutputStyle.EXPLANATORY]: {
    label: "Explanatory",
    summary: "Say why, not just what.",
    detail:
      "Names the approach before taking it and the trade-off behind a choice. "
      + "Useful in code you do not know well, and on decisions you will have to "
      + "live with.",
  },
  [OutputStyle.LEARNING]: {
    label: "Learning",
    summary: "Explain the decisions as they happen.",
    detail:
      "Names the pattern being followed and offers a genuinely open choice "
      + "rather than picking silently. It does not turn a simple task into a "
      + "lesson, and it does not slow one down.",
  },
});

/** @param {unknown} v @returns {string} */
export function normalizeStyle(v) {
  const k = String(v ?? "").toLowerCase();
  return STYLE_ORDER.includes(/** @type {any} */ (k)) ? k : OutputStyle.ADAPTIVE;
}

/** @param {unknown} v */
export const styleLabel = (v) => STYLE_COPY[normalizeStyle(v)].label;

/**
 * The chooser, as radio rows.
 *
 * Rendered rather than written out four times in the markup, so adding a
 * style is one entry in the table above and not five places to update.
 *
 * @param {string} current
 */
export function styleChooserHtml(current) {
  const now = normalizeStyle(current);
  return STYLE_ORDER.map((id) => {
    const c = STYLE_COPY[id];
    return `<label class="askopt">
  <input type="radio" name="output-style" value="${id}"${id === now ? " checked" : ""}>
  <span class="askopt-b">
    <span class="askopt-l">${c.label}${
      id === OutputStyle.ADAPTIVE ? ' <span class="askopt-r">default</span>' : ""}</span>
    <span class="askopt-d">${c.summary} ${c.detail}</span>
  </span>
</label>`;
  }).join("\n");
}
