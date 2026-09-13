// @ts-check
/**
 * Tests for the model browser.
 *
 * Two things are being checked, and the second is the one that matters.
 *
 * The first is that all fourteen states render something a person can read. A
 * browser spends most of its life not showing a finished model — searching,
 * waiting on metadata, halfway through a download, holding a file that is on
 * disk but not loaded — and each of those is a different sentence. Rendering
 * them as variations on an empty box is how a browser comes to feel broken.
 *
 * The second is that nothing is drawn as a fact that was not one. A verified
 * tick, a capability badge, a compatibility verdict and a download count are
 * all claims about somebody else's work, and each has a test that it does not
 * appear when the value behind it is unknown.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  modelBrowser, listPane, detailPane, summaryCard, downloadOptions, readmePanel,
  browserRow, capabilityMarks, capabilityBadges, compatibilityBadge, verifiedMark,
  artworkHtml, relativeTime, countLabel, sizeLabel, initialBrowserState,
  ListState, DetailState, InstallState,
} from "./modelbrowser.mjs";

const cap = (present, evidence = "because") => ({ present, evidence });
const CAPS = { vision: cap(false), toolUse: cap(true), reasoning: cap(null) };

const variant = (over = {}) => ({
  name: "m-q4_k_m.gguf", quantization: "Q4_K_M", bytes: 4.68e9,
  sha256: "a".repeat(64), url: "https://huggingface.co/o/r/resolve/main/m.gguf",
  format: "GGUF", parts: null, ...over,
});

const model = (over = {}) => ({
  repoId: "owner/Model-GGUF", displayName: "Model-GGUF", author: "owner",
  artwork: { dataUri: null, monogram: "OW" }, verified: null,
  description: "A model that does things.", downloads: 1234, likes: 56,
  updatedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
  parameters: { label: "7.6B", bytes: 7.6e9 }, architecture: "qwen2", domain: "code",
  formats: ["GGUF"], capabilities: CAPS, variants: [variant()],
  readme: "# Title\n\nSome prose that is long enough to be a real README section.",
  notes: [], ...over,
});

const state = (over = {}) => initialBrowserState({
  desktop: true, listState: ListState.READY,
  models: [{ ...model(), curated: true }],
  selectedId: "owner/Model-GGUF",
  detail: { state: DetailState.READY, model: model(), reason: null },
  compat: { verdict: "fits", detail: "About 5.6 GB of 12.8 GB on NVIDIA RTX 5070." },
  ...over,
});

/** Every state must produce readable prose, never an empty box. */
const readable = (html, what) => {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  assert.ok(text.length > 25, `${what} rendered almost nothing: "${text}"`);
  return text;
};

/* ============================================ the fourteen states ======= */

test("1. loading models shows the list is working, not that it is empty", () => {
  const html = listPane(state({ listState: ListState.LOADING, models: [] }));
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /mb-skel/, "no skeleton while loading");
  assert.ok(!/Nothing matches/.test(html), "a loading list claimed to be empty");
});

test("2. search results are labelled as results, not as the curated list", () => {
  const s = state({ query: "qwen", collection: "Search results" });
  const text = readable(listPane(s), "search results");
  assert.match(text, /Search results/);
  assert.match(listPane(s), /value="qwen"/, "the query is not in the field");
  assert.match(listPane(s), /data-mb-clear/, "no way to clear a search with text in it");
});

test("3. no results says what was searched for and what to try", () => {
  const text = readable(
    listPane(state({ listState: ListState.EMPTY, models: [], query: "zzzz" })), "empty");
  assert.match(text, /zzzz/, "the empty state does not say what was searched for");
  assert.match(text, /repository|shorter/i, "the empty state suggests nothing");
});

