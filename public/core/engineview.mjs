// @ts-check
/**
 * ForgeLocal's own engine, as the interface shows it.
 *
 * Five states, and the two that matter most are the ones that are not
 * "working": a failure names what went wrong and what to do about it, and a
 * restart says which attempt it is on. A spinner that means "something is
 * happening, we are not saying what" is the thing this file exists to avoid.
 *
 * Everything rendered here comes from the host. The engine's port and its
 * session token are never part of it — not because they are hidden, but
 * because they never arrive: the host hands them straight to the runtime and
 * the renderer is told only that a model is ready.
 */

import { escapeHtml as esc, truncate } from "./html.mjs";

/**
 * A byte count as a label.
 *
 * Named for what it returns rather than for its unit: core/units.mjs
 * already exports a `gb` that returns a NUMBER, and two functions with one
 * name is how a template ends up printing "12.8 GB GB".
 *
 * @param {number|null|undefined} n
 */
export function gbLabel(n) {
  if (n == null) return null;
  /* A unit that suits the number. A truncated download of 1,200 bytes
     rendered as "0.0 GB", which reads as the formatter being broken
     rather than as the file being tiny — and a tiny file is exactly what
     a failed download looks like. */
  if (n < 1e3) return `${n} bytes`;
  if (n < 1e6) return `${(n / 1e3).toFixed(1)} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

/**
 * What the machine has, in one line, saying what it could not measure.
 *
 * @param {any} hw
 * @returns {{summary: string, gpu: string|null, unknown: string[]}}
 */
export function hardwareSummary(hw) {
  if (!hw) {
    return {
      summary: "Nothing has been measured. The desktop app reports this; the web preview cannot.",
      gpu: null,
      unknown: ["everything"],
    };
  }
  const unknown = [];
  const parts = [];

  const gpus = Array.isArray(hw.gpus) ? hw.gpus : [];
  const best = gpus.find((g) => typeof g.vram_bytes === "number" && g.vram_bytes > 0)
    ?? gpus[0] ?? null;

  /** @type {string|null} */
  let gpuLine = null;
  if (!best) {
    unknown.push("GPU");
  } else if (best.vram_bytes) {
    gpuLine = `${best.name} · ${gbLabel(best.vram_bytes)}`;
    parts.push(gpuLine);
  } else {
    // Found but not measured. Said plainly rather than shown as a number.
    gpuLine = `${best.name} · memory not measurable`;
    parts.push(gpuLine);
    unknown.push("GPU memory");
  }

  if (hw.ram_bytes) parts.push(`${gbLabel(hw.ram_bytes)} memory`);
  else unknown.push("system memory");

  if (hw.cpu_cores) parts.push(`${hw.cpu_cores} cores`);

  return {
    summary: parts.length ? parts.join(" · ") : "Nothing could be measured on this machine.",
    gpu: gpuLine,
    unknown,
  };
}

/**
 * The engine's state, as a block.
 *
 * @param {object} input
 * @param {any} input.state        from the host, or null
 * @param {boolean} input.installed
 * @param {string[]} [input.log]   the engine's own last lines
 * @param {boolean} [input.desktop] whether there is a host at all
 */
export function engineBlock({ state, installed, log = [], desktop = true }) {
  if (!desktop) {
    return row("mut", "Not available here",
      "ForgeLocal's engine runs in the desktop app. This preview has no host to start one.");
  }
  if (!installed) {
    /* No terminal command here any more. Someone who installed the app does
       not have a checkout of it to run scripts from, and this build ships
       without the engine deliberately — it is a 150MB to 540MB download that
       depends on the machine, so it is fetched rather than bundled.
       What is honest to say is where it comes from and what else will do. */
    return `${row("warn", "The engine is not installed",
      "ForgeLocal runs models itself. The engine is downloaded for this machine rather "
      + "than bundled, because the build that suits a given graphics card is between "
      + "150MB and 540MB, and this copy has not been fetched yet.")}
<p class="set-d">An external server such as LM Studio can be used instead — see the provider setting below.</p>`;
  }

  const s = state ?? { state: "stopped" };
  switch (s.state) {
    case "ready":
      return `${row("ok", `Running ${esc(truncate(s.model ?? "a model", 44))}`,
        [
          s.load_seconds != null ? `Loaded in ${s.load_seconds}s.` : null,
          s.gpu_layers != null
            ? (s.gpu_layers >= 999 ? "All layers on the GPU." : `${s.gpu_layers} layers on the GPU.`)
            : null,
          s.context ? `${Number(s.context).toLocaleString()} token context.` : null,
        ].filter(Boolean).join(" "))}
<p class="set-d">It listens only on this machine and requires a token this session generated.</p>
<button class="btn btns" type="button" data-engine-stop>Unload the model</button>`;

    case "starting":
      return `${row("mut", `Loading ${esc(truncate(s.model ?? "a model", 44))}`,
        s.detail ? esc(truncate(s.detail, 140)) : "Reading the weights.")}
<p class="set-d">A large model on a cold disk takes minutes. What it prints is shown above.</p>
<button class="btn btns" type="button" data-engine-stop>Stop loading</button>`;

    case "restarting":
      return `${row("warn", `Restarting ${esc(truncate(s.model ?? "the model", 44))}`,
        `${esc(s.reason ?? "It stopped answering.")} Attempt ${s.attempt} of 3.`)}
<p class="set-d">It was working and then stopped. If this keeps happening it will stop trying and say so.</p>`;

    case "failed":
      return `${row("bad", esc(s.reason ?? "The engine stopped."), esc(s.fix ?? ""))}
${log.length ? `<details class="lv-row" style="margin-top:6px"><summary><span class="lv-label">What the engine printed</span></summary>
<div class="lv-detail"><pre class="lv-out m">${esc(log.slice(-14).join("\n"))}</pre></div></details>` : ""}`;

    default:
      return row("mut", "No model is loaded",
        "Choose a model to start the engine. Nothing is running and nothing is using the GPU.");
  }
}

/**
 * A model FILE on disk, with whether it will run here.
 *
 * Not catalog.mjs's modelRow, which renders a catalogue entry somebody
 * might download. These are different things and sharing a name made the
 * console gate, which flattens every module into one scope, refuse to load
 * any page at all.
 *
 * `fit` is null when the hardware could not be measured, and the row says so
 * rather than showing a verdict computed from nothing.
 *
 * @param {any} m
 * @param {{loadedName?: string|null}} [opts]
 */
export function modelFileRow(m, { loadedName = null } = {}) {
  const loaded = loadedName && m.name === loadedName;
  const tone = !m.usable ? "bad"
    : !m.fit ? "mut"
    : { fits: "ok", partial: "warn", tight: "warn", cpu: "warn", no: "bad", unknown: "mut" }[m.fit.verdict] ?? "mut";

  const verdict = !m.usable ? (m.problem ?? "Not a usable model file")
    : !m.fit ? "Whether this runs here is not known: the hardware could not be measured."
    : `${m.fit.label}. ${m.fit.detail}`;

  return `<div class="setrow" data-model-row="${esc(m.name)}">
  <div>
    <span class="set-l">${esc(m.name)}</span>
    <p class="set-d m">${esc(gbLabel(m.bytes) ?? "")}${
      m.fit && m.fit.gpuLayers != null && m.fit.gpuLayers < 999
        ? ` · suggested ${m.fit.gpuLayers} GPU layers` : ""}</p>
    <p class="set-d"><span class="cap-pill" data-tone="${tone}">${
      esc(!m.usable ? "Unusable" : (m.fit?.label ?? "Unknown"))}</span> ${esc(verdict)}</p>
  </div>
  <span style="display:flex;gap:6px;flex-shrink:0">
    ${m.usable && !loaded
      ? `<button class="btn btns" type="button" data-model-load="${esc(m.name)}">Load</button>`
      : ""}
    ${loaded ? `<span class="set-v faint">Loaded</span>` : ""}
    <button class="btn btns btnq" type="button" data-model-verify="${esc(m.name)}">Check</button>
    <button class="btn btns btnq btnd" type="button" data-model-delete="${esc(m.name)}">Delete</button>
  </span>
</div>`;
}

/**
 * The whole models list.
 * @param {object} input
 * @param {any[]} input.models @param {boolean} input.hardwareKnown
 * @param {string|null} [input.dir] @param {string|null} [input.loadedName]
 */
export function modelsBlock({ models, hardwareKnown, dir = null, loadedName = null }) {
  if (!models.length) {
    return `<p class="set-empty">No models yet. Weights are not part of the installer — they are
      downloaded separately and are usually several gigabytes.</p>
      ${dir ? `<p class="set-d m">${esc(dir)}</p>` : ""}`;
  }
  const warn = hardwareKnown ? "" :
    `<p class="set-d"><em>This machine's memory could not be measured, so none of these rows
      says whether a model will run. The suggestion is left to you.</em></p>`;
  return `${warn}${models.map((m) => modelFileRow(m, { loadedName })).join("\n")}
    ${dir ? `<p class="set-d m">${esc(dir)}</p>` : ""}`;
}

/** A download in flight. */
export function downloadRow(d) {
  const pct = d.total ? Math.round((d.bytes / d.total) * 100) : null;
  const phase = d.phase === "verifying" ? "Checking" : "Downloading";
  const rate = d.bytesPerSecond ? ` · ${(d.bytesPerSecond / 1e6).toFixed(1)} MB/s` : "";
  const left = d.secondsLeft != null && d.secondsLeft > 0
    ? ` · about ${d.secondsLeft > 90 ? `${Math.round(d.secondsLeft / 60)} min` : `${d.secondsLeft}s`} left`
    : "";
  return `<div class="setrow">
  <div><span class="set-l">${esc(d.name)}</span>
    <p class="set-d">${phase}${pct != null ? ` — ${pct}%` : ""}${esc(rate)}${esc(left)}</p></div>
  <button class="btn btns btnq" type="button" data-download-cancel="${esc(d.name)}">Stop</button>
</div>`;
}

/** @param {string} tone @param {string} title @param {string} detail */
function row(tone, title, detail) {
  return `<p class="cap-h"><span class="cap-pill" data-tone="${tone}">${title}</span></p>
    ${detail ? `<p class="set-d">${detail}</p>` : ""}`;
}
