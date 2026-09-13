// @ts-check
/**
 * The model files on this machine.
 *
 * Weights live in per-user application data, never in the project and never in
 * the installer. They are the largest thing the app touches — a single file can
 * be 40GB — so everything here is careful about reading them: a listing never
 * hashes, a hash is only computed when something asks, and nothing loads a
 * model file into memory.
 *
 * The one thing this module insists on is that a file is what it claims to be.
 * A truncated download and a complete one look identical in a directory
 * listing, and the failure they produce is "the engine stopped with exit code
 * 1" several minutes later. So a file is checked two ways: its size against
 * what was expected, and its first bytes against the GGUF magic. Neither is a
 * substitute for the checksum, and both catch the common case the checksum
 * catches expensively.
 */

import {
  mkdirSync, readdirSync, statSync, rmSync, existsSync, openSync, readSync, closeSync,
  createReadStream, readFileSync, writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { join } from "node:path";

/**
 * Where the chosen models folder is recorded.
 *
 * Its own small file rather than a row in the session database: it has to be
 * readable before anything else starts, it is one string, and a person moving
 * their models to another drive should not have that decision live inside a
 * store they might delete to clear their history.
 *
 * @param {NodeJS.ProcessEnv} [env] @param {string} [platform]
 */
export function modelDirSettingPath(env = process.env, platform = process.platform) {
  const home = env.USERPROFILE || env.HOME || ".";
  const base = platform === "win32"
    ? join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "ForgeLocal")
    : platform === "darwin"
      ? join(home, "Library", "Application Support", "ForgeLocal")
      : join(env.XDG_DATA_HOME || join(home, ".local", "share"), "forgelocal");
  return join(base, "model-dir.json");
}

/**
 * The folder the person chose, or null.
 *
 * Null on anything unexpected — missing file, unreadable JSON, a value that is
 * not a string — because the platform default is always a usable answer and a
 * corrupt preference should not stop the app finding models.
 *
 * @param {NodeJS.ProcessEnv} [env] @param {string} [platform]
 */
export function savedModelDir(env = process.env, platform = process.platform) {
  try {
    const raw = readFileSync(modelDirSettingPath(env, platform), "utf8");
    const value = JSON.parse(raw);
    return typeof value?.dir === "string" && value.dir ? value.dir : null;
  } catch { return null; }
}

/**
 * Record a new models folder.
 *
 * Nothing is moved and nothing is deleted. Pointing at a folder that already
 * holds models shows those; the old folder keeps what it had. Copying tens of
 * gigabytes on a click is not a thing to do quietly, and it is not what
 * somebody choosing a directory is asking for.
 *
 * @param {string} dir @param {NodeJS.ProcessEnv} [env] @param {string} [platform]
 */
