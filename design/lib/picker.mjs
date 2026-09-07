// The composer's model popover, generated from the profile source of truth so
// it can never disagree with the catalog or the recommendation.
import * as F from "./fit.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const chip = { ok: "ok", warn: "warn", bad: "bad", mut: "" };

const row = (m, selectedId) => {
  const fit = F.fitFor(m);
  const state = !m.installed ? "notinstalled" : "installed";
  const on = m.id === selectedId;
  return `<button role="menuitemradio" aria-checked="${on}" class="srow${on ? " on" : ""}"
    data-model-row data-model-id="${m.id}" data-model-name="${esc(m.displayName)}" data-state="${state}"
    style="height:auto;padding:9px;align-items:flex-start">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" style="flex-shrink:0;margin-top:2px"><rect x="3" y="3" width="18" height="18" rx="3.5"/><rect x="8" y="8" width="8" height="8" rx="1.8"/></svg>
    <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
      <span style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
        <span style="font-size:13.5px;font-weight:${on ? 600 : 400}">${esc(m.displayName)}</span>
        <span class="pill ${chip[fit.tone] || ""}" style="height:18px;font-size:10.5px;padding:0 6px">${esc(fit.label)}</span>
        ${m.loaded ? '<span class="pill ok" style="height:18px;font-size:10.5px;padding:0 6px">Loaded</span>' : ""}
      </span>
      <span class="faint" style="font-size:12px;line-height:17px">${esc(m.strength)}</span>
      <span class="lab num" style="font-size:11px">${esc(m.quantization)} &middot; ${F.gb(m.downloadBytes, 1)} GB${m.installed ? " &middot; installed" : " &middot; not installed"}</span>
    </span>
    ${m.installed
      ? (on ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--acc-text)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-top:3px"><path d="M20 6 9 17l-5-5"/></svg>' : "")
      : '<span class="btn btns" style="flex-shrink:0">Install</span>'}
  </button>`;
};

export function pickerHtml(models, selectedId) {
  const coding = models.filter((m) => m.tasks.includes("coding"));
  const installed = coding.filter((m) => m.installed);
  const available = coding.filter((m) => !m.installed);
  const other = models.filter((m) => !m.tasks.includes("coding"));

  const group = (label, list) => list.length
    ? `<div data-model-group><div class="sgroup">${label}</div>${list.map((m) => row(m, selectedId)).join("")}</div>`
    : "";

  return `<div class="menu popover" id="model-pop" role="menu" aria-label="Choose a model" hidden
  style="bottom:calc(100% + 8px);left:0;width:min(420px,calc(100vw - 48px));max-height:60vh;overflow-y:auto;padding:6px">
  <div style="padding:4px 4px 6px">
    <label class="field" style="height:32px">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="flex-shrink:0"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
      <span class="vh">Search models</span>
      <input data-model-search data-autofocus type="search" placeholder="Search models"
        style="border:0;background:transparent;outline:none;flex:1;min-width:0;color:var(--fg);font-size:13px">
    </label>
  </div>
  ${group("On this device", installed)}
  ${group("Available to install", available)}
  ${group("General purpose, not verified for tools", other)}
  <p data-model-empty hidden class="mut" style="padding:16px 10px;margin:0;font-size:13px;text-align:center">No models match.</p>
  <div class="sep" style="margin:6px 4px"></div>
  <div style="padding:4px 9px 6px">
    <a href="/app/models/" style="font-size:12.5px">Manage models</a>
    <span class="faint" style="font-size:12px"> &middot; fit is recalculated from your hardware</span>
  </div>
</div>`;
}
