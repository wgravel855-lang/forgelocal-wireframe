// @ts-check
/**
 * One byte unit for the whole product.
 *
 * The build formatted sizes as GiB while the browser formatted the same record
 * as decimal GB, so the loader dialog called a model 5.03 GB on the exact page
 * where the catalog called it 4.68 GB. Sizes now come from here on both sides.
 *
 * Windows reports file sizes in GiB and calls them GB, so ForgeLocal matches
 * what Explorer says about the same file on disk.
 */

export const GB = 1024 ** 3;

/**
 * @param {number} bytes
 * @param {number} [dp]
 * @returns {string} the number only, so callers own the unit and the markup
 */
export const gb = (bytes, dp = 1) => (bytes / GB).toFixed(dp).replace(/\.0$/, "");

/**
 * Context lengths read as 8k and 128k, never as 8192 tokens in a table cell.
 * @param {number} tokens
 */
export const fmtCtx = (tokens) => tokens >= 1024
  ? `${Math.round(tokens / 1024)}k`
  : String(tokens);

/** @param {number} n */
export const commas = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