export function setModelDir(dir, env = process.env, platform = process.platform) {
  const file = modelDirSettingPath(env, platform);
  mkdirSync(dirname(file), { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ dir }, null, 2)}\n`);
  return dir;
}

/**
 * Where weights live.
 *
 * Beside the session store rather than inside it: sessions are small and
 * frequently written, models are enormous and written once, and a user who
 * wants to move their models to another drive should not have to move their
 * history with them.
 *
 * @param {NodeJS.ProcessEnv} [env] @param {string} [platform]
 */
export function defaultModelDir(env = process.env, platform = process.platform) {
  if (env.FORGELOCAL_MODEL_DIR) return env.FORGELOCAL_MODEL_DIR;
  /* A folder the person chose, if they have chosen one.
   *
   * After the environment, so a test or a developer can still override it, and
   * before the platform default, which is only where models go when nobody has
   * said otherwise. Read from disk each time rather than cached: the setting
   * is changed from the interface and the next listing has to see it. */
  const chosen = savedModelDir(env, platform);
  if (chosen) return chosen;
  const home = env.USERPROFILE || env.HOME || ".";
  if (platform === "win32") {
    return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "ForgeLocal", "models");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "ForgeLocal", "models");
  }
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "forgelocal", "models");
}

/** The four bytes every GGUF file begins with. */
const GGUF_MAGIC = Buffer.from([0x47, 0x47, 0x55, 0x46]); // "GGUF"

/**
 * Is this a GGUF, and which version?
 *
 * Reads eight bytes. This is what separates "the file is there" from "the file
 * is a model": a download that returned an HTML error page, an archive nobody
 * extracted, or a `.gguf` that is half of one all fail here in a millisecond
 * rather than inside the engine two minutes later.
 *
 * @param {string} path
 * @returns {{gguf: boolean, version: number|null, reason: string|null}}
 */
export function inspectGguf(path) {
  let fd;
  try {
    fd = openSync(path, "r");
    const head = Buffer.alloc(8);
    const n = readSync(fd, head, 0, 8, 0);
    if (n < 8) {
      return { gguf: false, version: null, reason: "The file is too small to be a model." };
    }
    if (!head.subarray(0, 4).equals(GGUF_MAGIC)) {
      const looksHtml = head.subarray(0, 1).toString() === "<";
      return {
        gguf: false,
        version: null,
        reason: looksHtml
          ? "The file is a web page, not a model. The download probably hit an error page."
          : "The file does not start with the GGUF marker, so it is not a model file.",
      };
    }
    // Little-endian u32 after the magic.
    return { gguf: true, version: head.readUInt32LE(4), reason: null };
  } catch (/** @type {any} */ e) {
    return { gguf: false, version: null, reason: `The file could not be read: ${e && e.message}` };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * What is on disk.
 *
 * Deliberately cheap: a stat and eight bytes per file. A user with forty
 * models should not wait while the app hashes 400GB to draw a list.
 *
 * @param {string} [dir]
 */
export function listModels(dir = defaultModelDir()) {
  mkdirSync(dir, { recursive: true });
  /** @type {any[]} */
  const out = [];

  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith(".gguf")) continue;
    const path = join(dir, name);
    let size = 0;
    /** @type {number|null} */
    let modifiedMs = null;
    try {
      const st = statSync(path);
      size = st.size;
      /* When the file was last written. The models page sorts on it and shows
         it in a column, and a stat already has it — asking for it separately
         would be a second syscall per file for a number we just read. */
      modifiedMs = st.mtimeMs;
    } catch { continue; }

    const head = inspectGguf(path);
    out.push({
      name,
      path,
      bytes: size,
      modifiedMs,
      /* A file that is present but not a model is listed rather than hidden.
         Hiding it means the user sees a download "succeed" and then cannot
         find what it produced. */
      usable: head.gguf,
      problem: head.reason,
      ggufVersion: head.version,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** A partially downloaded file, if there is one. */
export function partialFor(path) {
  const part = `${path}.part`;
  if (!existsSync(part)) return null;
  try { return { path: part, bytes: statSync(part).size }; }
  catch { return null; }
}

/**
 * Hash a file, reporting progress.
 *
 * Streamed, because these files do not fit in memory. Progress is reported
 * because hashing 40GB takes minutes and a frozen dialog is indistinguishable
 * from a hung one.
 *
 * @param {string} path
 * @param {(done: number, total: number) => void} [onProgress]
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>}
 */
export function hashFile(path, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const total = statSync(path).size;
    const h = createHash("sha256");
    const stream = createReadStream(path);
    let done = 0;
    let lastTick = 0;

    const abort = () => {
      stream.destroy();
      reject(new Error("Verification was stopped."));
    };
    if (signal) {
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
    }

    stream.on("data", (chunk) => {
      h.update(chunk);
      done += chunk.length;
      const now = Date.now();
      if (onProgress && now - lastTick > 250) {
        lastTick = now;
        onProgress(done, total);
      }
    });
    stream.on("error", reject);
    stream.on("end", () => {
      if (onProgress) onProgress(total, total);
      resolve(h.digest("hex"));
    });
  });
}

/**
 * Check a file against everything known about it.
 *
 * Cheap checks first, on purpose. A size mismatch or a missing GGUF marker is
 * known in a millisecond, and there is no reason to spend four minutes hashing
 * a file already known to be wrong.
 *
 * @param {object} input
 * @param {string} input.path
 * @param {number|null} [input.expectedBytes]
 * @param {string|null} [input.expectedSha256]
 * @param {(done: number, total: number) => void} [input.onProgress]
 * @param {AbortSignal} [input.signal]
 */
export async function verifyModel({ path, expectedBytes = null, expectedSha256 = null, onProgress, signal }) {
  if (!existsSync(path)) {
    return { ok: false, reason: "The file is not there.", checked: [] };
  }
  const checked = [];

  const size = statSync(path).size;
  if (expectedBytes != null) {
    checked.push("size");
    if (size !== expectedBytes) {
      return {
        ok: false,
        checked,
        reason: `The file is ${size} bytes; it should be ${expectedBytes}. `
          + "It is incomplete or was replaced.",
      };
    }
  }

  const head = inspectGguf(path);
  checked.push("format");
  if (!head.gguf) {
    return { ok: false, checked, reason: head.reason ?? "Not a GGUF file." };
  }

  if (!expectedSha256) {
    /* Said plainly rather than reported as a pass. "Verified" has to mean
       something, and a file nobody has a hash for has not been verified —
       it has been found to be the right size and shape. */
    return {
      ok: true,
      checked,
      verified: false,
      reason: "No checksum is known for this file, so its contents were not verified. "
        + "Its size and format are right.",
    };
  }

  checked.push("sha256");
  const got = await hashFile(path, onProgress, signal);
  if (got !== expectedSha256) {
    return {
      ok: false,
      checked,
      reason: "The file's checksum does not match. It is corrupt, or it is not the "
        + "file it claims to be. It has not been deleted; delete it and download again.",
      expected: expectedSha256,
      got,
    };
  }
  return { ok: true, checked, verified: true, sha256: got };
}

/** @param {string} path */
export function deleteModel(path) {
  if (!path.toLowerCase().endsWith(".gguf")) {
    throw new Error("Only .gguf files are deleted through here.");
  }
  rmSync(path, { force: true });
  rmSync(`${path}.part`, { force: true });
  return { ok: true };
}
