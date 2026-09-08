// @ts-check
/**
 * Where each session was left. Returning to a finished chat should put you back
 * on what you were reading; only a chat you were following at the bottom keeps
 * following new content.
 *
 * The decisions live here as pure functions so they can be tested without a
 * scroll container, and the controller only supplies measurements.
 */

/**
 * @typedef {object} ReadingPosition
 * @property {number} top          scrollTop when the session was left
 * @property {boolean} pinned      the reader was at the end
 * @property {string|null} lastId  the last turn that was above the fold
 */

/**
 * @typedef {object} Metrics
 * @property {number} scrollTop
 * @property {number} scrollHeight
 * @property {number} clientHeight
 */

/** Within this many pixels of the end counts as following. */
export const PINNED_SLACK = 48;

/** @param {Metrics} m */
export const distanceFromBottom = (m) => m.scrollHeight - m.scrollTop - m.clientHeight;

/** @param {Metrics} m */
export const isPinned = (m) => distanceFromBottom(m) < PINNED_SLACK;

/**
 * @param {Metrics} m
 * @param {string|null} lastVisibleTurnId
 * @returns {ReadingPosition}
 */
export const capture = (m, lastVisibleTurnId) => ({
  top: Math.round(m.scrollTop),
  pinned: isPinned(m),
  lastId: lastVisibleTurnId,
});

/**
 * What scrollTop to apply on return.
 *
 * A pinned session goes to the end, because that is what following means. An
 * unpinned one prefers the offset of the turn it was reading, since a
 * re-render can change heights and make the raw pixel value wrong. With no
 * stored position at all the caller falls back to its own default.
 *
 * @param {ReadingPosition|null} pos
 * @param {Metrics} m
 * @param {number|null} anchorOffsetTop  offsetTop of pos.lastId, or null
 * @returns {{top:number, follow:boolean}|null}
 */
export function restore(pos, m, anchorOffsetTop) {
  if (!pos) return null;
  const max = Math.max(0, m.scrollHeight - m.clientHeight);
  if (pos.pinned) return { top: max, follow: true };
  const top = anchorOffsetTop != null
    ? Math.max(0, Math.min(anchorOffsetTop - 12, max))
    : Math.min(pos.top, max);
  return { top, follow: false };
}

/**
 * A streaming session follows the end only while the reader is still there.
 * Scrolling up during a run stops the auto-follow; returning to the bottom
 * resumes it.
 * @param {boolean} wasFollowing
 * @param {Metrics} m
 */
export const shouldFollow = (wasFollowing, m) => (wasFollowing ? isPinned(m) : isPinned(m));

/**
 * @param {Record<string, ReadingPosition>} all
 * @param {string|null} id
 * @param {ReadingPosition} pos
 * @returns {Record<string, ReadingPosition>}
 */
export const remember = (all, id, pos) => (id ? { ...all, [id]: pos } : all);
