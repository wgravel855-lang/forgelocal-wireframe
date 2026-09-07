// Hardware fit, computed rather than asserted.
//
// Fit states: great | tradeoffs | offload | nofit | unverified
// Every state carries a short reason built from the same arithmetic that
// model details show the user, so a page can never disagree with the maths.

import { kvCacheBytes, requiredBytes, RUNTIME_OVERHEAD_BYTES } from "../data/models.mjs";
export { requiredBytes, kvCacheBytes, RUNTIME_OVERHEAD_BYTES };

const GB = 1024 ** 3;

export const gb = (bytes, dp = 1) => (bytes / GB).toFixed(dp).replace(/\.0$/, "");

/** The example machine every screen is written against. */
export const thisPC = {
  id: "rtx4070-12gb-32gb",
  label: "RTX 4070 12 GB, 32 GB RAM",
  gpu: "NVIDIA GeForce RTX 4070",
  vramBytes: 12 * GB,
  ramBytes: 32 * GB,
  ramFreeBytes: 19 * GB,
  diskFreeBytes: 248 * GB,
  os: "Windows 11, 64-bit",
  cores: 16,
};

export const FIT = {
  great: { label: "Great fit", tone: "ok", rank: 0 },
  tradeoffs: { label: "Runs with tradeoffs", tone: "warn", rank: 1 },
  offload: { label: "CPU offload required", tone: "warn", rank: 2 },
  nofit: { label: "Does not fit", tone: "bad", rank: 3 },
  unverified: { label: "Unverified", tone: "mut", rank: 4 },
};

/**
 * @returns {{state:keyof FIT, label:string, tone:string, reason:string,
 *            required:number, kv:number, context:number, headroom:number}}
 */
export function fitFor(profile, pc = thisPC, context = profile.recommendedContext) {
  const kv = kvCacheBytes(profile, context);
  const required = requiredBytes(profile, context);
  const vram = pc.vramBytes;
  const headroom = vram - required;

  // Try a smaller context before declaring tradeoffs.
  const smallest = Math.min(...profile.contextOptions);
  const requiredAtSmallest = requiredBytes(profile, smallest);

  let state, reason;

  if (required <= vram * 0.92) {
    state = "great";
    reason = `Weights, a ${fmtCtx(context)} context and runtime overhead come to ${gb(required)} GB, inside ${gb(vram)} GB of video memory.`;
  } else if (required <= vram) {
    state = "tradeoffs";
    reason = `Needs ${gb(required)} GB of the ${gb(vram)} GB available. It fits, but leaves little room for anything else on the GPU.`;
  } else if (requiredAtSmallest <= vram) {
    state = "tradeoffs";
    reason = `Fits at a ${fmtCtx(smallest)} context (${gb(requiredAtSmallest)} GB). A ${fmtCtx(context)} context would need ${gb(required)} GB against ${gb(vram)} GB.`;
  } else if (profile.downloadBytes + RUNTIME_OVERHEAD_BYTES <= vram + pc.ramFreeBytes) {
    state = "offload";
    reason = `${gb(profile.downloadBytes)} GB of weights against ${gb(vram)} GB of video memory, so most layers run on the CPU. It works, but expect it to be slow.`;
  } else {
    state = "nofit";
    reason = `${gb(profile.downloadBytes)} GB of weights will not fit in ${gb(vram)} GB of video memory plus ${gb(pc.ramFreeBytes)} GB of free system memory.`;
  }

  return { state, ...FIT[state], reason, required, kv, context, headroom };
}

export function fmtCtx(n) {
  return n >= 1024 ? `${Math.round(n / 1024)}k` : String(n);
}

/** Speed is never asserted. Nothing here has been benchmarked. */
export function speedFor(profile, pc = thisPC) {
  const m = profile.measuredTokensPerSecond.find((x) => x.hardwareId === pc.id);
  return m
    ? { measured: true, text: `${m.median} tokens/s median`, detail: `${m.min}–${m.max} over ${m.generatedTokens} tokens at ${fmtCtx(m.context)} context` }
    : { measured: false, text: "Not measured on this PC yet", detail: "Run a local benchmark to record throughput for this exact profile." };
}

/**
 * The one recommendation: the most capable coding model that actually fits,
 * evaluated at the largest context that fits, plus the runner-up so the UI can
 * say what is being traded.
 */
export function recommendFor(pc = thisPC) {
  const candidates = models_coding()
    .map((m) => {
      // Largest context whose own arithmetic fits in video memory. Checking the
      // fit *state* here would be wrong: the state can fall back to a smaller
      // context internally, which would let us advertise a context that does
      // not actually fit.
      const ctx = [...m.contextOptions]
        .sort((a, b) => b - a)
        .find((c) => requiredBytes(m, c) <= pc.vramBytes);
      return ctx ? { m, f: fitFor(m, pc, ctx) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.m.parameterCount - a.m.parameterCount);

  if (!candidates.length) return null;
  const pick = candidates[0];
  const lighter = candidates.slice(1).find((c) => fitFor(c.m, pc).state === "great");
  return { ...pick, lighter: lighter ?? null };
}

let _models = null;
export function registerModels(list) { _models = list; }
function models_coding() {
  return (_models ?? []).filter((m) => m.tasks.includes("coding"));
}

export function storageTotals(list) {
  const installed = list.filter((m) => m.installed);
  return {
    installed,
    installedBytes: installed.reduce((a, m) => a + m.installedBytes, 0),
  };
}
