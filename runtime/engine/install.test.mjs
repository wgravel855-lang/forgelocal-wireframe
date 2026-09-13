// @ts-check
/**
 * Tests for getting an engine onto the machine.
 *
 * These do not download a 32MB engine. What they check is everything around
 * the download, which is where the damage is: that an unverified asset is
 * never installed, that a redirect cannot walk the allowlist, that a failed
 * install leaves nothing that looks installed, and that an upgrade cannot
 * destroy the engine that was working.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ENGINE_HOSTS, checkEngineUrl, currentEngine, engineDirName, engineRoot,
  installEngine, listEngines, removeEngine,
} from "./install.mjs";
import { ENGINE_BUILD, buildsFor, partsFor, totalBytes } from "./manifest.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "fl-engine-"));
const clean = (d) => rmSync(d, { recursive: true, force: true });

/** An installed engine, as the installer would have left it. */
function fakeInstall(root, build, id, { at = new Date().toISOString() } = {}) {
  const dir = join(root, engineDirName(build, id));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "llama-server.exe"), "MZ not really an engine");
  writeFileSync(join(dir, "engine.json"), JSON.stringify({ build, id, installedAt: at }));
  return dir;
}

/* ------------------------------------------------------------ 1. where --- */

test("engines live under the user's data directory, not the app's", () => {
  /* The app directory is Program Files on Windows. Writing there needs
     administrator rights, and an app that asks for them to download a file is
     an app that has made a category error. */
  const win = engineRoot({ LOCALAPPDATA: "C:/Users/x/AppData/Local" }, "win32");
  assert.match(win, /AppData[\\/]Local[\\/]ForgeLocal[\\/]engines$/);
  assert.ok(!/Program Files/i.test(win));

  const mac = engineRoot({ HOME: "/Users/x" }, "darwin");
  assert.match(mac, /Application Support[\\/]ForgeLocal[\\/]engines$/);

  const linux = engineRoot({ HOME: "/home/x" }, "linux");
  assert.match(linux, /forgelocal[\\/]engines$/);
});

test("an override wins, so tests never write to a real profile", () => {
  assert.equal(engineRoot({ FORGELOCAL_ENGINE_DIR: "/tmp/x" }, "win32"), "/tmp/x");
});

/* --------------------------------------------------------- 2. the hosts --- */

test("an engine is only fetched from the release host", () => {
  assert.equal(checkEngineUrl(
    `https://github.com/ggml-org/llama.cpp/releases/download/${ENGINE_BUILD}/x.zip`), null);
  assert.equal(checkEngineUrl("https://objects.githubusercontent.com/x"), null);

  for (const bad of [
    "https://evil.example/llama-server.zip",
    "https://github.com.evil.example/x.zip",
    "http://github.com/x.zip",
    "file:///C:/Windows/System32/cmd.exe",
    "not a url",
  ]) {
    assert.ok(checkEngineUrl(bad), `${bad} was accepted as an engine source`);
  }
});

test("the allowlist is a list of hosts, not a substring test", () => {
  /* "github.com" appearing in a hostname is not the same as being it, and a
     check written with includes() is the classic way that goes wrong. */
  assert.ok(checkEngineUrl("https://notgithub.com/x"));
  assert.ok(checkEngineUrl("https://github.com.attacker.net/x"));
  assert.ok(ENGINE_HOSTS.includes("github.com"));
});

/* ------------------------------------------------- 3. what gets refused --- */

test("a build with no recorded checksum is refused, not fetched", async () => {
  /* There is deliberately no flag to accept one. The engine is the process
     that executes for the rest of the session. */
  const root = tmp();
  await assert.rejects(
    () => installEngine({
      id: "nonexistent", env: { FORGELOCAL_ENGINE_DIR: root }, platform: "win32", arch: "x64",
    }),
    /no "nonexistent" engine/i,
  );
  clean(root);
});

test("a platform with no engine says so instead of offering a download", async () => {
  const root = tmp();
  await assert.rejects(
    () => installEngine({
      env: { FORGELOCAL_ENGINE_DIR: root }, platform: "sunos", arch: "sparc",
    }),
    /No engine is published for sunos-sparc/,
  );
  assert.deepEqual(await listEngines({ env: { FORGELOCAL_ENGINE_DIR: root }, platform: "win32" }), [],
    "a refused install left something behind");
  clean(root);
});

/* ------------------------------------------------- 4. what counts as one --- */

