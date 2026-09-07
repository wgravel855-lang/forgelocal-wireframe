// In-app model surfaces, rendered from the profile source of truth so the
// onboarding recommendation, Explore, My models and storage totals can never
// disagree with the catalog.
import * as F from "./fit.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tone = { ok: "ok", warn: "warn", bad: "bad", mut: "" };
const params = (n) => `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, "")}B`;

/* ------------------------------------------------- onboarding step two --- */
export function recommendationBlock(models) {
  const r = F.recommendFor();
  const m = r.m, fit = r.f;
  const speed = F.speedFor(m);
  const alt = r.lighter;

  const altRow = (label, x, note) => `
            <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 8px">
              <div style="flex:1;min-width:0">
                <div style="font-size:15px;font-weight:600">${esc(label)}</div>
                <div class="faint" style="font-size:13px;line-height:19px">${esc(x.displayName)} ${esc(x.quantization)} &middot; ${F.gb(x.downloadBytes, 1)} GB &middot; ${esc(note)}</div>
              </div>
              ${F.fitFor(x).rank <= 1
                ? `<button class="btn btns" type="button" style="flex-shrink:0">Use this instead</button>`
                : `<span class="pill ${tone[F.fitFor(x).tone]}" style="flex-shrink:0">${esc(F.fitFor(x).label)}</span>`}
            </div>`;

  const heavier = models
    .filter((x) => x.tasks.includes("coding") && x.parameterCount > m.parameterCount)
    .sort((a, b) => a.parameterCount - b.parameterCount)[0];

  return `<div style="display:flex;flex-direction:column;gap:12px">
        <span class="lab">Recommended for this PC</span>

        <div class="box" style="border-color:var(--acc);overflow:hidden">
          <div style="padding:18px 20px;display:flex;flex-direction:column;gap:14px">
            <div style="display:flex;align-items:flex-start;gap:12px">
              <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">
                <h2 class="h-sec">${esc(m.displayName)}</h2>
                <p class="mut" style="margin:0;font-size:14px;line-height:21px">
                  ${esc(m.strength)} Running at ${esc(F.fmtCtx(fit.context))} context, ${esc(m.quantization)}.
                </p>
              </div>
              <span class="pill ${tone[fit.tone]}" style="flex-shrink:0">${esc(fit.label)}</span>
            </div>

            <p class="faint" style="margin:0;font-size:13px;line-height:19px">${esc(fit.reason)}</p>

            <div style="display:flex;gap:24px;flex-wrap:wrap">
              <div style="display:flex;flex-direction:column;gap:3px">
                <span class="lab">Download</span><span class="m num">${F.gb(m.downloadBytes, 2)} GB</span>
              </div>
              <div style="display:flex;flex-direction:column;gap:3px">
                <span class="lab">Video memory needed</span><span class="m num">${F.gb(fit.required, 1)} GB of ${F.gb(F.thisPC.vramBytes, 0)} GB</span>
              </div>
              <div style="display:flex;flex-direction:column;gap:3px">
                <span class="lab">Speed</span><span class="m">${esc(speed.text)}</span>
              </div>
            </div>
          </div>

          <div class="sep"></div>
          <details>
            <summary class="hit" style="padding:0 20px;cursor:pointer;font-size:14px;color:var(--mut);list-style:none;gap:9px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
              Advanced
            </summary>
            <dl class="kv" style="padding:4px 20px 16px">
              <dt>Repository</dt><dd><span class="m">${esc(m.sourceUrl.replace("https://huggingface.co/", ""))}</span></dd>
              <dt>Quantization</dt><dd><span class="m">${esc(m.quantization)} &middot; ${esc(m.format)}</span></dd>
              <dt>Context</dt><dd><span class="m num">${esc(F.fmtCtx(fit.context))} (${F.gb(fit.kv, 2)} GB of KV cache)</span></dd>
              <dt>Runtime</dt><dd><span class="m">${esc(m.runtime)}</span></dd>
              <dt>GPU offload</dt><dd><span class="m">${esc(String(m.gpuOffloadLayers))}</span></dd>
              <dt>Stored in</dt><dd><span class="m">C:\\Users\\you\\ForgeLocal\\models</span></dd>
              <dt>License</dt><dd>${esc(m.licenseId)}</dd>
            </dl>
          </details>
        </div>

        <details class="box">
          <summary class="hit" style="padding:0 16px;cursor:pointer;font-size:14px;list-style:none;gap:9px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
            Compare other options
          </summary>
          <div class="sep"></div>
          <div style="padding:6px 8px 10px">
            ${alt ? altRow("Faster, more headroom", alt.m, "smaller and quicker, weaker on multi-file work") : ""}
            ${heavier ? altRow("More capable", heavier, heavier.limitation) : ""}
          </div>
        </details>
      </div>`;
}

