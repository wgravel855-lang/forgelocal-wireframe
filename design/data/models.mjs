// ---------------------------------------------------------------------------
// One model-profile source of truth.
//
// Every model surface (onboarding recommendation, composer picker, Explore,
// My models, the public catalog, model detail pages and storage totals) is
// rendered from this array. Nothing about a model is hand-typed into a page.
//
// HONESTY RULES BAKED IN HERE:
//   * downloadBytes are real published GGUF Q4_K_M artifact sizes.
//   * memory fit is ARITHMETIC (weights + KV cache + runtime overhead), not a
//     guess, and the formula is shown to the user in model details.
//   * measuredTokensPerSecond is EMPTY. Nothing has been benchmarked, so no
//     throughput number is presented as fact anywhere in the UI. Surfaces show
//     "Not measured on this PC yet" and offer to run a local benchmark.
//   * verifiedAt is null until an agent check suite has actually run.
// ---------------------------------------------------------------------------

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** Runtime working set that is not weights or KV cache. */
export const RUNTIME_OVERHEAD_BYTES = 600 * MB;

/**
 * KV cache size for a context window, in bytes.
 * 2 (K and V) x layers x kvHeads x headDim x context x bytesPerElement(f16 = 2)
 */
export function kvCacheBytes(profile, context) {
  const { layers, kvHeads, headDim } = profile.attention;
  return 2 * layers * kvHeads * headDim * context * 2;
}

/** Total memory a profile needs at a given context. */
export function requiredBytes(profile, context = profile.recommendedContext) {
  return profile.downloadBytes + kvCacheBytes(profile, context) + RUNTIME_OVERHEAD_BYTES;
}

