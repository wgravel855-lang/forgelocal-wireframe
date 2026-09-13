// @ts-check
/**
 * Tests for the tool-group setting.
 *
 * The property that matters: this interface can ask, and only ask. Every test
 * below is either about the two copies of the group list agreeing, or about
 * the interface refusing to offer something the runtime would refuse anyway —
 * a switch that silently does nothing is worse than a switch that explains
 * why it is unavailable.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ToolGroup, DEFAULT_GROUPS, OPTIONAL_GROUPS, GROUP_COPY,
  toolGroupsHtml, requestedGroups, unavailableBecause,
} from "./toolgroups.mjs";
import {
  ToolGroup as RuntimeGroup,
  DEFAULT_GROUPS as RUNTIME_DEFAULTS,
  namesInGroups,
} from "../../runtime/core/tools/index.mjs";
import { emptyProfile, AgentGrade, browserModeFor } from "../../runtime/core/capability.mjs";

const graded = (grade) => emptyProfile({
  model: "m", baseUrl: "u", agentGrade: grade, testedAt: Date.now(),
});

/* ------------------------------------------------------------- 1. parity */

test("the interface knows exactly the groups the runtime has", () => {
  assert.deepEqual(ToolGroup, RuntimeGroup);
  assert.deepEqual([...DEFAULT_GROUPS], [...RUNTIME_DEFAULTS]);
  assert.deepEqual(
    [...DEFAULT_GROUPS, ...OPTIONAL_GROUPS].sort(),
    Object.values(RuntimeGroup).sort(),
    "a group exists that the settings page neither lists nor offers",
  );
});

test("every group has copy, and every group actually contains tools", () => {
  for (const id of Object.values(ToolGroup)) {
    assert.ok(GROUP_COPY[id], `${id} has no description`);
    assert.ok(GROUP_COPY[id].detail.length > 30, `${id} does not explain itself`);
    assert.ok(namesInGroups([id]).length > 0, `${id} is offered but contains no tools`);
  }
});

test("the interface and the runtime agree on when browsing is available", () => {
  /* Two implementations of one rule, in trees that cannot import each other.
     browserModeFor is the runtime's; unavailableBecause is the interface's. */
  for (const grade of Object.values(AgentGrade)) {
    const profile = graded(grade);
    const runtimeOffers = browserModeFor(profile) !== null;
    const uiOffers = unavailableBecause(ToolGroup.BROWSER, profile) === null;
    assert.equal(uiOffers, runtimeOffers, `disagreed about ${grade}`);
  }
});

/* -------------------------------------------------- 2. what is on offer */

