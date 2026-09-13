// @ts-check
/**
 * Put a verified Node binary where the installer can pick it up.
 *
 * Run once before packaging. The installed app must never need this: it exists
 * so that the *build* has a Node to ship, not so that the user has one to
 * fetch. A machine that has only ever run the installer has no npm, no
 * scripts/ directory, and no way to reach this file.
 *
 *   node scripts/vendor-node.mjs            vendor for this platform
 *   node scripts/vendor-node.mjs --check    say what is there, change nothing
 *   node scripts/vendor-node.mjs --force    re-download over a good copy
 *
 * The download is verified against the checksum nodejs.org publishes for the
 * release. A mismatch deletes the file and stops; there is no flag to accept an
 * unverified Node, because "the runtime that executes everything else" is
 * exactly the wrong place to offer that escape hatch.
 */

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat, readFile, writeFile, rename, readdir, copyFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NODE_VERSION, nodeAsset, nodeTarget, nodeUrl } from "../runtime/vendor/node-manifest.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

/** Where the packaged app looks. Tauri copies this whole folder as a resource. */
export const VENDOR_DIR = join(repo, "desktop", "src-tauri", "vendor");
const NODE_DIR = join(VENDOR_DIR, "node");

const args = new Set(process.argv.slice(2));
const say = (...m) => console.log(...m);

/** @param {string} p */
async function sizeOf(p) {
  try { return (await stat(p)).size; } catch { return 0; }
}

/** @param {string} p */
async function sha256File(p) {
  const h = createHash("sha256");
  const { createReadStream } = await import("node:fs");
  await pipeline(createReadStream(p), h);
  return h.digest("hex");
}

/** Run a command and resolve with its exit code, never throwing on failure. */
function run(exe, argv, opts = {}) {
  return new Promise((resolve) => {
    const c = spawn(exe, argv, { stdio: "inherit", windowsHide: true, ...opts });
    c.on("error", () => resolve(-1));
    c.on("close", (code) => resolve(code ?? -1));
  });
}

/**
 * Download to a `.part` file and rename only once the checksum matches.
 *
 * The rename is the point: a `node.exe` that exists is a `node.exe` that
 * passed, so a build interrupted halfway cannot leave a truncated runtime that
 * the next build happily ships.
 */
async function download(url, dest, expected) {
  /* An archive already here that still matches is the same archive. Re-fetching
     37 MB to prove that again only makes a failed unpack expensive to retry. */
  if (await sizeOf(dest) && await sha256File(dest) === expected) {
    say(`  reusing verified ${basename(dest)}`);
    return;
  }
  const part = `${dest}.part`;
  await rm(part, { force: true });
  say(`  fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  if (!res.body) throw new Error(`${url} returned no body`);
  await pipeline(Readable.fromWeb(/** @type {any} */ (res.body)), createWriteStream(part));

  const got = await sha256File(part);
  if (got !== expected) {
    await rm(part, { force: true });
    throw new Error(
      `checksum mismatch for ${url}\n  expected ${expected}\n  got      ${got}\n`
      + "The download was discarded. This is either a corrupted transfer or a "
      + "file that is not what nodejs.org published; neither is safe to ship.");
  }
  await rename(part, dest);
  say(`  verified ${(await sizeOf(dest) / 1e6).toFixed(1)} MB`);
}

/** Unpack the archive and lift out just the executable we need. */
async function extract(archive, asset, into) {
  const work = join(into, "_unpack");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });

  /* Zip goes through PowerShell and tarballs through tar.

     Not one path for both, even though Windows' own tar.exe reads zip: whether
     `tar` on PATH is that bsdtar or the GNU tar a developer gets from Git for
     Windows is not something this script can know, and GNU tar answers a zip
     with "this does not look like a tar archive". Expand-Archive is part of
     Windows PowerShell itself, so it is there on any machine that could be
     building a Windows installer. */
  const code = archive.endsWith(".zip")
    ? await run("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${work}' -Force`])
    /* Relative, because bsdtar reads an argument containing a colon as
       `host:path` and tries to resolve "C" as a hostname. */
    : await run("tar", ["-xf", basename(archive), "-C", "_unpack"], { cwd: into });
  if (code !== 0) throw new Error(`could not unpack ${archive} (exit ${code})`);

  const from = join(work, asset.exe);
  if (!(await sizeOf(from))) {
    throw new Error(`${asset.exe} was not in the archive; the layout may have changed`);
  }
  const exeName = asset.exe.endsWith(".exe") ? "node.exe" : "node";
  const to = join(into, exeName);
  await rm(to, { force: true });
  await copyFile(from, to);

  /* On Windows a Node zip carries nothing else the runtime needs; on the
     others the binary is self-contained too. Anything that turns out to be
     needed belongs here, named, rather than by copying the whole tree. */
  await rm(work, { recursive: true, force: true });
  return to;
}

