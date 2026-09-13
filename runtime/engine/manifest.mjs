// @ts-check
/**
 * Which llama.cpp build ForgeLocal ships, and how to recognise it.
 *
 * ForgeLocal runs its own inference engine. LM Studio is an optional external
 * provider and nothing here depends on it — in particular nothing reads the
 * `llama-server.exe` inside LM Studio's backends folder, which is a 20KB
 * launcher that needs LM Studio's own libraries beside it.
 *
 * **The engine binary is not in this repository.** It is 100–400MB depending
 * on the acceleration build, and committing that to git would make every clone
 * pay for it. It is fetched by `scripts/fetch-engine.mjs` into
 * `desktop/src-tauri/binaries/`, where Tauri's `externalBin` picks it up and
 * puts it in the installer. Model weights are never bundled — that is a
 * separate thing the user downloads, and it is not this.
 *
 * **About the checksum.** llama.cpp publishes no checksum file with its
 * releases; the assets are the only thing there. So a hash here is one
 * somebody recorded after fetching, not one upstream vouched for, and the
 * script says so. With no hash recorded the script refuses to install unless
 * the person explicitly accepts the risk, and then records what it got so the
 * next fetch is verified against the first. That is weaker than a signature
 * and it is described as what it is rather than dressed up as verification.
 */

import { readFileSync } from "node:fs";

/**
 * The pinned build.
 *
 * llama.cpp tags releases `b<number>`. Moving this is a deliberate act: a
 * different build is a different engine, with different flags and different
 * bugs, and every recorded hash below belongs to this tag alone.
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
 * @property {string|null} sha256 recorded on a previous fetch, or null
 * @property {string} note        what this build needs to run
 */

/**
 * The builds worth offering, per platform.
 *
 * Not every asset upstream publishes. A menu with nine entries where seven
 * differ by a CUDA minor version is a menu nobody can choose from, so this
 * lists the ones that answer a real question: do you have an NVIDIA card, any
 * other GPU, or neither.
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
      sha256: null,
      note: "Needs an NVIDIA GPU and a driver supporting CUDA 12.4.",
    },
    {
      id: "cuda13",
      label: "NVIDIA (CUDA 13)",
      asset: `llama-${ENGINE_BUILD}-bin-win-cuda-13.3-x64.zip`,
      accel: "cuda",
      sha256: null,
      note: "Needs an NVIDIA GPU and a recent driver supporting CUDA 13.3.",
    },
    {
      id: "vulkan",
      label: "Any GPU (Vulkan)",
      asset: `llama-${ENGINE_BUILD}-bin-win-vulkan-x64.zip`,
      accel: "vulkan",
      note: "Works on AMD, Intel and NVIDIA. Usually slower than CUDA on NVIDIA.",
      sha256: null,
    },
    {
      id: "cpu",
      label: "Processor only",
      asset: `llama-${ENGINE_BUILD}-bin-win-cpu-x64.zip`,
      accel: "cpu",
      sha256: null,
      note: "No GPU needed. Much slower, and the only option on some machines.",
    },
  ],
  "darwin-arm64": [
    {
      id: "metal",
      label: "Apple silicon",
      asset: `llama-${ENGINE_BUILD}-bin-macos-arm64.tar.gz`,
      accel: "metal",
      sha256: null,
      note: "Uses the GPU through Metal. The only build for Apple silicon.",
    },
  ],
  "darwin-x64": [
    {
      id: "cpu",
      label: "Intel Mac",
      asset: `llama-${ENGINE_BUILD}-bin-macos-x64.tar.gz`,
      accel: "cpu",
      sha256: null,
      note: "Processor only.",
    },
  ],
  "linux-x64": [
    {
      id: "vulkan",
      label: "Any GPU (Vulkan)",
      asset: `llama-${ENGINE_BUILD}-bin-ubuntu-vulkan-x64.tar.gz`,
      accel: "vulkan",
      sha256: null,
      note: "Works on AMD, Intel and NVIDIA.",
    },
    {
      id: "cpu",
      label: "Processor only",
      asset: `llama-${ENGINE_BUILD}-bin-ubuntu-x64.tar.gz`,
      accel: "cpu",
      sha256: null,
      note: "No GPU needed.",
    },
  ],
});

/**
 * Hashes recorded by a previous fetch.
 *
 * Kept beside the manifest rather than inside it so the fetch script never
 * rewrites source code. A script that edits the module it imports is one
 * bad regular expression away from corrupting the thing it is checking, and
 * the failure would look like a checksum mismatch.
 *
 * Missing or unreadable means nothing is recorded, which is the state that
 * makes the script refuse to install. Failing towards "unverified" is the
 * safe direction.
 *
 * @returns {Record<string, string>}
 */
export function recordedHashes() {
  try {
    const url = new URL("./recorded-hashes.json", import.meta.url);
    const raw = readFileSync(url, "utf8");
    const all = JSON.parse(raw);
    /* Scoped to the pinned build. A hash recorded for b10800 says nothing
       about b10936, and reusing it across tags would be a checksum that
       passes for the wrong file. */
    const forBuild = all && all[ENGINE_BUILD];
    return forBuild && typeof forBuild === "object" ? forBuild : {};
  } catch { return {}; }
}

/** @param {string} [platform] @param {string} [arch] */
export function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
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
 * @param {any} hw  the hardware profile, or null when nothing is known
 * @param {string} [platform] @param {string} [arch]
 * @returns {EngineAsset|null}
 */
export function suggestBuild(hw, platform, arch) {
  const builds = buildsFor(platform, arch);
  if (!builds.length) return null;

  const vendor = String(hw?.gpu?.vendor ?? "").toLowerCase();
  const pick = (id) => builds.find((b) => b.id === id);

  if (vendor === "nvidia") return pick("cuda12") ?? pick("vulkan") ?? builds[0];
  if (vendor === "amd" || vendor === "intel") return pick("vulkan") ?? pick("cpu") ?? builds[0];
  if (vendor === "apple") return pick("metal") ?? builds[0];
  // Nothing known about the GPU. The processor build runs everywhere, which is
  // the right default when the alternative is a download that cannot start.
  return pick("cpu") ?? builds[0];
}

/** The executable inside the archive, per platform. */
export function executableName(platform = process.platform) {
  return platform === "win32" ? "llama-server.exe" : "llama-server";
}

/**
 * Where the bundler expects to find it.
 *
 * Tauri's externalBin appends the Rust target triple and, on Windows, `.exe`.
 * @param {string} [platform] @param {string} [arch]
 */
export function targetTriple(platform = process.platform, arch = process.arch) {
  const cpu = arch === "arm64" ? "aarch64" : "x86_64";
  if (platform === "win32") return `${cpu}-pc-windows-msvc`;
  if (platform === "darwin") return `${cpu}-apple-darwin`;
  return `${cpu}-unknown-linux-gnu`;
}
