// The composer's model picker. Three sections, and each row shows only what
// helps you choose: status, name, quantization, effective context, memory, and
// an agent-ready badge when the model has actually been verified for tool use.
// Everything else (publisher, license, architecture) lives in the manager.
import * as F from "./fit.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TICK = '<svg class="tick" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

const dot = (m) => m.loaded
  ? '<span class="dot ok" aria-hidden="true"></span>'
  : '<span class="dot" aria-hidden="true"></span>';

/**
 * agent_ready is only claimed for models whose tool-call conformance has been
 * checked. A general chat model can still answer questions, so it is listed
 * without the badge rather than hidden.
 */
const agentReady = (m) => m.tasks.includes("coding") && m.parameterCount >= 7e9;

const row = (m, selectedId) => {
  const fit = F.fitFor(m);
  const on = m.id === selectedId;
  const meta = m.loaded
    ? `${esc(m.quantization)} · ${esc(F.fmtCtx(fit.context))} context · ${F.gb(fit.required, 1)} GB in use`
    : `${esc(m.quantization)} · ${F.gb(m.downloadBytes, 1)} GB on disk`;
  return `<button role="menuitemradio" aria-checked="${on}" class="mpick-row"
    data-model-row data-model-id="${m.id}" data-model-name="${esc(m.displayName)}"
    data-state="${m.loaded ? "loaded" : "installed"}"
    title="${esc(m.displayName)}">
    <span class="ic">${dot(m)}</span>
    <span class="n">${esc(m.displayName)}</span>
    ${agentReady(m) ? '<span class="badge-agent">Agent-ready</span>' : ""}
    <span class="meta">${meta}</span>
    ${on ? TICK : ""}
  </button>`;
};

export function pickerHtml(models, selectedId) {
  const coding = models.filter((m) => m.installed);
  const loaded = coding.filter((m) => m.loaded);
  const unloaded = coding.filter((m) => !m.loaded);

  const section = (label, list) => list.length
    ? `<span class="mpick-h">${label}</span>${list.map((m) => row(m, selectedId)).join("\n")}`
    : "";

  return `<div class="menu popover mpick" id="model-pop" role="menu" aria-label="Choose a model"
    hidden style="bottom:calc(100% + 8px);top:auto;right:0;left:auto">
    ${section("Loaded", loaded)}
    ${section("Installed", unloaded)}
    ${loaded.length ? "" : `<p class="pd-note" style="padding:8px 9px">No model is loaded, so nothing can be sent yet.</p>`}
    <div class="mpick-foot">
      <a class="btn btns" href="/app/models/installed/">Model manager</a>
      <a class="btn btns btnq" href="/app/models/" style="border-color:var(--line)">Find a model</a>
    </div>
  </div>`;
}
