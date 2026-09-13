// @ts-check
/**
 * What the model browser shows, assembled from sources that actually know.
 *
 * One view model, built here rather than in the renderer, because every field
 * below comes from somewhere: Hugging Face's model API, the repository tree,
 * the README, the models folder on disk, the hardware probe. The renderer gets
 * a finished object and draws it.
 *
 * **The rule this file exists to enforce is that unknown is a value.** A model
 * browser is mostly numbers about somebody else's work — downloads, likes,
 * parameter counts, whether it can use tools — and every one of them is a
 * thing a person might act on. So each field is either measured, or null with
 * a reason, and there is no path that turns "we did not find out" into a
 * confident-looking figure. `capabilities` is the sharpest case: a badge
 * saying a model does tool calling is a promise about an agent loop, so it is
 * set only from evidence in the model's own chat template, never from a
 * hopeful reading of its tags.
 */

import { checkUrl, listRepoFiles } from "./download.mjs";
import { fitFor, suggestLoad } from "./fit.mjs";

/** How long any one metadata request may take. */
const TIMEOUT_MS = 15_000;

/**
 * @typedef {object} Capability
 * @property {boolean|null} present  true, false, or null when nothing said
 * @property {string} evidence       what decided it, in words
 */

/**
 * @typedef {object} BrowserModel
 * @property {string} repoId
 * @property {string} displayName
 * @property {string} author
 * @property {{dataUri: string|null, monogram: string}} artwork
 * @property {boolean|null} verified
 * @property {string|null} description
 * @property {number|null} downloads
 * @property {number|null} likes
 * @property {string|null} updatedAt
 * @property {{label: string|null, bytes: number|null}} parameters
 * @property {string|null} architecture
 * @property {string|null} domain
 * @property {string[]} formats
 * @property {{vision: Capability, toolUse: Capability, reasoning: Capability}} capabilities
 * @property {GgufVariant[]} variants
 * @property {string|null} readme
 * @property {string[]} notes  what could not be determined, for the interface
 */

/**
 * @typedef {object} GgufVariant
 * @property {string} name
 * @property {string} quantization
 * @property {number} bytes
 * @property {string|null} sha256
 * @property {string} url
 * @property {string} format
 * @property {{count: number, files: GgufVariant[]}|null} [parts]
 *   set when this is a split GGUF; null or absent for a single file
 */

/** A timeout that does not leak the controller. @param {number} ms */
function deadline(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

/**
 * Strip YAML front matter from a README.
 *
 * Not for tidiness: the front matter is a machine block that renders as a wall
 * of keys, and a person opening a README wants the prose.
 *
 * @param {string} md
 */
export function stripFrontMatter(md) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return m ? md.slice(m[0].length).replace(/^\s+/, "") : md;
}

/**
 * The first real sentence of a README, for the one-line description.
 *
 * Skips headings, badges and images, which is what the top of a model card is
 * mostly made of. Returns null rather than a heading when there is no prose —
 * "# Qwen2.5-Coder-7B-Instruct-GGUF" as a description tells nobody anything.
 *
 * @param {string|null} md @param {number} [limit]
 */
export function leadParagraph(md, limit = 240) {
  if (!md) return null;
  const body = stripFrontMatter(md);
  for (const block of body.split(/\r?\n\s*\r?\n/)) {
    const line = block.trim();
    if (!line) continue;
    if (line.startsWith("#") || line.startsWith("<") || line.startsWith("|")) continue;
    if (line.startsWith("```")) continue;
    /* A line that is only links and images is a badge row.
     *
     * Images go before links, and both go repeatedly, because the badge idiom
     * is a linked image — `[![build](shield.svg)](ci-url)` — and one pass with
     * a single pattern eats the inner image and leaves `](ci-url)` behind,
     * which then reads as prose. */
    let prose = line;
    for (let pass = 0; pass < 3; pass++) {
      const before = prose;
      prose = prose.replace(/!\[[^\]]*\]\([^)]*\)/g, "")     // images
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");            // links, keeping their text
      if (prose === before) break;
    }
    prose = prose.replace(/\s+/g, " ").trim();
    if (prose.length < 24) continue;
    return prose.length > limit ? `${prose.slice(0, limit - 1).trimEnd()}…` : prose;
  }
  return null;
}

/**
 * A parameter count from the GGUF metadata Hugging Face already parsed.
 *
 * `gguf.total` is the tensor parameter count, read from the file itself, so it
 * is a measurement rather than a reading of the repository name. A name can
 * say 7B for a 6.7B model, or say nothing at all.
 *
 * @param {number|null|undefined} total
 */
