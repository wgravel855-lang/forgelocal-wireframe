// @ts-check
/**
 * One isolated browser per agent session.
 *
 * **The isolation boundary, stated plainly.** Every ForgeLocal session gets its
 * own Playwright `BrowserContext`, created with no `storageState` and never
 * from `launchPersistentContext`. That context has its own cookie jar, its own
 * localStorage, its own sessionStorage, its own cache and its own permissions,
 * and all of it is destroyed with the context. The user's real Edge or Chrome
 * profile is never opened: what is shared is the browser *binary* on disk, in
 * the same way two programs share libc. No profile directory, no history, no
 * saved passwords, no extensions, no logged-in sessions.
 *
 * That matters most for what it prevents. An agent told to "check my dashboard"
 * cannot reach an account the user is signed into in their own browser, because
 * it is not that browser. If the task genuinely needs a login, the run pauses
 * and the person does it — see `pauseForHuman` — and even then the credentials
 * are typed by a human into a window, never handled by the model.
 *
 * **Where this runs.** Inside the privileged runtime process, never the
 * renderer. The renderer gets events describing what happened; it never holds a
 * page handle, so a compromised renderer cannot drive a browser.
 *
 * **Stale references.** Every snapshot bumps a version and stamps fresh refs.
 * An action naming a ref from an older snapshot is refused rather than resolved
 * — after a re-render, `e7` may be a different button, and clicking "whatever
 * is at position 7 now" is how an agent deletes the wrong record.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { WALKER, renderSnapshot } from "./snapshot.mjs";

/** Where a Chromium-family binary might be, in preference order. */
const BINARIES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/** How long any single browser operation may take. */
export const ACTION_TIMEOUT = 15_000;
export const NAV_TIMEOUT = 30_000;

/** Console and network findings kept per session. */
const MAX_FINDINGS = 100;

/** Page text returned to the model in one read. */
export const MAX_TEXT = 20 * 1024;

/** @returns {string|null} */
export function findBrowserBinary(extra = process.env.FORGELOCAL_BROWSER) {
  if (extra && existsSync(extra)) return extra;
  return BINARIES.find((p) => existsSync(p)) ?? null;
}

/**
 * A stale-reference error, distinguishable from a missing element so the model
 * is told to re-snapshot rather than told the button does not exist.
 */
export class StaleRef extends Error {
  constructor(ref, current) {
    super(
      `${ref} is from an earlier snapshot of this page. The page has changed since. `
      + `Call browser_snapshot again and use a ref from snapshot ${current}.`,
    );
    this.name = "StaleRef";
    this.ref = ref;
  }
}

/**
 * Create an isolated browser session.
 *
 * @param {object} opts
 * @param {(type: string, payload: any) => void} opts.emit  the event sink
 * @param {string} [opts.downloadDir]  quarantine for anything the page saves
 * @param {any} [opts.playwright]      injectable, so tests need no browser
 * @param {boolean} [opts.headless]
 */