test("4. a selected model fills the right pane, and only one row is selected", () => {
  const s = state({
    models: [
      { ...model({ repoId: "a/one", displayName: "One" }), curated: true },
      { ...model({ repoId: "b/two", displayName: "Two" }), curated: true },
    ],
    selectedId: "b/two",
  });
  const html = listPane(s);
  assert.equal((html.match(/class="mb-row is-on"/g) ?? []).length, 1,
    "expected exactly one selected row");
  assert.match(html, /data-mb-row="b\/two"[\s\S]*?aria-selected="true"|aria-selected="true"[\s\S]*?b\/two/);
  readable(detailPane(s), "detail");
});

test("5. loading metadata does not blank the pane", () => {
  const html = detailPane(state({ detail: { state: DetailState.LOADING, model: null, reason: null } }));
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /mb-skel/, "no placeholder while metadata loads");
});

test("6. a metadata failure says why and offers a retry", () => {
  const text = readable(detailPane(state({
    detail: { state: DetailState.ERROR, model: null, reason: "Hugging Face answered 503." },
  })), "metadata failure");
  assert.match(text, /503/, "the reason was swallowed");
  assert.match(detailPane(state({
    detail: { state: DetailState.ERROR, model: null, reason: "x" },
  })), /data-mb-retry-detail/, "no way to try again");
});

test("7. a disconnected desktop explains itself rather than looking broken", () => {
  const text = readable(
    listPane(state({ desktop: false, listState: ListState.DISCONNECTED, models: [] })),
    "disconnected");
  assert.match(text, /desktop app is not connected/i);
  assert.match(text, /runtime/i, "does not say what is missing");
});

test("8. hardware unknown is a state, not a verdict", () => {
  /* The web preview has measured nothing. Saying "Runs well" there would be
     a claim about a machine nobody looked at. */
  const html = compatibilityBadge(null);
  assert.match(html, /Hardware unknown/);
  assert.match(html, /is-unknown/);
  assert.ok(!/Runs well|Does not fit/.test(html));
  assert.match(compatibilityBadge({ verdict: "unknown" }), /Hardware unknown/);
});

test("9. downloading shows progress and a way to stop", () => {
  const html = downloadOptions(state({
    install: { state: InstallState.DOWNLOADING, bytes: 2.34e9, total: 4.68e9, reason: null },
  }));
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="50"/, "progress is not reported as a value");
  assert.match(html, /data-mb-cancel/, "a running download cannot be cancelled");
});

test("10. a paused download keeps its place and offers to resume", () => {
  const text = readable(downloadOptions(state({
    install: { state: InstallState.PAUSED, bytes: 1.17e9, total: 4.68e9, reason: null },
  })), "paused");
  assert.match(text, /Paused at 25%/, "a paused download lost its position");
  assert.match(text, /Resume/);
});

test("11. a failed download says why, and does not look installed", () => {
  const html = downloadOptions(state({
    install: {
      state: InstallState.FAILED, bytes: 0, total: 4.68e9,
      reason: "The file did not match its published checksum.",
    },
  }));
  const text = readable(html, "failed");
  assert.match(text, /did not match its published checksum/);
  assert.ok(!/\bLoad\b/.test(text), "a failed download offered to load the model");
  assert.match(html, /data-mb-download/, "no way to try again");
});

test("12. an installed model offers Load rather than Download", () => {
  const html = downloadOptions(state({
    install: { state: InstallState.INSTALLED, bytes: 0, total: 0, reason: null },
  }));
  assert.match(html, /data-mb-load/);
  assert.ok(!/data-mb-download/.test(html), "an installed model still offered a download");
});

test("13. loading a model is busy and cannot be clicked twice", () => {
  const html = downloadOptions(state({
    install: { state: InstallState.LOADING, bytes: 0, total: 0, reason: null },
  }));
  assert.match(html, /disabled/);
  assert.match(html, /mb-spin/, "no indication that anything is happening");
});

test("14. a loaded model says so and offers no further action", () => {
  const html = downloadOptions(state({
    install: { state: InstallState.LOADED, bytes: 0, total: 0, reason: null },
  }));
  assert.match(html, /mb-loaded/);
  assert.ok(!/data-mb-download|data-mb-load\b/.test(html),
    "a loaded model offered to load or download again");
});

/* ================================================ nothing is invented === */

