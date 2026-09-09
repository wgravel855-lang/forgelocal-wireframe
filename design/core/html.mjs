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
