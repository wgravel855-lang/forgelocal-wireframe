// @ts-check
/**
 * Tests for the model layer.
 *
 * Three properties, and the first two are about refusing things:
 *
 *   - a file only becomes a `.gguf` in the models folder after it has been
 *     checked, so anything the engine is asked to load has already passed;
 *   - a download reaches only hosts on the list, at every redirect hop, and
 *     writes only inside the models folder;
 *   - a fit calculation that depends on a number nobody measured produces no
 *     number, rather than a plausible one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createHash } from "node:crypto";
import {
  inspectGguf, listModels, verifyModel, deleteModel, defaultModelDir, hashFile,
} from "./files.mjs";
import { checkUrl, downloadModel, listRepoFiles, ALLOWED_HOSTS } from "./download.mjs";
import { fitFor, suggestLoad, primaryGpu } from "./fit.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "fl-models-"));
const clean = (d) => rmSync(d, { recursive: true, force: true });

/** A file with the GGUF magic and some filler. */
function fakeGguf(path, bytes = 1024) {
  const buf = Buffer.alloc(bytes);
  buf.write("GGUF", 0, "ascii");
  buf.writeUInt32LE(3, 4);
  writeFileSync(path, buf);
  return createHash("sha256").update(buf).digest("hex");
}

/* ------------------------------------------------------ 1. what is a model */

test("a file that is not a GGUF is identified as one that is not", () => {
  const d = dir();
  const p = join(d, "not-a-model.gguf");

  writeFileSync(p, "<!doctype html><title>404</title>");
  const html = inspectGguf(p);
  assert.equal(html.gguf, false);
  assert.match(String(html.reason), /web page/,
    "an error page saved as a model should say so, not just 'invalid'");

  writeFileSync(p, "xx");
  assert.match(String(inspectGguf(p).reason), /too small/);

  writeFileSync(p, Buffer.alloc(64));
  assert.match(String(inspectGguf(p).reason), /GGUF marker/);

  fakeGguf(p);
  assert.equal(inspectGguf(p).gguf, true);
  assert.equal(inspectGguf(p).version, 3);
  clean(d);
});

test("a listing shows an unusable file rather than hiding it", () => {
  /* Hiding it means the user watches a download succeed and then cannot find
     what it produced. */
  const d = dir();
  fakeGguf(join(d, "good.gguf"));
  writeFileSync(join(d, "bad.gguf"), "<html>");
  writeFileSync(join(d, "notes.txt"), "ignored");

  const list = listModels(d);
  assert.equal(list.length, 2, "a non-model file was listed, or a model was not");
  const bad = list.find((m) => m.name === "bad.gguf");
  assert.equal(bad.usable, false);
  assert.ok(bad.problem, "an unusable file with no explanation");
  assert.equal(list.find((m) => m.name === "good.gguf").usable, true);
  clean(d);
});

/* --------------------------------------------------------- 2. verification */

test("verification checks the cheap things before the expensive one", async () => {
  const d = dir();
  const p = join(d, "m.gguf");
  fakeGguf(p, 2048);

  // Wrong size: caught without hashing.
  const wrongSize = await verifyModel({ path: p, expectedBytes: 9999, expectedSha256: "0".repeat(64) });
  assert.equal(wrongSize.ok, false);
  assert.deepEqual(wrongSize.checked, ["size"], "it hashed a file already known to be wrong");
  assert.match(String(wrongSize.reason), /incomplete/);
  clean(d);
});

test("a file with no known checksum is reported as unverified, not as verified", async () => {
  /* "Verified" has to mean something. A file nobody has a hash for has been
     found to be the right size and shape, which is a different claim. */
  const d = dir();
  const p = join(d, "m.gguf");
  fakeGguf(p, 512);

  const out = await verifyModel({ path: p, expectedBytes: 512 });
  assert.equal(out.ok, true);
  assert.equal(out.verified, false);
  assert.match(String(out.reason), /not verified/);
  clean(d);
});

