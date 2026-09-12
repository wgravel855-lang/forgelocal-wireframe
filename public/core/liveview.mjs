// @ts-check
/**
 * Rendering a live session.
 *
 * Every row here comes from a runtime event. There is no fixture path: if the
 * reducer's state has no rows, the transcript is empty, and an empty transcript
 * is what a session that has done nothing looks like.
 *
 * It reuses the classes the existing transcript already uses, so a live session
 * and a stored one look like the same product. Nothing here is a new design.
 */

import { escapeHtml as esc, clipOutput } from "./html.mjs";
import { groupActivity, detailOf } from "./activity.mjs";
import { renderMarkdown } from "./markdown.mjs";

/**
 * @param {any} view   the reduced session state from core/events.mjs
 * @returns {string} HTML for [data-thread]
 */
export function liveTranscript(view) {
  if (!view || !view.rows.length) return "";

  /** @type {string[]} */
  const html = [];
  /** @type {any[]} */
  let toolRun = [];

  const flush = () => {
    if (!toolRun.length) return;
    html.push(activityBlock(toolRun));
    toolRun = [];
  };

  /** @type {any[]} */
  let browserRun = [];
  const flushBrowser = () => {
    if (!browserRun.length) return;
    html.push(browserBlock(browserRun));
    browserRun = [];
  };

  /* Every kind the reducer produces has a branch here.
   *
   * It used to have three, and rows of any other kind fell through and
   * rendered nothing: a run of browser actions, and every question the agent
   * asked once it had been answered, were simply absent from the transcript.
   * A transcript that silently omits what happened is worse than one that
   * renders it plainly, so the default branch below is loud rather than a
   * no-op — a new row kind must be given a block, not quietly dropped. */
  for (const row of view.rows) {
    if (row.kind === "tool") { flushBrowser(); toolRun.push(row); continue; }
    if (row.kind === "browser") { flush(); browserRun.push(row); continue; }
    flush();
    flushBrowser();
    switch (row.kind) {
      case "user": html.push(userTurn(row)); break;
      case "assistant": html.push(assistantTurn(row)); break;
      case "question": html.push(askedBlock(row)); break;
      case "notice": html.push(noticeBlock(row)); break;
      default:
        html.push(`<article class="turn turn-assistant"><p class="lv-note">${
          esc(`A ${row.kind} entry was recorded here and this build has no way to show it.`)
        }</p></article>`);
    }
  }
  flush();
  flushBrowser();

  return html.join("\n");
}

/**
 * A run of browser actions.
 *
 * Grouped like a run of tool calls, and for the same reason: six clicks on one
 * page are one passage of work, not six objects. What each row carries is the
 * action, what it targeted, and the origin — never the value typed, because a
 * typed value can be a password even when the field is not marked as one.
 * @param {any[]} rows
 */
function browserBlock(rows) {
  const origins = [...new Set(rows.map((r) => originOf(r.url)).filter(Boolean))];
  const failed = rows.filter((r) => r.ok === false).length;
  const label = origins.length === 1
    ? `Browsed ${origins[0]}`
    : `Browsed ${origins.length} sites`;

  const items = rows.map((r) => {
    const bad = r.ok === false;
    return `<div class="lv-call" data-status="${bad ? "failed" : "completed"}">
      <dl class="lv-kv"><dt>${esc(r.action ?? "action")}</dt>
      <dd class="m">${esc(clipOutput(r.target ?? "", 200))}${
        bad ? " — did not succeed" : ""}</dd>
      ${r.detail ? `<dt>detail</dt><dd class="m">${esc(clipOutput(r.detail, 200))}</dd>` : ""}
      ${r.url ? `<dt>page</dt><dd class="m">${esc(clipOutput(r.url, 200))}</dd>` : ""}
      </dl></div>`;
  }).join("\n");

  return `<article class="turn turn-assistant">
  <div class="lvact">
    <details class="lv-row" data-activity="browser" data-status="${failed ? "failed" : "completed"}">
      <summary>
        <span class="lv-ico" aria-hidden="true">${failed ? ICON.bad : ICON.ok}</span>
        <span class="lv-label">${esc(label)}</span>
        <span class="lv-meta">${rows.length}</span>
        ${ICON.chev}
      </summary>
      <div class="lv-detail">${items}</div>
    </details>
  </div>
</article>`;
}

/**
 * A question the agent asked, after it was answered.
 *
 * The pending question is a card with controls; this is the record of one, and
 * it is deliberately not interactive. A replayed session shows what was asked
 * and what was chosen rather than a gap where a pause used to be — and it must
 * not offer buttons that would answer a question nobody is waiting on.
 * @param {any} row
 */