export function parameterLabel(total) {
  if (typeof total !== "number" || !(total > 0)) return null;
  if (total >= 1e12) return `${(total / 1e12).toFixed(total < 1e13 ? 1 : 0)}T`;
  if (total >= 1e9) return `${(total / 1e9).toFixed(total < 1e10 ? 1 : 0)}B`;
  if (total >= 1e6) return `${(total / 1e6).toFixed(0)}M`;
  return String(total);
}

/** The quantisation in a GGUF file name, which is the one thing it reliably carries. */
const QUANT = /[.-](Q\d[_A-Za-z0-9]*|IQ\d[_A-Za-z0-9]*|FP16|FP32|F16|F32|BF16|MXFP\d+)(?=[.-]|$)/i;

/** A split-GGUF suffix: `-00002-of-00003`, which llama.cpp writes and reads. */
const SHARD = /-(\d{5})-of-(\d{5})$/;

/** @param {string} name */
export function quantOf(name) {
  const base = name.replace(/\.gguf$/i, "").replace(SHARD, "");
  const m = QUANT.exec(base);
  return m ? m[1].toUpperCase() : "unknown";
}

/**
 * Split a GGUF file name into the model it belongs to and which part it is.
 *
 * Large models are published in shards — `…-q8_0-00002-of-00003.gguf` — and a
 * shard is not a model. Listing them as separate downloads offers somebody a
 * 0.18 GB "Q8_0" that is the tail of a 8 GB file and will not load. That is
 * how a picker built from a file listing goes wrong.
 *
 * @param {string} name
 * @returns {{base: string, part: number|null, of: number|null}}
 */
export function shardOf(name) {
  const stem = name.replace(/\.gguf$/i, "");
  const m = SHARD.exec(stem);
  if (!m) return { base: stem, part: null, of: null };
  return { base: stem.replace(SHARD, ""), part: Number(m[1]), of: Number(m[2]) };
}

/**
 * Collapse a file listing into the things a person can actually download.
 *
 * One entry per model: a single file stays one, and a shard set becomes one
 * variant carrying every part. The size is the sum, because that is what the
 * download costs and what has to fit on the disk. `parts` is kept so the
 * interface can say "3 files" rather than implying a single 8 GB fetch.
 *
 * @param {GgufVariant[]} files
 * @returns {GgufVariant[]}
 */
export function groupVariants(files) {
  /* Standalone files and shard sets are collected separately before either is
     turned into a variant, because a repository can publish the same model
     both ways. Qwen2.5-Coder-7B-Instruct-GGUF does: there is a 4.68 GB
     q4_k_m.gguf *and* a q4_k_m-00001-of-00002 pair that is the same weights
     split in two. Merging them by base name double-counts, and reports a
     4.68 GB download as 9.37 GB. */
  /** @type {Map<string, GgufVariant>} */
  const whole = new Map();
  /** @type {Map<string, GgufVariant[]>} */
  const shards = new Map();

  for (const f of files) {
    const { base, part } = shardOf(f.name);
    if (part === null) { whole.set(base, f); continue; }
    const list = shards.get(base) ?? [];
    list.push(f);
    shards.set(base, list);
  }

  /** @type {GgufVariant[]} */
  const out = [];
  for (const [base, f] of whole) {
    /* A standalone file wins over the split of the same weights: it is one
       download, it needs no reassembly, and it is what the size says. */
    out.push({ ...f, parts: null });
    shards.delete(base);
  }
  for (const [base, list] of shards) {
    list.sort((a, b) => (shardOf(a.name).part ?? 0) - (shardOf(b.name).part ?? 0));
    const first = list[0];
    out.push({
      ...first,
      name: `${base}.gguf`,
      /* The sum, because that is what the download costs and what has to fit
         on the disk. The first shard's URL and checksum identify the set —
         llama.cpp is pointed at that one and finds the rest. */
      bytes: list.reduce((n, x) => n + x.bytes, 0),
      parts: { count: shardOf(first.name).of ?? list.length, files: list },
    });
  }
  return out.sort((a, b) => a.bytes - b.bytes);
}

/**
 * What a model can do, from evidence rather than from vibes.
 *
 * Tool use is the one that can be settled: llama.cpp drives tools through the
 * chat template, so a template that handles a `tools` variable is a model
 * whose own authors wired tool calling, and one that does not is a model where
 * an agent loop will not work however the tags read. That is a fact about the
 * file, and it is the fact that matters.
 *
 * Vision comes from the pipeline tag, which Hugging Face sets from the model
 * config rather than from prose.
 *
 * Reasoning has no such signal. There is no field, no template marker, and the
 * tag is self-applied by whoever uploaded the repository — so it is reported as
 * unknown unless the uploader claimed it, and the claim is attributed.
 *
 * @param {any} info  the Hugging Face model record
 * @returns {{vision: Capability, toolUse: Capability, reasoning: Capability}}
 */
