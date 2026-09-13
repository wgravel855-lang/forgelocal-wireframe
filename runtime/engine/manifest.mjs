// @ts-check
/**
 * Which llama.cpp build ForgeLocal runs, and how to recognise it.
 *
 * ForgeLocal runs its own inference engine. LM Studio is an optional external
 * provider and nothing here depends on it — in particular nothing reads the
 * `llama-server.exe` inside LM Studio's backends folder, which is a 20KB
 * launcher that needs LM Studio's own libraries beside it.
 *
 * **The engine is downloaded on first run, not bundled.** Two reasons, and the
 * second is the one that settles it. The engine is hardware-specific: a CUDA
 * build is useless on a machine with an AMD card, and the right build depends
 * on what the probe finds. And the sizes are not close — the CUDA 12.4 engine
 * is 254MB and needs a 391MB CUDA runtime beside it, so bundling the NVIDIA
 * path alone would mean a 645MB installer that most people would be
 * downloading for nothing. Downloading one 32MB build the machine can actually
 * use is both smaller and more correct. Model weights are never bundled
 * either; that is a separate thing the person chooses.
 *
 * **About the checksums.** llama.cpp publishes no SHASUMS file, but GitHub
 * computes and serves a SHA-256 `digest` for every release asset through its
 * API, and the values below were copied from it. That is a checksum GitHub
 * vouches for against the bytes it stores, not one we recorded after
 * downloading — so it does detect a tampered or truncated transfer, and it
 * does pin this exact artifact. It is not a signature from the llama.cpp
 * maintainers, because there isn't one to have: it says "this is the file
 * GitHub is serving for tag b10936", not "the maintainers meant to publish
 * this". That is a real limit and it is worth knowing, but it is a long way
 * from the unverified download this used to be.
 */

import { readFileSync } from "node:fs";

/**
 * The pinned build.
 *
 * llama.cpp tags releases `b<number>`. Moving this is a deliberate act: a
 * different build is a different engine, with different flags and different
 * bugs, and every hash below belongs to this tag alone. Re-record them all
 * with `node scripts/fetch-engine.mjs --record` when it moves.
 */
export const ENGINE_BUILD = "b10936";

export const RELEASE_BASE =
  `https://github.com/ggml-org/llama.cpp/releases/download/${ENGINE_BUILD}`;

/**
 * @typedef {object} EngineAsset
 * @property {string} id          how the interface names this build
 * @property {string} label       what a person reading a menu sees
 * @property {string} asset       the exact file name in the release
 * @property {string} accel       "cuda" | "vulkan" | "cpu" | "metal" | "rocm"
 * @property {string|null} sha256 from GitHub's asset digest, or null
 * @property {number} bytes       the download size, so a person can be told
 * @property {string} note        what this build needs to run
 * @property {{asset: string, sha256: string, bytes: number}} [companion]
 *   a second archive this build cannot run without
 */

/**
 * The builds worth offering, per platform.
 *
 * Not every asset upstream publishes. A menu with nine entries where seven
 * differ by a CUDA minor version is a menu nobody can choose from, so this
 * lists the ones that answer a real question: do you have an NVIDIA card, any
 * other GPU, or neither.
 *
 * Sizes and hashes are from GitHub's release API for tag b10936, read on
 * 2026-09-12.
 *
 * @type {Record<string, EngineAsset[]>}
 */