test("a directory without the executable is not an installed engine", async () => {
  /* This is the half-installed case. A download interrupted after the folder
     exists and before the binary lands must read as "no engine", because an
     engine that is reported installed and cannot start is a bug report about
     the model instead of about the download. */
  const root = tmp();
  const halfway = join(root, engineDirName(ENGINE_BUILD, "vulkan"));
  mkdirSync(halfway, { recursive: true });
  writeFileSync(join(halfway, "engine.json"), "{}");
  writeFileSync(join(halfway, "some-library.dll"), "x");

  const found = await listEngines({ env: { FORGELOCAL_ENGINE_DIR: root }, platform: "win32" });
  assert.deepEqual(found, [], "a directory with no engine in it was listed as an engine");
  assert.equal(await currentEngine({ env: { FORGELOCAL_ENGINE_DIR: root }, platform: "win32" }), null);
  clean(root);
});

test("staging is not mistaken for an install", async () => {
  const root = tmp();
  const staging = join(root, `.staging-${engineDirName(ENGINE_BUILD, "cpu")}`);
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, "llama-server.exe"), "half a download");

  const found = await listEngines({ env: { FORGELOCAL_ENGINE_DIR: root }, platform: "win32" });
  assert.deepEqual(found, [], "staging was listed as an installed engine");
  clean(root);
});

/* ----------------------------------------------------- 5. keeping the old --- */

test("two builds coexist, so an upgrade has something to fall back to", async () => {
  const root = tmp();
  fakeInstall(root, "b10000", "vulkan", { at: "2026-01-01T00:00:00.000Z" });
  fakeInstall(root, ENGINE_BUILD, "cpu", { at: "2026-09-01T00:00:00.000Z" });

  const all = await listEngines({ env: { FORGELOCAL_ENGINE_DIR: root }, platform: "win32" });
  assert.equal(all.length, 2, "installing a second build removed the first");

  const now = await currentEngine({ env: { FORGELOCAL_ENGINE_DIR: root }, platform: "win32" });
  assert.equal(now.build, ENGINE_BUILD, "the pinned build was not preferred");
  clean(root);
});

test("an older engine still runs the app when the pinned one is not installed", async () => {
  /* The rollback story. Moving the pin in a release must not turn every
     existing installation into one with no engine. */
  const root = tmp();
  fakeInstall(root, "b10000", "vulkan");
  const now = await currentEngine({ env: { FORGELOCAL_ENGINE_DIR: root }, platform: "win32" });
  assert.ok(now, "an installed engine from an older build was ignored");
  assert.equal(now.build, "b10000");
  clean(root);
});

test("the last engine cannot be removed out from under the app", async () => {
  const root = tmp();
  fakeInstall(root, ENGINE_BUILD, "cpu");
  const one = await removeEngine(engineDirName(ENGINE_BUILD, "cpu"),
    { env: { FORGELOCAL_ENGINE_DIR: root }, platform: "win32" });
  assert.equal(one.ok, false);
  assert.match(one.reason ?? "", /only engine/);
  assert.ok(existsSync(join(root, engineDirName(ENGINE_BUILD, "cpu"), "llama-server.exe")));

  fakeInstall(root, "b10000", "vulkan");
  const two = await removeEngine(engineDirName("b10000", "vulkan"),
    { env: { FORGELOCAL_ENGINE_DIR: root }, platform: "win32" });
  assert.equal(two.ok, true, two.reason ?? "");
  assert.equal((await listEngines({ env: { FORGELOCAL_ENGINE_DIR: root }, platform: "win32" })).length, 1);
  clean(root);
});

/* ------------------------------------------------------- 6. the manifest --- */

test("every Windows build has a checksum and a real size", () => {
  /* The whole point of the milestone's engine work: nothing is installable
     that cannot be verified, and the interface can say what it is about to
     spend before it spends it. */
  const builds = buildsFor("win32", "x64");
  assert.ok(builds.length >= 3);
  for (const b of builds) {
    assert.match(b.sha256 ?? "", /^[0-9a-f]{64}$/, `${b.id} has no usable checksum`);
    assert.ok(b.bytes > 1e6, `${b.id} has no plausible size`);
    for (const part of partsFor(b)) {
      assert.match(part.sha256 ?? "", /^[0-9a-f]{64}$/, `${b.id}: ${part.asset} is unverifiable`);
      assert.equal(checkEngineUrl(part.url), null, `${b.id}: ${part.asset} is off the allowlist`);
    }
  }
});

test("a CUDA build counts its runtime, because it cannot start without it", () => {
  /* llama.cpp ships the CUDA runtime as a separate archive. Reporting the
     engine's own 254MB as the download size would understate it by 391MB and
     leave the engine failing on a missing DLL. */
  const cuda = buildsFor("win32", "x64").find((b) => b.id === "cuda12");
  assert.ok(cuda, "there is no CUDA 12 build to check");
  assert.ok(cuda.companion, "the CUDA build claims to need nothing beside it");
  assert.equal(partsFor(cuda).length, 2);
  assert.ok(totalBytes(cuda) > cuda.bytes * 2, "the companion is not counted in the size");
});