test("a verified tick appears only where something verified", () => {
  assert.equal(verifiedMark(null), "", "an unknown publisher got a verified tick");
  assert.equal(verifiedMark(false), "", "an unverified publisher got a tick");
  assert.match(verifiedMark(true), /Verified publisher/);
});

test("a capability mark appears only for a capability that is present", () => {
  /* Absent and unknown both get nothing in a list row: three dim icons read
     as "has all three, disabled", which is the opposite of the truth. */
  assert.equal(capabilityMarks({ vision: cap(null), toolUse: cap(null), reasoning: cap(null) }), "");
  assert.equal(capabilityMarks({ vision: cap(false), toolUse: cap(false), reasoning: cap(false) }), "");
  const one = capabilityMarks(CAPS);
  assert.equal((one.match(/mb-cap /g) ?? []).length, 1, "expected exactly one mark");
});

test("a capability badge distinguishes absent from unknown", () => {
  const html = capabilityBadges(CAPS);
  assert.match(html, /is-no/, "an absent capability looks the same as a present one");
  assert.match(html, /is-unknown/, "an unknown capability was resolved to yes or no");
  assert.match(html, /Reasoning\?/, "an unknown capability is not marked as a question");
});

test("every capability badge carries its evidence as a tooltip", () => {
  const html = capabilityBadges({
    vision: cap(true, "Published as image-text-to-text."),
    toolUse: cap(true, "Its chat template handles tool calls."),
    reasoning: cap(null, "Nothing published says either way."),
  });
  assert.match(html, /title="Published as image-text-to-text\."/);
  assert.match(html, /title="Its chat template handles tool calls\."/);
  assert.match(html, /title="Nothing published says either way\."/);
});

test("missing statistics are absent, not zero", () => {
  /* A model with no reported downloads has not been downloaded zero times. */
  assert.equal(countLabel(null), null);
  assert.equal(countLabel(undefined), null);
  assert.equal(countLabel(0), "0", "a real zero is still a number");
  const text = readable(detailPane(state({
    detail: {
      state: DetailState.READY, reason: null,
      model: model({ downloads: null, likes: null, updatedAt: null }),
    },
  })), "no stats");
  assert.match(text, /No statistics published/);
});

test("missing metadata says unknown rather than collapsing the row", () => {
  const html = summaryCard(model({
    parameters: { label: null, bytes: null }, architecture: null, domain: null, formats: [],
  }));
  assert.equal((html.match(/unknown/g) ?? []).length >= 3, true,
    "missing metadata vanished instead of saying so");
  assert.match(html, /PARAMS|Params/i, "the label disappeared with its value");
});

test("a repository with no description says so, rather than showing nothing", () => {
  const text = readable(summaryCard(model({ description: null })), "no description");
  assert.match(text, /publishes no description/i);
});

/* ==================================================== artwork and rows == */

test("real artwork is used when there is any, and initials only when not", () => {
  const withArt = artworkHtml({ dataUri: "data:image/webp;base64,AAA", monogram: "QW" }, "Qwen");
  assert.match(withArt, /<img/, "artwork was available and initials were drawn instead");
  assert.ok(!/QW/.test(withArt), "initials were drawn over real artwork");

  const without = artworkHtml({ dataUri: null, monogram: "QW" }, "Qwen");
  assert.match(without, /QW/);
  assert.ok(!/<img/.test(without));
});

test("the same publisher gets the same fallback colour every time", () => {
  const a = artworkHtml({ dataUri: null, monogram: "BA" }, "bartowski");
  const b = artworkHtml({ dataUri: null, monogram: "BA" }, "bartowski");
  const c = artworkHtml({ dataUri: null, monogram: "QW" }, "Qwen");
  assert.equal(a, b, "one publisher rendered two different colours");
  assert.notEqual(a, c, "two publishers rendered identically");
});

test("a whole row is the control, so a 68px target is not a 12px one", () => {
  const html = browserRow(model(), { selected: false });
  assert.match(html, /^<button class="mb-row"/);
  assert.match(html, /role="option"/);
});

