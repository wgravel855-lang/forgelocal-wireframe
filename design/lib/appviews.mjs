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
                ? `<a class="btn btns" href="/setup/3/" style="flex-shrink:0">Use this instead</a>`
                : `<span class="pill ${tone[F.fitFor(x).tone]}" style="flex-shrink:0">${esc(F.fitFor(x).label)}</span>`}
            </div>`;

  const heavier = models
    .filter((x) => x.tasks.includes("coding") && x.parameterCount > m.parameterCount)
    .sort((a, b) => a.parameterCount - b.parameterCount)[0];

  return `<div>
        <div style="box-shadow:inset 2px 0 0 var(--acc)">
          <div style="padding:18px 20px 20px;display:flex;flex-direction:column;gap:14px">
            <span class="lab">Recommended for this PC</span>
            <div style="display:flex;align-items:flex-start;gap:12px">
              <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">
                <h2 class="h-sec">${esc(m.displayName)}</h2>
                <p class="mut" style="margin:0;font-size:14px;line-height:21px">
                  ${esc(m.strength)} Running at ${esc(F.fmtCtx(fit.context))} context, ${esc(m.quantization)}.
                </p>
              </div>
              <span class="rfit" style="flex-shrink:0"><span class="dot ${tone[fit.tone]}" aria-hidden="true"></span>${esc(fit.label)}</span>
            </div>

            <p class="faint" style="margin:0;font-size:13.5px;line-height:20px">${esc(fit.reason)}</p>

            <div class="specs" style="border:0;margin:0;padding:0;gap:14px 28px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
              <div><span class="k">Download</span><span class="v">${F.gb(m.downloadBytes, 2)} GB</span></div>
              <div><span class="k">Video memory needed</span><span class="v">${F.gb(fit.required, 1)} GB of ${F.gb(F.thisPC.vramBytes, 0)} GB</span></div>
              <div><span class="k">Speed</span><span class="v" style="font-size:14px">${esc(speed.text)}</span></div>
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

        <div class="sep"></div>
        <details>
          <summary class="hit" style="padding:0 20px;cursor:pointer;font-size:14px;list-style:none;gap:9px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
            Compare other options
          </summary>
          <div style="padding:0 12px 12px">
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
const fitDot = (fit) =>
  `<span class="rfit"><span class="dot ${tone[fit.tone] || ""}" aria-hidden="true"></span>${esc(fit.label)}</span>`;

export function exploreList(models) {
  return models.map((m) => {
    const fit = F.fitFor(m);
    const action = m.loaded
      ? `<button class="btn btns" type="button" data-inert="This model is already loaded.">In use</button>`
      : m.installed
        ? `<button class="btn btnp btns" type="button" data-model-use="${esc(m.displayName)}" data-model-id="${esc(m.id)}">Use</button>`
        : `<button class="btn btns" type="button" data-model-install="${esc(m.displayName)}">Install</button>`;
    return `<li data-filter-item data-name="${esc(m.displayName + " " + m.publisher)}"
              data-tags="${m.tasks.join(" ")} ${m.installed ? "installed" : ""} ${fit.rank <= 1 ? "fits" : ""}"${m.loaded ? ' class="is-current"' : ""}>
              <div class="rrow has-action">
                <div style="min-width:0">
                  <a class="rname" href="/models/${m.id}/">${esc(m.displayName)}</a>
                  <p class="ruse">${esc(m.strength)}</p>
                  <p class="rmeta">${esc(m.publisher)} &middot; ${esc(m.quantization)} ${params(m.parameterCount)} &middot; ${esc(m.licenseId)}</p>
                </div>
                ${fitDot(fit)}
                <div class="rnums">
                  <span class="rnum"><b>${F.gb(fit.required, 1)} GB</b><span>video memory</span></span>
                  <span class="rnum"><b>${F.gb(m.downloadBytes, 1)} GB</b><span>download</span></span>
                  <span class="rnum"><b>${esc(F.fmtCtx(fit.context))}</b><span>context</span></span>
                </div>
                ${action}
              </div>
            </li>`;
  }).join("\n");
}

/* ----------------------------------------------------------- My models --- */
export function myModelsList(models) {
  const t = F.storageTotals(models);
  const rows = t.installed.map((m) => {
    const fit = F.fitFor(m);
    return `<li data-filter-item data-name="${esc(m.displayName)} ${esc(m.publisher)}"
              data-tags="${m.tasks.join(" ")} installed${fit.rank <= 1 ? " fits" : ""}"${m.loaded ? ' class="is-current"' : ""}>
              <div class="rrow has-action">
                <div style="min-width:0">
                  <a class="rname" href="/models/${m.id}/">${esc(m.displayName)}</a>
                  <p class="ruse">${esc(m.strength)}</p>
                  <p class="rmeta"><span data-load-pill>${m.loaded ? "Loaded" : "Idle"}</span> &middot; ${esc(m.quantization)}${m.recommended ? " &middot; Default for coding" : ""}</p>
                </div>
                <span class="rfit"><span class="dot ${m.loaded ? "ok" : ""}" aria-hidden="true"></span>${m.loaded ? "In video memory" : "On disk only"}</span>
                <div class="rnums">
                  <span class="rnum"><b>${F.gb(m.installedBytes, 2)} GB</b><span>on disk</span></span>
                  <span class="rnum"><b>${F.gb(fit.required, 1)} GB</b><span>when loaded</span></span>
                  <span class="rnum"><b>${esc(F.fmtCtx(fit.context))}</b><span>context</span></span>
                </div>
                <button class="btn btns" type="button" data-load-toggle data-model="${esc(m.displayName)}">${m.loaded ? "Eject" : "Load"}</button>
              </div>
            </li>`;
  }).join("\n");

  return { rows, totalGB: F.gb(t.installedBytes, 2), freeGB: F.gb(F.thisPC.diskFreeBytes, 0), count: t.installed.length };
}