test("a wrong checksum is a failure that does not delete the file", async () => {
  const d = dir();
  const p = join(d, "m.gguf");
  fakeGguf(p, 512);

  const out = await verifyModel({ path: p, expectedBytes: 512, expectedSha256: "a".repeat(64) });
  assert.equal(out.ok, false);
  assert.match(String(out.reason), /checksum does not match/);
  assert.ok(existsSync(p), "a failed check deleted the user's download");
  clean(d);
});

test("a right checksum verifies", async () => {
  const d = dir();
  const p = join(d, "m.gguf");
  const sha = fakeGguf(p, 4096);
  const out = await verifyModel({ path: p, expectedBytes: 4096, expectedSha256: sha });
  assert.equal(out.ok, true);
  assert.equal(out.verified, true);
  assert.equal(out.sha256, sha);
  assert.deepEqual(out.checked, ["size", "format", "sha256"]);
  clean(d);
});

test("hashing reports progress, because these files take minutes", async () => {
  const d = dir();
  const p = join(d, "m.gguf");
  fakeGguf(p, 1 << 20);
  const seen = [];
  await hashFile(p, (done, total) => seen.push([done, total]));
  assert.ok(seen.length, "no progress at all");
  assert.deepEqual(seen[seen.length - 1], [1 << 20, 1 << 20], "the last tick is not completion");
  clean(d);
});

/* ------------------------------------------------------------ 3. downloads */

test("only allowlisted https hosts are fetched from", () => {
  for (const bad of [
    "http://huggingface.co/x.gguf",
    "https://example.com/x.gguf",
    "https://huggingface.co.evil.test/x.gguf",
    "file:///etc/passwd",
    "not a url",
  ]) {
    assert.equal(checkUrl(bad).ok, false, `accepted ${bad}`);
  }
  for (const good of ALLOWED_HOSTS) {
    assert.equal(checkUrl(`https://${good}/a/b.gguf`).ok, true, `refused ${good}`);
  }
});

test("a download refuses a name that would escape the models folder", async () => {
  const d = dir();
  for (const name of ["../escape.gguf", "sub/dir.gguf", "a\\b.gguf", "x.exe", ".gguf"]) {
    const out = await downloadModel({
      url: "https://huggingface.co/a/b.gguf", name, dir: d,
      fetch: async () => { throw new Error("should not have been reached"); },
    });
    assert.equal(out.ok, false, `accepted the name ${name}`);
    assert.match(String(out.reason), /usable model file name/);
  }
  assert.deepEqual(readdirSync(d), [], "something was written");
  clean(d);
});

test("a redirect to a host that is not allowed stops the download", async () => {
  /* Hugging Face redirects to a CDN, so redirects must be followed — and each
     hop re-checked. Checking only the first URL is no allowlist at all. */
  const d = dir();
  const out = await downloadModel({
    url: "https://huggingface.co/a/b.gguf", name: "b.gguf", dir: d,
    fetch: async () => ({
      ok: false, status: 302,
      headers: { get: (h) => (h === "location" ? "https://evil.test/b.gguf" : null) },
    }),
  });
  assert.equal(out.ok, false);
  assert.match(String(out.reason), /redirected somewhere unexpected/);
  clean(d);
});

test("a file only becomes a .gguf after it has been checked", async () => {
  /* The ordering the whole module is built around. A crash between writing
     and verifying must not leave something that looks complete. */
  const d = dir();
  const body = Buffer.alloc(256);
  body.write("GGUF", 0, "ascii");
  body.writeUInt32LE(3, 4);

  const out = await downloadModel({
    url: "https://huggingface.co/a/b.gguf",
    name: "b.gguf", dir: d, bytes: 256,
    sha256: "f".repeat(64),               // deliberately wrong
    fetch: async () => ({
      ok: true, status: 200,
      headers: { get: (h) => (h === "content-length" ? "256" : null) },
      body: (async function* () { yield body; })(),
    }),
  });

  assert.equal(out.ok, false);
  assert.ok(!existsSync(join(d, "b.gguf")), "a file that failed its check was installed");
  assert.ok(existsSync(join(d, "b.gguf.part")), "the partial download was discarded");
  clean(d);
});

