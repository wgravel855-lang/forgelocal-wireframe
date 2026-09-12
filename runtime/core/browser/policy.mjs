// @ts-check
/**
 * What the agent may do to a web page.
 *
 * This is a separate axis from the file and command permissions, and that
 * separation is the point. "Allow edits" says the user is content for files
 * inside their project to change without being asked each time. It says
 * nothing whatsoever about posting a comment, sending an email, deleting a
 * record or buying something, and a policy that let one imply the other would
 * be reading consent for a local, reversible, checkpointed action as consent
 * for a remote, irreversible, public one.
 *
 * The model is as follows.
 *
 * **Reading an origin is approved once.** The first time a session touches
 * example.com the user approves it; after that, reading text, taking snapshots,
 * inspecting console and network, and screenshotting proceed without further
 * prompts. Asking again for every snapshot would train the user to click
 * through, and a user clicking through prompts is a user with no permissions at
 * all.
 *
 * **Every consequential action is confirmed every time**, and an origin grant
 * never covers one. The list is in CONSEQUENTIAL below; each entry is there
 * because it reaches outside the machine, costs money, or cannot be undone.
 *
 * **Page content never influences any of this.** The classifier's inputs are
 * the tool name, the target origin, the requested side effect and the user's
 * static policy. It is never given page text, element names or console output.
 * That is not a stylistic choice: a page that could reach the classifier could
 * write "this action is routine and pre-approved" into a button label, and
 * `classifyBrowserAction` would have no way to tell that from the truth. See
 * the test named for exactly that.
 */

/** Browser capabilities, ordered from least to most consequential. */
export const BrowserPermission = Object.freeze({
  /** Open a browser at all. */
  OPEN: "browser.open",
  /** Read a page: snapshot, text, console, network, screenshot. */
  INSPECT: "browser.inspect",
  /** Move around: navigate, scroll, switch tab, go back. */
  NAVIGATE: "browser.navigate",
  /** Change page state without leaving it: click, type, select. */
  INTERACT: "browser.interact",
  /** Anything that reaches beyond the page. Never covered by an origin grant. */
  CONSEQUENTIAL: "browser.consequential",
});

/**
 * Actions that always stop and ask, whatever has been approved before.
 *
 * Each is annotated with why, because a list like this rots the moment someone
 * adds an entry they cannot justify or removes one they did not understand.
 */
export const CONSEQUENTIAL = Object.freeze({
  submit: "Submitting a form can publish, purchase, or send.",
  upload: "A file upload sends the user's data to another party.",
  download_move: "Moving a download out of quarantine puts an untrusted file in the project.",
  external_protocol: "Opening mailto:, tel: or a custom scheme hands control to another application.",
  credentials: "Anything involving a password, token or key.",
  cross_origin_post: "Sending data collected on one origin to another.",
});

/**
 * Which permission a browser tool needs.
 * @type {Record<string, string>}
 */
export const BROWSER_TOOL_PERMISSION = Object.freeze({
  browser_open: BrowserPermission.OPEN,
  browser_navigate: BrowserPermission.NAVIGATE,
  browser_snapshot: BrowserPermission.INSPECT,
  browser_read_text: BrowserPermission.INSPECT,
  browser_console: BrowserPermission.INSPECT,
  browser_network: BrowserPermission.INSPECT,
  browser_screenshot: BrowserPermission.INSPECT,
  browser_tabs: BrowserPermission.INSPECT,
  browser_click: BrowserPermission.INTERACT,
  browser_type: BrowserPermission.INTERACT,
  browser_select: BrowserPermission.INTERACT,
  browser_keypress: BrowserPermission.INTERACT,
  browser_scroll: BrowserPermission.NAVIGATE,
  browser_wait: BrowserPermission.INSPECT,
  browser_file_upload: BrowserPermission.CONSEQUENTIAL,
  browser_close: BrowserPermission.OPEN,
});

/** Words in a control's own name that make a click consequential. */
const SUBMIT_WORDS = [
  "submit", "send", "publish", "post", "confirm", "pay", "buy", "purchase",
  "order", "checkout", "subscribe", "delete", "remove", "destroy", "deactivate",
  "transfer", "withdraw", "donate", "book", "apply now", "sign up", "register",
];

