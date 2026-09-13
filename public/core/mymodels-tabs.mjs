// @ts-check
/**
 * The Load and Inference tabs of the model inspector.
 *
 * Separated from mymodels.mjs because between them they are most of the
 * surface: two sliders, six advanced switches, and eight accordions holding
 * around twenty-five controls. Keeping them here leaves the page module about
 * the page.
 *
 * One rule runs through the whole file and decides what is in it. **A control
 * is rendered only where the runtime can honour it.** ForgeLocal starts
 * llama-server with a specific set of flags, and its OpenAI-compatible
 * requests carry a specific set of sampling fields; anything outside those two
 * sets would be a knob that moves and changes nothing, which is worse than an
 * absent feature because it invites somebody to tune it. So the Load tab shows
 * the six flags the host actually passes, and the Inference tab's sections say
 * plainly where a thing is not supported rather than offering it greyed out.
 *
 * The second rule is that an estimate is labelled as one. The memory figures
 * come from the same arithmetic the model browser uses — file size, layer
 * count, KV cache per token — and that is a projection, not a measurement.
 */

import { escapeHtml as esc } from "./html.mjs";
import { sizeLabel } from "./units.mjs";
import { MM_ICON } from "./mymodels.mjs";

/**
 * The llama-server flags ForgeLocal passes.
 *
 * Taken from engine.rs, which builds the command line: -ngl, -c, -np, -fa.
 * Anything else here would be a control with no wire behind it. When the host
 * learns a new flag this list grows and the accordion grows with it.
 */
export const ADVANCED = Object.freeze([
  {
    id: "threads", label: "CPU threads", kind: "number", min: 1, max: 64,
    help: "How many processor threads the engine uses for the layers it does not put on the GPU.",
    supported: false,
    why: "ForgeLocal does not pass a thread count yet; llama.cpp picks one from the machine.",
  },
  {
    id: "batch", label: "Batch size", kind: "number", min: 32, max: 4096,
    help: "Tokens evaluated per pass while reading your prompt.",
    supported: false,
    why: "ForgeLocal does not pass a batch size yet.",
  },
  {
    id: "flashAttention", label: "Flash attention", kind: "switch",
    help: "A faster attention kernel. Usually a clear win on recent NVIDIA cards.",
    supported: true,
  },
  {
    id: "parallel", label: "Parallel sequences", kind: "number", min: 1, max: 8,
    help: "How many requests the engine serves at once. Each one needs its own KV cache.",
    supported: true,
  },
  {
    id: "mmap", label: "Memory mapping", kind: "switch",
    help: "Map the file rather than reading it into memory.",
    supported: false,
    why: "ForgeLocal leaves this at llama.cpp's default.",
  },
  {
    id: "mlock", label: "Lock model in memory", kind: "switch",
    help: "Stop the operating system paging the weights out.",
    supported: false,
    why: "ForgeLocal leaves this at llama.cpp's default.",
  },
]);

/** Bytes per token per layer for the KV cache, as the fit module measures it. */
const KV_BYTES_PER_TOKEN_PER_LAYER = 4096;

/**
 * What loading this model at these settings would cost.
 *
 * A projection from three real numbers — the file's size on disk, its layer
 * count from the header, and the context asked for — and it is labelled as a
 * projection everywhere it is shown. Returns nulls rather than zeroes when the
 * header did not carry what it needs.
 *
 * @param {{bytes: number|null, layers: number|null}} model
 * @param {{context: number, gpuLayers: number}} settings
 */
export function estimate(model, settings) {
  const bytes = typeof model.bytes === "number" ? model.bytes : null;
  const layers = typeof model.layers === "number" && model.layers > 0 ? model.layers : null;
  if (!bytes || !layers) return { weights: null, kv: null, vram: null, ram: null, approximate: true };

  const onGpu = Math.max(0, Math.min(settings.gpuLayers, layers));
  const share = onGpu / layers;
  const kv = settings.context * layers * KV_BYTES_PER_TOKEN_PER_LAYER;
  return {
    weights: bytes,
    kv,
    /* The KV cache follows the layers onto the card. */
    vram: Math.round(bytes * share + kv * share),
    ram: Math.round(bytes * (1 - share) + kv * (1 - share)),
    approximate: true,
  };
}

/* Bytes become words in units.mjs. */

/**
 * One line of the memory estimate.
 *
 * Zero and unknown are different answers and were being given the same word.
 * With every layer on the card, nothing is in system RAM — that is a figure
 * this page worked out, not one it failed to work out, and printing
 * "unknown" beside it made the whole estimate look like it had given up.
 * Null stays "unknown", because that is when the file's header did not say
 * enough to project anything.
 *
 * @param {string} label @param {number|null} bytes
 */
