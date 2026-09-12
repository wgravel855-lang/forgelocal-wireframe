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

import { escapeHtml as esc } from "./html.mjs";
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

  for (const row of view.rows) {
    if (row.kind === "tool") { toolRun.push(row); continue; }
    flush();
    if (row.kind === "user") html.push(userTurn(row));
    if (row.kind === "assistant") html.push(assistantTurn(row));
  }
  flush();

  return html.join("\n");
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
    links: false,           // a reply does not mint clickable destinations
    softBreaks: true,       // keep the line breaks the model wrote
    cls: null,              // styled by element inside .prose
  });
}

/** One activity group: the collapsed line, and the detail behind it. */
function activityBlock(rows) {
  const groups = groupActivity(rows);
  return `<article class="turn turn-assistant">
  <div class="act">
${groups.map(activityRow).join("\n")}
  </div>
</article>`;
}

const ICON = {
  ok: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
  bad: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--bad)" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  run: `<span class="lv-spin" aria-hidden="true"></span>`,
  wait: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/></svg>`,
};

function activityRow(group, i) {
  const icon = group.status === "failed" || group.status === "denied" ? ICON.bad
    : group.status === "running" || group.status === "requested" ? ICON.run
    : group.status === "awaiting_permission" ? ICON.wait
    : group.status === "cancelled" ? ICON.bad
    : ICON.ok;

  const note = group.status === "denied" ? "Denied"
    : group.status === "cancelled" ? "Stopped"
    : group.status === "awaiting_permission" ? "Waiting"
    : group.calls.length > 1 ? `${group.calls.length}`
    : "";

  const body = group.calls.map(callDetail).join("\n");
  const id = `lv-${i}-${Math.random().toString(36).slice(2, 7)}`;

  return `    <details class="arow lv-row" data-activity="${esc(group.kind)}" data-status="${esc(group.status)}">
      <summary id="${id}">
        ${icon}
        <span class="lv-label">${esc(group.label)}</span>
        ${note ? `<span class="lab">${esc(note)}</span>` : ""}
      </summary>
      <div class="lv-detail">${body}</div>
    </details>`;
}

function callDetail(call) {
  const d = detailOf(call);
  const kv = d.rows.length
    ? `<dl class="lv-kv">${d.rows.map(([k, v]) =>
        `<dt>${esc(k)}</dt><dd class="m">${esc(v)}</dd>`).join("")}</dl>`
    : "";
  const out = d.output
    ? `<pre class="lv-out m">${esc(clip(d.output, 4000))}</pre>`
    : "";
  const cut = d.truncated ? `<p class="lv-note">Output was cut off by the runtime's limit.</p>` : "";
  return `${kv}${out}${cut}`;
}

/** Long output is clipped for the DOM; the runtime already bounded it once. */
function clip(s, n) {
  const t = String(s);
  return t.length > n ? `${t.slice(0, n)}\n… ${t.length - n} more characters` : t;
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
export function questionCard(q) {
  if (!q) return "";
  const opts = (q.options || []).map((o) =>
    `<button class="btn btns" type="button" data-answer-option="${esc(o)}">${esc(o)}</button>`).join("");
  return `<div class="perm lv-ask" role="group" aria-label="The agent asked a question">
  <p class="lv-ask-q">${esc(q.question)}</p>
  ${opts ? `<div class="lv-perm-a">${opts}</div>` : ""}
  <p class="lv-note">Answer in the composer to continue.</p>
</div>`;
}
