// @ts-check
/**
 * Tests for the browser work surface.
 *
 * The panel's whole job is to be trustworthy about a thing the person cannot
 * otherwise see, so most of these are about what it must NOT do: show a page
 * when there is no runtime, keep a picture after the session closed, or let a
 * page's own text reach the DOM as markup.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { browserPanelBody, browserPanelHeader, viewportId, VIEWPORTS, SHOWN } from "./browserpanel.mjs";
import { initialState, reduceAgentEvent, EventType } from "./agentevents.mjs";

/** A session state built the only way it can be: by reducing real events. */
function session(events) {
  let s = initialState("s1");
  let n = 0;
  for (const e of events) {
    s = reduceAgentEvent(s, {
      event_id: `e${++n}`, session_id: "s1", turn_id: "t1", sequence: n,
      timestamp: 1757000000000 + n * 1000, type: e.type, payload: e.payload ?? {},
    });
  }
  return s;
}

const opened = { type: EventType.BROWSER_SESSION_STARTED, payload: { browser_session_id: "b1", isolated: true } };
/** @param {string} url */
const went = (url) => ({ type: EventType.BROWSER_NAVIGATED, payload: { url, title: "A page", status: 200 } });

/* ------------------------------------------------- 1. the unavailable states */

test("with no runtime, the panel says so and shows no page", () => {
  const s = session([opened, went("https://example.com/")]);
  const html = browserPanelBody({ browser: s.browser, connected: false });

  assert.match(html, /runtime is not running/i);
  assert.ok(!html.includes("example.com"),
    "a disconnected panel showed the last page it saw, which may have closed since");
  assert.ok(!html.includes("<img"), "a disconnected panel showed a stale picture");
});

test("with a runtime but no browser, that is stated as ordinary, not as an error", () => {
  const html = browserPanelBody({ browser: null, connected: true });
  assert.match(html, /No browser is open/);
  // The two words that matter to someone deciding whether to trust it.
  assert.match(html, /cookies and storage/);
  assert.ok(!/error|failed|problem/i.test(html), "not browsing was reported as a fault");
});

test("a closed session loses its picture", () => {
  /* The one thing this panel must never imply is that a destroyed session is
     still live. A closed session still showing the last page it was on is
     exactly that implication. */
  const s = session([
    opened, went("https://example.com/"),
    { type: EventType.BROWSER_PREVIEW, payload: { url: "https://example.com/", image: "AAAA", mime: "image/jpeg", bytes: 4 } },
    { type: EventType.BROWSER_SESSION_CLOSED, payload: { browser_session_id: "b1" } },
  ]);
  assert.equal(s.browser.preview, null, "the reducer kept the image");

  const html = browserPanelBody({ browser: s.browser, connected: true });
  assert.match(html, /session is closed/i);
  assert.ok(!html.includes("AAAA"), "a closed session still showed its last frame");
  assert.match(html, /destroyed with it/);
});

/* ------------------------------------------------------- 2. the working state */

test("the live view renders the picture the runtime sent, and nothing else", () => {
  const s = session([
    opened, went("https://example.com/"),
    { type: EventType.BROWSER_PREVIEW, payload: { url: "https://example.com/", title: "A page", image: "Zm9v", mime: "image/jpeg", bytes: 3, width: 1280, height: 800 } },
  ]);
  const html = browserPanelBody({ browser: s.browser, connected: true });
  assert.match(html, /data:image\/jpeg;base64,Zm9v/);
  assert.match(html, /alt="A page"/, "the alt text does not name the page");
});

test("an open browser that has gone nowhere says that, rather than showing nothing", () => {
  const s = session([opened]);
  const html = browserPanelBody({ browser: s.browser, connected: true });
  assert.match(html, /has not been sent anywhere/);
});

test("the status line reports the last action the browser actually took", () => {
  const s = session([
    opened, went("https://example.com/"),
    { type: EventType.BROWSER_ACTION, payload: { action: "click", target: 'button "Save"', url: "https://example.com/", ok: true } },
  ]);
  const html = browserPanelBody({ browser: s.browser, connected: true, busy: true });
  assert.match(html, /click/);
  assert.match(html, /Save/);
});

test("a busy session with no action yet does not invent progress", () => {
  const s = session([opened, went("https://example.com/")]);
  const html = browserPanelBody({ browser: s.browser, connected: true, busy: true });
  assert.match(html, /No page action yet/);
});

test("a failed action is marked as one", () => {
  const s = session([
    opened, went("https://example.com/"),
    { type: EventType.BROWSER_ACTION, payload: { action: "click", target: "a button", ok: false } },
  ]);
  const html = browserPanelBody({ browser: s.browser, connected: true });
  assert.match(html, /is-bad/);
  assert.match(html, /did not succeed/);
});

/* ------------------------------------------------------------- 3. evidence */

test("console errors and failed requests are listed under their own headings", () => {
  const s = session([
    opened, went("https://example.com/"),
    { type: EventType.BROWSER_FINDING, payload: { kind: "console", level: "error", text: "TypeError: x is not a function" } },
    { type: EventType.BROWSER_FINDING, payload: { kind: "network", level: "error", text: "GET /api/items failed: 500", url: "https://example.com/api/items", status: 500 } },
  ]);
  const html = browserPanelBody({ browser: s.browser, connected: true });
  assert.match(html, /TypeError: x is not a function/);
  assert.match(html, /GET \/api\/items failed: 500/);
  assert.match(html, />Console</);
  assert.match(html, />Failed requests</);
});