function estRow(label, bytes) {
  const known = typeof bytes === "number" && Number.isFinite(bytes);
  const text = !known ? "unknown" : bytes === 0 ? "none" : (sizeLabel(bytes) ?? "under 1 MB");
  return `<div class="mm-kv"><span class="mm-kv-k">${esc(label)}</span>
    <span class="mm-kv-v${known && bytes > 0 ? "" : " is-none"}"${
  known && bytes === 0 ? ' title="Every layer is on the GPU, so nothing is held in system RAM."' : ""
}>${esc(text)}</span></div>`;
}

/**
 * A slider paired with the number it sets, both driving one value.
 *
 * Three rows, in the reference's order: the label with its value, then a
 * sentence naming the ceiling, then the slider. The ceiling used to sit under
 * the slider as "max 131,072" in the right-hand corner, which put the one
 * figure that explains why the slider stops where it does furthest from the
 * number it constrains — and at a narrow width the two corner captions wrapped
 * into each other. Saying it in words next to the value is both clearer and
 * shorter.
 *
 * `limit` is {before, value, after}, kept as three pieces rather than one
 * string so the figure can be a pill and every part is still escaped.
 *
 * @param {{id: string, label: string, value: number, min: number, max: number,
 *          step?: number, note?: string,
 *          limit?: {before: string, value: string, after?: string} | null}} opts
 */
function slider({ id, label, value, min, max, step = 1, limit = null, note = "" }) {
  return `<div class="mm-ctl">
    <div class="mm-ctl-h">
      <label class="mm-ctl-l" for="mm-${id}">${esc(label)}</label>
      <input class="mm-num" id="mm-${id}-n" type="number" data-mm-set="${esc(id)}"
        value="${value}" min="${min}" max="${max}" step="${step}"
        aria-label="${esc(label)}">
    </div>
    ${limit ? `<p class="mm-ctl-c">${esc(limit.before)}
      <span class="mm-pill">${esc(limit.value)}</span>${
  limit.after ? ` ${esc(limit.after)}` : ""}</p>` : ""}
    <input class="mm-range" id="mm-${id}" type="range" data-mm-set="${esc(id)}"
      value="${value}" min="${min}" max="${max}" step="${step}"
      aria-label="${esc(label)}">
    ${note ? `<p class="mm-ctl-n">${esc(note)}</p>` : ""}
  </div>`;
}

/**
 * The Load tab: what to ask the engine for.
 *
 * Both sliders are clamped to something real — the context to the ceiling in
 * the file's header, the offload to its layer count — so a person cannot ask
 * for a context the model does not have and watch the engine refuse two
 * minutes later.
 */
export function loadTab(s) {
  const m = s.rows.find((x) => x.name === s.selected);
  const meta = s.meta?.[s.selected];
  if (!m || !meta?.ok) {
    return `<div class="mm-pane"><p class="mm-note">Load settings need the file's header,
      which could not be read.</p></div>`;
  }

  const sum = meta.summary ?? {};
  const maxCtx = sum.contextLength || 8192;
  const layers = sum.blockCount || 0;
  const set = s.settings?.[s.selected] ?? {};
  const context = Math.min(set.context ?? Math.min(8192, maxCtx), maxCtx);
  const gpuLayers = Math.min(set.gpuLayers ?? layers, layers);

  const est = estimate({ bytes: m.bytes, layers: sum.blockCount }, { context, gpuLayers });
  const recommended = s.recommended?.[s.selected];

  return `<div class="mm-pane">
    <p class="mm-sec-h">${MM_ICON.sliders}Context and Offload</p>

    ${slider({
    id: "context", label: "Context Length", value: context,
    min: 512, max: maxCtx, step: 512,
    limit: { before: "Model supports up to", value: maxCtx.toLocaleString("en-US"),
      after: "tokens" },
  })}

    ${layers ? slider({
    id: "gpuLayers", label: "GPU Offload", value: gpuLayers,
    min: 0, max: layers,
    limit: { before: "This model has", value: String(layers), after: "layers" },
    /* Only when something actually measured the machine. A recommendation
       with nothing behind it is the kind of number this page exists not to
       print. */
    note: recommended != null
      ? `${recommended} recommended for this computer.`
      : "Nothing has measured this computer, so there is no recommendation.",
  }) : `<p class="mm-note">The file's header does not state a layer count, so GPU offload
      cannot be set here. llama.cpp will choose.</p>`}

    <div class="mm-est">
      <p class="mm-est-h">Estimated memory</p>
      ${estRow("On the GPU", est.vram)}
      ${estRow("In system RAM", est.ram)}
      <p class="mm-note">A projection from the file size, its layer count and the context
        above — not a measurement. The engine's real use is reported once it is loaded.</p>
    </div>

    <details class="mm-acc">
      <summary class="mm-acc-h">${MM_ICON.chevron}<span>Advanced</span></summary>
      <div class="mm-acc-b">
        ${ADVANCED.filter((a) => a.supported).map((a) => advancedControl(a, set)).join("")}
        ${ADVANCED.some((a) => !a.supported) ? `<p class="mm-note">
          Not shown: ${esc(ADVANCED.filter((a) => !a.supported).map((a) => a.label.toLowerCase()).join(", "))}.
          ForgeLocal does not pass these to the engine, so a control here would change nothing.</p>` : ""}
      </div>
    </details>
  </div>`;
}

