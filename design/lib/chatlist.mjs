// Renders the sidebar chat selector from the fixtures. Every chat is emitted
// once, in its date bucket; the controller moves rows between the Pinned group
// and their date group at runtime, so pinning survives without a rebuild.
import { projects, chats, GROUPS, groupFor } from "../data/chats.mjs";
import { threads } from "../data/threads.mjs";
import { models } from "../data/models.mjs";
import * as F from "./fit.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const dot = {
  running: '<span class="dot acc pulse" aria-hidden="true"></span>',
  done: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  failed: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--bad)" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  idle: '<span class="dot" aria-hidden="true"></span>',
};

const stateWord = { running: "running", done: "finished", failed: "stopped", idle: "idle" };

/**
 * The download state a fixture model starts in. An installed model reached the
 * disk by finishing a download, so it seeds as completed rather than as no
 * history at all; that is also what the store itself produces on
 * download.completed, so the seeded and the earned record have one shape.
 */
function downloadSeed(m) {
  const bytes = m.installedBytes || m.downloadBytes;
  if (m.downloading) {
    return { modelId: m.id, state: "downloading", receivedBytes: Math.round(m.downloadBytes * 0.44),
      totalBytes: m.downloadBytes, bytesPerSecond: 28.6e6, etaSeconds: 180 };
  }
  if (m.downloadFailed) {
    return { modelId: m.id, state: "failed", receivedBytes: m.downloadFailed.receivedBytes,
      totalBytes: m.downloadBytes, failure: m.downloadFailed.reason };
  }
  if (m.installed) {
    return { modelId: m.id, state: "completed", receivedBytes: bytes, totalBytes: bytes };
  }
  return undefined;
}

/**
 * The seed for the shared model store, in ModelRecord shape.
 *
 * The build renders the first paint of every model surface from
 * createState(modelSeed()), and the browser hydrates the same array out of the
 * page. One function, so the server-rendered list and the store cannot disagree
 * before the first event is even dispatched.
 */
export function modelSeed() {
  return models.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    publisher: m.publisher,
    family: m.family || m.architecture || "",
    architecture: m.architecture || m.family || "",
    parameterCount: (m.parameterCount / 1e9).toFixed(m.parameterCount >= 1e10 ? 0 : 1).replace(/\.0$/, "") + "B",
    format: "GGUF",
    quantization: m.quantization,
    fileSizeBytes: m.installedBytes || m.downloadBytes,
    maxContextTokens: Math.max(...m.contextOptions),
    capabilities: ["chat"]
      .concat(m.tasks.includes("tool-use") ? ["tool_use"] : [])
      .concat(m.tasks.includes("coding") && m.parameterCount >= 7e9 ? ["agent_ready"] : [])
      .concat(m.tasks.includes("coding") ? ["fim"] : []),
    license: m.licenseId,
    sourceUrl: m.sourceUrl,
    installed: !!m.installed,
    loadedInstances: m.loaded
      ? [{ instanceId: "seed-" + m.id, contextTokens: F.fitFor(m).context }]
      : [],
    downloadState: downloadSeed(m),
    hardwareFit: ({ great: "excellent", tradeoffs: "good", offload: "tight", none: "unsupported" })[F.fitFor(m).state] || "unknown",
    bestFor: (m.strength || "").split(". ")[0],
  }));
}

function row(c) {
  return `<div class="chat" data-chat="${esc(c.id)}" data-project="${esc(c.project)}"
        data-bucket="${esc(groupFor(c))}"${c.pinned ? " data-pinned" : ""}${c.route ? ` data-route="${esc(c.route)}"` : ""}>
        <button class="chat-open" type="button" title="${esc(c.title)}"
          aria-label="${esc(c.title)}, ${stateWord[c.state] || "idle"}">
          <span class="ic" aria-hidden="true">${dot[c.state] || dot.idle}</span>
          <span class="t" data-chat-title>${esc(c.title)}</span>
        </button>
        <button class="chat-more" type="button" aria-haspopup="menu" aria-expanded="false"
          aria-label="Actions for ${esc(c.title)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r=".9"/><circle cx="12" cy="12" r=".9"/><circle cx="19" cy="12" r=".9"/></svg>
        </button>
      </div>`;
}

