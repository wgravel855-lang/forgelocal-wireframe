// @ts-check
/**
 * Durable session state.
 *
 * Everything the agent did has to survive the host being killed, and it has to
 * come back as the *same* session rather than a plausible reconstruction of
 * one. That is why the event log is the store's primary object and everything
 * else — the plan, the pending question, the permission request, the final
 * result — is derived from it by the same reducer the UI uses. There is one
 * source of truth, so a restored session cannot disagree with the live one.
 *
 * Three decisions worth stating:
 *
 * **SQLite, through node:sqlite.** Node 24 ships it, so durable structured
 * state costs no dependency. The alternative was a JSON file per session, which
 * is fine until two writes interleave or the process dies mid-write and the
 * session is gone rather than truncated.
 *
 * **Large output lives outside the database.** A command that prints 40MB is
 * one row in `events` with a reference, and 40MB in a session file. Keeping it
 * inline would mean every replay of that session reads 40MB to render a row
 * that says "exit 0", and the model's context never wanted it either.
 *
 * **Nothing here re-executes.** Replay folds events into state. It never calls
 * a tool, never touches the project, and never emits. That is the whole reason
 * a restarted session is safe to reopen: the events already happened, and
 * reading them cannot make them happen again.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

/** Anything longer than this becomes a file and a reference. */
export const INLINE_LIMIT = 8 * 1024;

/**
 * Where sessions live when nobody says otherwise.
 *
 * Per-user application data, not the project: a session is a record of a
 * conversation, and writing it into the folder the agent is editing would put
 * it in the user's repository, in their diffs, and eventually in their commits.
 *
 * FORGELOCAL_STATE_DIR overrides it, which is how the tests get a temporary
 * directory without the sidecar needing a parameter it would only ever be
 * given by a test.
 *
 * @param {NodeJS.ProcessEnv} [env] @param {string} [platform]
 */
export function defaultStoreDir(env = process.env, platform = process.platform) {
  if (env.FORGELOCAL_STATE_DIR) return env.FORGELOCAL_STATE_DIR;
  const home = env.USERPROFILE || env.HOME || ".";
  if (platform === "win32") {
    return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "ForgeLocal", "sessions");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "ForgeLocal", "sessions");
  }
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "forgelocal", "sessions");
}