test("a row with no description still says something", () => {
  const text = readable(browserRow(model({ description: null })), "row");
  assert.match(text, /No description published/);
});

/* ========================================================== downloads == */

test("a split model is offered as one download, with its parts stated", () => {
  const html = downloadOptions(state({
    detail: {
      state: DetailState.READY, reason: null,
      model: model({ variants: [variant({ parts: { count: 3, files: [] }, bytes: 8.1e9 })] }),
    },
  }));
  assert.match(html, /3 files/, "a split download does not say it is split");
  assert.match(html, /7\.54 GB/, "the size is not the total of the set");
});

test("a file with no published checksum says so before it is downloaded", () => {
  const html = downloadOptions(state({
    detail: {
      state: DetailState.READY, reason: null,
      model: model({ variants: [variant({ sha256: null })] }),
    },
  }));
  assert.match(html, /no checksum/i, "an unverifiable download did not say so");
});

test("a repository with no GGUF says the engine cannot run it", () => {
  const text = readable(downloadOptions(state({
    detail: { state: DetailState.READY, reason: null, model: model({ variants: [] }) },
  })), "no gguf");
  assert.match(text, /no GGUF/i);
});

test("the web preview cannot start a download, and the button says why", () => {
  const html = downloadOptions(state({ desktop: false }));
  assert.match(html, /disabled/);
  assert.match(html, /needs the desktop app/i);
});

/* ============================================================= readme == */

test("the README is rendered as Markdown, not shown as source", () => {
  const html = readmePanel("# Heading\n\nA paragraph.\n\n- one\n- two\n\n`code`");
  /* h3, not h1. The renderer demotes headings by two so that a README embedded
     under this card's own <h3>README</h3> does not claim to be a document
     heading — which is also why the stylesheet sizes h3 and h4. */
  assert.match(html, /<h3[^>]*class="mb-mdh"[^>]*>Heading<\/h3>/);
  assert.match(html, /<ul/);
  assert.match(html, /<code>code<\/code>/);
  assert.ok(!/# Heading/.test(html), "the Markdown source leaked through");
});

test("the README is sanitised, because it is somebody else's text", () => {
  const html = readmePanel('# Hi\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))');
  assert.ok(!/<script/i.test(html), "a script tag survived into the README");
  assert.ok(!/javascript:/i.test(html), "a javascript: URL survived into the README");
});

test("a repository with no README says so rather than leaving a gap", () => {
  const text = readable(readmePanel(null), "no readme");
  assert.match(text, /No README/i);
});

test("the lower half of the detail pane is never empty", () => {
  /* The specification is explicit about this, and it is the thing that made
     the old page look unfinished. */
  const html = detailPane(state());
  assert.match(html, /mb-readme-sec/, "there is no README section at all");
  const text = readable(html, "detail");
  assert.match(text, /README/);
});

/* ============================================================= shell === */

test("the modal is a dialog over a dimmed application", () => {
  const html = modelBrowser(state());
  assert.match(html, /mb-scrim/, "nothing dims the application behind it");
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /data-mb-close/, "no close button");
});

test("both panes are present and separated", () => {
  const html = modelBrowser(state());
  assert.match(html, /mb-list/);
  assert.match(html, /mb-detail/);
  assert.match(html, /mb-div/, "no divider between the panes");
});

test("curated and found results are separated when both are shown", () => {
  const html = listPane(state({
    query: "qwen",
    models: [
      { ...model({ repoId: "a/one" }), curated: true },
      { ...model({ repoId: "b/two" }), curated: false },
    ],
  }));
  assert.match(html, /Staff picks/);
  assert.match(html, /Search results/);
});

/* ============================================================ helpers == */

test("relative time is a gap a person reads, and absent when unknown", () => {
  const now = Date.parse("2026-09-13T00:00:00Z");
  assert.equal(relativeTime("2026-09-12T00:00:00Z", now), "yesterday");
  assert.equal(relativeTime("2026-08-20T00:00:00Z", now), "24 days ago");
  assert.equal(relativeTime("2025-09-13T00:00:00Z", now), "12 months ago");
  assert.equal(relativeTime(null, now), null);
  assert.equal(relativeTime("not a date", now), null);
});

