// @ts-check
/**
 * Render the model browser to a standalone page, from real metadata.
 *
 * The visual checks need a page to measure, and the page has to be the real
 * component fed real data -- a hand-written fixture would let the layout pass
 * against text lengths and artwork sizes that never occur. So this fetches the
 * curated list from Hugging Face and renders the actual view module.
 *
 * It therefore needs the network, which is why it is a script rather than part
 * of the suite: design/qa/visual.mjs skips when the page it produces is not
 * there, so a machine that is offline runs everything else.
 *
 *   node design/qa/model-preview.mjs public/_mbpreview.html
 *
 * The hardware below is this machine, stated rather than probed, because the
 * point is a stable page to measure: a compatibility badge that changes with
 * whoever runs it would make the screenshots incomparable.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { describeModel, compatibilityFor, installStateFor }
  from "../../runtime/core/models/browser.mjs";
import { modelBrowser, initialBrowserState, ListState, DetailState, InstallState }
  from "../core/modelbrowser.mjs";
import { STAFF_PICK_IDS, STAFF_PICKS, pickReason }
  from "../core/staffpicks.mjs";

const HW = {
  gpus: [{ vendor: "nvidia", name: "NVIDIA GeForce RTX 5070", vram_bytes: 12227 * 1024 * 1024 }],
  ram_bytes: 34 * 1024 ** 3, cpu_cores: 16,
};

const rows = [];
let detail = null;
for (const [i, repoId] of STAFF_PICK_IDS.entries()) {
  const r = await describeModel(repoId, { artwork: true });
  if (!r.ok) { console.error(`  skip ${repoId}: ${r.reason}`); continue; }
  const m = r.model;
  rows.push({
    repoId: m.repoId, displayName: m.displayName, author: m.author, artwork: m.artwork,
    verified: m.verified, description: m.description, updatedAt: m.updatedAt,
    downloads: m.downloads, likes: m.likes, capabilities: m.capabilities, curated: true,
  });
  if (i === 0) {
    const variants = installStateFor(m.variants, [], null)
      .map((v) => ({ ...v, compat: compatibilityFor(v, HW) }));
    detail = { ...m, variants };
  }
  console.error(`  ${repoId} -> ${m.parameters.label ?? "?"} ${m.variants.length} variants`);
}

const state = initialBrowserState({
  desktop: true,
  listState: ListState.READY,
  collection: "Staff picks",
  models: rows,
  selectedId: detail?.repoId ?? null,
  detail: { state: detail ? DetailState.READY : DetailState.IDLE, model: detail, reason: null },
  variantIndex: Math.max(0, (detail?.variants ?? []).findIndex((v) => v.quantization === "Q4_K_M")),
  compat: null,
  pickReasons: Object.fromEntries(STAFF_PICKS.map((x) => [x.repoId, pickReason(x.repoId)])),
});
state.compat = detail?.variants?.[state.variantIndex]?.compat ?? null;

const css = readFileSync(new URL("../../public/assets/forgelocal.css", import.meta.url), "utf8");
writeFileSync(process.argv[2], `<!doctype html><html><head><meta charset="utf-8">
<title>Model browser</title><style>${css}</style>
<style>html,body{margin:0;height:100%;background:#101012;font-family:ui-sans-serif,system-ui,sans-serif}</style>
</head><body>${modelBrowser(state)}</body></html>`);
console.error(`\nwrote ${process.argv[2]} — ${rows.length} rows, detail=${detail?.repoId}`);