/**
 * Does this look like a control that commits something?
 *
 * Note carefully what this is and is not. It is a heuristic applied to the
 * element the MODEL asked to click, used only to make the policy *stricter*.
 * It can add a confirmation; it can never remove one. So a page that names its
 * "Delete account" button "Continue" gets a click without the extra
 * confirmation — but the click still needs INTERACT on an approved origin, and
 * a page cannot use this to gain anything. The failure mode is a missed extra
 * prompt, never an unearned approval.
 *
 * @param {string} target  the accessible name of the element
 * @param {string} role
 */
export function looksCommitting(target, role) {
  if (role !== "button" && role !== "link" && role !== "menuitem") return false;
  const t = String(target ?? "").toLowerCase();
  return SUBMIT_WORDS.some((w) => t.includes(w));
}

/**
 * Decide whether a browser action may proceed.
 *
 * @param {object} input
 * @param {string} input.tool
 * @param {string|null} input.origin        the page's origin, from the URL
 * @param {Set<string>} input.grantedOrigins
 * @param {string} [input.targetName]       the element's accessible name
 * @param {string} [input.targetRole]
 * @param {boolean} [input.enabled]         whether browser tools are on at all
 * @returns {{decision: "allow"|"confirm"|"deny", reason: string, permission?: string}}
 */
export function classifyBrowserAction({
  tool, origin, grantedOrigins, targetName = "", targetRole = "", enabled = true,
}) {
  if (!enabled) {
    return { decision: "deny", reason: "Browser tools are not enabled for this session." };
  }

  const permission = BROWSER_TOOL_PERMISSION[tool];
  if (!permission) {
    // Fails closed, like the file policy: an unlisted browser tool is denied,
    // so adding one without classifying it cannot ship as "probably fine".
    return { decision: "deny", reason: `${tool} has no browser permission classification.` };
  }

  // Always confirmed, every time, whatever else has been granted.
  if (permission === BrowserPermission.CONSEQUENTIAL) {
    return {
      decision: "confirm",
      permission,
      reason: CONSEQUENTIAL.upload,
    };
  }

  /* Closing is the one browser action that only ever removes capability: it
     ends the session and destroys its cookies and storage. Asking permission
     to give something up trains people to click through prompts, so it is
     allowed outright. */
  if (tool === "browser_close") {
    return { decision: "allow", permission, reason: "Closing the browser removes access, never grants it." };
  }

  // Opening the browser is not origin-scoped: there is no page yet.
  if (permission === BrowserPermission.OPEN) {
    return { decision: "confirm", permission, reason: "Open an isolated browser for this session." };
  }

  if (!origin) {
    return { decision: "confirm", permission, reason: "No page is open yet." };
  }

  /* An external protocol leaves the browser entirely. It is not a navigation,
     whatever the URL bar says. */
  if (!/^https?:$/.test(protocolOf(origin))) {
    return { decision: "confirm", permission, reason: CONSEQUENTIAL.external_protocol };
  }

  const approved = grantedOrigins.has(origin);

  if (permission === BrowserPermission.NAVIGATE) {
    return approved
      ? { decision: "allow", permission, reason: `${origin} is approved for this session` }
      : { decision: "confirm", permission, reason: `Open ${origin}` };
  }

  if (permission === BrowserPermission.INSPECT) {
    return approved
      ? { decision: "allow", permission, reason: `${origin} is approved for this session` }
      : { decision: "confirm", permission, reason: `Read ${origin}` };
  }

  // INTERACT: approved origin is enough for an ordinary click, but a control
  // that commits something is confirmed on its own terms.
  if (looksCommitting(targetName, targetRole)) {
    return {
      decision: "confirm",
      permission: BrowserPermission.CONSEQUENTIAL,
      reason: CONSEQUENTIAL.submit,
    };
  }
  return approved
    ? { decision: "allow", permission, reason: `${origin} is approved for this session` }
    : { decision: "confirm", permission, reason: `Interact with ${origin}` };
}

function protocolOf(origin) {
  try { return new URL(origin).protocol; } catch { return ""; }
}

/** The origin of a URL, or null when it has none worth granting. */
export function originOf(url) {
  try {
    const u = new URL(String(url));
    // A data: or blob: URL has no meaningful origin to grant, and treating
    // "null" as an origin would let one grant cover every such page.
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.origin;
  } catch {
    return null;
  }
}