export const ENGINE_BUILDS = Object.freeze({
  "win32-x64": [
    {
      id: "cuda12",
      label: "NVIDIA (CUDA 12)",
      asset: `llama-${ENGINE_BUILD}-bin-win-cuda-12.4-x64.zip`,
      accel: "cuda",
      sha256: "2f3a9614429afedb9979bdcc919bbf9e8225a421f35d43442a8c76e34bb71748",
      bytes: 254_100_000,
      note: "Needs an NVIDIA GPU and a driver supporting CUDA 12.4.",
      /* The engine zip carries no CUDA runtime. Without this beside it,
         llama-server.exe fails to start with a missing-DLL error that says
         nothing about CUDA — so the companion is part of the download rather
         than a thing to discover later. */
      companion: {
        asset: "cudart-llama-bin-win-cuda-12.4-x64.zip",
        sha256: "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6",
        bytes: 391_400_000,
      },
    },
    {
      id: "cuda13",
      label: "NVIDIA (CUDA 13)",
      asset: `llama-${ENGINE_BUILD}-bin-win-cuda-13.3-x64.zip`,
      accel: "cuda",
      sha256: "ef272cc0a7679b3a9b8643b81dcfa823e7f04f134be7b1e02d1760e0a2683f53",
      bytes: 149_700_000,
      note: "Needs an NVIDIA GPU and a recent driver supporting CUDA 13.3.",
      companion: {
        asset: "cudart-llama-bin-win-cuda-13.3-x64.zip",
        sha256: "1462a050eb4c684921ba51dcc4cc488a036674c3e73e9945ee705b854808d03e",
        bytes: 391_000_000,
      },
    },
    {
      id: "vulkan",
      label: "Any GPU (Vulkan)",
      asset: `llama-${ENGINE_BUILD}-bin-win-vulkan-x64.zip`,
      accel: "vulkan",
      sha256: "156093831ceded51c3929ad8c1bf5daca86b60761d43dd98b3752df9c6336b25",
      bytes: 31_700_000,
      note: "Works on AMD, Intel and NVIDIA, and needs no CUDA runtime. "
        + "Usually slower than CUDA on NVIDIA, and a twentieth of the download.",
    },
    {
      id: "cpu",
      label: "Processor only",
      asset: `llama-${ENGINE_BUILD}-bin-win-cpu-x64.zip`,
      accel: "cpu",
      sha256: "45ad8088c9d007c3f9b9ccf6d28cc4b9d0caf94f4b8b4feae417898fa92690bf",
      bytes: 18_400_000,
      note: "No GPU needed. Much slower, and the only option on some machines.",
    },
  ],

  /* Below this line: recorded, not supported.
   *
   * This milestone builds and tests one installer, for Windows x64. These
   * entries are real assets with real digests, so the machinery is not
   * Windows-only by construction — but nobody has run ForgeLocal from an
   * installer on any of them, and claiming otherwise in a menu would be a
   * claim about testing that has not happened. isSupportedPlatform below is
   * what the interface asks. */
  "darwin-arm64": [
    {
      id: "metal",
      label: "Apple silicon",
      asset: `llama-${ENGINE_BUILD}-bin-macos-arm64.tar.gz`,
      accel: "metal",
      sha256: "7b00e5a3f3556fa95d7ade8a4a354932c5ef19841faf0016d76475876494448f",
      bytes: 11_100_000,
      note: "Uses the GPU through Metal. The only build for Apple silicon.",
    },
  ],
  "darwin-x64": [
    {
      id: "cpu",
      label: "Intel Mac",
      asset: `llama-${ENGINE_BUILD}-bin-macos-x64.tar.gz`,
      accel: "cpu",
      sha256: "2f385c4ebaa37d86aad15e7fe5de67d49fd3c772b42ee06cf28feeb6d5a30ce6",
      bytes: 11_200_000,
      note: "Processor only.",
    },
  ],
  "linux-x64": [
    {
      id: "vulkan",
      label: "Any GPU (Vulkan)",
      asset: `llama-${ENGINE_BUILD}-bin-ubuntu-vulkan-x64.tar.gz`,
      accel: "vulkan",
      sha256: "929b3ccf30903ce8e2932b84779f8bba0fafe64729b9f47821765357574a6d17",
      bytes: 30_200_000,
      note: "Works on AMD, Intel and NVIDIA.",
    },
    {
      id: "cpu",
      label: "Processor only",
      asset: `llama-${ENGINE_BUILD}-bin-ubuntu-x64.tar.gz`,
      accel: "cpu",
      sha256: "83e3ac374d188e2ea76d8f138e2dbd993ab6fc52b22a74020b03d86c829f3631",
      bytes: 16_800_000,
      note: "No GPU needed.",
    },
  ],
});

/**
 * The platforms this milestone actually ships an installer for.
 *
 * One. Everything else has assets recorded and no tested path, and the
 * difference matters to somebody deciding whether to trust it.
 */
export const SUPPORTED_PLATFORMS = Object.freeze(["win32-x64"]);

/** @param {string} [platform] @param {string} [arch] */
export function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

/** @param {string} [platform] @param {string} [arch] */
export function isSupportedPlatform(platform, arch) {
  return SUPPORTED_PLATFORMS.includes(platformKey(platform, arch));
}