function advancedControl(a, set) {
  const v = set[a.id];
  if (a.kind === "switch") {
    const on = v === undefined ? a.id === "flashAttention" : !!v;
    return `<div class="mm-row2">
      <div><span class="mm-ctl-l">${esc(a.label)}</span>
        <p class="mm-note">${esc(a.help)}</p></div>
      <button class="mm-switch" type="button" role="switch" data-mm-set="${esc(a.id)}"
        aria-checked="${on}" aria-label="${esc(a.label)}"><span></span></button>
    </div>`;
  }
  return `<div class="mm-row2">
    <div><span class="mm-ctl-l">${esc(a.label)}</span>
      <p class="mm-note">${esc(a.help)}</p></div>
    <input class="mm-num" type="number" data-mm-set="${esc(a.id)}"
      value="${v ?? a.min}" min="${a.min}" max="${a.max}" aria-label="${esc(a.label)}">
  </div>`;
}

/* --------------------------------------------------------------- inference */

/**
 * The sampling fields ForgeLocal's provider actually sends.
 *
 * The OpenAI-compatible body carries temperature, top_p, presence_penalty and
 * max_tokens; llama.cpp additionally accepts top_k, min_p and repeat_penalty
 * through the same endpoint. Each entry says which, so the accordion can show
 * the ones that work and say what it is leaving out.
 */
export const SAMPLING = Object.freeze([
  { id: "temperature", label: "Temperature", min: 0, max: 2, step: 0.05, def: 0.7,
    help: "Higher is more varied. At 0 the model always picks its most likely token." },
  { id: "topP", label: "Top P", min: 0, max: 1, step: 0.01, def: 0.95,
    help: "Consider only the tokens making up this share of the probability." },
  { id: "topK", label: "Top K", min: 0, max: 200, step: 1, def: 40,
    help: "Consider only this many of the most likely tokens. 0 turns it off." },
  { id: "minP", label: "Min P", min: 0, max: 1, step: 0.01, def: 0.05,
    help: "Drop tokens less likely than this share of the most likely one." },
  { id: "repeatPenalty", label: "Repeat Penalty", min: 1, max: 2, step: 0.01, def: 1.1,
    help: "Push down tokens that have already appeared." },
  { id: "presencePenalty", label: "Presence Penalty", min: -2, max: 2, step: 0.05, def: 0,
    help: "Push down tokens that have appeared at all, regardless of how often." },
]);

/** One accordion. Native details/summary, so the keyboard works without help. */
function acc(id, label, icon, body, open = false) {
  return `<details class="mm-acc" data-mm-acc="${esc(id)}"${open ? " open" : ""}>
    <summary class="mm-acc-h">${icon}<span>${esc(label)}</span>${MM_ICON.chevron}</summary>
    <div class="mm-acc-b">${body}</div>
  </details>`;
}