export function chatList() {
  const groups = GROUPS.map(([id, label]) => {
    const rows = chats.filter((c) => groupFor(c) === id).map(row).join("\n      ");
    // An empty group is not a heading with nothing under it: it is absent.
    return `<section class="cgroup" data-group="${id}"${rows ? "" : " hidden"}>
      <h2 class="cgroup-hd">
        <button type="button" data-group-toggle aria-expanded="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9.5 6 6 6-6"/></svg>
          ${esc(label)}
        </button>
      </h2>
      <div class="cgroup-body">
      ${rows}
      </div>
    </section>`;
  }).join("\n    ");

  return `${groups}
    <p class="chat-empty" data-chat-empty hidden>No chat matches that search.</p>
    <div class="chat-archived" data-archived-wrap hidden>
      <button class="chat-archived-toggle" type="button" data-archived-toggle aria-expanded="false">
        <span data-archived-label>Archived</span>
      </button>
    </div>`;
}

// The state the workspace needs, emitted once per app page. No fetch, no new
// dependency: the controller reads it out of the DOM at boot.
export function sessionData() {
  const payload = {
    projects,
    chats: chats.map((c) => ({
      id: c.id, title: c.title, project: c.project, state: c.state,
      route: c.route || null, hasThread: !!threads[c.id],
    })),
    threads,
    // The seed for the shared model store. This is the ONLY place model data
    // enters the client; every surface then reads the store, never this.
    modelSeed: modelSeed(),
    models: models.map((m) => {
      const fit = F.fitFor(m);
      return { id: m.id, name: m.displayName, publisher: m.publisher, quant: m.quantization,
        format: m.format, license: m.licenseId, source: m.sourceUrl, revision: m.sourceRevision,
        strength: m.strength, limitation: m.limitation, runtime: m.runtime,
        installed: m.installed,
      agentReady: m.tasks.includes("coding") && m.parameterCount >= 7e9, loaded: m.loaded,
        downloadGB: F.gb(m.downloadBytes, 2), diskGB: F.gb(m.installedBytes, 2),
        fitLabel: fit.label, fitTone: fit.tone, fitReason: fit.reason,
        needGB: F.gb(fit.required, 1), vramGB: F.gb(F.thisPC.vramBytes, 0),
        context: F.fmtCtx(fit.context),
        contexts: m.contextOptions.map((c) => {
          const f = F.fitAtContext(m, F.thisPC, c);
          return { ctx: F.fmtCtx(c), need: F.gb(F.requiredBytes(m, c), 1),
            label: f.label, tone: f.tone };
        }),
        offload: String(m.gpuOffloadLayers),
        store: "C:\Users\you\ForgeLocal\models",
      };
    }),
  };
  // a literal < is escaped so no payload value can close the element early
  const json = JSON.stringify(payload).split(String.fromCharCode(60)).join("\\u003c");
  return `<script type="application/json" id="fl-sessions">${json}</script>`;
}

export function projectOptions() {
  return projects.map((p, i) =>
    `<button role="menuitemradio" class="srow" type="button" data-project-pick="${esc(p.id)}"
          aria-checked="${i === 0 ? "true" : "false"}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><path d="M3 7.5A2 2 0 0 1 5 5.5h3.6l1.8 2H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
          <span class="t">${esc(p.name)}</span>
        </button>`).join("\n        ");
}

export function moveOptions() {
  return projects.map((p) =>
    `<button role="menuitemradio" type="button" data-move-to="${esc(p.id)}" aria-checked="false">
          <span class="check" aria-hidden="true"></span>${esc(p.name)}
        </button>`).join("\n        ");
}
