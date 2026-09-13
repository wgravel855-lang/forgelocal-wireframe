// @ts-check
/**
 * Whether a model will run here, and how to load it.
 *
 * The version of this that existed before computed everything from a fixed
 * RTX 4070 profile, so it answered confidently and was wrong for everyone who
 * did not own that card. The rule here is the opposite: **a number that
 * depends on an unknown is not produced.** A machine whose VRAM could not be
 * measured gets `null` and a sentence explaining what is missing, not a
 * plausible default.
 *
 * The arithmetic is deliberately approximate and says so. Real memory use
 * depends on the quantisation of each tensor, the KV cache type, the batch
 * size and what else is on the GPU. What this needs to get right is the
 * decision — will it fit, will it fit with the context you want, or will it
 * not fit at all — and for that a margin matters more than precision.
 */

/** Headroom left on the GPU for the desktop, the compositor and everything else. */
export const GPU_RESERVE_BYTES = 800 * 1024 * 1024;

/** Headroom left in system memory when a model runs on the processor. */
export const RAM_RESERVE_BYTES = 3 * 1024 * 1024 * 1024;

/**
 * Roughly what one token of KV cache costs, per layer, at f16.
 *
 * For a grouped-query model the cache holds a key and a value per token per
 * layer: 2 x n_kv_heads x head_dim x 2 bytes. A 7B with 8 KV heads and a head
 * dimension of 128 works out at 2 x 8 x 128 x 2 = 4096 bytes, and most models
 * in this size range are close to it.
 *
 * A per-model figure would need the head count out of the GGUF header. This is
 * the order of magnitude, which is what a "will it fit" decision needs, and
 * every number derived from it is presented as approximate.
 *
 * The first version of this was written as `128 * 1024 / 1024` meaning
 * "128KB per 1k tokens" and then multiplied by 1024 again at the call site.
 * The result was 30GB of cache for an 8k context, so a 4GB model on a 12GB
 * card was reported as not fitting. The tests caught it; arithmetic with two
 * unit conversions in it is worth writing as one number.
 */
const KV_BYTES_PER_TOKEN_PER_LAYER = 4096;

/** Layer counts are not in a file name, so this is a band, not a lookup. */
function guessLayers(fileBytes) {
  const gb = fileBytes / 1e9;
  if (gb < 2) return 24;
  if (gb < 5) return 28;
  if (gb < 10) return 32;
  if (gb < 20) return 40;
  if (gb < 45) return 48;
  return 80;
}

/**
 * The largest usable GPU, and how much of it is free to use.
 *
 * @param {any} hw
 * @returns {{vram: number|null, name: string|null, vendor: string|null}}
 */
export function primaryGpu(hw) {
  const gpus = Array.isArray(hw?.gpus) ? hw.gpus : [];
  if (!gpus.length) return { vram: null, name: null, vendor: null };

  // The one with the most measured memory. A GPU whose memory is unknown is
  // not "0" — it is simply not a candidate for sizing anything.
  const measured = gpus.filter((g) => typeof g.vram_bytes === "number" && g.vram_bytes > 0);
  if (!measured.length) {
    return { vram: null, name: gpus[0].name ?? null, vendor: gpus[0].vendor ?? null };
  }
  const best = measured.reduce((a, b) => (b.vram_bytes > a.vram_bytes ? b : a));
  return { vram: best.vram_bytes, name: best.name ?? null, vendor: best.vendor ?? null };
}

/**
 * Can this machine run this file, and how.
 *
 * @param {object} input
 * @param {number} input.fileBytes
 * @param {any} input.hardware       from the host's probe
 * @param {number} [input.context]   tokens the user wants
 */
