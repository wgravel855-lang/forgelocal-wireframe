// @ts-check
/**
 * Real models on disk, in the shape the model pages already render.
 *
 * The Models pages were built against a seeded catalogue in localStorage. That
 * was right while there was no runtime to ask; it is wrong now, because it
 * meant Explore and My Models showed the same rows on a machine with no models
 * installed as on one with six, and neither had anything to do with the folder
 * the engine actually loads from.
 *
 * Rather than rewrite those pages, this converts what `model.list` reports into
 * the record shape they already take. One rendering path, fed by the runtime.
 *
 * **What this file will not do is fill in a blank.** A `.gguf` on disk gives a
 * file name, a size, and whether the first eight bytes say GGUF. It does not
 * give a publisher, a licence, a download count or a parameter count. Those
 * fields exist in the record shape because a catalogue entry has them, and a
 * local file does not become one by being read. Anything not measured is left
 * empty and the views say so, because a guessed publisher is indistinguishable
 * on screen from a known one.
 */

/**
 * @typedef {object} LiveModelRow  one entry from model.list
 * @property {string} name
 * @property {number} bytes
 * @property {boolean} usable
 * @property {string} [problem]
 * @property {any} [fit]
 * @property {any} [suggested]
 */

/** GGUF file names carry the quantisation, and only that, reliably. */
const QUANT = /[.-](Q\d[_A-Za-z0-9]*|IQ\d[_A-Za-z0-9]*|FP16|FP32|F16|F32|BF16)(?=[.-]|$)/i;

/**
 * The quantisation in a file name, or undefined.
 *
 * This is the one piece of metadata a GGUF file name really does carry — the
 * convention is near-universal and the value is unambiguous when it matches.
 * Everything else people read out of these names (publisher, parameter count)
 * is convention at best and wrong often enough to matter.
 *
 * @param {string} name
 */
export function quantOf(name) {
  const m = QUANT.exec(name.replace(/\.gguf$/i, ""));
  return m ? m[1].toUpperCase() : undefined;
}

/** The name without its extension and quantisation suffix. @param {string} name */
export function displayNameOf(name) {
  const base = name.replace(/\.gguf$/i, "");
  const q = quantOf(name);
  if (!q) return base;
  return base.replace(new RegExp(`[.-]${q}$`, "i"), "") || base;
}

/**
 * How a fit verdict from the runtime reads in the interface.
 *
 * `unknown` is a real answer and maps to itself: it is what the runtime says
 * when it could not measure the machine, and turning that into "good" would be
 * inventing the measurement.
 *
 * @param {any} fit
 * @returns {'excellent'|'good'|'tight'|'unsupported'|'unknown'}
 */
export function fitVerdict(fit) {
  switch (fit && fit.verdict) {
    case "fits": return "excellent";
    case "partial": return "good";
    case "tight": return "tight";
    case "cpu": return "good";
    case "no": return "unsupported";
    default: return "unknown";
  }
}

/**
 * One record, from one file.
 *
 * @param {LiveModelRow} row
 * @param {{loaded?: string|null, agentReady?: boolean}} [ctx]
 */
export function recordFor(row, ctx = {}) {
  const name = String(row.name ?? "");
  const isLoaded = !!ctx.loaded && ctx.loaded === name;

  /** @type {string[]} */
  const capabilities = [];
  /* agent_ready is a claim about tool reliability that only the conformance
     suite can make, and only about the model that was tested. It is never
     inferred from a file. */
  if (isLoaded && ctx.agentReady) capabilities.push("agent_ready");

  return /** @type {any} */ ({
    id: name,
    displayName: displayNameOf(name),
    /* Blank, not guessed. A file called qwen3-8b-Q4_K_M.gguf might be from
       Qwen, or a fine-tune of it by somebody else, or a re-quantisation of
       that; the file cannot tell us and the page must not claim. */
    publisher: "",
    family: "",
    architecture: "",
    format: row.usable ? "GGUF" : "other",
    quantization: quantOf(name),
    fileSizeBytes: Number(row.bytes) || 0,
    capabilities,
    installed: true,
    loadedInstances: isLoaded
      ? [{ id: name, contextTokens: row.suggested?.context ?? null }]
      : [],
    hardwareFit: fitVerdict(row.fit),
    /* Carried through so a file that is not a model can say what is wrong with
       it rather than sitting in the list looking installed. */
    problem: row.usable ? undefined : (row.problem || "This file is not a GGUF model."),
  });
}

/**
 * The whole store, from what the runtime reported.
 *
 * @param {{models?: LiveModelRow[]}|null} list  the model.list payload
 * @param {{loaded?: string|null, agentReady?: boolean}} [ctx]
 */
export function liveModelState(list, ctx = {}) {
  const rows = list && Array.isArray(list.models) ? list.models : [];
  const seed = rows.map((r) => recordFor(r, ctx));
  /** @type {Record<string, any>} */
  const byId = {};
  for (const m of seed) byId[m.id] = m;
  const loaded = seed.find((m) => m.loadedInstances.length > 0);
  return {
    version: 1,
    byId,
    selectedId: loaded ? loaded.id : null,
    order: seed.map((m) => m.id),
  };
}
