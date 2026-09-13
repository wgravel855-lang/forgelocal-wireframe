// @ts-check
/**
 * Getting an engine onto the machine, on first run.
 *
 * The installer does not carry one. The engine is hardware-specific and the
 * NVIDIA path is 645MB, so bundling would mean most people downloading most of
 * an installer for a build they cannot use. Instead the app works out what this
 * machine can run, says what it is about to fetch and how big it is, and
 * fetches that.
 *
 * What this file is careful about:
 *
 * **A half-installed engine must not look installed.** Everything lands in a
 * staging directory and is moved into place only once the archive verified and
 * the executable is actually present. A download interrupted at 90% leaves a
 * partial file in staging and an install directory that still does not exist,
 * which reads correctly as "no engine" rather than as an engine that crashes.
 *
 * **An upgrade must not destroy the thing that was working.** Versions live in
 * their own directories, named for the build and the acceleration. Installing
 * b11000 does not touch b10936, so a new engine that turns out to be broken is
 * a matter of pointing back at the old one rather than of downloading the old
 * one again.
 *
 * **Nothing unverified is ever installed.** Every asset has a SHA-256 in the
 * manifest, taken from GitHub's release API. There is no flag to skip it. The
 * engine is the process that will be executing on this machine for the rest of
 * the session; it is the wrong place to offer an escape hatch.
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir, rm, stat, rename, readdir, readFile, writeFile, copyFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  ENGINE_BUILD, buildsFor, executableName, partsFor, platformKey, suggestBuild, totalBytes,
} from "./manifest.mjs";

/**
 * Hosts an engine download may talk to.
 *
 * GitHub redirects release downloads to its object store, so both are needed,
 * and the check is re-applied at every hop rather than only at the start —
 * a redirect to somewhere else is how an allowlist that only checks the first
 * URL gets walked around.
 */
export const ENGINE_HOSTS = Object.freeze([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

/**
 * Where engines live, per user.
 *
 * Beside the session store rather than beside the application, because the
 * application directory is under Program Files on Windows and writing there
 * needs administrator rights the app does not have and should not ask for.
 *
 * @param {NodeJS.ProcessEnv} [env] @param {string} [platform]
 */
export function engineRoot(env = process.env, platform = process.platform) {
  if (env.FORGELOCAL_ENGINE_DIR) return env.FORGELOCAL_ENGINE_DIR;
  const home = env.USERPROFILE || env.HOME || ".";
  if (platform === "win32") {
    return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "ForgeLocal", "engines");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "ForgeLocal", "engines");
  }
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "forgelocal", "engines");
}

/** One build's directory name. Build and acceleration, so both can coexist. */
export function engineDirName(build, id) {
  return `${build}-${id}`;
}

/** @param {string} p */
async function sizeOf(p) {
  try { return (await stat(p)).size; } catch { return 0; }
}

/** @param {string} p */
async function sha256File(p) {
  const h = createHash("sha256");
  await pipeline(createReadStream(p), h);
  return h.digest("hex");
}

/**
 * What is installed, newest-looking first.
 *
 * Reads the directory rather than a registry of what we think we installed.
 * A record can disagree with the disk; the disk cannot disagree with itself.
 *
 * @param {{env?: NodeJS.ProcessEnv, platform?: string}} [opts]
 */
export async function listEngines(opts = {}) {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const root = engineRoot(env, platform);
  const exe = executableName(platform);
  /** @type {{dir: string, build: string, id: string, exe: string, bytes: number, installedAt: string|null}[]} */
  const out = [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return out; }

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    /* Staging is dot-prefixed, and holds a real executable for the moment
       between "unpacked" and "installed". Listing it would mean a download
       interrupted in that window leaves something the app would then try to
       run out of a directory it is about to delete. */
    if (e.name.startsWith(".")) continue;
    const dir = join(root, e.name);
    const path = join(dir, exe);
    const bytes = await sizeOf(path);
    if (!bytes) continue;                         // staging, or a failed install
    const dash = e.name.indexOf("-");
    let installedAt = null;
    try {
      const meta = JSON.parse(await readFile(join(dir, "engine.json"), "utf8"));
      installedAt = meta.installedAt ?? null;
    } catch { /* an engine without its note is still an engine */ }
    out.push({
      dir,
      build: dash > 0 ? e.name.slice(0, dash) : e.name,
      id: dash > 0 ? e.name.slice(dash + 1) : "",
      exe: path,
      bytes,
      installedAt,
    });
  }
  out.sort((a, b) => String(b.installedAt ?? "").localeCompare(String(a.installedAt ?? "")));
  return out;
}

/**
 * The engine to run, or null.
 *
 * Prefers the pinned build, then anything else installed. The fallback is the
 * rollback story: an app updated to a new pinned build that has not been
 * downloaded yet still starts on the engine that was already working, instead
 * of reporting no engine because the version number moved.
 *
 * @param {{env?: NodeJS.ProcessEnv, platform?: string}} [opts]
 */
