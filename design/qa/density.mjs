// @ts-check
/**
 * Counts the visual grammar this pass is trying to reduce: rounded objects,
 * visible borders, filled pills, and text below the readable floor.
 *
 * It runs in the browser through the Browser pane rather than in jsdom, because
 * every one of these needs real computed styles. Exported as a string so the
 * same expression can be pasted into a page and produce the same numbers before
 * and after, which is the only way the reduction targets mean anything.
 */

export const MEASURE = `(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0.05;
  };
  const px = (v) => parseFloat(v) || 0;
  const els = [...document.querySelectorAll("body *")].filter(vis);

  let rounded = 0, bordered = 0, shadowed = 0, capsules = 0, mono = 0;
  const small = [];
  for (const el of els) {
    const s = getComputedStyle(el);
    const radius = Math.max(px(s.borderTopLeftRadius), px(s.borderTopRightRadius),
      px(s.borderBottomLeftRadius), px(s.borderBottomRightRadius));
    if (radius >= 3) rounded++;
    const r = el.getBoundingClientRect();
    if (radius >= Math.min(r.height, r.width) / 2 - 1 && radius >= 10) capsules++;
    const widths = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map(px);
    const styles = [s.borderTopStyle, s.borderRightStyle, s.borderBottomStyle, s.borderLeftStyle];
    const hasBorder = widths.some((w, i) => w > 0 && styles[i] !== "none"
      && !/rgba\\(0, 0, 0, 0\\)|transparent/.test([s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor][i]));
    if (hasBorder) bordered++;
    if (s.boxShadow && s.boxShadow !== "none") shadowed++;
    if (/mono/i.test(s.fontFamily)) mono++;
    // only elements whose own text is the leaf text, so a wrapper is not counted
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && px(s.fontSize) < 13) small.push(el.tagName.toLowerCase() + " " + s.fontSize + " :: " + el.textContent.trim().slice(0, 40));
  }

  // horizontal overflow: the body must never scroll sideways
  const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
  const h1s = [...document.querySelectorAll("h1")].filter(vis).map((h) => h.textContent.trim());

  return { total: els.length, rounded, bordered, shadowed, capsules, mono,
    smallText: small.length, smallSamples: small.slice(0, 6), overflow, h1s };
})()`;
