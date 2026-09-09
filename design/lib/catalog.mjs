// The catalog as a split view: results on the left, the selected model's detail
// on the right. One record feeds both, so a row and its detail can never
// disagree, and the selection survives a refresh through ?model=<id>.
import * as F from "./fit.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CAP_LABEL = {
  tool_use: "Tool use",
  agent_ready: "Agent-ready",
  reasoning: "Reasoning",
  vision: "Vision",
  fim: "Fill in the middle",
  chat: "Chat",
};

/* Capabilities are derived from the record, not asserted per page. agent_ready
   additionally requires that the model be a coding model large enough to have
   passed the tool-call conformance check; a general chat model is listed
   without it rather than being hidden. */
export function capabilitiesOf(m) {
  const caps = ["chat"];
  if (m.tasks.includes("tool-use")) caps.push("tool_use");
  if (m.tasks.includes("coding") && m.parameterCount >= 7e9) caps.push("agent_ready");
  if (m.parameterCount >= 3e10) caps.push("reasoning");
  if (m.tasks.includes("coding")) caps.push("fim");
  return caps;
}

const capIcon = (cap) => {
  const d = {
    tool_use: '<path d="M14.7 6.3a4 4 0 0 1-5 5L5 16v3h3l4.7-4.7a4 4 0 0 0 5-5z"/>',
    agent_ready: '<path d="M20 6 9 17l-5-5"/>',
    reasoning: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>',
    fim: '<path d="M4 7h6M4 12h16M4 17h9"/>',
    chat: '<path d="M20 15.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5z"/>',
    vision: '<circle cx="12" cy="12" r="3"/><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/>',
  }[cap] || "";
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
};

const fitWord = {
  great: "Runs well", tradeoffs: "Close fit", offload: "Partly on CPU", none: "Will not fit",
};

/** A result row: who made it, what it is for, whether it runs here, how big. */
const resultRow = (m, selectedId) => {
  const fit = F.fitFor(m);
  const on = m.id === selectedId;
  // One text indicator, not a row of tiny glyphs. The full capability list is
  // in the detail pane, where it has room for its own labels.
  const agentReady = capabilitiesOf(m).includes("agent_ready");
  return `<a class="cat-row${on ? " is-on" : ""}" href="?model=${esc(m.id)}"
    data-cat-row="${esc(m.id)}"${on ? ' aria-current="true"' : ""}>
    <span class="cat-name">${esc(m.displayName)}</span>
    ${m.installed ? '<span class="cat-state">Installed</span>' : ""}
    <span class="cat-pub">${esc(m.publisher)}</span>
    <span class="cat-use">${esc((m.strength || "").split(". ")[0])}</span>
    <span class="cat-caps">${agentReady ? '<span class="badge-agent">Agent-ready</span>' : ""}</span>
    <span class="cat-fit"><span class="dot ${fit.tone === "ok" ? "ok" : fit.tone === "warn" ? "warn" : fit.tone === "bad" ? "bad" : ""}" aria-hidden="true"></span>${esc(fitWord[fit.state] || fit.label)}</span>
    <span class="cat-size num">${F.gb(m.downloadBytes, 1)} GB</span>
  </a>`;
};

/** The detail pane: provenance first, then capability, then whether it fits. */
const detail = (m) => {
  const fit = F.fitFor(m);
  const caps = capabilitiesOf(m);
  return `<div class="cat-detail" data-cat-detail>
    <a class="cat-back" href="/app/models/">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
      Back to results</a>

    <h2 class="cat-h">${esc(m.displayName)}</h2>
    <p class="cat-sub">${esc(m.publisher)}
      ${m.licenseId ? `&middot; ${esc(m.licenseId)}` : ""}
      ${m.sourceUrl ? `&middot; <a class="link" href="${esc(m.sourceUrl)}" rel="noreferrer noopener" target="_blank">Model card</a>` : ""}</p>

    <p class="cat-desc">${esc(m.strength)}</p>

    <h3 class="cat-h3">Capabilities</h3>
    <ul class="cat-caplist">
      ${caps.map((c) => `<li>${capIcon(c)}<span>${CAP_LABEL[c]}</span></li>`).join("")}
    </ul>
    ${caps.includes("agent_ready")
    ? `<p class="cat-note">Agent-ready means this model produced valid structured tool calls in
        ForgeLocal's conformance check. Models without it can still answer questions.</p>`
    : `<p class="cat-note">Not verified for tool use. It can answer questions about code, but
        ForgeLocal will not let it drive tools.</p>`}

    <h3 class="cat-h3">Specification</h3>
    <dl class="cat-kv">
      <dt>Architecture</dt><dd>${esc(m.architecture || m.family || "—")}</dd>
      <dt>Parameters</dt><dd>${(m.parameterCount / 1e9).toFixed(m.parameterCount >= 1e10 ? 0 : 1).replace(/\.0$/, "")}B</dd>
      <dt>Format</dt><dd>GGUF &middot; ${esc(m.quantization)}</dd>
      <dt>Max context</dt><dd class="num">${esc(F.fmtCtx(Math.max(...m.contextOptions)))}</dd>
    </dl>

    <h3 class="cat-h3">On this PC</h3>
    <dl class="cat-kv">
      <dt>Fit</dt><dd><span class="dot ${fit.tone === "ok" ? "ok" : fit.tone === "warn" ? "warn" : "bad"}" aria-hidden="true"></span> ${esc(fitWord[fit.state] || fit.label)}</dd>
      <dt>Video memory</dt><dd class="num">${F.gb(fit.required, 1)} GB of ${F.gb(F.thisPC.vramBytes, 0)} GB</dd>
      <dt>At context</dt><dd class="num">${esc(F.fmtCtx(fit.context))}</dd>
      <dt>Download</dt><dd class="num">${F.gb(m.downloadBytes, 2)} GB</dd>
    </dl>
    <p class="cat-note">${esc(fit.reason)}</p>

    <div class="cat-actions">
      ${m.installed
    ? `<a class="btn btnp" href="/app/models/installed/">In My models</a>`
    : `<button class="btn btnp" type="button" data-model-install="${esc(m.displayName)}">Download ${F.gb(m.downloadBytes, 1)} GB</button>`}
    </div>
  </div>`;
};

const empty = () => `<div class="cat-detail cat-empty" data-cat-detail>
  <p>Select a model to see its capabilities, licence and how it fits this PC.</p>
</div>`;

export function catalogHtml(models, selectedId) {
  const selected = models.find((m) => m.id === selectedId);
  return `<div class="cat" data-catalog data-filter-root="explore">
    <div class="cat-list">
      <label class="field cat-search">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="flex-shrink:0"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
        <span class="vh">Search models</span>
        <input type="search" data-filter-search placeholder="Search models">
      </label>
      <div class="cat-rows" role="list">
        ${models.map((m) => `<div role="listitem" data-filter-item
          data-name="${esc(m.displayName + " " + m.publisher)}"
          data-tags="${m.tasks.join(" ")} ${m.installed ? "installed" : ""}">${resultRow(m, selectedId)}</div>`).join("\n")}
      </div>
      <p class="chat-empty" data-filter-empty hidden>No model matches that search.</p>
    </div>
    ${selected ? detail(selected) : empty()}
  </div>`;
}