test("a good download is installed and reported as verified", async () => {
  const d = dir();
  const body = Buffer.alloc(256);
  body.write("GGUF", 0, "ascii");
  body.writeUInt32LE(3, 4);
  const sha = createHash("sha256").update(body).digest("hex");

  const out = await downloadModel({
    url: "https://huggingface.co/a/b.gguf",
    name: "b.gguf", dir: d, bytes: 256, sha256: sha,
    fetch: async () => ({
      ok: true, status: 200,
      headers: { get: (h) => (h === "content-length" ? "256" : null) },
      body: (async function* () { yield body; })(),
    }),
  });

  assert.equal(out.ok, true, String(out.reason ?? ""));
  assert.equal(out.verified, true);
  assert.ok(existsSync(join(d, "b.gguf")));
  assert.ok(!existsSync(join(d, "b.gguf.part")), "the partial file was left behind");
  clean(d);
});

test("a cancelled download keeps what it got", async () => {
  /* A cancel that threw away thirty gigabytes would make cancelling something
     people are afraid to do, which is worse than not offering it. */
  const d = dir();
  const controller = new AbortController();
  const body = Buffer.alloc(64);
  body.write("GGUF", 0, "ascii");

  const out = await downloadModel({
    url: "https://huggingface.co/a/b.gguf", name: "b.gguf", dir: d,
    signal: controller.signal,
    fetch: async () => ({
      ok: true, status: 200,
      headers: { get: () => null },
      body: (async function* () {
        yield body;
        controller.abort();
        yield body;
      })(),
    }),
  });

  assert.equal(out.ok, false);
  assert.equal(out.cancelled, true);
  assert.match(String(out.reason), /can be resumed/);
  assert.ok(existsSync(join(d, "b.gguf.part")), "the partial download was thrown away");
  assert.ok(statSync(join(d, "b.gguf.part")).size > 0);
  clean(d);
});

test("a partial longer than the whole file is discarded rather than resumed", async () => {
  const d = dir();
  writeFileSync(join(d, "b.gguf.part"), Buffer.alloc(9999));
  const body = Buffer.alloc(256);
  body.write("GGUF", 0, "ascii");
  body.writeUInt32LE(3, 4);

  let sawRange = null;
  await downloadModel({
    url: "https://huggingface.co/a/b.gguf", name: "b.gguf", dir: d, bytes: 256,
    fetch: async (_u, init) => {
      sawRange = init.headers.range ?? null;
      return {
        ok: true, status: 200,
        headers: { get: () => "256" },
        body: (async function* () { yield body; })(),
      };
    },
  });
  assert.equal(sawRange, null, "it tried to resume a partial from a different file");
  clean(d);
});

