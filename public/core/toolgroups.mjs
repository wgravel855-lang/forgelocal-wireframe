// @ts-check
/**
 * Which kinds of tool a session may use, for the interface.
 *
 * The runtime owns the grouping; this is the same six groups with the words a
 * settings page shows, because the renderer is a static site and cannot import
 * from the runtime tree. toolgroups.test.mjs asserts the two agree, the same
 * way the output styles are checked.
 *
 * Two things this file exists to keep honest.
 *
 * **The base groups are not optional.** Reading, editing, running commands and
 * planning are what an agent is; a toggle that removed reading would leave a
 * loop with nothing to reason from. They are listed so a person can see what a
 * session can do, and they are not switches.
 *
 * **A toggle here is a request, not a grant.** The sidecar decides what a
 * session actually gets, and refuses browsing for a model the conformance
 * suite has not graded. This file says so in the interface so the person
 * understands why the control is unavailable, but the refusal happens in the
 * runtime where the renderer cannot reach it.
 */

import { escapeHtml as esc } from "./html.mjs";

export const ToolGroup = Object.freeze({
  READ: "read",
  EDIT: "edit",
  COMMAND: "command",
  PLAN: "plan",
  WEB: "web",
  BROWSER: "browser",
});

/** What a session gets without asking. */
export const DEFAULT_GROUPS = Object.freeze([
  ToolGroup.READ, ToolGroup.EDIT, ToolGroup.COMMAND, ToolGroup.PLAN,
]);

/** The two that are opt-in, in the order the settings page lists them.
 *  @type {readonly string[]} */
export const OPTIONAL_GROUPS = Object.freeze([ToolGroup.WEB, ToolGroup.BROWSER]);

export const GROUP_COPY = Object.freeze({
  [ToolGroup.READ]: {
    label: "Reading",
    detail: "Open files, list folders, search the project. Never outside it.",
  },
  [ToolGroup.EDIT]: {
    label: "Editing",
    detail: "Change files, with a checkpoint before each change so it can be undone.",
  },
  [ToolGroup.COMMAND]: {
    label: "Commands",
    detail: "Run commands in the project. Always asks first, whatever the mode.",
  },
  [ToolGroup.PLAN]: {
    label: "Planning and asking",
    detail: "Keep a plan, and stop to ask you when a request is genuinely ambiguous.",
  },
  [ToolGroup.WEB]: {
    label: "Fetch a page",
    detail:
      "Read a URL and search. Bounded in size and time, redirects re-checked at "
      + "every hop, and what comes back is fenced as untrusted text.",
  },
  [ToolGroup.BROWSER]: {
    label: "Drive a browser",
    detail:
      "Open pages in a browser that has its own cookies and storage and is "
      + "signed in to nothing. Every site is approved separately, and anything "
      + "that submits, uploads or publishes asks every time.",
  },
});

/**
 * Why an optional group is unavailable, or null when it is offered.
 *
 * Browsing needs a model the suite has graded. That is a real bar and the
 * interface states it rather than showing a control that does nothing: a
 * disabled toggle with no reason beside it reads as a bug.
 *
 * @param {string} group @param {any} profile
 * @returns {string|null}
 */
export function unavailableBecause(group, profile) {
  const grade = profile && typeof profile.agentGrade === "string" ? profile.agentGrade : "untested";
  if (grade === "chat_only") {
    return "This model was graded chat only, so it has no tools at all.";
  }
  if (group === ToolGroup.BROWSER && (grade === "untested" || grade === "chat_only")) {
    return "Test this model first. Driving a browser is the most consequential "
      + "thing the agent can do, and it is only offered for a model the suite has graded.";
  }
  return null;
}

/**
 * @param {string[]} enabled  the groups the person has asked for
 * @param {any} profile
 * @returns {string}
 */
export function toolGroupsHtml(enabled, profile) {
  const on = new Set(enabled);

  const base = DEFAULT_GROUPS.map((id) => `<div class="setrow">
  <div><span class="set-l">${esc(GROUP_COPY[id].label)}</span>
    <p class="set-d">${esc(GROUP_COPY[id].detail)}</p></div>
  <span class="set-v faint">Always on</span>
</div>`).join("\n");

  const optional = OPTIONAL_GROUPS.map((id) => {
    const why = unavailableBecause(id, profile);
    const checked = !why && on.has(id);
    return `<div class="setrow">
  <div><span class="set-l">${esc(GROUP_COPY[id].label)}</span>
    <p class="set-d">${esc(GROUP_COPY[id].detail)}</p>
    ${why ? `<p class="set-d" data-group-blocked="${esc(id)}"><em>${esc(why)}</em></p>` : ""}</div>
  <button class="switch" type="button" role="switch" data-tool-group="${esc(id)}"
    aria-checked="${checked}" ${why ? 'disabled aria-disabled="true"' : ""}
    aria-label="${esc(GROUP_COPY[id].label)}"><span></span></button>
</div>`;
  }).join("\n");

  return `${base}\n${optional}`;
}

/**
 * The groups to ask the runtime for.
 *
 * Always includes the base four. An optional one is included only when the
 * person turned it on AND nothing blocks it — so a stored preference from a
 * session with a graded model cannot silently carry into one without.
 *
 * @param {string[]} enabled @param {any} profile
 * @returns {string[]}
 */
export function requestedGroups(enabled, profile) {
  const on = new Set(Array.isArray(enabled) ? enabled : []);
  return [
    ...DEFAULT_GROUPS,
    ...OPTIONAL_GROUPS.filter((id) => on.has(id) && !unavailableBecause(id, profile)),
  ];
}
