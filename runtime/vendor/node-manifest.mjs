// @ts-check
/**
 * The Node runtime ForgeLocal ships.
 *
 * The sidecar is an ES module tree that needs a Node to run it, and a machine
 * that has never had developer tools installed has no Node. Asking the person
 * to install one is asking them to become a developer to use a chat app, so we
 * ship one.
 *
 * Pinned to an exact version rather than a range. Two reasons, and the second
 * is the one that bites: `node:sqlite` is what the session store is built on
 * and it is recent enough that "some Node 22" is not a safe answer; and a
 * floating version means the binary a build produces depends on the day it was
 * built, which makes a bug report unreproducible.
 *
 * The checksum is not ours. nodejs.org publishes SHASUMS256.txt alongside every
 * release, signed by the release team, and the value below is copied from it.
 * Recording our own hash of a file we downloaded would only prove the file did
 * not change between our download and yours — it would say nothing about
 * whether we fetched the real thing.
 */

/** The pinned release. Changing this means re-recording every hash below. */
export const NODE_VERSION = "24.19.0";

/**
 * What each platform's archive is called, and what nodejs.org says it hashes to.
 *
 * Every listed platform has a recorded checksum, copied from that file on
 * 2026-09-12, so vendoring for any of them is verified. That is not the same as
 * supporting them: this milestone builds and tests a Windows x64 installer
 * only, and the other three exist so that adding a platform is a packaging and
 * testing job rather than a cryptography one. A target with no entry at all
 * fails with "no recorded checksum" rather than installing something
 * unverified.
 *
 * @type {Record<string, {archive: string, sha256: string|null, exe: string}>}
 */
export const NODE_ASSETS = Object.freeze({
  "win32-x64": {
    archive: `node-v${NODE_VERSION}-win-x64.zip`,
    sha256: "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73",
    exe: `node-v${NODE_VERSION}-win-x64/node.exe`,
  },
  "win32-arm64": {
    archive: `node-v${NODE_VERSION}-win-arm64.zip`,
    sha256: "8502f4a50b458d4cc38ed8f2001556c2cd239d464920f74017926ccb1e1c157f",
    exe: `node-v${NODE_VERSION}-win-arm64/node.exe`,
  },
  "linux-x64": {
    archive: `node-v${NODE_VERSION}-linux-x64.tar.xz`,
    sha256: "14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647",
    exe: `node-v${NODE_VERSION}-linux-x64/bin/node`,
  },
  "darwin-arm64": {
    archive: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    sha256: "8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d",
    exe: `node-v${NODE_VERSION}-darwin-arm64/bin/node`,
  },
});

/** Where the release lives. */
export function nodeUrl(archive) {
  return `https://nodejs.org/dist/v${NODE_VERSION}/${archive}`;
}

/** The published checksum file for this release, for re-recording a hash. */
export function shasumsUrl() {
  return `https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`;
}

/**
 * The key for a platform, in the same shape the manifest uses.
 * @param {string} [platform] @param {string} [arch]
 */
export function nodeTarget(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

/**
 * What we ship for this platform, or null when nothing is recorded for it.
 * @param {string} [target]
 */
export function nodeAsset(target = nodeTarget()) {
  return NODE_ASSETS[target] ?? null;
}