export function capabilitiesFrom(info) {
  const tags = Array.isArray(info?.tags) ? info.tags.map((t) => String(t).toLowerCase()) : [];
  const template = String(info?.gguf?.chat_template ?? "");
  const pipeline = String(info?.pipeline_tag ?? "").toLowerCase();

  /** @type {Capability} */
  let toolUse;
  if (template) {
    const handles = /\btools\b/.test(template) && /tool_call|tool_calls/.test(template);
    toolUse = handles
      ? { present: true, evidence: "Its chat template handles tool calls." }
      : { present: false, evidence: "Its chat template has no tool-call section." };
  } else {
    toolUse = { present: null, evidence: "No chat template was published, so this is unknown." };
  }

  /** @type {Capability} */
  const vision = pipeline === "image-text-to-text" || pipeline === "visual-question-answering"
    ? { present: true, evidence: `Published as ${pipeline}.` }
    : pipeline
      ? { present: false, evidence: `Published as ${pipeline}, which takes text only.` }
      : { present: null, evidence: "No pipeline was published, so this is unknown." };

  /* Self-applied, and said so. A tag is the uploader's claim about their own
     upload; it is worth showing and it is not worth presenting as a finding. */
  const claimsReasoning = tags.some((t) => t === "reasoning" || t === "chain-of-thought");
  /** @type {Capability} */
  const reasoning = claimsReasoning
    ? { present: true, evidence: "The uploader tagged it for reasoning. Not independently checked." }
    : { present: null, evidence: "Nothing published says either way." };

  return { vision, toolUse, reasoning };
}

/**
 * A fallback monogram, for a repository with no artwork.
 *
 * Two letters from the author, because the author is the part a person
 * recognises and the model name is usually a version string.
 *
 * @param {string} author
 */
export function monogramFor(author) {
  const clean = String(author ?? "").replace(/[^A-Za-z0-9]+/g, " ").trim();
  if (!clean) return "?";
  const words = clean.split(/\s+/);
  return (words.length > 1
    ? words[0][0] + words[1][0]
    : clean.slice(0, 2)).toUpperCase();
}

/**
 * The author's avatar, as a data URI.
 *
 * Inlined rather than linked, for two reasons that point the same way. The
 * desktop window's content-security policy allows `img-src 'self' data:` and
 * nothing else, so a remote URL simply does not render. And fetching it here
 * means the renderer never makes a request of its own to a third party — the
 * page cannot be made to phone home by the contents of a repository listing.
 *
 * A failure is not an error. There is a monogram for exactly this.
 *
 * @param {string} url @param {{fetch?: typeof fetch}} [opts]
 */
export async function inlineAvatar(url, opts = {}) {
  const f = opts.fetch ?? fetch;
  const allowed = checkUrl(url);
  if (!allowed.ok) return null;
  const t = deadline(TIMEOUT_MS);
  try {
    const res = await f(url, { signal: t.signal });
    if (!res.ok) return null;
    const type = String(res.headers.get("content-type") ?? "");
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    /* A cap, because this goes into a frame and then into the DOM. An avatar
       larger than this is not an avatar. */
    if (buf.length > 512 * 1024) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  } finally {
    t.done();
  }
}

/**
 * Everything the browser needs about one repository.
 *
 * Assembled from three requests that are allowed to fail independently: the
 * model record, the file tree, and the README. A repository with no README is
 * still a model you can download, and losing the whole panel because the prose
 * did not load would be the wrong trade.
 *
 * @param {string} repoId
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @param {AbortSignal} [opts.signal]
 * @param {boolean} [opts.artwork]  fetch the author avatar; off by default
 * @returns {Promise<{ok: true, model: BrowserModel}|{ok: false, reason: string}>}
 */