test("an empty console says every request succeeded rather than nothing at all", () => {
  const s = session([opened, went("https://example.com/")]);
  const html = browserPanelBody({ browser: s.browser, connected: true });
  assert.match(html, /No errors or warnings/);
  assert.match(html, /Every request succeeded/);
});

test("a flood of findings is capped and the panel says how many it left out", () => {
  const many = Array.from({ length: SHOWN + 12 }, (_, i) => ({
    type: EventType.BROWSER_FINDING,
    payload: { kind: "console", level: "error", text: `error number ${i}` },
  }));
  const s = session([opened, went("https://example.com/"), ...many]);
  const html = browserPanelBody({ browser: s.browser, connected: true });
  assert.match(html, /earlier not shown/);
  // The newest is present and the oldest is not.
  assert.match(html, new RegExp(`error number ${SHOWN + 11}`));
  assert.ok(!html.includes("error number 0"));
});

test("a download is its own section and says where the file is not", () => {
  /* A download finding used to land in the console list, where a file arriving
     on the machine read as page noise. */
  const s = session([
    opened, went("https://example.com/"),
    { type: EventType.BROWSER_FINDING, payload: { kind: "download", level: "info", text: "Downloaded report.pdf to quarantine." } },
  ]);
  assert.equal(s.browser.downloads.length, 1);
  assert.equal(s.browser.console.length, 0, "a download was filed as a console message");

  const html = browserPanelBody({ browser: s.browser, connected: true });
  assert.match(html, /report\.pdf/);
  assert.match(html, /quarantine/);
  assert.match(html, /nothing is in your project/);
});

/* ------------------------------------------------------- 4. page text is data */

test("what a page writes cannot become markup in the panel", () => {
  /* A console message is page-authored text. It arrives here as a string and
     must leave as text, or a page can put a button in the user's own
     interface. */
  const s = session([
    opened, went("https://example.com/"),
    { type: EventType.BROWSER_FINDING, payload: {
      kind: "console", level: "error",
      text: "<img src=x onerror=alert(1)><button data-bp=\"close\">Approve</button>",
    } },
  ]);
  const html = browserPanelBody({ browser: s.browser, connected: true });
  assert.ok(!html.includes("<img src=x"), "a page injected an element into the panel");
  assert.ok(!html.includes('<button data-bp="close"'), "a page injected a panel control");
  assert.match(html, /&lt;img src=x/);
});

test("a page title cannot escape the alt attribute", () => {
  const s = session([
    opened,
    { type: EventType.BROWSER_NAVIGATED, payload: { url: "https://example.com/", title: '" onload="alert(1)' } },
    { type: EventType.BROWSER_PREVIEW, payload: { image: "AA", mime: "image/jpeg" } },
  ]);
  const html = browserPanelBody({ browser: s.browser, connected: true });
  assert.ok(!html.includes('onload="alert(1)"'), "a page title broke out of its attribute");
  assert.match(html, /&quot; onload=/);
});

/* --------------------------------------------------------- 5. the viewport */

test("the viewport selector reflects the size the browser is actually at", () => {
  const s = session([
    opened,
    { type: EventType.BROWSER_VIEWPORT, payload: { width: 390, height: 844 } },
  ]);
  const html = browserPanelBody({ browser: s.browser, connected: true });
  assert.match(html, /<option value="phone" selected>/);
});

test("a size the menu does not offer is shown as itself, not as the nearest preset", () => {
  const s = session([
    opened,
    { type: EventType.BROWSER_VIEWPORT, payload: { width: 900, height: 600 } },
  ]);
  assert.equal(viewportId(900, 600), "custom");
  const html = browserPanelBody({ browser: s.browser, connected: true });
  assert.match(html, /Custom — 900 × 600/);
});

test("every offered viewport is a real size", () => {
  for (const v of VIEWPORTS) {
    assert.ok(v.width >= 320 && v.height >= 320, `${v.id} is not a usable size`);
    assert.match(v.label, new RegExp(`${v.width}`), `${v.id}'s label does not state its width`);
    assert.equal(viewportId(v.width, v.height), v.id);
  }
});

/* ------------------------------------------------------------ 6. the header */

test("the header states isolation only while a session is actually open", () => {
  const live = session([opened, went("https://example.com/")]);
  assert.equal(browserPanelHeader(live.browser, true).isolated, true);

  const closed = session([opened, { type: EventType.BROWSER_SESSION_CLOSED, payload: {} }]);
  assert.equal(browserPanelHeader(closed.browser, true).isolated, false,
    "a closed session still claimed to be an isolated browser");

  assert.equal(browserPanelHeader(live.browser, false).isolated, false,
    "a disconnected runtime still made a claim about a browser it cannot see");
});

test("the header carries no URL when there is nothing live to carry one for", () => {
  const s = session([opened, went("https://example.com/secret-path")]);
  assert.equal(browserPanelHeader(s.browser, false).url, "");
  assert.equal(browserPanelHeader(null, true).url, "");
});