test("a repository listing carries the source's own hash, or none", async () => {
  const out = await listRepoFiles("owner/repo-GGUF", {
    fetch: async () => ({
      ok: true,
      json: async () => ([
        { type: "file", path: "a.gguf", lfs: { size: 1234, oid: "b".repeat(64) } },
        { type: "file", path: "plain.gguf", size: 99 },
        { type: "file", path: "README.md", size: 10 },
        { type: "directory", path: "sub" },
      ]),
    }),
  });
  assert.equal(out.ok, true);
  assert.ok(out.files, "a listing with no files array");
  assert.equal(out.files.length, 2, "non-GGUF entries were included");
  const [lfs, plain] = out.files;
  assert.equal(lfs.sha256, "b".repeat(64));
  assert.equal(lfs.bytes, 1234);
  // No LFS record means no authoritative hash, and none is invented.
  assert.equal(plain.sha256, null);
  assert.match(lfs.url, /^https:\/\/huggingface\.co\/owner\/repo-GGUF\/resolve\/main\//);
});

/* ------------------------------------------------------------------ 4. fit */

const hw = (over = {}) => ({
  os: "windows", arch: "x86_64", cpu_cores: 16,
  ram_bytes: 32e9, ram_free_bytes: 16e9, gpus: [], notes: [], ...over,
});
const gpu = (vram, name = "Test GPU") => ({
  vendor: "nvidia", name, vram_bytes: vram, driver: null, source: "test",
});

test("a machine nobody could measure gets no number at all", () => {
  /* The branch the fixed profile never had. This is the whole point of the
     module: no VRAM and no RAM means no answer, not a default. */
  const out = fitFor({ fileBytes: 5e9, hardware: hw({ ram_bytes: null }) });
  assert.equal(out.verdict, "unknown");
  assert.equal(out.gpuLayers, null);
  assert.equal(out.recommendedContext, null);
  assert.match(out.detail, /could be measured/);
});

test("a GPU whose memory is unknown is not reported as absent", () => {
  /* "Processor only" would be a claim about hardware nobody checked. */
  const out = fitFor({
    fileBytes: 4e9,
    hardware: hw({ gpus: [{ vendor: "amd", name: "Radeon RX 7900", vram_bytes: null, source: "test" }] }),
  });
  assert.match(out.label, /GPU unknown/);
  assert.equal(out.gpuLayers, null, "it guessed a layer count for an unmeasured GPU");
  assert.match(out.detail, /could not be measured/);
});

test("a model that fits on the GPU says so", () => {
  const out = fitFor({ fileBytes: 4e9, hardware: hw({ gpus: [gpu(12e9)] }) });
  assert.equal(out.verdict, "fits");
  assert.ok(Number(out.gpuLayers) > 0);
  assert.equal(out.approximate, true, "an estimate presented as exact");
});

test("a model too large for the GPU but not for memory offers a partial load", () => {
  const out = fitFor({ fileBytes: 20e9, hardware: hw({ gpus: [gpu(12e9)], ram_bytes: 64e9 }) });
  assert.ok(["partial", "tight"].includes(out.verdict), out.verdict);
  assert.ok(Number(out.gpuLayers) > 0 && Number(out.gpuLayers) < 999);
  assert.match(out.detail, /processor/);
});

test("a model too large for everything says which numbers it is comparing", () => {
  const out = fitFor({ fileBytes: 200e9, hardware: hw({ gpus: [gpu(8e9)], ram_bytes: 16e9 }) });
  assert.equal(out.verdict, "no");
  assert.match(out.detail, /200\.0 GB/);
  assert.match(out.detail, /16\.0 GB/);
  // And it says what to do, rather than only that it will not work.
  assert.match(out.detail, /smaller quantisation/);
});

test("the largest measured GPU is the one that counts", () => {
  const out = primaryGpu(hw({
    gpus: [
      { vendor: "intel", name: "Integrated", vram_bytes: 128e6, source: "test" },
      gpu(24e9, "Big"),
      { vendor: "amd", name: "Unmeasured", vram_bytes: null, source: "test" },
    ],
  }));
  assert.equal(out.vram, 24e9);
  assert.equal(out.name, "Big");
});

test("suggested load parameters carry the reasoning that produced them", () => {
  const out = suggestLoad({ fileBytes: 4e9, hardware: hw({ gpus: [gpu(12e9)] }) });
  assert.equal(out.parallel, 1);
  assert.ok(out.basis, "a suggestion with no stated basis");
  assert.equal(out.basis.approximate, true);
});

test("the model folder is per-user application data, never the project", () => {
  const slash = (p) => p.split(sep).join("/");
  assert.match(slash(defaultModelDir({ LOCALAPPDATA: "C:/u/AppData/Local" }, "win32")),
    /AppData\/Local\/ForgeLocal\/models$/);
  assert.match(slash(defaultModelDir({ HOME: "/Users/x" }, "darwin")),
    /Application Support\/ForgeLocal\/models$/);
  assert.match(slash(defaultModelDir({ HOME: "/home/x" }, "linux")),
    /\.local\/share\/forgelocal\/models$/);
  assert.equal(defaultModelDir({ FORGELOCAL_MODEL_DIR: "/tmp/m" }, "linux"), "/tmp/m");
});

test("deleting refuses anything that is not a model file", () => {
  const d = dir();
  const p = join(d, "keep.txt");
  writeFileSync(p, "important");
  assert.throws(() => deleteModel(p), /only .gguf/i);
  assert.ok(existsSync(p));
  clean(d);
});