export async function currentEngine(opts = {}) {
  const all = await listEngines(opts);
  return all.find((e) => e.build === ENGINE_BUILD) ?? all[0] ?? null;
}

/** Refuse anything that is not a release asset on an allowed host. */
export function checkEngineUrl(url) {
  let u;
  try { u = new URL(url); } catch { return "That is not a URL."; }
  if (u.protocol !== "https:") return "Engine downloads must use https.";
  if (!ENGINE_HOSTS.includes(u.hostname)) {
    return `Engines are only downloaded from ${ENGINE_HOSTS.join(", ")}, not ${u.hostname}.`;
  }
  return null;
}

/**
 * Fetch, re-checking the host at every redirect.
 *
 * @param {string} url @param {{signal?: AbortSignal}} [opts]
 */
async function fetchFollowing(url, opts = {}) {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const bad = checkEngineUrl(current);
    if (bad) throw new Error(bad);
    const res = await fetch(current, { redirect: "manual", signal: opts.signal });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new Error(`${current} redirected with no destination.`);
      current = new URL(next, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`${current} returned HTTP ${res.status}.`);
    return res;
  }
  throw new Error("Too many redirects while fetching the engine.");
}

/**
 * Download one asset into staging and verify it.
 *
 * @param {{url: string, asset: string, sha256: string|null, bytes: number}} part
 * @param {string} into
 * @param {{onProgress?: (n: number, total: number) => void, signal?: AbortSignal}} opts
 */
async function fetchPart(part, into, opts) {
  if (!part.sha256) {
    throw new Error(
      `No checksum is recorded for ${part.asset}, so it cannot be verified. `
      + "Nothing unverified is installed as an engine.");
  }
  const dest = join(into, part.asset);

  /* Already here and still correct is already downloaded. This is what makes a
     retry after a failed unpack cheap, and what makes a second install of the
     same CUDA build skip the 391MB runtime it already has. */
  if (await sizeOf(dest) && await sha256File(dest) === part.sha256) return dest;

  const tmp = `${dest}.part`;
  await rm(tmp, { force: true });
  const res = await fetchFollowing(part.url, { signal: opts.signal });

  const total = Number(res.headers.get("content-length")) || part.bytes;
  let seen = 0;
  const body = Readable.fromWeb(/** @type {any} */ (res.body));
  body.on("data", (c) => {
    seen += c.length;
    if (opts.onProgress) opts.onProgress(seen, total);
  });
  await pipeline(body, createWriteStream(tmp));

  const got = await sha256File(tmp);
  if (got !== part.sha256) {
    await rm(tmp, { force: true });
    throw new Error(
      `${part.asset} did not match its published checksum and was discarded.\n`
      + `  expected ${part.sha256}\n  got      ${got}`);
  }
  await rename(tmp, dest);
  return dest;
}

/** Run a command, resolving with its exit code rather than throwing. */
function run(exe, argv, cwd) {
  return new Promise((resolve) => {
    const c = spawn(exe, argv, { cwd, stdio: "ignore", windowsHide: true });
    c.on("error", () => resolve(-1));
    c.on("close", (code) => resolve(code ?? -1));
  });
}

/** Unpack an archive into a directory, by type rather than by hope. */
async function unpack(archive, into, platform) {
  await mkdir(into, { recursive: true });
  if (archive.endsWith(".zip")) {
    if (platform === "win32") {
      /* Expand-Archive is part of Windows PowerShell, so it is on every
         Windows machine. tar.exe also reads zip, but whether `tar` resolves to
         that bsdtar or to a GNU tar from Git for Windows is not knowable from
         here, and GNU tar answers a zip with "this does not look like a tar
         archive". */
      const code = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command",
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${into}' -Force`]);
      if (code !== 0) throw new Error(`Could not unpack ${basename(archive)} (exit ${code}).`);
      return;
    }
    const code = await run("unzip", ["-oq", basename(archive), "-d", into], dirname(archive));
    if (code !== 0) throw new Error(`Could not unpack ${basename(archive)} (exit ${code}).`);
    return;
  }
  /* Relative, because bsdtar reads an argument containing a colon as
     host:path and tries to resolve "C" as a hostname. */
  const code = await run("tar", ["-xf", basename(archive), "-C", into], dirname(archive));
  if (code !== 0) throw new Error(`Could not unpack ${basename(archive)} (exit ${code}).`);
}

/** Find the server executable anywhere under a directory. */
async function findExe(dir, name, depth = 4) {
  if (depth < 0) return null;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (e.isFile() && e.name === name) return join(dir, e.name);
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const found = await findExe(join(dir, e.name), name, depth - 1);
    if (found) return found;
  }
  return null;
}

