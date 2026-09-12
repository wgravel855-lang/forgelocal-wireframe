// @ts-check
/**
 * Remembering what a model turned out to be.
 *
 * A conformance run costs ten real model turns. Asking the user to sit through
 * that on every launch would mean nobody ever runs it, and a suite nobody runs
 * is a suite that grades nothing — so the verdict is written down.
 *
 * What is stored is deliberately small: the profile for one model on one
 * server, keyed by both. The same model name served by two different endpoints
 * is two different things (a different quantization, a different chat template,
 * a different context length), and a cache keyed on the name alone would let a
 * verdict earned by one stand in for the other.
 *
 * A stored profile is a claim with an age. `SUITE_VERSION` invalidates every
 * profile the moment the cases change, because a grade earned against a
 * different suite is not the grade it claims to be. Nothing here ever upgrades
 * a profile on read: an unreadable or unrecognised file means untested, which
 * is the state that withholds agent features rather than the one that offers
 * them.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CASES } from "./capability.mjs";

/**
 * Bumped whenever the suite changes what it asks or how it grades.
 *
 * Derived from the case ids rather than hand-maintained, because a number
 * somebody has to remember to increment is a number that stays at 1 while the
 * thing it versions changes underneath it.
 */
export const SUITE_VERSION = CASES.map((c) => c.id).join(",");

/** How long a verdict is trusted. A model file can be replaced in place. */
export const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** @param {string} baseUrl @param {string} model */
export const profileKey = (baseUrl, model) => `${String(baseUrl)}::${String(model)}`;

/**
 * Open the profile store.
 *
 * One JSON file, read whole and written whole. There are at most a handful of
 * models on a machine, so the cost of that is nothing and the benefit is that a
 * half-written file is detectable rather than a corrupt row in the middle of
 * something else.
 *
 * @param {string} dir
 */
export function openProfiles(dir) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "profiles.json");

  /** @returns {Record<string, any>} */
  const readAll = () => {
    if (!existsSync(file)) return {};
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      // A damaged file means every model is untested, which withholds agent
      // features. That is the safe direction to fail in.
      return {};
    }
  };

  return {
    file,

    /**
     * The stored verdict for this model on this server, or null.
     *
     * Null for anything stale, anything graded by a different suite, and
     * anything the file could not produce. Every one of those is "we do not
     * know", and the caller treats not knowing as untested.
     *
     * @param {string} baseUrl @param {string} model @param {number} [now]
     */
    get(baseUrl, model, now = Date.now()) {
      const row = readAll()[profileKey(baseUrl, model)];
      if (!row || typeof row !== "object") return null;
      if (row.suite !== SUITE_VERSION) return null;
      if (!row.profile || typeof row.profile.agentGrade !== "string") return null;
      if (typeof row.profile.testedAt !== "number") return null;
      if (now - row.profile.testedAt > MAX_AGE_MS) return null;
      return row.profile;
    },

    /** @param {string} baseUrl @param {string} model @param {any} profile */
    set(baseUrl, model, profile) {
      const all = readAll();
      all[profileKey(baseUrl, model)] = { suite: SUITE_VERSION, profile };
      writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`, "utf8");
      return profile;
    },

    /** @param {string} baseUrl @param {string} model */
    forget(baseUrl, model) {
      const all = readAll();
      delete all[profileKey(baseUrl, model)];
      writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`, "utf8");
    },

    /** Every stored profile, for a settings page that lists them. */
    all() {
      return Object.entries(readAll())
        .filter(([, row]) => row && row.suite === SUITE_VERSION)
        .map(([key, row]) => ({ key, ...row.profile }));
    },
  };
}
