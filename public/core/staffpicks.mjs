// @ts-check
/**
 * The collection the browser opens on.
 *
 * A list of repository names and nothing else. That restraint is the point:
 * every number a person sees beside these — downloads, likes, size, parameter
 * count, when it was last touched — is fetched from Hugging Face when the
 * browser opens, so a curated list cannot become a set of stale figures that
 * look measured. If Hugging Face is unreachable, the browser says so rather
 * than falling back to what these once were.
 *
 * Chosen for one reason each, stated. They are all GGUF repositories that
 * ForgeLocal's own engine can actually run, which is the bar for appearing
 * here at all: a recommendation for a model the app cannot load is not a
 * recommendation.
 */

/**
 * @typedef {object} StaffPick
 * @property {string} repoId
 * @property {string} why  why this is on the list, in one line
 */

/** @type {readonly StaffPick[]} */
export const STAFF_PICKS = Object.freeze([
  {
    repoId: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
    why: "Fits a 12GB card with room to spare, and its chat template does tool calls.",
  },
  {
    repoId: "Qwen/Qwen2.5-Coder-14B-Instruct-GGUF",
    why: "The same family a size up, for cards with 16GB or more.",
  },
  {
    repoId: "bartowski/Llama-3.2-3B-Instruct-GGUF",
    why: "Small enough to run on the processor alone.",
  },
  {
    repoId: "bartowski/Mistral-Small-24B-Instruct-2501-GGUF",
    why: "A larger general model for machines with headroom.",
  },
  {
    repoId: "Qwen/Qwen2.5-7B-Instruct-GGUF",
    why: "A general-purpose counterpart to the coder models.",
  },
  {
    repoId: "bartowski/gemma-2-9b-it-GGUF",
    why: "Google's mid-size instruct model, widely used.",
  },
  {
    repoId: "google/gemma-3-4b-it-qat-q4_0-gguf",
    why: "Published by Google directly, quantisation-aware trained for 4-bit.",
  },
  {
    repoId: "Qwen/Qwen3-8B-GGUF",
    why: "The current Qwen generation, with reasoning the uploader documents.",
  },
  {
    repoId: "Qwen/Qwen3-4B-GGUF",
    why: "The same generation small enough for 8GB cards.",
  },
  {
    repoId: "unsloth/Qwen3-14B-GGUF",
    why: "A larger Qwen3 for machines with 16GB or more.",
  },
  {
    repoId: "bartowski/microsoft_Phi-4-mini-instruct-GGUF",
    why: "Microsoft's small instruct model, strong for its size.",
  },
  {
    repoId: "ggml-org/gemma-3-4b-it-GGUF",
    why: "Packaged by the llama.cpp maintainers themselves.",
  },
]);

/** The repository names alone, for a caller that only needs the ids. */
export const STAFF_PICK_IDS = Object.freeze(STAFF_PICKS.map((p) => p.repoId));

/** Why one repository is on the list, or null when it is not. @param {string} repoId */
export function pickReason(repoId) {
  return STAFF_PICKS.find((p) => p.repoId === repoId)?.why ?? null;
}