export const models = [
  {
    id: "qwen25-coder-7b-q4km",
    displayName: "Qwen2.5 Coder 7B",
    publisher: "Alibaba Qwen",
    sourceUrl: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
    sourceRevision: "main",
    licenseId: "Apache-2.0",
    runtime: "llama.cpp",
    format: "GGUF",
    quantization: "Q4_K_M",
    parameterCount: 7.6e9,
    downloadBytes: Math.round(4.68 * GB),
    installedBytes: Math.round(4.68 * GB),
    checksum: null,
    contextOptions: [8192, 16384, 32768],
    recommendedContext: 16384,
    gpuOffloadLayers: "auto",
    attention: { layers: 28, kvHeads: 4, headDim: 128 },
    supportedArchitectures: ["x86_64", "arm64"],
    tasks: ["coding", "tool-use"],
    strength: "Quick single-file edits, short scripts and focused fixes.",
    limitation: "Loses the thread on refactors that span many files.",
    verifiedAt: null,
    verificationHardware: [],
    measuredTokensPerSecond: [],
    installed: true,
    loaded: false,
  },
  {
    id: "qwen25-coder-14b-q4km",
    displayName: "Qwen2.5 Coder 14B",
    publisher: "Alibaba Qwen",
    sourceUrl: "https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct-GGUF",
    sourceRevision: "main",
    licenseId: "Apache-2.0",
    runtime: "llama.cpp",
    format: "GGUF",
    quantization: "Q4_K_M",
    parameterCount: 14.7e9,
    downloadBytes: Math.round(8.99 * GB),
    installedBytes: Math.round(8.99 * GB),
    checksum: null,
    contextOptions: [8192, 16384, 32768],
    recommendedContext: 16384,
    gpuOffloadLayers: "auto",
    attention: { layers: 48, kvHeads: 8, headDim: 128 },
    supportedArchitectures: ["x86_64", "arm64"],
    tasks: ["coding", "tool-use"],
    strength: "Multi-file edits, running commands, tests and previews.",
    limitation: "Slower than the 7B on trivial one-line changes.",
    verifiedAt: null,
    verificationHardware: [],
    measuredTokensPerSecond: [],
    installed: true,
    loaded: true,
    recommended: true,
  },
  {
    id: "deepseek-coder-v2-lite-q4km",
    downloading: true,
    displayName: "DeepSeek-Coder-V2 Lite 16B",
    publisher: "DeepSeek",
    sourceUrl: "https://huggingface.co/bartowski/DeepSeek-Coder-V2-Lite-Instruct-GGUF",
    sourceRevision: "main",
    licenseId: "DeepSeek License",
    runtime: "llama.cpp",
    format: "GGUF",
    quantization: "Q4_K_M",
    parameterCount: 15.7e9,
    downloadBytes: Math.round(10.36 * GB),
    installedBytes: Math.round(10.36 * GB),
    checksum: null,
    contextOptions: [8192, 16384, 32768],
    recommendedContext: 16384,
    gpuOffloadLayers: "auto",
    attention: { layers: 27, kvHeads: 16, headDim: 128 },
    supportedArchitectures: ["x86_64", "arm64"],
    tasks: ["coding", "tool-use"],
    strength: "Reading an unfamiliar codebase and explaining it back.",
    limitation: "Mixture-of-experts loading makes the first response slower.",
    verifiedAt: null,
    verificationHardware: [],
    measuredTokensPerSecond: [],
    installed: false,
    loaded: false,
  },
  {
    id: "qwen25-coder-32b-q4km",
    displayName: "Qwen2.5 Coder 32B",
    publisher: "Alibaba Qwen",
    sourceUrl: "https://huggingface.co/Qwen/Qwen2.5-Coder-32B-Instruct-GGUF",
    sourceRevision: "main",
    licenseId: "Apache-2.0",
    runtime: "llama.cpp",
    format: "GGUF",
    quantization: "Q4_K_M",
    parameterCount: 32.8e9,
    downloadBytes: Math.round(19.85 * GB),
    installedBytes: Math.round(19.85 * GB),
    checksum: null,
    contextOptions: [8192, 16384, 32768],
    recommendedContext: 16384,
    gpuOffloadLayers: "auto",
    attention: { layers: 64, kvHeads: 8, headDim: 128 },
    supportedArchitectures: ["x86_64", "arm64"],
    tasks: ["coding", "tool-use"],
    strength: "Longer plans and wider context on a machine with room for it.",
    limitation: "Needs about 20 GB of weights alone. On a 12 GB card most layers run on the CPU.",
    verifiedAt: null,
    verificationHardware: [],
    measuredTokensPerSecond: [],
    installed: false,
    loaded: false,
  },
  {
    id: "llama33-70b-q4km",
    displayName: "Llama 3.3 70B",
    publisher: "Meta",
    sourceUrl: "https://huggingface.co/bartowski/Llama-3.3-70B-Instruct-GGUF",
    sourceRevision: "main",
    licenseId: "Llama 3.3 Community License",
    runtime: "llama.cpp",
    format: "GGUF",
    quantization: "Q4_K_M",
    parameterCount: 70.6e9,
    downloadBytes: Math.round(42.52 * GB),
    installedBytes: Math.round(42.52 * GB),
    checksum: null,
    contextOptions: [8192, 16384],
    recommendedContext: 8192,
    gpuOffloadLayers: "auto",
    attention: { layers: 80, kvHeads: 8, headDim: 128 },
    supportedArchitectures: ["x86_64", "arm64"],
    tasks: ["general", "coding"],
    strength: "Reasoning over long, tangled tasks.",
    limitation: "42.5 GB of weights. This needs a workstation card or a lot of patience.",
    verifiedAt: null,
    verificationHardware: [],
    measuredTokensPerSecond: [],
    installed: false,
    loaded: false,
    // A failed download the Downloads page can show without inventing one in
    // its own markup. The reason is the one the disk check would produce.
    downloadFailed: {
      receivedBytes: Math.round(6.2 * GB),
      reason: "The disk had 19 GB free and this profile needs 42.5 GB. Free space or choose a smaller profile, then retry.",
    },
  },
  {
    id: "gemma2-9b-q4km",
    displayName: "Gemma 2 9B",
    publisher: "Google",
    sourceUrl: "https://huggingface.co/bartowski/gemma-2-9b-it-GGUF",
    sourceRevision: "main",
    licenseId: "Gemma Terms of Use",
    runtime: "llama.cpp",
    format: "GGUF",
    quantization: "Q4_K_M",
    parameterCount: 9.2e9,
    downloadBytes: Math.round(5.76 * GB),
    installedBytes: Math.round(5.76 * GB),
    checksum: null,
    contextOptions: [4096, 8192],
    recommendedContext: 8192,
    gpuOffloadLayers: "auto",
    attention: { layers: 42, kvHeads: 8, headDim: 256 },
    supportedArchitectures: ["x86_64", "arm64"],
    tasks: ["general"],
    strength: "Writing and explanation.",
    limitation: "Not verified for the agent's tool-call format. Not offered for coding.",
    verifiedAt: null,
    verificationHardware: [],
    measuredTokensPerSecond: [],
    installed: false,
    loaded: false,
  },
];

export const byId = (id) => models.find((m) => m.id === id);
