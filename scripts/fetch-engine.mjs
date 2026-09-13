#!/usr/bin/env node
// @ts-check
/**
 * Put the inference engine where the bundler will find it.
 *
 *   node scripts/fetch-engine.mjs [--build <id>] [--accept-unverified] [--list]
 *
 * This is a build step, not something the app does. The binary is 100–400MB
 * and belongs in the installer, so it is fetched once by whoever builds the
 * installer and never by a user at runtime.
 *
 * **What it will and will not do.** It downloads one asset from the pinned
 * llama.cpp release, checks it against the hash recorded in the manifest, and
 * extracts the server binary into desktop/src-tauri/binaries/. If no hash is
 * recorded it stops and says so: llama.cpp publishes no checksums, so a first
 * fetch cannot be verified against anything, and running an unverified
 * executable is a decision for a person rather than a default. Passing
 * --accept-unverified takes that decision, and the hash is recorded afterwards
 * so every later fetch is checked against the first.
 *
 * It never downloads model weights. Those are a separate, larger thing the
 * user chooses, and they are not in any installer.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, createReadStream, renameSync, chmodSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  ENGINE_BUILD, RELEASE_BASE, buildsFor, executableName, targetTriple, platformKey,
} from "../runtime/engine/manifest.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const OUT = join(root, "desktop", "src-tauri", "binaries");
const CACHE = join(root, ".forgelocal", "engine-cache");
const HASHES = join(root, "runtime", "engine", "recorded-hashes.json");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};

const builds = buildsFor();
if (!builds.length) {
  console.error(`No llama.cpp build is published for ${platformKey()}.`);
  console.error("ForgeLocal cannot run its own engine on this platform. LM Studio");
  console.error("or another OpenAI-compatible server can still be used.");
  process.exit(2);
}

if (flag("--list")) {
  console.log(`llama.cpp ${ENGINE_BUILD} — builds for ${platformKey()}:\n`);
  for (const b of builds) {
    console.log(`  ${b.id.padEnd(8)} ${b.label}`);
    console.log(`  ${" ".repeat(8)} ${b.note}`);
    console.log(`  ${" ".repeat(8)} ${b.asset}`);
    console.log(`  ${" ".repeat(8)} sha256: ${b.sha256 ?? "not recorded"}\n`);
  }
  process.exit(0);
}

const wanted = opt("--build") ?? builds[0].id;
const build = builds.find((b) => b.id === wanted);
if (!build) {
  console.error(`No build called "${wanted}". Run with --list to see the options.`);
  process.exit(2);
}

/* ------------------------------------------------------------------ fetch */

mkdirSync(CACHE, { recursive: true });
const archive = join(CACHE, build.asset);
const url = `${RELEASE_BASE}/${build.asset}`;

/** @param {number} n */
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

/**
 * Download with resume.
 *
 * A 400MB download over a domestic connection fails often enough that
 * restarting from zero is a real cost. A partial file is kept and continued
 * with a Range request; a server that ignores Range is detected by the status
 * code rather than assumed to have honoured it, because appending a fresh
 * 200 response onto a partial file produces a corrupt archive that only fails
 * at the checksum, and only if there is one.
 */