function askedBlock(row) {
  const list = Array.isArray(row.questions) ? row.questions : [];
  if (!list.length) return "";

  const asked = list.map((q) => `<dt>${esc(q.question ?? "")}</dt><dd>${
    esc(answerFor(row, q) || (row.answered ? "(no answer recorded)" : "waiting"))
  }</dd>`).join("");

  return `<article class="turn turn-assistant">
  <div class="lvact">
    <details class="lv-row" data-activity="ask" data-status="${row.answered ? "completed" : "awaiting_permission"}">
      <summary>
        <span class="lv-ico" aria-hidden="true">${row.answered ? ICON.ok : ICON.wait}</span>
        <span class="lv-label">${esc(row.answered ? "Asked, and answered" : "Waiting for an answer")}</span>
        ${ICON.chev}
      </summary>
      <div class="lv-detail"><div class="lv-call" data-status="completed">
        <dl class="lv-kv">${asked}</dl>
      </div></div>
    </details>
  </div>
</article>`;
}

/** What the person chose for one question, from either shape of answer. */
function answerFor(row, q) {
  const found = Array.isArray(row.answers)
    ? row.answers.find((a) => a && a.id === q.id)
    : null;
  if (found) {
    const chosen = Array.isArray(found.choice) ? found.choice : [found.choice];
    const said = chosen.filter((c) => typeof c === "string" && c.trim()).join(", ");
    if (said) return said;
  }
  // A free-text reply answers whatever was asked; with one question it is the
  // answer, and with several there is no way to say which it belonged to.
  return row.answered && typeof row.answerText === "string" ? row.answerText : "";
}

/**
 * Something that happened to the conversation rather than in it.
 *
 * Compaction and a turn that stopped short are both facts a reader scrolling
 * back needs, and both used to be session state that the next turn overwrote.
 * @param {any} row
 */
function noticeBlock(row) {
  return `<article class="turn turn-assistant">
  <p class="lv-notice" data-tone="${esc(row.tone ?? "context")}">
    <span>${esc(row.text ?? "")}</span>
    ${row.detail ? `<span class="lv-notice-d">${esc(row.detail)}</span>` : ""}
  </p>
</article>`;
}

/** The origin of a URL, for a label. Never throws on a page's own nonsense. */
function originOf(url) {
  try { return new URL(String(url)).origin; } catch { return ""; }
}

function userTurn(row) {
  return `<article class="turn turn-user">
  <div class="umsg"><div class="umsg-body">${esc(row.text)}</div></div>
</article>`;
}

function assistantTurn(row) {
  // A streaming message is marked so the caret can show, and an empty one draws
  // nothing at all rather than an empty bubble.
  if (!row.text && !row.streaming) return "";
  return `<article class="turn turn-assistant">
  <div class="prose amsg"${row.streaming ? ' data-streaming="true"' : ""}>${paragraphs(row.text)}</div>
  ${row.cancelled ? `<p class="lv-note">Stopped before this finished.</p>` : ""}
</article>`;
}

/**
 * Model text to HTML.
 *
 * This was paragraphs only, on the reasoning that model output is not
 * Markdown. Models write Markdown: a reply with a heading, a list and a fenced
 * block arrived as literal "## " and "- " lines. The subset in markdown.mjs
 * escapes first and transforms second, so the guarantee is the one this
 * function always made, with structure on top of it.
 */
function paragraphs(text) {
  return renderMarkdown(text, {
    headingOffset: 1,       // "#" is an h2; a reply is shallower than a card
    maxHeading: 4,
    /* Links are on. They were off on the reasoning that a reply should not
       mint clickable destinations; the brief asks for them, and safeUrl is
       what makes that safe rather than the absence of the feature. Only
       http, https, mailto and relative survive it, every anchor carries
       rel="noreferrer noopener", and a rejected href keeps its words and
       loses its destination rather than disappearing. */
    links: true,
    softBreaks: true,       // keep the line breaks the model wrote
    cls: null,              // styled by element inside .prose
  });
}

/** One activity group: the collapsed line, and the detail behind it. */
function activityBlock(rows) {
  const groups = groupActivity(rows);
  /* A run of tool calls is not an object on the page. It used to render
     inside .act, which is a bordered, filled card, so four reads and a test
     run became a slab the width of the transcript with a large green tick on
     every line. Completed work is a status line: it says what happened, stays
     out of the way, and opens when asked. Only expanded detail is a surface. */
  return `<article class="turn turn-assistant">
  <div class="lvact">
${groups.map(activityRow).join("\n")}
  </div>
</article>`;
}

