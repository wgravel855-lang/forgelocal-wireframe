// @ts-check
/**
 * The two request allowlists must agree.
 *
 * The Rust host validates every frame before forwarding it, and the Node
 * sidecar validates it again on arrival. That duplication is deliberate — a
 * transport check is not an authorization check — and its comment says so.
 *
 * What the comment did not say is what happens when they drift. Adding a
 * request to the Node side and not to Rust does not widen anything; it
 * silently *narrows* the app, and only in the desktop build. Five requests
 * were added over one milestone and none reached the Rust list, so in the
 * shipped app the browser panel's controls did nothing, sessions could not be
 * listed or reopened, and the button that grades a model — the gate browsing
 * depends on — was refused. Everything passed in the web preview and in every
 * test, because neither goes through Rust.
 *
 * This is the cheapest possible check for that: read both lists and compare.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { REQUEST_TYPES, NOTIFY_TYPES, HOST_ONLY } from "../../runtime/host/protocol.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUST = join(root, "desktop", "src-tauri", "src", "sidecar.rs");

/** The string literals in the Rust host's ALLOWED array. */
function rustAllowed() {
  const src = readFileSync(RUST, "utf8");
  const m = src.match(/const ALLOWED: &\[&str\] = &\[([\s\S]*?)\];/);
  assert.ok(m, "could not find ALLOWED in sidecar.rs — has it been renamed?");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

test("the Rust host forwards exactly the requests the runtime accepts", () => {
  const rust = rustAllowed();
  /* Minus the ones only the host may originate. Those are not a gap in the
     allowlist; their absence from it is the thing being protected. */
  const node = REQUEST_TYPES.filter((t) => !HOST_ONLY.includes(t));

  const missingInRust = node.filter((t) => !rust.includes(t));
  assert.deepEqual(missingInRust, [],
    "these requests reach the runtime in tests and the web preview, and are "
    + "silently refused in the desktop app");

  const missingInNode = rust.filter((t) => !node.includes(t));
  assert.deepEqual(missingInNode, [],
    "the Rust host forwards requests the runtime does not implement");
});

test("a host-only request can never be sent by the renderer", () => {
  /* engine.attached carries the session token for the local inference
     server. A page that could send one would point the runtime at a server
     of its choosing and read every prompt and every answer. The Rust host
     writes these itself and refuses to forward them from the WebView, and
     this asserts that rather than trusting the comment saying so. */
  assert.ok(HOST_ONLY.length > 0, "nothing is marked host-only any more");
  const rust = rustAllowed();
  for (const t of HOST_ONLY) {
    assert.ok(!rust.includes(t),
      `${t} is forwardable from the renderer, which defeats the separation`);
  }
});

test("neither list has duplicates, which would hide a typo", () => {
  const rust = rustAllowed();
  assert.equal(new Set(rust).size, rust.length, `duplicate in ALLOWED: ${rust}`);
  assert.equal(new Set(REQUEST_TYPES).size, REQUEST_TYPES.length);
});

test("every allowed request looks like a request and not a notification", () => {
  /* Notifications travel the other way. One in this list would be a request
     the renderer could send that nothing handles. */
  for (const t of rustAllowed()) {
    assert.match(t, /^[a-z]+\.[a-z.]+$/, `${t} is not a request name`);
  }
});

/* -------------------------------------------- the client's own copy, too */

/**
 * The renderer cannot import from the runtime tree — it is a static site built
 * separately — so design/core/hostclient.mjs keeps its own copy of the request
 * and notification names. Three copies of one list now, and nothing compared
 * the third: adding session.setRoot meant hand-syncing it, and a typo there
 * would have produced a request the sidecar refuses with "unknown type" at the
 * moment a person clicks something.
 */
test("the renderer's copy of the protocol matches the runtime's", async () => {
  const client = await import("../core/hostclient.mjs");

  for (const [name, value] of Object.entries(client.Request)) {
    assert.ok(REQUEST_TYPES.includes(value),
      `the client can send ${name} ("${value}"), which the runtime does not accept`);
  }
  for (const [name, value] of Object.entries(client.Notify)) {
    assert.ok(NOTIFY_TYPES.includes(value),
      `the client listens for ${name} ("${value}"), which the runtime never sends`);
  }

  /* The other direction is a warning, not a failure: the runtime may
     legitimately have requests the renderer has no button for, and every
     HOST_ONLY one is required to be absent. But a notification the runtime
     sends and the client has no name for is a frame nobody handles. */
  for (const value of HOST_ONLY) {
    assert.ok(!Object.values(client.Request).includes(value),
      `the renderer has a name for ${value}, which only the host may send`);
  }
});