async function download() {
  const partial = `${archive}.part`;
  let have = existsSync(partial) ? statSync(partial).size : 0;

  const headers = {};
  if (have > 0) {
    headers.range = `bytes=${have}-`;
    console.log(`Resuming at ${mb(have)}.`);
  }

  const res = await fetch(url, { headers, redirect: "follow" });
  if (res.status === 416) {
    // The range starts past the end: the file is already whole.
    renameSync(partial, archive);
    return;
  }
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status} ${res.statusText}`);
  }
  if (have > 0 && res.status !== 206) {
    console.log("The server ignored the resume request; starting again.");
    rmSync(partial, { force: true });
    have = 0;
  }

  const total = Number(res.headers.get("content-length") ?? 0) + have;
  const out = createWriteStream(partial, { flags: have > 0 ? "a" : "w" });
  let seen = have;
  let lastLine = 0;

  for await (const chunk of res.body) {
    out.write(chunk);
    seen += chunk.length;
    const now = Date.now();
    if (now - lastLine > 500) {
      lastLine = now;
      const pct = total ? ` (${Math.round((seen / total) * 100)}%)` : "";
      process.stdout.write(`\r  ${mb(seen)}${total ? ` of ${mb(total)}` : ""}${pct}   `);
    }
  }
  await new Promise((r) => out.end(r));
  process.stdout.write("\n");
  renameSync(partial, archive);
}

/** @param {string} file */
function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file).on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

/* ---------------------------------------------------------------- extract */

/**
 * Unpack the archive with the platform's own tool.
 *
 * Shelling out rather than adding a zip library: the only archives this
 * handles are two formats from one publisher, `tar` reads both on every
 * platform this supports (Windows has had bsdtar since 1803), and a
 * dependency that exists to unpack one file per release is a dependency that
 * outlives its reason.
 *
 * @param {string} file @param {string} into
 */
function extract(file, into) {
  mkdirSync(into, { recursive: true });
  execFileSync("tar", ["-xf", file, "-C", into], { stdio: "inherit" });
}

/** Find the server binary anywhere under a directory. */
function findServer(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findServer(p, name);
      if (hit) return hit;
    } else if (entry.name === name) {
      return p;
    }
  }
  return null;
}

/**
 * Everything beside the binary comes too.
 *
 * A CUDA build is a server executable and a dozen large DLLs, and the
 * executable alone does not start. Tauri's externalBin copies one file, so the
 * rest are placed as ordinary bundle resources next to it.
 */
function copySiblings(from, to) {
  let n = 0;
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name === executableName()) continue;
    // The other tools in the archive are not used and are large.
    if (/^llama-(?!server)/.test(entry.name)) continue;
    writeFileSync(join(to, entry.name), readFileSync(join(from, entry.name)));
    n += 1;
  }
  return n;
}

/* ------------------------------------------------------------------- main */

console.log(`llama.cpp ${ENGINE_BUILD} — ${build.label} (${build.accel})`);
console.log(url);
console.log("");

if (flag("--dry-run")) {
  /* Proves the decision path without the download. The point of this
     script is what it refuses to do, and that should be checkable
     without pulling hundreds of megabytes. */
  console.log("Dry run: not downloading.");
  console.log(build.sha256
    ? `Would verify against ${build.sha256}.`
    : "No hash recorded, so this would refuse to install without --accept-unverified.");
  process.exit(build.sha256 || flag("--accept-unverified") ? 0 : 1);
}

if (!existsSync(archive)) {
  await download();
} else {
  console.log(`Already downloaded: ${archive}`);
}

const got = await sha256(archive);
console.log(`sha256: ${got}`);

if (build.sha256) {
  if (got !== build.sha256) {
    console.error("");
    console.error("CHECKSUM MISMATCH.");
    console.error(`  expected ${build.sha256}`);
    console.error(`  got      ${got}`);
    console.error("");
    console.error("The file is not the one this manifest pins. It has not been");
    console.error("extracted and nothing has been installed. Delete the cached");
    console.error(`archive and try again: ${archive}`);
    process.exit(1);
  }
  console.log("Checksum matches the pinned value.");
} else if (flag("--accept-unverified")) {
  console.log("");
  console.log("No checksum was recorded for this build, and --accept-unverified");
  console.log("was passed. llama.cpp publishes no checksums, so this hash is a");
  console.log("record of what arrived, not a confirmation from upstream.");
  /* Written to a data file rather than back into the manifest. A script that
     rewrites the module it imports is one bad regular expression away from
     corrupting the thing doing the checking, and that failure would surface
     as a checksum mismatch pointing at the download. */
  let all = {};
  try { all = JSON.parse(readFileSync(HASHES, "utf8")); } catch { /* first time */ }
  all[ENGINE_BUILD] = { ...(all[ENGINE_BUILD] ?? {}), [`${platformKey()}:${build.id}`]: got };
  writeFileSync(HASHES, `${JSON.stringify(all, null, 2)}\n`);
  console.log(`Recorded in ${HASHES}. Later fetches are checked against it.`);
} else {
  console.error("");
  console.error("No checksum is recorded for this build, so this download cannot");
  console.error("be verified against anything. llama.cpp does not publish");
  console.error("checksums with its releases.");
  console.error("");
  console.error("Nothing has been extracted. To accept that and record the hash");
  console.error("for future fetches:");
  console.error("");
  console.error(`  node scripts/fetch-engine.mjs --build ${build.id} --accept-unverified`);
  console.error("");
  process.exit(1);
}

const staging = join(CACHE, `${build.id}-unpacked`);
rmSync(staging, { recursive: true, force: true });
extract(archive, staging);

const exe = findServer(staging, executableName());
if (!exe) {
  console.error(`No ${executableName()} inside ${build.asset}.`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const suffix = process.platform === "win32" ? ".exe" : "";
const dest = join(OUT, `llama-server-${targetTriple()}${suffix}`);
writeFileSync(dest, readFileSync(exe));
if (process.platform !== "win32") chmodSync(dest, 0o755);

const extras = copySiblings(dirname(exe), OUT);

console.log("");
console.log(`Installed ${dest}`);
if (extras) console.log(`  plus ${extras} supporting file(s) the engine needs beside it`);
console.log("");
console.log("Tauri will include these in the installer. Model weights are not");
console.log("bundled and are never fetched by this script.");
