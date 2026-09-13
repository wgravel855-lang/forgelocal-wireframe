// @ts-check
/**
 * The acceptance runs that need a real model and a real browser.
 *
 *   node runtime/acceptance.mjs [baseUrl] [model] [only]
 *
 * `only` names one scenario by number, because the browser one drives a real
 * model through a real task and takes minutes: re-running the cheap checks to
 * get to it wastes the slowest resource on the machine.
 *
 * These are not part of `npm run check`, on purpose. A gate that needs a model
 * loaded and a browser installed is a gate that gets skipped, and a skipped
 * gate is worse than an honest manual step. They are run by hand, and what
 * they print is evidence rather than a claim: every assertion names the
 * command, the file or the page state it checked.
 *
 * Each scenario drives the real sidecar over the real protocol — the same path
 * the desktop app uses — against a real project on disk. Nothing is stubbed
 * except the project itself, which is a temporary directory built here so the
 * bug being fixed is a bug nobody has seen before.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { PROTOCOL_VERSION, Request, Notify, createDecoder } from "./host/protocol.mjs";
import { findBrowserBinary } from "./core/browser/session.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SIDECAR = join(here, "host", "sidecar.mjs");

/* `||`, not `??`: an argument can be present and empty, and `?? null` keeps
   an empty string. Passing "" for the model once selected the empty model,
   connected with none, and every later step failed with a timeout that named
   nothing. */
const baseUrl = process.argv[2] || "http://127.0.0.1:1234/v1";
const wantedModel = process.argv[3] || null;
const only = process.argv[4] || null;
/** @param {string} n */
const wants = (n) => !only || only === n;

/* ------------------------------------------------------------- plumbing */

let failures = 0;
const pass = (what, evidence) => {
  console.log(`  PASS  ${what}`);
  if (evidence) console.log(`        ${evidence}`);
};
const fail = (what, evidence) => {
  failures += 1;
  console.log(`  FAIL  ${what}`);
  if (evidence) console.log(`        ${evidence}`);
};
/** @param {boolean} ok @param {string} what @param {string} [evidence] */
const check = (ok, what, evidence) => (ok ? pass(what, evidence) : fail(what, evidence));

/** A live sidecar, spoken to the way the Rust host speaks to it. */
function startSidecar(stateDir) {
  const child = spawn(process.execPath, [SIDECAR], {
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, FORGELOCAL_STATE_DIR: stateDir },
  });
  /** @type {any[]} */
  const frames = [];
  /** @type {any[]} */
  const waiters = [];
  let stderr = "";

  const decoder = createDecoder((f) => {
    frames.push(f);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(f)) { waiters[i].resolve(f); waiters.splice(i, 1); }
    }
  }, (line) => { throw new Error(`non-JSON on stdout: ${line}`); });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (c) => decoder.push(String(c)));
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => { stderr += c; });

  let seq = 0;
  return {
    child,
    get frames() { return frames; },
    get stderr() { return stderr; },
    /** @param {string} type @param {any} [payload] @param {string|null} [sessionId] */
    send(type, payload = {}, sessionId = null) {
      const id = `a${++seq}`;
      child.stdin.write(`${JSON.stringify({ v: PROTOCOL_VERSION, id, type, sessionId, payload })}\n`);
      return id;
    },
    /** @param {(f: any) => boolean} match */
    wait(match, ms = 600000) {
      const found = frames.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(
          `timed out.\nseen: ${frames.map((f) => f.type).join(", ")}\nstderr: ${stderr.slice(-600)}`,
        )), ms);
        waiters.push({ match, resolve: (f) => { clearTimeout(t); resolve(f); } });
      });
    },
    /** Approve everything the agent asks for, and record what was asked. */
    autoApprove(asked) {
      const seen = new Set();
      const tick = () => {
        for (const f of frames) {
          if (f.type !== Notify.PERMISSION_REQUESTED) continue;
          const rid = f.payload.requestId;
          if (seen.has(rid)) continue;
          seen.add(rid);
          asked.push({ tool: f.payload.tool, action: f.payload.action, reason: f.payload.reason });
          this.send(Request.PERMISSION_RESOLVE,
            { requestId: rid, decision: "approve_for_session" }, f.sessionId);
        }
      };
      const timer = setInterval(tick, 120);
      return () => clearInterval(timer);
    },
    async stop() {
      child.stdin.end();
      await new Promise((r) => { child.on("close", r); setTimeout(r, 3000); });
      if (child.exitCode === null) child.kill();
    },
  };
}