/** Everything beside the executable, which for CUDA is most of what matters. */
async function copyFlat(from, into) {
  let n = 0;
  for (const e of await readdir(from, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    await copyFile(join(from, e.name), join(into, e.name));
    n++;
  }
  return n;
}

/**
 * Install one build.
 *
 * @param {object} opts
 * @param {string} [opts.id]         which build; the suggestion when omitted
 * @param {any} [opts.hardware]      what the probe found, for the suggestion
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.platform]
 * @param {string} [opts.arch]
 * @param {(e: {phase: string, asset?: string, done?: number, total?: number, message?: string}) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 */
export async function installEngine(opts = {}) {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const emit = opts.onProgress ?? (() => {});

  const builds = buildsFor(platform, arch);
  if (!builds.length) {
    throw new Error(
      `No engine is published for ${platformKey(platform, arch)}, so ForgeLocal `
      + "cannot run a model on this machine.");
  }
  const build = opts.id
    ? builds.find((b) => b.id === opts.id)
    : suggestBuild(opts.hardware ?? null, platform, arch);
  if (!build) {
    throw new Error(`There is no "${opts.id}" engine for ${platformKey(platform, arch)}.`);
  }

  const root = engineRoot(env, platform);
  const name = engineDirName(ENGINE_BUILD, build.id);
  const finalDir = join(root, name);
  const exeName = executableName(platform);

  /* Already installed and intact is already installed. */
  if (await sizeOf(join(finalDir, exeName))) {
    emit({ phase: "already", message: `${build.label} is already installed.` });
    return { dir: finalDir, exe: join(finalDir, exeName), build: ENGINE_BUILD, id: build.id, reused: true };
  }

  const staging = join(root, `.staging-${name}`);
  await mkdir(staging, { recursive: true });

  try {
    const parts = partsFor(build);
    const grandTotal = totalBytes(build);
    let before = 0;

    for (const part of parts) {
      emit({ phase: "download", asset: part.asset, done: before, total: grandTotal });
      const file = await fetchPart(part, staging, {
        signal: opts.signal,
        onProgress: (n) => emit({
          phase: "download", asset: part.asset, done: before + n, total: grandTotal,
        }),
      });
      before += part.bytes;
      emit({ phase: "unpack", asset: part.asset, done: before, total: grandTotal });
      await unpack(file, join(staging, "unpacked"), platform);
    }

    const found = await findExe(join(staging, "unpacked"), exeName);
    if (!found) {
      throw new Error(
        `${exeName} was not in the download. The release layout may have changed; `
        + "nothing was installed.");
    }

    /* Assembled in staging, moved once. The executable and everything beside it
       — for CUDA that is the runtime DLLs, which is most of the download — come
       from the same directory, because an engine without its libraries starts
       and then dies with a message about a missing DLL that says nothing about
       CUDA. */
    const assembled = join(staging, "assembled");
    await mkdir(assembled, { recursive: true });
    const copied = await copyFlat(dirname(found), assembled);

    /* A CUDA runtime unpacks to its own folder beside the engine's. Anything
       flat in the unpack root belongs beside the executable too. */
    const unpackedRoot = join(staging, "unpacked");
    if (dirname(found) !== unpackedRoot) await copyFlat(unpackedRoot, assembled);

    await writeFile(join(assembled, "engine.json"), `${JSON.stringify({
      build: ENGINE_BUILD, id: build.id, label: build.label, accel: build.accel,
      platform: platformKey(platform, arch),
      files: copied,
      installedAt: new Date().toISOString(),
      assets: parts.map((p) => ({ asset: p.asset, sha256: p.sha256 })),
    }, null, 2)}\n`);

    emit({ phase: "install", message: `Installing ${build.label}.` });
    await rm(finalDir, { recursive: true, force: true });
    await mkdir(dirname(finalDir), { recursive: true });
    await rename(assembled, finalDir);

    const exe = join(finalDir, exeName);
    if (!(await sizeOf(exe))) {
      await rm(finalDir, { recursive: true, force: true });
      throw new Error("The engine did not survive being installed; nothing was kept.");
    }

    emit({ phase: "done", message: `${build.label} is ready.` });
    return { dir: finalDir, exe, build: ENGINE_BUILD, id: build.id, reused: false };
  } finally {
    /* Staging goes whatever happened. On success it holds a duplicate; on
       failure it holds a partial download that must not be mistaken for one. */
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * Remove one installed engine.
 *
 * Refuses to remove the last one while another is not present, because an app
 * with no engine cannot answer anything and the person who clicked Remove
 * probably meant "remove the old one".
 *
 * @param {string} dirName @param {{env?: NodeJS.ProcessEnv, platform?: string}} [opts]
 */
export async function removeEngine(dirName, opts = {}) {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const all = await listEngines(opts);
  const target = all.find((e) => basename(e.dir) === dirName);
  if (!target) return { ok: false, reason: `No engine named ${dirName} is installed.` };
  if (all.length === 1) {
    return {
      ok: false,
      reason: "That is the only engine installed. Install another one first, "
        + "or ForgeLocal will have nothing to run a model with.",
    };
  }
  await rm(join(engineRoot(env, platform), dirName), { recursive: true, force: true });
  return { ok: true };
}