test("a size is the one from the download, or absent", () => {
  assert.equal(sizeLabel(4.68e9), "4.36 GB");
  assert.equal(sizeLabel(null), null);
  assert.equal(sizeLabel(0), null, "zero bytes was reported as a size");
});

test("nothing in the browser escapes into markup", () => {
  const nasty = '"><script>alert(1)</script>';
  const html = modelBrowser(state({
    query: nasty,
    models: [{ ...model({ displayName: nasty, description: nasty, repoId: nasty }), curated: true }],
    detail: {
      state: DetailState.READY, reason: null,
      model: model({ displayName: nasty, description: nasty, repoId: nasty, architecture: nasty }),
    },
  }));
  assert.ok(!/<script/i.test(html), "a model name became markup");
});

/* ============================================ the action does not move == */

test("the action button sits in the same place in every download state", () => {
  /* Reported from use: cancelling a download moved the button sideways. It
     lived inside a group whose width followed the status text, and "Paused at
     0%" and "Download stopped. It can be resumed." are different lengths — so
     the control moved at the moment it was pressed, which is how a second
     press lands somewhere else.

     The structural rule that prevents it: the action is the last child of
     .mb-dlbar, preceded by the spacer, in every state. Nothing may nest it
     inside a group that also holds text. */
  const states = [
    InstallState.NONE, InstallState.DOWNLOADING, InstallState.PAUSED,
    InstallState.FAILED, InstallState.INSTALLED, InstallState.LOADING,
    InstallState.LOADED,
  ];
  for (const st of states) {
    const html = downloadOptions(state({
      install: { state: st, bytes: 1e9, total: 4.68e9, reason: "A reason of some considerable length." },
    }));
    const bar = /<div class="mb-dlbar">([\s\S]*?)<\/div>/.exec(html);
    assert.ok(bar, `${st}: no download bar`);

    assert.ok(!/mb-dl-live/.test(html),
      `${st}: the action is still wrapped in a width-following group`);

    /* The spacer comes last before the action, so the action is flush right. */
    const after = bar[1].slice(bar[1].lastIndexOf('<span class="grow">'));
    assert.match(after, /mb-btn|mb-loaded/,
      `${st}: the action is not the last thing in the bar`);
    assert.ok(!/mb-dl-pct/.test(after),
      `${st}: status text sits after the spacer and pushes the action`);
  }
});

test("a long failure message truncates rather than moving the button", () => {
  const html = downloadOptions(state({
    install: {
      state: InstallState.FAILED, bytes: 0, total: 4.68e9,
      reason: "x".repeat(400),
    },
  }));
  const found = /<div class="mb-dlbar">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(found, "no download bar");
  const bar = found[1];
  /* The message is before the spacer, so however long it is the button stays
     put; the stylesheet gives .mb-dl-pct min-width:0 and an ellipsis. */
  assert.ok(bar.indexOf("mb-dl-pct") < bar.indexOf('<span class="grow">'),
    "the message is not in the flexible slot");
});

test("the progress bar is its own row, not a competitor for the button's line", () => {
  const html = downloadOptions(state({
    install: { state: InstallState.DOWNLOADING, bytes: 2.34e9, total: 4.68e9, reason: null },
  }));
  const found = /<div class="mb-dlbar">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(found, "no download bar");
  assert.ok(!/mb-prog/.test(found[1]), "the progress bar is inside the action row");
  assert.match(html, /mb-prog/, "there is no progress bar at all");
});

test("a paused download keeps its position, so resuming is worth choosing", () => {
  const text = downloadOptions(state({
    install: { state: InstallState.PAUSED, bytes: 2.34e9, total: 4.68e9, reason: null },
  })).replace(/<[^>]+>/g, " ");
  assert.match(text, /Paused at 50%/, "a paused download forgot where it stopped");
});