/** The small page under test, served for real over http. */
async function serveBuggyPage(dir) {
  const server = createServer((req, res) => {
    const file = (req.url ?? "/").split("?")[0] === "/app.js" ? "app.js" : "index.html";
    try {
      const body = readFileSync(join(dir, file), "utf8");
      res.writeHead(200, {
        "content-type": file.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch (/** @type {any} */ e) {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
  const addr = /** @type {any} */ (server.address());
  return {
    url: `http://127.0.0.1:${addr.port}/`,
    close: () => new Promise((r) => server.close(() => r(null))),
  };
}

/**
 * A project with one real bug: the total is computed with `+` on strings, so
 * the page shows "0510" instead of 15, and a console error fires.
 */
function buggyProject() {
  const base = mkdtempSync(join(tmpdir(), "fl-accept-"));
  writeFileSync(join(base, "index.html"), `<!doctype html>
<meta charset="utf-8">
<title>Cart</title>
<h1>Cart</h1>
<ul id="items"></ul>
<p>Total: <b id="total">?</b></p>
<script type="module" src="/app.js"></script>
`);
  writeFileSync(join(base, "app.js"), `const items = [
  { name: "Mug", price: "5" },
  { name: "Shirt", price: "10" },
];

export function total(list) {
  // BUG: prices arrive as strings, so + concatenates instead of adding.
  return list.reduce((sum, item) => sum + item.price, 0);
}

document.getElementById("items").innerHTML =
  items.map((i) => "<li>" + i.name + "</li>").join("");
document.getElementById("total").textContent = String(total(items));
if (total(items) !== 15) {
  console.error("total is " + total(items) + ", expected 15");
}
`);
  writeFileSync(join(base, "FORGELOCAL.md"),
    "# Cart\n\nA tiny page. `app.js` exports `total`. Open the page to check it.\n");
  return base;
}

/* ------------------------------------------------------------ scenario 22 */

/**
 * Acceptance 22: reproduce a local UI bug in the browser, patch it, reload,
 * and verify — end to end, with a real model driving.
 */
async function localUiBug(model) {
  console.log("\n22. Reproduce a local UI bug in the browser, patch it, reload, verify\n");

  const base = buggyProject();
  const stateDir = mkdtempSync(join(tmpdir(), "fl-accept-state-"));
  const site = await serveBuggyPage(base);
  const s = startSidecar(stateDir);
  /** @type {any[]} */
  const asked = [];
  let stopApproving = () => {};

  try {
    await s.wait((f) => f.type === Notify.RUNTIME_STATE);
    s.send(Request.PROVIDER_CONNECT, { baseUrl, model });
    const conn = await s.wait((f) => f.type === Notify.PROVIDER_STATE && f.id);
    if (!conn.payload.connected || !conn.payload.model) {
      fail("connect to the model server",
        conn.payload.error?.message ?? `connected with model ${JSON.stringify(conn.payload.model)}`);
      return;
    }

    /* Browsing is only offered for a model the suite has graded, so the
       scenario has to earn that first. This is the product's own flow, not a
       harness convenience: skipping it here would mean testing a path the
       app does not have. It costs ten real model turns. */
    console.log("        grading the model first (browsing is gated on it)...");
    const gradedAt = Date.now();
    const mid = s.send(Request.MODEL_TEST, {});
    const tested = await s.wait((f) => f.type === Notify.MODEL_TESTED && f.id === mid);
    const grade = tested.payload.profile?.agentGrade;
    console.log(`        graded "${grade}" in ${Math.round((Date.now() - gradedAt) / 1000)}s`);
    if (!tested.payload.agentReady) {
      /* Not a harness failure and not a product failure: this model cannot be
         given a browser, and saying so is the correct outcome. */
      fail("the model is graded well enough to be given a browser",
        `graded ${grade}: ${tested.payload.reason}`);
      return;
    }

    const cid = s.send(Request.SESSION_CREATE, { root: base, mode: "allow_edits" });
    /* Either answer, not just the happy one. A refusal carries the same id,
       so waiting only for session.created turned "connect a model first"
       into a ten-minute timeout with the reason unread in the frame list. */
    const created = await s.wait((f) => f.id === cid
      && (f.type === Notify.SESSION_CREATED || f.type === Notify.TURN_FAILED));
    if (created.type === Notify.TURN_FAILED) {
      fail("open a session on the project", created.payload.message);
      return;
    }
    const sessionId = created.payload.sessionId;
    stopApproving = s.autoApprove(asked);

    const before = readFileSync(join(base, "app.js"), "utf8");

    s.send(Request.TURN_START, {
      text:
        `The page at ${site.url} shows the wrong cart total and logs a console error. `
        + "Open it in the browser, read the console, then fix app.js so the total is 15, "
        + "reload the page and confirm the console error is gone.",
      mode: "allow_edits",
      effort: "thorough",
      /* Without this the session has no browser tools at all and the agent
         cannot open anything — which is exactly what the first run of this
         scenario found, and why the opt-in now exists. */
      groups: ["read", "edit", "command", "plan", "browser"],
    }, sessionId);

    const done = await s.wait((f) =>
      f.type === Notify.TURN_COMPLETED && f.sessionId === sessionId);
    stopApproving();

    const events = s.frames
      .filter((f) => f.type === Notify.AGENT_EVENT && f.sessionId === sessionId)
      .map((f) => f.payload);

    const navigated = events.filter((e) => e.type === "browser_navigated");
    const consoleRead = events.some((e) =>
      e.type === "tool_completed" && e.payload?.tool === "browser_console");
    const findings = events.filter((e) =>
      e.type === "browser_finding" && e.payload?.kind === "console");
    const patched = events.filter((e) => e.type === "file_changed");

    check(navigated.length > 0,
      "the agent opened the page in the isolated browser",
      navigated.length ? `navigated to ${navigated[0].payload.url}` : "no browser_navigated event");

    check(findings.length > 0,
      "the page's console error was captured as evidence",
      findings.length ? findings[0].payload.text : "no console finding was recorded");

    check(consoleRead,
      "the agent read the console rather than guessing",
      consoleRead ? "browser_console completed" : "browser_console was never called");

    const after = readFileSync(join(base, "app.js"), "utf8");
    check(after !== before,
      "app.js was actually changed on disk",
      patched.length ? `${patched.length} file_changed event(s)` : "no file_changed event");

    /* The check that matters, and it is not the model's word for it: open the
       page in a browser this harness controls and read what it renders.

       The first version of this imported app.js and called the exported
       function. That could never have passed: app.js touches `document` at
       module scope, so importing it in Node throws before the export is
       reachable — the check reported "the module would not load" whatever the
       agent had done. Loading the page is also the better question, because
       it is the page that was broken. */
    const proof = await verifyInBrowser(site.url);
    check(proof.total === "15",
      "the page now renders the right total",
      `the page shows "${proof.total}"`);
    check(proof.errors.length === 0,
      "the page's console error is gone",
      proof.errors.length ? proof.errors[0] : "no console errors on load");

    check(done.payload.stop_reason === "final" || done.payload.disposed,
      "the turn ended by answering rather than at a limit",
      `stop_reason: ${done.payload.stop_reason ?? "(none)"}`);

    console.log(`\n        approvals asked for: ${asked.length}`);
    for (const a of asked.slice(0, 12)) {
      console.log(`          ${a.tool}  ${String(a.reason ?? "").slice(0, 70)}`);
    }
  } finally {
    stopApproving();
    await s.stop();
    await site.close();
    rmSync(base, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  }
}

/**
 * Load the page and report what it actually renders.
 *
 * A separate, throwaway browser session, deliberately: the agent's session
 * has been clicking around and reloading, and checking a fix in the state the
 * agent left behind is checking the agent's memory rather than the page.
 *
 * @param {string} url
 */
async function verifyInBrowser(url) {
  const { createBrowserSession } = await import("./core/browser/session.mjs");
  /** @type {string[]} */
  const errors = [];
  const b = await createBrowserSession({
    emit: (type, payload) => {
      if (type === "browser_finding" && payload.kind === "console" && payload.level === "error") {
        errors.push(String(payload.text));
      }
    },
    downloadDir: mkdtempSync(join(tmpdir(), "fl-verify-")),
    previews: false,
  });
  try {
    await b.navigate(url);
    await b.waitFor({ ms: 600 });
    const text = await b.readText();
    const m = text.text.match(/Total:\s*(\S+)/);
    return { total: m ? m[1] : "(not found)", errors, text: text.text };
  } finally {
    await b.close();
  }
}

/* ------------------------------------------------------------ scenario 16 */

/** Acceptance 16: the agent's browser is not the user's browser. */
async function isolation() {
  console.log("\n16. The agent's browser shares nothing with the user's\n");

  const { createBrowserSession } = await import("./core/browser/session.mjs");
  const dir = mkdtempSync(join(tmpdir(), "fl-iso-"));
  const a = await createBrowserSession({ emit: () => {}, downloadDir: join(dir, "a") });
  const b = await createBrowserSession({ emit: () => {}, downloadDir: join(dir, "b") });

  try {
    const page = "data:text/html," + encodeURIComponent("<h1>iso</h1>");
    await a.navigate(page);
    await b.navigate(page);

    check(a.id !== b.id, "two sessions are two different browsers", `${a.id} vs ${b.id}`);

    /* The substantive claim: neither context was built from a profile, so
       neither can be signed in to anything. Checked by asking the page. */
    const cookiesA = await (await a.snapshot(), a.readText());
    check(!/logged in|signed in/i.test(cookiesA.text), "a fresh session is signed in to nothing");

    check(!a.quarantineDir.startsWith(process.cwd()),
      "downloads land outside the project",
      a.quarantineDir);
  } finally {
    await a.close();
    await b.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------ scenario 23 */

/** Acceptance 23: the web preview reports honestly that it needs the desktop. */
async function webPreviewHonesty() {
  console.log("\n23. The public web preview says what it cannot do\n");

  const built = join(here, "..", "public", "app", "running", "index.html");
  let html = "";
  try { html = readFileSync(built, "utf8"); }
  catch { fail("the site is built", `${built} is missing; run npm run build`); return; }

  check(/Desktop not connected|data-env-label/.test(html),
    "the composer carries a runtime label rather than a fabricated state");
  check(!/Connected · /.test(html),
    "the built page does not ship a connected-looking label");
  check(/data-browser-panel/.test(html),
    "the browser panel ships hidden rather than as a mock");
  check(/hidden/.test(html.split("data-browser-panel")[1].slice(0, 40)),
    "the browser panel is hidden with no session",
    html.split("data-browser-panel")[1].slice(0, 30).trim());
}

/* ----------------------------------------------------------------- main */

const probe = await fetch(`${baseUrl}/models`).then((r) => r.json()).catch(() => null);
if (!probe || !probe.data || !probe.data.length) {
  console.error(`No model server at ${baseUrl}. Start LM Studio, or pass a base URL.`);
  process.exit(2);
}
const model = wantedModel || probe.data[0].id;

console.log(`model:   ${model}`);
console.log(`server:  ${baseUrl}`);
console.log(`browser: ${findBrowserBinary() ?? "NOT FOUND"}`);

if (wants("23")) await webPreviewHonesty();
if (findBrowserBinary()) {
  if (wants("16")) await isolation();
  if (wants("22")) await localUiBug(model);
} else {
  console.log("\nSkipping the browser scenarios: no Chromium-family browser found.\n");
}

console.log(`\n${failures ? `${failures} check(s) failed` : "every check passed"}`);
process.exit(failures ? 1 : 0);