/** The Inference tab: eight sections, each honest about what it can do. */
export function inferenceTab(s) {
  const meta = s.meta?.[s.selected];
  const sum = meta?.summary ?? {};
  const set = s.settings?.[s.selected] ?? {};
  const v = (id) => {
    const found = SAMPLING.find((x) => x.id === id);
    return set[id] ?? found?.def ?? 0;
  };

  const systemPrompt = set.systemPrompt ?? "";
  /* Characters over four is the usual rough token ratio for English. Said as
     an estimate, because counting properly needs the model's tokenizer. */
  const approxTokens = Math.ceil(systemPrompt.length / 4);

  return `<div class="mm-pane mm-accs">
    ${acc("system", "System Prompt", MM_ICON.file, `
      <textarea class="mm-ta" data-mm-set="systemPrompt" rows="6"
        placeholder="Instructions the model sees before every message in this chat."
        aria-label="System prompt">${esc(systemPrompt)}</textarea>
      <p class="mm-note">${systemPrompt
    ? `About ${approxTokens} tokens, estimated at four characters each — the exact count needs the model's tokenizer.`
    : "Saved against this model, and used by every new chat that loads it."}</p>
    `)}

    ${acc("reasoning", "Reasoning", MM_ICON.activity, `
      <p class="mm-note">Nothing published about this file says whether it reasons,
        and its header carries no reasoning-effort field. ForgeLocal will not offer a
        control that the engine would ignore.</p>
    `)}

    ${acc("settings", "Settings", MM_ICON.settings2, `
      ${slider({ id: "maxTokens", label: "Maximum output tokens",
    value: set.maxTokens ?? 2048, min: 128, max: Math.max(4096, sum.contextLength ?? 4096), step: 128,
    note: "Where a reply is cut off if the model does not stop first." })}
      <div class="mm-row2">
        <div><span class="mm-ctl-l">Stop strings</span>
          <p class="mm-note">Generation stops when one of these appears. One per line.</p></div>
      </div>
      <textarea class="mm-ta" data-mm-set="stop" rows="3"
        placeholder="&lt;|im_end|&gt;" aria-label="Stop strings">${esc(set.stop ?? "")}</textarea>
      <p class="mm-note">CPU threads and batch size live in the Load tab, because they are
        fixed when the engine starts rather than per request.</p>
    `)}

    ${acc("parsing", "Reasoning Parsing", MM_ICON.activity, `
      <div class="mm-row2">
        <div><span class="mm-ctl-l">Separate a thinking block</span>
          <p class="mm-note">Hide text the model wraps in reasoning tags rather than showing it
            as the answer. Off unless you know this model emits them.</p></div>
        <button class="mm-switch" type="button" role="switch" data-mm-set="parseReasoning"
          aria-checked="${!!set.parseReasoning}" aria-label="Separate a thinking block"><span></span></button>
      </div>
      <p class="mm-note">Parsing only hides text that is already there. It does not make a
        model reason, and turning it on for one that does not will hide nothing.</p>
    `)}

    ${acc("sampling", "Sampling", MM_ICON.sliders, `
      ${SAMPLING.map((x) => slider({
    id: x.id, label: x.label, value: v(x.id),
    min: x.min, max: x.max, step: x.step, note: x.help,
  })).join("")}
      <button class="mm-btn" type="button" data-mm-reset-sampling>Reset to recommended</button>
    `)}

    ${acc("structured", "Structured Output", MM_ICON.file, `
      <div class="mm-row2">
        <div><span class="mm-ctl-l">Structured Output</span>
          <p class="mm-note">Require replies to match a JSON schema.</p></div>
        <button class="mm-switch" type="button" role="switch" data-mm-set="structured"
          aria-checked="${!!set.structured}" aria-label="Structured Output"><span></span></button>
      </div>
      ${set.structured ? `
        <textarea class="mm-ta mm-mono" data-mm-set="schema" rows="8"
          placeholder='{ "type": "object", "properties": { } }'
          aria-label="JSON schema">${esc(set.schema ?? "")}</textarea>
        ${s.schemaError ? `<p class="mm-err-t">${esc(s.schemaError)}</p>`
    : set.schema ? `<p class="mm-ok-t">Valid JSON.</p>` : ""}` : ""}
    `)}

    ${acc("speculative", "Speculative Decoding", MM_ICON.box, `
      <p class="mm-note">Unavailable. It needs a smaller draft model of the same family, and
        ForgeLocal does not identify draft models or run two engines at once.</p>
    `)}

    ${acc("template", "Prompt Template", MM_ICON.file, `
      ${sum.hasChatTemplate
    ? `<p class="mm-note">This file carries its own chat template, and llama.cpp uses it.
         ForgeLocal does not override it: a hand-edited template is the most reliable way to
         make a working model produce nothing but nonsense.</p>
       <div class="mm-kv"><span class="mm-kv-k">Template</span>
         <span class="mm-kv-v">from the file</span></div>`
    : `<p class="mm-note">This file carries no chat template, so llama.cpp falls back to a
         generic one. Replies may be poorly formatted; that is a property of the file.</p>`}
    `)}
  </div>`;
}
