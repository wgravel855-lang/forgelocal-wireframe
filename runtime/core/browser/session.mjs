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
import { join, basename } from "node:path";
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

/**
 * How often the panel's live view may be refreshed.
 *
 * A preview is a JPEG of the viewport, which at this quality is tens of
 * kilobytes. A run that scrolls forty times in a second would otherwise push
 * forty images down the pipe to draw one. This is the interval, not a debounce:
 * the first change after a quiet moment is drawn immediately.
 */
export const PREVIEW_EVERY_MS = 400;

/** The preview's long edge. Small on purpose; it is a view, not evidence. */
export const PREVIEW_WIDTH = 640;

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
 * @param {boolean} [opts.previews]    stream a small view of the page to the panel
 */
export async function createBrowserSession({
  emit, downloadDir, playwright = null, headless = true, previews = true,
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
  /* A deliberately ordinary, non-identifying viewport. Matching the user's
     real screen would be fingerprinting them to every site the agent opens.
     Mutable because the panel offers a viewport selector: checking a layout at
     phone width is a thing people do, and changing it here means the person
     and the agent are looking at the same page rather than two. */
  let viewport = { width: 1280, height: 800 };
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport,
  });
  context.setDefaultTimeout(ACTION_TIMEOUT);
  context.setDefaultNavigationTimeout(NAV_TIMEOUT);

  /** @type {any[]} */
  const findings = [];
  let version = 0;
  let snapshotId = "s0";
  let closed = false;
  /* ref -> what that element was when it was snapshotted. The permission
     classifier needs the accessible name of the thing a click would hit, and
     reading it back off the page at decision time would mean deciding against
     a DOM that may already have changed. */
  /** @type {Map<string, {role: string, name: string}>} */
  const refIndex = new Map();

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
      } catch (/** @type {any} */ e) {
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

  /**
   * Send the panel a picture of what the page looks like now.
   *
   * This is what makes the work surface a work surface rather than a log: the
   * person can see the page the agent is on. It is deliberately a *separate*
   * event from the browser_screenshot tool, and deliberately small — the model
   * gets a full-quality image when it asks for one; this is for a human
   * glancing at a panel, and it must not cost enough to be worth switching off.
   *
   * Failure is silent on purpose. A preview is a convenience; a run must not
   * fail because the page was mid-navigation when the panel wanted a picture.
   */
  let lastPreview = 0;
  let previewing = false;
  const preview = async (force = false) => {
    if (closed || !previews || previewing) return;
    const at = Date.now();
    if (!force && at - lastPreview < PREVIEW_EVERY_MS) return;
    previewing = true;
    lastPreview = at;
    try {
      const p = current();
      const buf = await p.screenshot({ type: "jpeg", quality: 45, scale: "css" });
      emit("browser_preview", {
        url: p.url(),
        title: await p.title().catch(() => ""),
        mime: "image/jpeg",
        bytes: buf.length,
        width: viewport.width,
        height: viewport.height,
        image: buf.toString("base64"),
      });
    } catch { /* a preview is never worth failing a run for */ }
    finally { previewing = false; }
  };

  return {
    id,
    get quarantineDir() { return quarantine; },
    get closed() { return closed; },
    get findings() { return findings.slice(); },
    get snapshotId() { return snapshotId; },
    /* Where the session is now. The permission policy needs this to work out
       the origin an action would land on, and it has to come from the page
       rather than from the URL the model last asked for: a redirect moves the
       origin without the model saying anything. */
    get url() { return closed ? "" : current().url(); },

    /**
     * What the last snapshot said a ref was.
     *
     * Returns the role and accessible name only, and returns null for a ref
     * from an older snapshot. The caller is the permission classifier, which
     * uses the name to make a decision *stricter* and never looser, so a page
     * that lies about its own button names can cost the user an extra prompt
     * and nothing else.
     *
     * @param {string} ref @returns {{role: string, name: string}|null}
     */
    describeRef(ref) {
      const r = String(ref ?? "");
      if (!r.startsWith(`${snapshotId}-`)) return null;
      return refIndex.get(r) ?? null;
    },

    async navigate(url) {
      const p = current();
      const res = await p.goto(url, { waitUntil: "domcontentloaded" });
      emit("browser_navigated", {
        url: p.url(), title: await p.title(), status: res ? res.status() : null,
      });
      await preview(true);
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
      refIndex.clear();
      for (const node of raw.nodes ?? []) {
        if (node.ref) refIndex.set(node.ref, { role: node.role, name: node.name });
      }
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
      await preview();
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
      await preview();
      return { ok: true, typed: name };
    },

    async select(ref, values) {
      const loc = locate(ref);
      const name = await describe(loc);
      await loc.selectOption(values, { timeout: ACTION_TIMEOUT });
      emit("browser_action", { action: "select", target: name, url: current().url(), ok: true });
      await preview();
      return { ok: true, selected: name };
    },

    async press(key) {
      await current().keyboard.press(String(key));
      emit("browser_action", { action: "keypress", target: String(key), url: current().url(), ok: true });
      await preview();
      return { ok: true, pressed: key };
    },

    async scroll(direction = "down", amount = 600) {
      const dy = direction === "up" ? -Math.abs(amount) : Math.abs(amount);
      await current().mouse.wheel(0, dy);
      emit("browser_action", { action: "scroll", target: direction, url: current().url(), ok: true });
      await preview();
      return { ok: true };
    },

    /** @param {{text?: string|null, ms?: number|null}} [opts] */
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

    /**
     * Hand files from the project to a file input on the page.
     *
     * The most consequential thing in this file: it is the one action that
     * moves the user's data outward. Paths arrive already resolved inside the
     * project root by the caller, and the policy above classifies this as
     * always-confirm, so a page cannot obtain a file by asking for one.
     *
     * @param {string} ref @param {string[]} paths absolute, inside the root
     */
    async uploadTo(ref, paths) {
      const loc = locate(ref);
      const name = await describe(loc);
      await loc.setInputFiles(paths, { timeout: ACTION_TIMEOUT });
      emit("browser_action", {
        action: "upload", target: name, url: current().url(), ok: true,
        // Names, not contents, and not the absolute paths: an event is
        // written to disk and a home directory is identifying.
        detail: `${paths.length} file(s): ${paths.map((p) => basename(p)).join(", ")}`,
      });
      return { ok: true, target: name };
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

    /**
     * What the person pressed in the panel.
     *
     * Separate from the tools on purpose, and deliberately a closed set. The
     * model's browsing goes through the permission policy; this does not,
     * because it is the person acting directly and there is nobody to ask. The
     * price of that is that it must not be able to do anything a person could
     * not do with four buttons: there is no navigate-to-URL here, so this
     * cannot be turned into a general-purpose driver by a compromised
     * renderer. Back, forward and reload can only move within history the
     * person already approved reaching.
     *
     * @param {"back"|"forward"|"reload"} what
     */
    async goBackForwardOrReload(what) {
      const p = current();
      const was = p.url();
      const res = what === "back" ? await p.goBack({ waitUntil: "domcontentloaded" })
        : what === "forward" ? await p.goForward({ waitUntil: "domcontentloaded" })
        : await p.reload({ waitUntil: "domcontentloaded" });

      /* Two signals, because neither alone is right. goBack resolves to null
         when there is nothing behind it — but ALSO when the page it went back
         to has no network response, which is every data: URL and every
         same-document navigation. Checking the URL alone misses a back to the
         same address. Either one moving means it moved; a reload always did. */
      const moved = what === "reload" || res !== null || p.url() !== was;
      emit("browser_navigated", {
        url: p.url(), title: await p.title().catch(() => ""),
        status: res ? res.status() : null, by: "user", action: what, moved,
      });
      await preview(true);
      return { ok: true, moved, url: p.url() };
    },

    /**
     * Resize the page the agent is looking at.
     *
     * Applied to every open tab, not only the current one, so switching tabs
     * does not silently switch back to the old size.
     * @param {number} width @param {number} height
     */
    async setViewport(width, height) {
      viewport = {
        width: Math.max(320, Math.min(2560, Math.round(width))),
        height: Math.max(320, Math.min(2000, Math.round(height))),
      };
      for (const t of context.pages()) await t.setViewportSize(viewport).catch(() => {});
      emit("browser_viewport", { ...viewport });
      await preview(true);
      return { ok: true, ...viewport };
    },

    get viewport() { return { ...viewport }; },

    /** Ask for a fresh view now, ignoring the throttle. */
    refreshPreview() { return preview(true); },

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
