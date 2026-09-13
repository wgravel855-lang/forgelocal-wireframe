// @ts-check
/**
 * Getting a model onto the machine.
 *
 * These files are tens of gigabytes and the connection will drop. Everything
 * here exists because of that: the download resumes, it verifies what it got,
 * and it will not move a file into place until it has checked it.
 *
 * The order of operations is the part worth stating. A download writes to
 * `name.gguf.part` and only becomes `name.gguf` after verification passes. So
 * a `.gguf` in the models folder is always a file that finished and checked
 * out, and an interrupted download is always visibly a `.part`. Writing
 * straight to the final name and verifying afterwards would mean a crash
 * between the two leaves a file that looks complete, and the next thing to
 * read it is the engine.
 *
 * Where the checksum comes from matters. Hugging Face stores GGUFs as LFS
 * objects and publishes their SHA-256 in the repository tree, so a model
 * download is verified against a hash the source vouches for — unlike the
 * engine binary, where no such hash exists and the script says so.
 */

import { createWriteStream, existsSync, mkdirSync, statSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { verifyModel, defaultModelDir } from "./files.mjs";

/** Per-response read timeout. A stalled socket is a failed download. */
export const STALL_MS = 60_000;

/** Redirect hops. Hugging Face sends two or three to reach a CDN. */
export const MAX_REDIRECTS = 6;

/**
 * Hosts a model may be fetched from.
 *
 * An allowlist rather than "any https URL". The alternative is a request the
 * model or a page could shape into a fetch of anything, and the size limits
 * that protect web_fetch do not apply to something designed to pull 40GB.
 * Adding a host here is a deliberate act.
 */
export const ALLOWED_HOSTS = Object.freeze([
  "huggingface.co",
  "cdn-lfs.huggingface.co",
  "cdn-lfs-us-1.huggingface.co",
  "cdn-lfs-eu-1.huggingface.co",
  "transfer.xethub.hf.co",
  /* Hugging Face's Xet storage, which is where large files now actually come
     from: a resolve URL on huggingface.co redirects to a regional host like
     us.aws.cdn.hf.co. Without this the allowlist refused every real model
     download while still passing its own tests, because the tests never
     followed a redirect to the live CDN.

     The suffix match below is anchored on a leading dot, so this admits
     subdomains of cdn.hf.co and nothing that merely ends in those letters —
     "evilcdn.hf.co" does not end with ".cdn.hf.co". */
  "cdn.hf.co",
]);

/** @param {string} url */
export function checkUrl(url) {
  let u;
  try { u = new URL(String(url)); }
  catch { return { ok: false, reason: "That is not a URL." }; }

  if (u.protocol !== "https:") {
    return { ok: false, reason: "Models are only downloaded over https." };
  }
  const host = u.hostname.toLowerCase();
  const allowed = ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (!allowed) {
    return {
      ok: false,
      reason: `${u.hostname} is not somewhere ForgeLocal downloads models from.`,
    };
  }
  return { ok: true, url: u };
}

/**
 * Ask Hugging Face what a repository holds.
 *
 * Returns the GGUF files with their real sizes and, where the repository
 * stores them as LFS objects, their real SHA-256. That hash is the difference
 * between a verified download and a hopeful one, and it comes from the source
 * rather than from anything recorded here.
 *
 * @param {string} repo  e.g. "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF"
 * @param {{fetch?: any, signal?: AbortSignal}} [opts]
 */
export async function listRepoFiles(repo, { fetch: f = fetch, signal } = {}) {
  const clean = String(repo).replace(/^\/+|\/+$/g, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(clean)) {
    return { ok: false, reason: "A repository looks like owner/name." };
  }
  const api = `https://huggingface.co/api/models/${clean}/tree/main?recursive=1`;
  const res = await f(api, { signal, headers: { accept: "application/json" } });
  if (!res.ok) {
    return {
      ok: false,
      reason: res.status === 404
        ? `No repository called ${clean}.`
        : `Hugging Face answered ${res.status} for ${clean}.`,
    };
  }
  const tree = await res.json();
  const files = (Array.isArray(tree) ? tree : [])
    .filter((e) => e && e.type === "file" && String(e.path).toLowerCase().endsWith(".gguf"))
    .map((e) => ({
      name: String(e.path).split("/").pop(),
      path: String(e.path),
      // The LFS record carries the authoritative size and hash. A file stored
      // directly in git has neither, and is reported without them rather than
      // with the git blob hash, which is a different thing entirely.
      bytes: e.lfs?.size ?? e.size ?? null,
      sha256: e.lfs?.oid && /^[0-9a-f]{64}$/.test(e.lfs.oid) ? e.lfs.oid : null,
      url: `https://huggingface.co/${clean}/resolve/main/${encodeURI(String(e.path))}?download=true`,
    }));

  return { ok: true, repo: clean, files };
}

/**
 * Download one model file, resuming if there is something to resume.
 *
 * @param {object} input
 * @param {string} input.url
 * @param {string} input.name         the file name to save as
 * @param {number|null} [input.bytes] expected size, when known
 * @param {string|null} [input.sha256] expected hash, when the source published one
 * @param {string} [input.dir]
 * @param {(p: any) => void} [input.onProgress]
 * @param {AbortSignal} [input.signal]
 * @param {any} [input.fetch]
 */
export async function downloadModel({
  url, name, bytes = null, sha256 = null, dir = defaultModelDir(),
  onProgress = () => {}, signal, fetch: f = fetch,
}) {
  const check = checkUrl(url);
  if (!check.ok) return { ok: false, reason: check.reason };

  if (!/^[\w.\-()+ ]+\.gguf$/i.test(name)) {
    /* The name becomes a path. Anything with a separator or a traversal in it
       is refused rather than sanitised: a sanitiser that gets it wrong writes
       outside the models folder, and there is no legitimate GGUF whose name
       needs a slash. */
    return { ok: false, reason: `"${name}" is not a usable model file name.` };
  }

  mkdirSync(dir, { recursive: true });
  const final = join(dir, name);
  const part = `${final}.part`;

  if (existsSync(final)) {
    return { ok: true, path: final, already: true };
  }

  let have = existsSync(part) ? statSync(part).size : 0;
  if (bytes != null && have > bytes) {
    /* Longer than the whole file: this partial is from a different file with
       the same name. Continuing it would produce something that fails its
       checksum after another hour of downloading. */
    rmSync(part, { force: true });
    have = 0;
  }

  const headers = { accept: "application/octet-stream" };
  if (have > 0) headers.range = `bytes=${have}-`;

  const res = await fetchFollowing(check.url.href, { headers, signal }, f);
  if (!res.ok) return { ok: false, reason: res.reason };

  if (have > 0 && res.status !== 206) {
    // The server ignored the range. Appending a fresh body onto a partial file
    // makes a corrupt one that only fails at the checksum.
    rmSync(part, { force: true });
    have = 0;
  }

  /* The expected size when the caller knew it, otherwise what the server
     said plus what was already on disk. Null when neither is available:
     a progress bar with no total is honest, an invented one is not. */
  const total = bytes ?? (Number(res.headers.get("content-length") ?? 0) + have || null);

  const out = createWriteStream(part, { flags: have > 0 ? "a" : "w" });
  let done = have;
  let lastTick = 0;
  let lastBytes = have;
  let lastAt = Date.now();
  let rate = 0;

  try {
    for await (const chunk of res.body) {
      if (signal?.aborted) throw new Error("aborted");
      out.write(chunk);
      done += chunk.length;

      const now = Date.now();
      if (now - lastTick > 400) {
        // A rate averaged over the last interval rather than the whole
        // download: an estimate that still reflects the first thirty seconds
        // of a two-hour transfer is not an estimate.
        const dt = (now - lastAt) / 1000;
        if (dt > 0) rate = (done - lastBytes) / dt;
        lastAt = now;
        lastBytes = done;
        lastTick = now;
        onProgress({
          phase: "downloading",
          bytes: done,
          total,
          bytesPerSecond: Math.round(rate),
          secondsLeft: total && rate > 0 ? Math.round((total - done) / rate) : null,
        });
      }
    }
  } catch (/** @type {any} */ e) {
    await new Promise((r) => out.end(r));
    if (signal?.aborted) {
      /* The partial file is KEPT. That is the entire point of a resumable
         download: a cancel that discarded 30GB would make cancelling something
         people are afraid to do. */
      return { ok: false, cancelled: true, resumeBytes: done, reason: "Download stopped. It can be resumed." };
    }
    return { ok: false, reason: `The download failed after ${done} bytes: ${e && e.message}` };
  }
  await new Promise((r) => out.end(r));

  onProgress({ phase: "verifying", bytes: done, total });
  const verdict = await verifyModel({
    path: part,
    expectedBytes: bytes,
    expectedSha256: sha256,
    onProgress: (d, t) => onProgress({ phase: "verifying", bytes: d, total: t }),
    signal,
  });

  if (!verdict.ok) {
    /* Not moved into place, and not deleted either. Deleting it would throw
       away a download that might only need resuming; leaving it as a .part
       means the folder never contains a .gguf that failed its check. */
    return { ok: false, reason: verdict.reason, verification: verdict };
  }

  renameSync(part, final);
  onProgress({ phase: "done", bytes: done, total: done });
  return {
    ok: true,
    path: final,
    bytes: done,
    verified: verdict.verified === true,
    // Said out loud when there was no hash to check against, so "downloaded"
    // is never mistaken for "verified".
    note: verdict.verified === true ? null : verdict.reason,
  };
}

/**
 * Follow redirects by hand, re-checking the host at every hop.
 *
 * Hugging Face redirects to a CDN, and the CDN is a different host. Letting
 * fetch follow them would mean the allowlist was applied to the first URL and
 * nothing else — which is no allowlist at all.
 */
async function fetchFollowing(url, init, f) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await f(current, { ...init, redirect: "manual" });
    const location = res.headers?.get?.("location");
    if (![301, 302, 303, 307, 308].includes(res.status) || !location) {
      if (!res.ok && res.status !== 206) {
        return { ok: false, reason: `${current} returned ${res.status}.` };
      }
      return { ok: true, status: res.status, headers: res.headers, body: res.body };
    }
    const next = checkUrl(new URL(location, current).href);
    if (!next.ok) {
      return { ok: false, reason: `The download redirected somewhere unexpected: ${next.reason}` };
    }
    current = next.url.href;
  }
  return { ok: false, reason: `More than ${MAX_REDIRECTS} redirects.` };
}