/**
 * Hashes recorded locally, for a build whose digest GitHub does not serve.
 *
 * Every asset above now carries a digest from GitHub's API, so this is a
 * fallback rather than the main path — it exists for a mirror, or an asset
 * whose digest is missing, and it is scoped to the pinned tag so a hash
 * recorded for b10800 can never pass for b10936.
 *
 * Missing or unreadable means nothing is recorded. Failing towards
 * "unverified" is the safe direction, because the caller refuses to install
 * anything it cannot check.
 *
 * @returns {Record<string, string>}
 */
export function recordedHashes() {
  try {
    const url = new URL("./recorded-hashes.json", import.meta.url);
    const raw = readFileSync(url, "utf8");
    const all = JSON.parse(raw);
    const forBuild = all && all[ENGINE_BUILD];
    return forBuild && typeof forBuild === "object" ? forBuild : {};
  } catch { return {}; }
}

/**
 * The builds available for this machine, or an empty list.
 *
 * An empty list is a real answer — a 32-bit Windows box or a Linux ARM board
 * has no build here — and the caller says so rather than offering a download
 * that cannot run.
 *
 * @param {string} [platform] @param {string} [arch]
 */
export function buildsFor(platform, arch) {
  const hashes = recordedHashes();
  const key = platformKey(platform, arch);
  return (ENGINE_BUILDS[key] ?? []).map((b) => ({
    ...b, sha256: b.sha256 ?? hashes[`${key}:${b.id}`] ?? null,
  }));
}

/**
 * Which build to suggest, given what the hardware probe found.
 *
 * Only ever a suggestion: the person picks, because the probe can be wrong
 * about a driver in a way it cannot detect, and a CUDA build on a machine with
 * a too-old driver fails at launch rather than at download.
 *
 * NVIDIA gets Vulkan rather than CUDA, which is worth explaining. CUDA is
 * faster, and it is also a 645MB download that fails at startup on a driver
 * that turns out to be too old, on a machine whose owner has not yet seen the
 * app work once. Vulkan is 32MB, runs on the same card, needs no runtime
 * beside it, and is offered in the same list for anyone who wants the speed.
 * First run is the wrong moment to spend twenty times the bytes on a bet.
 *
 * @param {any} hw  the hardware profile, or null when nothing is known
 * @param {string} [platform] @param {string} [arch]
 * @returns {EngineAsset|null}
 */
export function suggestBuild(hw, platform, arch) {
  const builds = buildsFor(platform, arch);
  if (!builds.length) return null;

  const vendor = String(hw?.gpu?.vendor ?? "").toLowerCase();
  const pick = (id) => builds.find((b) => b.id === id);

  if (vendor === "apple") return pick("metal") ?? builds[0];
  if (vendor === "nvidia" || vendor === "amd" || vendor === "intel") {
    return pick("vulkan") ?? pick("cpu") ?? builds[0];
  }
  // Nothing known about the GPU. The processor build runs everywhere, which is
  // the right default when the alternative is a download that cannot start.
  return pick("cpu") ?? builds[0];
}

/** The executable inside the archive, per platform. @param {string} [platform] */
export function executableName(platform = process.platform) {
  return platform === "win32" ? "llama-server.exe" : "llama-server";
}

/**
 * Everything one build needs downloaded, main archive first.
 *
 * A CUDA build is two archives, and treating that as one download with a
 * companion rather than as "the engine, and also a thing that went wrong
 * later" is the difference between a progress bar that is honest about what it
 * is doing and one that finishes before the engine can start.
 *
 * @param {EngineAsset} build
 * @returns {{asset: string, sha256: string|null, bytes: number, url: string}[]}
 */
export function partsFor(build) {
  const parts = [{
    asset: build.asset, sha256: build.sha256, bytes: build.bytes,
    url: `${RELEASE_BASE}/${build.asset}`,
  }];
  if (build.companion) {
    parts.push({
      asset: build.companion.asset, sha256: build.companion.sha256,
      bytes: build.companion.bytes,
      url: `${RELEASE_BASE}/${build.companion.asset}`,
    });
  }
  return parts;
}

/** Total bytes for a build, companion included. @param {EngineAsset} build */
export function totalBytes(build) {
  return partsFor(build).reduce((n, p) => n + p.bytes, 0);
}