/* --------------------------------------------------- onboarding step 3 --- */
export function installBlock() {
  const r = F.recommendFor();
  const m = r.m;
  const done = Math.round(m.downloadBytes * 0.41);
  return {
    name: esc(m.displayName),
    total: F.gb(m.downloadBytes, 2),
    done: F.gb(done, 2),
    freeAfter: F.gb(F.thisPC.diskFreeBytes - m.installedBytes, 0),
  };
}

/* ------------------------------------------------------------- Explore --- */
export function exploreList(models) {
  return models.map((m) => {
    const fit = F.fitFor(m);
    const speed = F.speedFor(m);
    const action = m.loaded
      ? `<button class="btn btns" type="button" data-inert="Already loaded.">In use</button>`
      : m.installed
        ? `<button class="btn btnp btns" type="button">Use</button>`
        : `<button class="btn btns" type="button">Install</button>`;
    return `<li class="box" data-filter-item data-name="${esc(m.displayName + " " + m.publisher)}"
              data-tags="${m.tasks.join(" ")} ${m.installed ? "installed" : ""} ${fit.rank <= 1 ? "fits" : ""}"
              style="padding:18px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
              <div style="flex:1;min-width:260px;display:flex;flex-direction:column;gap:8px">
                <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
                  <span class="h2">${esc(m.displayName)}</span>
                  <span class="pill ${tone[fit.tone]}">${esc(fit.label)}</span>
                  ${m.loaded ? '<span class="pill ok">Loaded</span>' : m.installed ? '<span class="pill">Installed</span>' : ""}
                </div>
                <p class="mut" style="margin:0;font-size:14px;line-height:21px">${esc(m.strength)}</p>
                <p class="faint" style="margin:0;font-size:13px;line-height:19px">${esc(fit.reason)}</p>
                <div style="display:flex;gap:18px;flex-wrap:wrap;padding-top:2px">
                  <span class="lab num">${esc(m.publisher)}</span>
                  <span class="lab num">${esc(m.quantization)} &middot; ${params(m.parameterCount)}</span>
                  <span class="lab num">${F.gb(m.downloadBytes, 1)} GB download</span>
                  <span class="lab">${esc(m.licenseId)}</span>
                  <span class="lab">${esc(speed.measured ? speed.text : "Speed not measured")}</span>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;flex-shrink:0">
                ${action}
                <a class="link" href="/models/${m.id}/">Details</a>
              </div>
            </li>`;
  }).join("\n");
}

/* ----------------------------------------------------------- My models --- */
export function myModelsList(models) {
  const t = F.storageTotals(models);
  const rows = t.installed.map((m) => {
    const fit = F.fitFor(m);
    return `<li class="box" style="padding:18px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap${m.loaded ? ";border-color:var(--acc)" : ""}">
              <div style="flex:1;min-width:260px;display:flex;flex-direction:column;gap:9px">
                <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
                  <span class="h2">${esc(m.displayName)}</span>
                  <span class="pill ${m.loaded ? "ok" : ""}">${m.loaded ? "Loaded" : "Idle"}</span>
                  ${m.recommended ? '<span class="pill">Default for coding</span>' : ""}
                </div>
                <div style="display:flex;gap:22px;flex-wrap:wrap">
                  <div style="display:flex;flex-direction:column;gap:3px"><span class="lab">On disk</span><span class="m num">${F.gb(m.installedBytes, 2)} GB</span></div>
                  <div style="display:flex;flex-direction:column;gap:3px"><span class="lab">Video memory when loaded</span><span class="m num">${F.gb(fit.required, 1)} GB</span></div>
                  <div style="display:flex;flex-direction:column;gap:3px"><span class="lab">Context</span><span class="m num">${esc(F.fmtCtx(fit.context))}</span></div>
                  <div style="display:flex;flex-direction:column;gap:3px"><span class="lab">Quantization</span><span class="m">${esc(m.quantization)}</span></div>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;flex-shrink:0">
                <button class="btn btns" type="button">${m.loaded ? "Eject" : "Load"}</button>
                <a class="link" href="/models/${m.id}/">Details</a>
              </div>
            </li>`;
  }).join("\n");

  return { rows, totalGB: F.gb(t.installedBytes, 2), freeGB: F.gb(F.thisPC.diskFreeBytes, 0), count: t.installed.length };
}