export async function describeModel(repoId, opts = {}) {
  const f = opts.fetch ?? fetch;
  const clean = String(repoId).replace(/^\/+|\/+$/g, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(clean)) {
    return { ok: false, reason: "A repository looks like owner/name." };
  }

  const t = deadline(TIMEOUT_MS);
  /** @type {any} */
  let info = null;
  try {
    const res = await f(`https://huggingface.co/api/models/${clean}`, {
      signal: opts.signal ?? t.signal, headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: res.status === 404
          ? `No repository called ${clean}.`
          : `Hugging Face answered ${res.status} for ${clean}.`,
      };
    }
    info = await res.json();
  } catch (/** @type {any} */ e) {
    return { ok: false, reason: `Could not reach Hugging Face: ${e?.message ?? e}` };
  } finally {
    t.done();
  }

  /** @type {string[]} */
  const notes = [];

  /* The files. A repository that answers but lists nothing downloadable is a
     real state, and the panel says so rather than showing an empty picker. */
  let variants = /** @type {GgufVariant[]} */ ([]);
  const tree = await listRepoFiles(clean, { fetch: f, signal: opts.signal });
  if (!tree.ok) {
    notes.push(`The file list could not be read: ${tree.reason}`);
  } else {
    variants = (tree.files ?? []).map((file) => {
      const name = String(file.name ?? "");
      return {
        name,
        quantization: quantOf(name),
        bytes: Number(file.bytes) || 0,
        sha256: file.sha256 ?? null,
        url: String(file.url ?? ""),
        format: "GGUF",
      };
    });
    /* Shards collapsed into the model they belong to, so the picker offers
       downloads rather than fragments. */
    variants = groupVariants(variants);
    if (!variants.length) notes.push("This repository publishes no GGUF files.");
  }

  /* The README. Optional by design. */
  /** @type {string|null} */
  let readme = null;
  try {
    const res = await f(`https://huggingface.co/${clean}/raw/main/README.md`, { signal: opts.signal });
    if (res.ok) readme = await res.text();
    else notes.push("This repository has no README.");
  } catch {
    notes.push("The README could not be fetched.");
  }

  const author = String(info.author ?? clean.split("/")[0]);
  /** @type {string|null} */
  let dataUri = null;
  if (opts.artwork) {
    const avatar = typeof info.avatarUrl === "string" ? info.avatarUrl : null;
    if (avatar) dataUri = await inlineAvatar(new URL(avatar, "https://huggingface.co").toString(), { fetch: f });
  }

  const params = parameterLabel(info?.gguf?.total);
  if (!params) notes.push("The parameter count is not published in a form we can read.");
  const architecture = info?.gguf?.architecture ? String(info.gguf.architecture) : null;
  if (!architecture) notes.push("The architecture is not published.");

  /* Domain, from the tags the uploader set. Presented as their description of
     their own upload, which is what it is. */
  const tags = Array.isArray(info.tags) ? info.tags.map((x) => String(x)) : [];
  const domainTag = tags.find((x) => ["code", "math", "chat", "vision", "embeddings"].includes(x.toLowerCase()));
  const domain = domainTag ?? (info.pipeline_tag ? String(info.pipeline_tag) : null);

  return {
    ok: true,
    model: {
      repoId: clean,
      displayName: clean.split("/")[1] ?? clean,
      author,
      artwork: { dataUri, monogram: monogramFor(author) },
      /* Hugging Face's model endpoint does not report whether an organisation
         is verified, and guessing from a well-known name would be exactly the
         wrong kind of badge. Unknown until there is a source. */
      verified: null,
      description: leadParagraph(readme),
      downloads: typeof info.downloads === "number" ? info.downloads : null,
      likes: typeof info.likes === "number" ? info.likes : null,
      updatedAt: info.lastModified ? String(info.lastModified) : null,
      parameters: { label: params, bytes: typeof info?.gguf?.total === "number" ? info.gguf.total : null },
      architecture,
      domain,
      formats: variants.length ? ["GGUF"] : [],
      capabilities: capabilitiesFrom(info),
      variants,
      readme,
      notes,
    },
  };
}

/**
 * How one variant would run on this machine.
 *
 * Delegates to the same fit the rest of the app uses, so the browser cannot
 * disagree with the model list about whether something will run. With no
 * hardware it returns the unknown verdict rather than an optimistic one.
 *
 * @param {GgufVariant} variant @param {any} hardware
 */
export function compatibilityFor(variant, hardware) {
  if (!variant) return null;
  const fit = fitFor({ fileBytes: variant.bytes, hardware: hardware ?? null });
  return {
    ...fit,
    suggested: hardware ? suggestLoad({ fileBytes: variant.bytes, hardware }) : null,
  };
}

/**
 * Fold in what this machine already has.
 *
 * The three states a row can be in are different actions, and they are decided
 * by different sources: on disk (the models folder), currently serving (the
 * provider), or neither. Nothing here infers one from another — a file being
 * present is not weights being in memory.
 *
 * @param {GgufVariant[]} variants
 * @param {{name: string}[]} installed  from listModels()
 * @param {string|null} loadedModel     what the provider reports serving
 */
export function installStateFor(variants, installed, loadedModel) {
  const have = new Set((installed ?? []).map((m) => m.name));
  return variants.map((v) => ({
    ...v,
    installed: have.has(v.name),
    loaded: !!loadedModel && loadedModel === v.name,
  }));
}