/* A completed step is the ordinary case and gets the quietest mark on the
   page. The tick used to be 14px in --ok on every finished row, which spent
   the transcript's only success colour on "a file was read". Red and amber
   are kept for the two states that actually need a reader to stop. */
const ICON = {
  ok: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
  bad: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  run: `<span class="lv-spin" aria-hidden="true"></span>`,
  wait: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/></svg>`,
  chev: `<svg class="lv-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>`,
};

function activityRow(group, i) {
  const icon = group.status === "failed" || group.status === "denied" ? ICON.bad
    : group.status === "running" || group.status === "requested" ? ICON.run
    : group.status === "awaiting_permission" ? ICON.wait
    : group.status === "cancelled" ? ICON.bad
    : ICON.ok;

  /* The right-hand fact, when there is one worth carrying on the collapsed
     line: how long a single call took, how many a group stands for, or what a
     patch changed. Never two of them, and never a count of one. */
  const meta = metaFor(group);

  const body = group.calls.map(callDetail).join("\n");
  const id = `lv-${i}-${Math.random().toString(36).slice(2, 7)}`;

  return `    <details class="lv-row" data-activity="${esc(group.kind)}" data-status="${esc(group.status)}">
      <summary id="${id}">
        <span class="lv-ico" aria-hidden="true">${icon}</span>
        <span class="lv-label">${esc(group.label)}</span>
        ${meta ? `<span class="lv-meta">${esc(meta)}</span>` : ""}
        ${ICON.chev}
      </summary>
      <div class="lv-detail">${body}</div>
    </details>`;
}

/** @param {any} group */
function metaFor(group) {
  if (group.calls.length > 1) return String(group.calls.length);
  const only = group.calls[0] ?? {};
  if (group.kind === "edit" && only.result) {
    const r = only.result;
    if (typeof r.added === "number" && typeof r.removed === "number") {
      return `+${r.added} −${r.removed}`;
    }
  }
  if (typeof only.durationMs === "number" && only.durationMs >= 100) {
    return only.durationMs >= 1000
      ? `${(only.durationMs / 1000).toFixed(1)}s`
      : `${only.durationMs}ms`;
  }
  return "";
}

/**
 * One call inside an expanded group.
 *
 * Eleven commands used to expand into one undivided run of key/value pairs,
 * where the three that failed looked exactly like the eight that did not.
 * Each call is its own block now, carrying its own status, and the raw
 * payload sits behind a second disclosure so the default view stays readable.
 * @param {any} call
 */
function callDetail(call) {
  const d = detailOf(call);
  const kv = d.rows.length
    ? `<dl class="lv-kv">${d.rows.map(([k, v]) =>
        `<dt>${esc(k)}</dt><dd class="m">${esc(v)}</dd>`).join("")}</dl>`
    : "";
  const out = d.output
    ? `<pre class="lv-out m">${esc(clipOutput(d.output, 4000))}</pre>`
    : "";
  const cut = d.truncated
    ? `<p class="lv-note">Output was cut off by the runtime's limit.</p>`
    : "";
  return `<div class="lv-call" data-status="${esc(call.status ?? "completed")}">${kv}${out}${cut}${rawDetails(call)}</div>`;
}

/**
 * The unshaped payload, one disclosure deeper than the readable view.
 *
 * It is the only place in the transcript where provider-shaped data appears,
 * it is never the default, and it is escaped like everything else: this is a
 * debugging affordance, not a channel for tool output to render itself.
 * @param {any} call
 */
function rawDetails(call) {
  let json;
  try {
    json = JSON.stringify({
      tool: call.tool, status: call.status,
      args: call.args ?? null, result: call.result ?? null,
      error: call.error ?? null, durationMs: call.durationMs ?? null,
    }, null, 2);
  } catch { return ""; }
  return `<details class="lv-raw"><summary>Raw details</summary>
<pre class="lv-out m">${esc(clipOutput(json, 4000))}</pre></details>`;
}

/**
 * The live plan block. Rendered only when the model has actually sent one.
 * @param {any[]|null} items
 */