test("the base groups are shown but are not switches", () => {
  /* A loop that cannot read has nothing to reason from, and a toggle that
     could remove it would be a way to build a broken session on purpose. */
  const html = toolGroupsHtml([], graded(AgentGrade.READY));
  for (const id of DEFAULT_GROUPS) {
    assert.match(html, new RegExp(GROUP_COPY[id].label));
    assert.ok(!html.includes(`data-tool-group="${id}"`),
      `${id} was rendered as a toggle`);
  }
  assert.equal((html.match(/data-tool-group="/g) || []).length, OPTIONAL_GROUPS.length);
});

test("browsing is unavailable for an untested model, with the reason beside it", () => {
  const html = toolGroupsHtml([ToolGroup.BROWSER], emptyProfile({ model: "m" }));
  assert.match(html, /data-tool-group="browser"[^>]*disabled/s);
  assert.match(html, /data-group-blocked="browser"/);
  assert.match(html, /Test this model first/);
  // And it is not shown as on.
  assert.ok(!/data-tool-group="browser"[^>]*aria-checked="true"/s.test(html));
});

test("browsing is offered once the model is graded", () => {
  const html = toolGroupsHtml([ToolGroup.BROWSER], graded(AgentGrade.READY));
  assert.ok(!/data-tool-group="browser"[^>]*disabled/s.test(html),
    "a graded model could still not be given a browser");
  assert.match(html, /data-tool-group="browser"[^>]*aria-checked="true"/s);
});

test("a chat-only model is told it has no tools at all, not just no browser", () => {
  const p = graded(AgentGrade.CHAT_ONLY);
  for (const id of OPTIONAL_GROUPS) {
    assert.match(String(unavailableBecause(id, p)), /no tools at all/,
      `${id} gave a reason that did not mention the real one`);
  }
});

/* ------------------------------------------------- 3. what gets asked for */

test("the base groups are always requested, whatever is stored", () => {
  for (const stored of [[], null, ["nonsense"], [ToolGroup.BROWSER]]) {
    const got = requestedGroups(/** @type {any} */ (stored), graded(AgentGrade.READY));
    for (const id of DEFAULT_GROUPS) {
      assert.ok(got.includes(id), `${id} was dropped for stored ${JSON.stringify(stored)}`);
    }
  }
});

test("a stored preference cannot carry browsing into a session that may not have it", () => {
  /* The case this function exists for: the person turns browsing on with a
     graded model loaded, then loads a different one. The stored value is
     still "on", and asking for it anyway would put a request on the wire that
     the runtime has to refuse — and, if the runtime ever forgot to, would
     hand an ungraded model a browser. */
  const asked = requestedGroups([ToolGroup.BROWSER], emptyProfile({ model: "other" }));
  assert.ok(!asked.includes(ToolGroup.BROWSER));

  const allowed = requestedGroups([ToolGroup.BROWSER], graded(AgentGrade.READY));
  assert.ok(allowed.includes(ToolGroup.BROWSER));
});

test("web fetching is offered to an untested model but browsing is not", () => {
  // Reading one bounded page is not driving a browser, and the bar differs.
  const p = emptyProfile({ model: "m" });
  assert.equal(unavailableBecause(ToolGroup.WEB, p), null);
  assert.ok(unavailableBecause(ToolGroup.BROWSER, p));
  assert.deepEqual(
    requestedGroups([ToolGroup.WEB, ToolGroup.BROWSER], p).filter((g) => OPTIONAL_GROUPS.includes(g)),
    [ToolGroup.WEB],
  );
});

test("a model name cannot become markup", () => {
  const html = toolGroupsHtml(["<img src=x>"], graded(AgentGrade.READY));
  assert.ok(!html.includes("<img src=x"));
});

/* ------------------------------------------- 4. a session with no project */

test("with no project open, nothing is claimed to be always on", () => {
  /* The panel used to print "Always on" beside reading, editing, commands and
     planning unconditionally. In a conversation with no folder the sidecar
     grants none of them, so that line was false exactly where a person is
     most likely to be wondering what the agent can do. */
  const html = toolGroupsHtml([], graded("ready"), false);
  assert.ok(!html.includes("Always on"), "claimed a tool group was on with no project open");
  for (const id of Object.values(ToolGroup)) {
    assert.match(html, new RegExp(`data-group-blocked="${id}"`),
      `${id} was offered with no project open, and no reason given`);
  }
  assert.match(html, /No project folder is open/);
});

test("with a project open, the panel is unchanged", () => {
  const html = toolGroupsHtml([], graded("ready"), true);
  assert.equal((html.match(/Always on/g) ?? []).length, DEFAULT_GROUPS.length);
  assert.ok(!html.includes("No project folder is open"));
});

test("a session with no project asks the runtime for nothing", () => {
  /* Matching allowedGroups, which returns [] for a session with no root. The
     runtime is what enforces it — sidecar.test.mjs proves that end to end —
     and this keeps the interface from asking for four groups it knows will be
     refused, which would only produce a refusal it then has to explain. */
  assert.deepEqual(requestedGroups(["web", "browser"], graded("ready"), false), []);
  assert.deepEqual(requestedGroups([], graded("ready"), false), []);

  // and with a folder, exactly what it asked for before
  assert.deepEqual(requestedGroups([], graded("ready"), true), [...DEFAULT_GROUPS]);
});

test("every group is unavailable without a project, base groups included", () => {
  for (const id of Object.values(ToolGroup)) {
    assert.ok(unavailableBecause(id, graded("ready"), false),
      `${id} was available in a session with nothing to use it on`);
    // the default is the ordinary case, so no call site accidentally opts out
    assert.equal(unavailableBecause(id, graded("ready")), unavailableBecause(id, graded("ready"), true));
  }
});