/** What a session was doing when it stopped being written to. */
export const SessionStatus = Object.freeze({
  RUNNING: "running",
  /**
   * Open, with nothing in flight.
   *
   * The state between turns, and a distinct one: a session sitting idle
   * when the host dies has lost nothing, and a session mid-turn has. Without
   * it every session that had ever run came back labelled interrupted, which
   * makes the label mean nothing.
   */
  IDLE: "idle",
  AWAITING_USER: "awaiting_user",
  AWAITING_PERMISSION: "awaiting_permission",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  FAILED: "failed",
  /** The host died while this was running. Set on open, never by a live run. */
  INTERRUPTED: "interrupted",
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  root          TEXT NOT NULL,
  title         TEXT,
  mode          TEXT NOT NULL,
  style         TEXT NOT NULL DEFAULT 'adaptive',
  model         TEXT,
  status        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  /* Set when a run ends cleanly. Its absence on open is what identifies a
     session the host died in the middle of. */
  closed_at     INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  session_id    TEXT NOT NULL,
  sequence      INTEGER NOT NULL,
  event_id      TEXT NOT NULL,
  turn_id       TEXT,
  type          TEXT NOT NULL,
  timestamp     INTEGER NOT NULL,
  payload       TEXT NOT NULL,
  PRIMARY KEY (session_id, sequence)
);

/* The event id is what makes replay idempotent, so it is enforced here rather
   than hoped for: the same event written twice is rejected by the database. */
CREATE UNIQUE INDEX IF NOT EXISTS events_unique_id ON events (session_id, event_id);

CREATE TABLE IF NOT EXISTS blobs (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  kind          TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

/* The pre-compaction transcript, kept for audit and replay. Compaction
   rewrites what the model sees; it must not rewrite what happened. */
CREATE TABLE IF NOT EXISTS compactions (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  at_sequence   INTEGER NOT NULL,
  summary       TEXT NOT NULL,
  dropped       INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
`;

/**
 * Open (or create) the store.
 * @param {string} dir  a directory the runtime owns; created if absent
 */
export function openStore(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, "sessions.db"));
  // Durability without fsync on every write: a crash can lose the last
  // fraction of a second, not the session.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);

  const blobDir = join(dir, "blobs");
  mkdirSync(blobDir, { recursive: true });

  const stmt = {
    createSession: db.prepare(
      `INSERT INTO sessions (id, root, title, mode, style, model, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    touchSession: db.prepare("UPDATE sessions SET updated_at = ?, status = ? WHERE id = ?"),
    closeSession: db.prepare(
      "UPDATE sessions SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?"),
    setTitle: db.prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?"),
    setRoot: db.prepare("UPDATE sessions SET root = ?, updated_at = ? WHERE id = ?"),
    getSession: db.prepare("SELECT * FROM sessions WHERE id = ?"),
    listSessions: db.prepare(
      "SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?"),
    appendEvent: db.prepare(
      `INSERT OR IGNORE INTO events (session_id, sequence, event_id, turn_id, type, timestamp, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`),
    readEvents: db.prepare(
      "SELECT * FROM events WHERE session_id = ? ORDER BY sequence ASC"),
    lastSequence: db.prepare(
      "SELECT MAX(sequence) AS seq FROM events WHERE session_id = ?"),
    addBlob: db.prepare(
      "INSERT INTO blobs (id, session_id, kind, bytes, created_at) VALUES (?, ?, ?, ?, ?)"),
    addCompaction: db.prepare(
      `INSERT INTO compactions (id, session_id, at_sequence, summary, dropped, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`),
    lastCompaction: db.prepare(
      "SELECT * FROM compactions WHERE session_id = ? ORDER BY at_sequence DESC LIMIT 1"),
    countCompactions: db.prepare(
      "SELECT COUNT(*) AS n FROM compactions WHERE session_id = ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
    deleteEvents: db.prepare("DELETE FROM events WHERE session_id = ?"),
    deleteBlobs: db.prepare("DELETE FROM blobs WHERE session_id = ?"),
    deleteCompactions: db.prepare("DELETE FROM compactions WHERE session_id = ?"),
  };

  const now = () => Date.now();

  return {
    /**
     * @param {object} s
     * @param {string} [s.id]
     * @param {string} s.root  the project folder, or "" for a session with none
     * @param {string} s.mode
     * @param {string} [s.style] @param {string|null} [s.model] @param {string|null} [s.title]
     * @returns {string} the session id
     */
    createSession({ id = randomUUID(), root, mode, style = "adaptive", model = null, title = null }) {
      const t = now();
      stmt.createSession.run(id, root, title, mode, style, model, SessionStatus.RUNNING, t, t);
      return id;
    },

    /** @param {string} id */
    getSession(id) {
      return stmt.getSession.get(id) ?? null;
    },

    /** @param {number} [limit] */
    listSessions(limit = 50) {
      return stmt.listSessions.all(limit);
    },

    /** @param {string} id @param {string|null} title */
    setTitle(id, title) {
      stmt.setTitle.run(title, now(), id);
    },

    /**
     * The folder this session works in, changed after the fact.
     *
     * A conversation can start without one and be given one partway through,
     * which is the ordinary case rather than an odd one: the model is told to
     * ask for a folder when it needs a file it cannot read. The row is updated
     * rather than a second session being written, because it is one
     * conversation — and splitting it would leave the half that explains why
     * the folder was opened attached to a session with no folder.
     *
     * `""` means no folder. The column is NOT NULL and an empty string is
     * already what a session with no project is stored as.
     *
     * @param {string} id @param {string} root
     */
    setRoot(id, root) {
      stmt.setRoot.run(root, now(), id);
    },

    /** @param {string} id @param {string} status */
    setStatus(id, status) {
      stmt.touchSession.run(now(), status, id);
    },

    /** @param {string} id @param {string} status */
    closeSession(id, status) {
      const t = now();
      stmt.closeSession.run(status, t, t, id);
    },

    /**
     * Append one event.
     *
     * INSERT OR IGNORE on the unique event id, so writing the same event twice
     * — which a reconnecting client will do — is a no-op rather than a
     * duplicate row or an exception the caller has to know about.
     *
     * @param {string} sessionId @param {any} ev
     */
    appendEvent(sessionId, ev) {
      const { payload, blobs } = externalise(sessionId, ev.payload ?? {}, blobDir, stmt, now);
      stmt.appendEvent.run(
        sessionId,
        Number(ev.sequence),
        String(ev.event_id),
        ev.turn_id ?? null,
        String(ev.type),
        Number(ev.timestamp ?? now()),
        JSON.stringify(payload),
      );
      stmt.touchSession.run(now(), statusFor(ev.type) ?? currentStatus(stmt, sessionId), sessionId);
      return blobs;
    },

    /**
     * Every event for a session, in order, with blob references resolved back
     * to their content when the caller asks for it.
     * @param {string} sessionId
     * @param {{inflate?: boolean}} [opts]
     */
    readEvents(sessionId, { inflate = false } = {}) {
      return stmt.readEvents.all(sessionId).map((row) => ({
        event_id: row.event_id,
        session_id: sessionId,
        turn_id: row.turn_id,
        sequence: row.sequence,
        type: row.type,
        timestamp: row.timestamp,
        payload: inflate
          ? internalise(JSON.parse(String(row.payload)), blobDir)
          : JSON.parse(String(row.payload)),
      }));
    },

    /** @param {string} sessionId */
    lastSequence(sessionId) {
      const r = stmt.lastSequence.get(sessionId);
      return r && r.seq != null ? Number(r.seq) : 0;
    },

    /** Read one externalised blob by reference. @param {string} ref */
    readBlob(ref) {
      const file = join(blobDir, `${ref}.txt`);
      return existsSync(file) ? readFileSync(file, "utf8") : null;
    },

    /**
     * @param {{sessionId: string, atSequence: number, summary: string,
     *   dropped: number}} c
     */
    recordCompaction({ sessionId, atSequence, summary, dropped }) {
      const id = randomUUID();
      stmt.addCompaction.run(id, sessionId, atSequence, summary, dropped, now());
      return id;
    },

    /** @param {string} sessionId */
    lastCompaction(sessionId) {
      return stmt.lastCompaction.get(sessionId) ?? null;
    },

    /** @param {string} sessionId */
    compactionCount(sessionId) {
      const r = stmt.countCompactions.get(sessionId);
      return r ? Number(r.n) : 0;
    },

    /**
     * Sessions the host was in the middle of when it stopped.
     *
     * A session is interrupted when it has no closed_at. Nothing sets this
     * flag at crash time — there is no crash-time — so it is inferred on
     * open, which is the only moment the information exists.
     */
    markInterrupted() {
      const open = db.prepare(
        `SELECT id FROM sessions WHERE closed_at IS NULL AND status IN (?, ?, ?)`,
      ).all(SessionStatus.RUNNING, SessionStatus.AWAITING_USER, SessionStatus.AWAITING_PERMISSION);
      // A session waiting on the user is not interrupted: the user simply has
      // not answered yet, and it can be resumed exactly as it stands.
      const stale = db.prepare(
        `UPDATE sessions SET status = ? WHERE closed_at IS NULL AND status = ?`,
      );
      const changed = stale.run(SessionStatus.INTERRUPTED, SessionStatus.RUNNING);
      return { inspected: open.length, interrupted: Number(changed.changes ?? 0) };
    },

    /**
     * Remove a session and everything it owns.
     *
     * The blob files have to be listed from the database before the rows go,
     * because the filename is the only link between them and nothing else
     * records which session wrote which file. Dropping the rows first leaves
     * the bytes on disk with no way left to find them.
     */
    /** @param {string} id */
    deleteSession(id) {
      const files = db.prepare("SELECT id FROM blobs WHERE session_id = ?").all(id);
      stmt.deleteEvents.run(id);
      stmt.deleteBlobs.run(id);
      stmt.deleteCompactions.run(id);
      stmt.deleteSession.run(id);
      for (const f of files) {
        const file = join(blobDir, `${f.id}.txt`);
        if (existsSync(file)) rmSync(file, { force: true });
      }
      return files.length;
    },

    close() { db.close(); },

    /** For tests and diagnostics. */
    get db() { return db; },
    get blobDir() { return blobDir; },
  };
}

/** Which session status an event implies, or null when it implies nothing. */
function statusFor(type) {
  switch (type) {
    case "turn_started": return SessionStatus.RUNNING;
    /* A finished turn leaves the session open and idle, not completed:
       completed is what a session that has been closed is. */
    case "turn_completed": return SessionStatus.IDLE;
    case "question_requested": return SessionStatus.AWAITING_USER;
    case "permission_required": return SessionStatus.AWAITING_PERMISSION;
    case "question_answered":
    case "permission_resolved": return SessionStatus.RUNNING;
    case "turn_cancelled": return SessionStatus.CANCELLED;
    case "runtime_error": return SessionStatus.FAILED;
    default: return null;
  }
}

function currentStatus(stmt, sessionId) {
  const s = stmt.getSession.get(sessionId);
  return s ? String(s.status) : SessionStatus.RUNNING;
}

/** Payload fields large enough to be worth keeping out of the row. */
const BIG_FIELDS = ["output", "content", "text", "snapshot", "body"];

/**
 * Replace oversized strings with references, writing the content to a file.
 *
 * The reference keeps the first part of the value inline, because most readers
 * of a 40MB command output only ever want the first screen of it, and a row
 * that can render without touching the disk is worth the few hundred bytes.
 */
function externalise(sessionId, payload, blobDir, stmt, now) {
  if (!payload || typeof payload !== "object") return { payload, blobs: [] };
  /** @type {string[]} */
  const blobs = [];
  /** @type {any} */
  const out = Array.isArray(payload) ? [...payload] : { ...payload };

  for (const key of BIG_FIELDS) {
    const v = out[key];
    if (typeof v !== "string" || v.length <= INLINE_LIMIT) continue;
    const id = randomUUID();
    const file = join(blobDir, `${id}.txt`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, v, "utf8");
    stmt.addBlob.run(id, sessionId, key, Buffer.byteLength(v), now());
    blobs.push(id);
    out[key] = {
      __blob: id,
      bytes: Buffer.byteLength(v),
      excerpt: v.slice(0, 2000),
      truncated: true,
    };
  }
  return { payload: out, blobs };
}

/** Put the content back, for a caller that asked to inflate. */
function internalise(payload, blobDir) {
  if (!payload || typeof payload !== "object") return payload;
  /** @type {any} */
  const out = Array.isArray(payload) ? [...payload] : { ...payload };
  for (const [k, v] of Object.entries(out)) {
    if (!v || typeof v !== "object" || !("__blob" in v)) continue;
    const file = join(blobDir, `${v.__blob}.txt`);
    out[k] = existsSync(file) ? readFileSync(file, "utf8") : v.excerpt ?? "";
  }
  return out;
}