export async function createBrowserSession({
  emit, downloadDir, playwright = null, headless = true,
}) {
  const pw = playwright ?? (await import("playwright-core")).chromium;
  const exe = playwright ? null : findBrowserBinary();
  if (!playwright && !exe) {
    throw new Error(
      "No Chromium-family browser was found. Install Microsoft Edge or Google Chrome, "
      + "or set FORGELOCAL_BROWSER to a browser executable.",
    );
  }

  const id = randomUUID();
  const quarantine = downloadDir ?? join(process.cwd(), ".forgelocal", "downloads", id);
  mkdirSync(quarantine, { recursive: true });

  const browser = await pw.launch({
    ...(exe ? { executablePath: exe } : {}),
    headless,
    args: [
      // The page is untrusted content; it gets no more of the machine than it
      // needs to render itself.
      "--disable-background-networking",
      "--disable-sync",
      "--disable-extensions",
      "--no-default-browser-check",
      "--no-first-run",
    ],
  });

  /* The isolation boundary. No storageState, no persistent profile: this
     context begins with an empty cookie jar and takes nothing from the user's
     own browser, and everything it accumulates dies with close(). */
  const context = await browser.newContext({
    acceptDownloads: true,
    // A deliberately ordinary, non-identifying viewport. Matching the user's
    // real screen would be fingerprinting them to every site the agent opens.
    viewport: { width: 1280, height: 800 },
  });
  context.setDefaultTimeout(ACTION_TIMEOUT);
  context.setDefaultNavigationTimeout(NAV_TIMEOUT);

  /** @type {any[]} */
  const findings = [];
  let version = 0;
  let snapshotId = "s0";
  let closed = false;

  const note = (kind, payload) => {
    findings.push({ kind, ...payload, at: Date.now() });
    if (findings.length > MAX_FINDINGS) findings.shift();
    emit("browser_finding", { kind, ...payload });
  };

  /** Wire a page for evidence collection. Every page, including popups. */
  const watch = (page) => {
    page.on("console", (msg) => {
      const type = msg.type();
      if (type !== "error" && type !== "warning") return;
      note("console", { level: type, text: String(msg.text()).slice(0, 500) });
    });
    page.on("pageerror", (err) => {
      note("console", { level: "error", text: String(err && err.message ? err.message : err).slice(0, 500) });
    });
    page.on("requestfailed", (req) => {
      note("network", {
        level: "error",
        text: `${req.method()} ${req.url()} failed: ${req.failure()?.errorText ?? "unknown"}`,
        url: req.url(),
      });
    });
    page.on("response", (res) => {
      if (res.status() < 400) return;
      note("network", {
        level: res.status() >= 500 ? "error" : "warning",
        text: `${res.request().method()} ${res.url()} -> ${res.status()}`,
        url: res.url(), status: res.status(),
      });
    });
    /* Downloads land in quarantine and nothing moves them. The brief is
       explicit that a download must not execute and must not reach the
       project without approval; the simplest way to guarantee both is for
       the only place it ever exists to be a directory outside the project. */
    page.on("download", async (dl) => {
      const name = dl.suggestedFilename();
      const target = join(quarantine, `${Date.now()}-${name}`);
      try {
        await dl.saveAs(target);
        note("download", {
          level: "info",
          text: `Downloaded ${name} to quarantine. It has not been moved into the project and has not been run.`,
          url: dl.url(),
        });
      } catch (e) {
        note("download", { level: "error", text: `Download of ${name} failed: ${e && e.message}` });
      }
    });
  };

  const page = await context.newPage();
  watch(page);
  context.on("page", watch);

  emit("browser_session_started", { browser_session_id: id, isolated: true });

  /** The page actions operate on: the last one opened, or the first. */
  const current = () => {
    const pages = context.pages();
    return pages[pages.length - 1] ?? page;
  };

  /**
   * Resolve a ref to a locator, refusing anything from an older snapshot.
   * @param {string} ref
   */
  const locate = (ref) => {
    const r = String(ref ?? "");
    if (!r.startsWith(`${snapshotId}-`)) throw new StaleRef(r, snapshotId);
    return current().locator(`[data-fl-ref="${r}"]`);
  };

  return {
    id,
    get quarantineDir() { return quarantine; },
    get closed() { return closed; },
    get findings() { return findings.slice(); },
    get snapshotId() { return snapshotId; },

    async navigate(url) {
      const p = current();
      const res = await p.goto(url, { waitUntil: "domcontentloaded" });
      emit("browser_navigated", {
        url: p.url(), title: await p.title(), status: res ? res.status() : null,
      });
      return { url: p.url(), title: await p.title(), status: res ? res.status() : null };
    },

    /**
     * Walk the page and hand back something actionable.
     *
     * Every call invalidates the previous refs, on purpose: a snapshot is a
     * statement about the page at one moment, and letting two generations of
     * refs coexist is how an agent acts on a layout that has moved.
     */
    async snapshot() {
      version += 1;
      snapshotId = `s${version}`;
      /* Passed as one expression rather than evaluate(fn, arg): Playwright
         treats a string as an expression to evaluate and silently drops the
         second argument, so the walker ran with version undefined. */
      const raw = await current().evaluate(
        `(${WALKER})(${JSON.stringify(snapshotId)})`);
      emit("browser_snapshot", {
        snapshot_id: snapshotId, url: raw.url, title: raw.title,
        elements: raw.interactive,
      });
      return { ...raw, snapshotId, text: renderSnapshot(raw) };
    },

    async click(ref) {
      const loc = locate(ref);
      const name = await describe(loc);
      await loc.click({ timeout: ACTION_TIMEOUT });
      emit("browser_action", { action: "click", target: name, url: current().url(), ok: true });
      return { ok: true, clicked: name };
    },

    async type(ref, text, { submit = false } = {}) {
      const loc = locate(ref);
      const name = await describe(loc);
      await loc.fill(String(text), { timeout: ACTION_TIMEOUT });
      if (submit) await loc.press("Enter");
      emit("browser_action", {
        action: "type", target: name, url: current().url(), ok: true,
        // The value is NOT emitted. A typed value can be a password even when
        // the field is not marked as one, and an event is written to disk.
        detail: `${String(text).length} characters`,
      });
      return { ok: true, typed: name };
    },

    async select(ref, values) {
      const loc = locate(ref);
      const name = await describe(loc);
      await loc.selectOption(values, { timeout: ACTION_TIMEOUT });
      emit("browser_action", { action: "select", target: name, url: current().url(), ok: true });
      return { ok: true, selected: name };
    },

    async press(key) {
      await current().keyboard.press(String(key));
      emit("browser_action", { action: "keypress", target: String(key), url: current().url(), ok: true });
      return { ok: true, pressed: key };
    },

    async scroll(direction = "down", amount = 600) {
      const dy = direction === "up" ? -Math.abs(amount) : Math.abs(amount);
      await current().mouse.wheel(0, dy);
      emit("browser_action", { action: "scroll", target: direction, url: current().url(), ok: true });
      return { ok: true };
    },

    async waitFor({ text = null, ms = null } = {}) {
      const p = current();
      if (text) {
        await p.getByText(String(text), { exact: false }).first()
          .waitFor({ state: "visible", timeout: ACTION_TIMEOUT });
        return { ok: true, found: text };
      }
      await p.waitForTimeout(Math.min(Number(ms) || 500, 5000));
      return { ok: true };
    },

    async readText() {
      const p = current();
      const body = await p.locator("body").innerText().catch(() => "");
      const truncated = body.length > MAX_TEXT;
      return {
        url: p.url(), title: await p.title(),
        text: body.slice(0, MAX_TEXT), truncated,
      };
    },

    async tabs() {
      const pages = context.pages();
      return Promise.all(pages.map(async (t, i) => ({
        index: i, url: t.url(), title: await t.title().catch(() => ""),
        active: t === current(),
      })));
    },

    /** An in-memory screenshot, bounded so it cannot flood a context. */
    async screenshot({ fullPage = false } = {}) {
      const buf = await current().screenshot({ fullPage, type: "jpeg", quality: 60 });
      return { bytes: buf.length, base64: buf.toString("base64"), mime: "image/jpeg" };
    },

    consoleMessages() { return findings.filter((f) => f.kind === "console"); },
    networkFindings() { return findings.filter((f) => f.kind === "network"); },
    downloads() { return findings.filter((f) => f.kind === "download"); },

    async close() {
      if (closed) return;
      closed = true;
      // Cookies and storage die with the context. Nothing is persisted, and
      // nothing is carried into the next session.
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      emit("browser_session_closed", { browser_session_id: id });
    },
  };
}

/** A short description of what an action targeted, for the event. */
async function describe(loc) {
  try {
    const role = await loc.getAttribute("role");
    const name = (await loc.textContent())?.trim()
      || await loc.getAttribute("aria-label")
      || await loc.getAttribute("placeholder")
      || "";
    const tag = (await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "")) || "";
    const label = String(name).replace(/\s+/g, " ").slice(0, 60);
    return label ? `${role || tag} "${label}"` : (role || tag || "element");
  } catch {
    return "element";
  }
}