export function planBlock(items) {
  if (!items || !items.length) return "";
  const done = items.filter((s) => s.status === "done").length;
  return `<div class="act lv-plan">
  <div class="hd">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6.5h16M4 12h16M4 17.5h10"/></svg>
    <span style="flex:1">Plan</span><span class="lab">${done} of ${items.length} complete</span>
  </div>
  ${items.map((s) => `<div class="arow lv-step" data-step="${esc(s.status)}">
    <span class="lv-dot" aria-hidden="true"></span>
    <span style="flex:1">${esc(s.step)}</span>
    ${s.note ? `<span class="lab">${esc(s.note)}</span>` : ""}
  </div>`).join("")}
</div>`;
}

/**
 * The permission card.
 *
 * It states the exact action, where it would run, why, and how the policy
 * classified it. "Allow for this session" is offered only when the runtime
 * offered it, which it does not for anything the classifier flagged.
 * @param {any} card
 */
export function permissionCard(card) {
  if (!card) return "";
  const risky = card.risk === "confirm" || card.risk === "blocked";
  /** @type {Array<[string, string]>} */
  const rows = [["Action", card.action]];
  if (card.cwd) rows.push(["Working in", card.cwd]);
  if (Array.isArray(card.target) && card.target.length) rows.push(["Files", card.target.join(", ")]);
  if (card.purpose) rows.push(["Why", card.purpose]);
  rows.push(["Classified",
    risky ? `Needs confirmation — ${card.riskReason || "sensitive"}` : "Ordinary"]);


  const buttons = (card.options || []).map((o) => {
    const label = o === "approve_once" ? "Allow once"
      : o === "approve_for_session" ? "Allow for this session"
      : "Deny";
    const cls = o === "deny" ? "btn btns" : "btn btnp btns";
    return `<button class="${cls}" type="button" data-perm-decide="${esc(o)}">${label}</button>`;
  }).join("");

  return `<div class="perm lv-perm" role="group" aria-label="Permission request"${risky ? ' data-risk="confirm"' : ""}>
  <div class="lv-perm-h">
    <span class="lv-perm-t">${esc(card.tool === "run_command" ? "Run a command" : "Change files")}</span>
    ${risky ? `<span class="pill warn">${esc(card.risk)}</span>` : ""}
  </div>
  <pre class="m lv-perm-cmd">${esc(card.action)}</pre>
  <dl class="lv-kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
  <div class="lv-perm-a">${buttons || `<button class="btn btns" type="button" data-perm-decide="deny">Deny</button>`}</div>
</div>`;
}

/** The blocking question from ask_user. */
/**
 * The question card.
 *
 * This used to be the question text and a row of bare buttons, which is what
 * you can build from a flat list of strings. A choice with no stated
 * consequence is not a choice the user can make quickly: they either pick one
 * at random or stop and go read the code themselves, and the second defeats
 * the point of asking.
 *
 * So each option carries its tradeoff, one is marked as the recommendation,
 * and free text is always present because the user is not obliged to accept
 * the frame the model imagined. Nothing here is a permission control: a
 * clarification and an approval are different decisions and must never be
 * answerable by the same click.
 *
 * @param {any} q  the pending question state: { questions: [...] }
 */
export function questionCard(q) {
  const list = q && Array.isArray(q.questions) ? q.questions : [];
  if (!list.length) return "";

  const block = (item, i) => {
    const name = esc(item.id || `q${i}`);
    const multi = item.multiSelect === true;
    const opts = (item.options || []).map((o, k) => {
      const id = `ask-${name}-${k}`;
      return `<label class="askopt" for="${id}">
      <input id="${id}" type="${multi ? "checkbox" : "radio"}" name="ask-${name}"
        value="${esc(o.label)}" data-ask-input>
      <span class="askopt-b">
        <span class="askopt-l">${esc(o.label)}${o.recommended
          ? ' <span class="askopt-r">Recommended</span>'
          : ""}</span>
        <span class="askopt-d">${esc(o.description)}</span>
      </span>
    </label>`;
    }).join("");

    return `<div class="askq" data-ask-q="${name}" data-ask-multi="${multi}">
    <p class="askq-h">${esc(item.header)}</p>
    <p class="askq-q">${esc(item.question)}</p>
    <div class="askq-o">${opts}</div>
  </div>`;
  };

  return `<div class="perm lv-ask" role="group" aria-label="The agent asked a question" data-ask-card>
  <div class="lv-perm-h"><span class="lv-perm-t">A question before continuing</span></div>
  ${list.map(block).join("")}
  <label class="askfree">
    <span class="vh">Or answer in your own words</span>
    <input type="text" data-ask-free placeholder="Or answer in your own words">
  </label>
  <div class="lv-perm-a">
    <button class="btn btnp btns" type="button" data-ask-send>Send answer</button>
  </div>
</div>`;
}