export function fitFor({ fileBytes, hardware, context = 8192 }) {
  const gpu = primaryGpu(hardware);
  const ram = typeof hardware?.ram_bytes === "number" ? hardware.ram_bytes : null;
  const layers = guessLayers(fileBytes);
  const kv = context * layers * KV_BYTES_PER_TOKEN_PER_LAYER;

  /* Nothing measurable, nothing claimed. This is the branch the old fixed
     profile never had, and it is the only honest answer for a machine whose
     GPU could not be read. */
  if (gpu.vram == null && ram == null) {
    return {
      verdict: "unknown",
      label: "Cannot tell",
      detail: "Neither the GPU memory nor the system memory could be measured on this "
        + "machine, so nothing here can say whether this model will run.",
      gpuLayers: null,
      recommendedContext: null,
      approximate: true,
    };
  }

  if (gpu.vram != null) {
    const usable = gpu.vram - GPU_RESERVE_BYTES;
    const needed = fileBytes + kv;

    if (needed <= usable) {
      return {
        verdict: "fits",
        label: "Runs on the GPU",
        detail: `About ${gb(needed)} of ${gb(gpu.vram)} on ${gpu.name ?? "the GPU"}, `
          + `leaving room for the desktop. Approximate.`,
        gpuLayers: 999,      // llama.cpp clamps to the model's real count
        recommendedContext: context,
        approximate: true,
      };
    }

    // Some of it, then. How many layers fit is the useful number.
    const perLayer = fileBytes / layers;
    const kvPerLayer = kv / layers;
    const affordable = Math.max(0, Math.floor(usable / (perLayer + kvPerLayer)));

    /* What the processor would have to hold. A partial load only helps if
       the remainder fits in system memory; if it does not, this model does
       not run here at all, and saying "will be slow" would be wrong in the
       direction that wastes an hour of somebody's download. */
    const ramNeeded = affordable >= 1 ? fileBytes - affordable * perLayer : fileBytes;
    const remainderFits = ram == null || ramNeeded + RAM_RESERVE_BYTES <= ram;

    if (affordable >= 1 && remainderFits) {
      // Tight when the remainder is most of what is left, which is the case
      // where it technically runs and nobody enjoys it.
      const tight = ram != null && ramNeeded + RAM_RESERVE_BYTES > ram * 0.8;
      return {
        verdict: tight ? "tight" : "partial",
        label: tight ? "Runs, but slowly" : "Runs partly on the GPU",
        detail: `About ${affordable} of roughly ${layers} layers fit in `
          + `${gb(gpu.vram)} of GPU memory; the rest runs on the processor. `
          + (tight
            ? `That rest is about ${gb(ramNeeded)}, which is most of this machine's `
              + `memory. Expect it to be slow. Approximate.`
            : "Slower than a full GPU load. Approximate."),
        gpuLayers: affordable,
        recommendedContext: context,
        approximate: true,
      };
    }

    if (ram != null && ramNeeded + RAM_RESERVE_BYTES > ram) {
      return {
        verdict: "no",
        label: "Too large for this machine",
        detail: `This model needs about ${gb(fileBytes)} and this machine has `
          + `${gb(ram)} of memory and ${gb(gpu.vram)} of GPU memory. A smaller `
          + `quantisation of the same model may fit.`,
        gpuLayers: 0,
        recommendedContext: null,
        approximate: true,
      };
    }
    return {
      verdict: "cpu",
      label: "Processor only",
      detail: `It does not fit in ${gb(gpu.vram)} of GPU memory, but it fits in system `
        + "memory. Expect it to be several times slower. Approximate.",
      gpuLayers: 0,
      recommendedContext: Math.min(context, 8192),
      approximate: true,
    };
  }

  /* A GPU may exist and simply not be measurable — the interface says so
     rather than reporting "processor only", which would be a claim about
     hardware nobody checked. */
  const gpuUnknown = gpu.name != null;
  if (ram != null && fileBytes + RAM_RESERVE_BYTES > ram) {
    return {
      verdict: "no",
      label: "Too large for this machine",
      detail: `This model needs about ${gb(fileBytes)} and this machine has ${gb(ram)} `
        + "of memory.",
      gpuLayers: 0,
      recommendedContext: null,
      approximate: true,
    };
  }
  return {
    verdict: "cpu",
    label: gpuUnknown ? "Fits in memory; GPU unknown" : "Processor only",
    detail: gpuUnknown
      ? `It fits in ${gb(ram ?? 0)} of system memory. ${gpu.name} was found but its `
        + "memory could not be measured, so how much would run on it is not known. "
        + "Set the GPU layers by hand if you know the figure."
      : `It fits in ${gb(ram ?? 0)} of system memory. No GPU was found.`,
    gpuLayers: gpuUnknown ? null : 0,
    recommendedContext: Math.min(context, 8192),
    approximate: true,
  };
}

/**
 * Default load parameters for a file on this machine.
 *
 * Every field can be `null`, and `null` means "let llama.cpp decide" rather
 * than a number nobody measured. The interface shows the fields it has and
 * says which it does not.
 *
 * @param {object} input
 * @param {number} input.fileBytes @param {any} input.hardware
 */
export function suggestLoad({ fileBytes, hardware }) {
  const fit = fitFor({ fileBytes, hardware, context: 8192 });
  return {
    gpuLayers: fit.gpuLayers,
    context: fit.recommendedContext,
    // One sequence. Each extra one costs a whole KV cache, and nothing in the
    // product asks for more than one at a time.
    parallel: 1,
    // Worth having wherever it is supported, and llama.cpp ignores it where
    // it is not.
    flashAttention: true,
    basis: fit,
  };
}

/** @param {number} n */
function gb(n) {
  return `${(n / 1e9).toFixed(1)} GB`;
}