/**
 * Copy the one npm package the runtime imports at run time.
 *
 * playwright-core is a dynamic import inside the browser session, so it is only
 * needed when someone actually drives a browser — but "only sometimes" is not
 * "never", and a production app that throws MODULE_NOT_FOUND the first time a
 * person clicks Browse is not shipping the feature. Node resolves bare
 * specifiers by walking up from the importing file, so placing it beside the
 * bundled runtime is all the wiring required.
 */
async function vendorPlaywright() {
  const from = join(repo, "node_modules", "playwright-core");
  const to = join(VENDOR_DIR, "node_modules", "playwright-core");
  if (!(await sizeOf(join(from, "package.json")))) {
    throw new Error("playwright-core is not installed; run npm install first");
  }
  await rm(to, { recursive: true, force: true });
  await mkdir(dirname(to), { recursive: true });
  await copyTree(from, to);
  const pkg = JSON.parse(await readFile(join(to, "package.json"), "utf8"));
  say(`  playwright-core ${pkg.version}`);
  return pkg.version;
}

/** @param {string} src @param {string} dest */
async function copyTree(src, dest) {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const a = join(src, entry.name);
    const b = join(dest, entry.name);
    if (entry.isDirectory()) await copyTree(a, b);
    else if (entry.isFile()) await copyFile(a, b);
  }
}

async function main() {
  const target = nodeTarget();
  const asset = nodeAsset(target);
  if (!asset) {
    console.error(`No Node is recorded for ${target}. Add it to runtime/vendor/node-manifest.mjs.`);
    process.exit(2);
  }
  if (!asset.sha256) {
    console.error(`No recorded checksum for ${target}, so nothing can be verified. Stopping.`);
    process.exit(2);
  }

  const exeName = asset.exe.endsWith(".exe") ? "node.exe" : "node";
  const exe = join(NODE_DIR, exeName);
  const existing = await sizeOf(exe);

  if (args.has("--check")) {
    say(`target        ${target}`);
    say(`node          v${NODE_VERSION}`);
    say(`vendored      ${existing ? `${(existing / 1e6).toFixed(1)} MB at ${exe}` : "no"}`);
    const pw = await sizeOf(join(VENDOR_DIR, "node_modules", "playwright-core", "package.json"));
    say(`playwright    ${pw ? "vendored" : "no"}`);
    process.exit(existing && pw ? 0 : 1);
  }

  await mkdir(NODE_DIR, { recursive: true });

  if (existing && !args.has("--force")) {
    say(`node v${NODE_VERSION} is already vendored (${(existing / 1e6).toFixed(1)} MB)`);
  } else {
    say(`vendoring node v${NODE_VERSION} for ${target}`);
    const archive = join(NODE_DIR, asset.archive);
    await download(nodeUrl(asset.archive), archive, asset.sha256);
    const out = await extract(archive, asset, NODE_DIR);
    await rm(archive, { force: true });
    say(`  installed ${out}`);
  }

  say("vendoring playwright-core");
  const pwVersion = await vendorPlaywright();

  /* A record of what this build actually shipped, so a bug report can say
     which Node and which playwright rather than "the bundled one". */
  await writeFile(join(VENDOR_DIR, "vendored.json"), `${JSON.stringify({
    node: NODE_VERSION, target, playwrightCore: pwVersion, vendoredAt: new Date().toISOString(),
  }, null, 2)}\n`);

  say("done");
}

main().catch((e) => {
  console.error(`\nvendor-node failed: ${e.message}`);
  process.exit(1);
});
