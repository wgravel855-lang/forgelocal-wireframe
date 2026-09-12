// @ts-check
/**
 * One HTML escape for everything core renders.
 *
 * There were two: the model card escaped apostrophes and the list views did
 * not, so the same publisher name was safe in one panel and interpolated into
 * an attribute unescaped in another. A single quote closes a single-quoted
 * attribute, so both are escaped here and nothing chooses.
 */

/**
 * @param {unknown} s
 * @returns {string} safe to interpolate into element text or a quoted attribute
 */
export const escapeHtml = (s) => String(s ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

/**
 * Shorten a label to fit one line.
 *
 * For names, URLs and status text, where the reader needs to recognise the
 * thing rather than read all of it. The ellipsis is a character, not a count:
 * "… 41 more characters" in the middle of a button is noise.
 *
 * @param {unknown} s @param {number} n
 */
export function truncate(s, n) {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * Shorten a block of output for the DOM.
 *
 * Different from `truncate` on purpose, and named differently after both lived
 * as `clip` in two modules: this one says how much was left out, because the
 * reader of a command's output needs to know there is more, and it is the size
 * of the omission that tells them whether to go and look.
 *
 * @param {unknown} s @param {number} n
 */
export function clipOutput(s, n) {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n)}\n… ${t.length - n} more characters` : t;
}
