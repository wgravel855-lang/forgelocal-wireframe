// @ts-check
/**
 * Reading a GGUF file's own metadata.
 *
 * Everything the model inspector shows about a file — its architecture, its
 * real context length, how many layers it has, whether its chat template
 * handles tools — is written in the file's header by whoever produced it. This
 * reads that, rather than inferring it from the file name or fetching it from
 * a repository the file may not have come from.
 *
 * Why it matters that this is local: the browser's view model asks Hugging
 * Face, which is right for a model you are deciding whether to download. It is
 * wrong for a file already on disk, which may have been renamed, may not be in
 * any repository, and is the thing that will actually be loaded. The header is
 * the only account of a file that cannot disagree with the file.
 *
 * **The format.** A little-endian header: magic "GGUF", a u32 version, u64
 * tensor count, u64 metadata-key count, then that many key/value pairs. A key
 * is a length-prefixed UTF-8 string; a value is a u32 type tag followed by its
 * data. Arrays carry an element type and a count. Version 1 used u32 lengths
 * where 2 and 3 use u64, which is the one incompatibility that matters here.
 *
 * Nothing here trusts the file. Counts are bounded, every read is checked
 * against what was actually read, and a malformed header produces a stated
 * failure rather than a crash or an invented value — this parses bytes that
 * arrived over the network from a stranger.
 */

import { closeSync, openSync, readSync, statSync } from "node:fs";

const MAGIC = Buffer.from("GGUF", "ascii");

/** GGUF value type tags, in the order the specification numbers them. */
const T = Object.freeze({
  UINT8: 0, INT8: 1, UINT16: 2, INT16: 3, UINT32: 4, INT32: 5,
  FLOAT32: 6, BOOL: 7, STRING: 8, ARRAY: 9, UINT64: 10, INT64: 11, FLOAT64: 12,
});

/**
 * How much of the file to read.
 *
 * The header is at the front and is usually tens of kilobytes; a chat template
 * can make it a few hundred. This is a ceiling rather than a target — reading
 * the whole of a 40GB file to show a metadata panel is not an option, and a
 * header larger than this is a file we decline to characterise rather than one
 * we spend a gigabyte of memory on.
 */
const MAX_HEADER = 8 * 1024 * 1024;

/** Keys worth showing, and what to call them. Everything else is still read. */
const INTERESTING = Object.freeze([
  ["general.architecture", "Architecture"],
  ["general.name", "Name"],
  ["general.size_label", "Size label"],
  ["general.license", "License"],
  ["general.quantization_version", "Quantisation version"],
  ["general.file_type", "File type"],
]);

class Reader {
  /** @param {Buffer} buf */
  constructor(buf) {
    this.buf = buf;
    this.at = 0;
  }

  /** @param {number} n */
  need(n) {
    if (n < 0 || this.at + n > this.buf.length) {
      throw new Error("the header ends before the metadata does");
    }
  }

  u8() { this.need(1); return this.buf.readUInt8(this.at++); }
  u16() { this.need(2); const v = this.buf.readUInt16LE(this.at); this.at += 2; return v; }
  i16() { this.need(2); const v = this.buf.readInt16LE(this.at); this.at += 2; return v; }
  u32() { this.need(4); const v = this.buf.readUInt32LE(this.at); this.at += 4; return v; }
  i32() { this.need(4); const v = this.buf.readInt32LE(this.at); this.at += 4; return v; }
  f32() { this.need(4); const v = this.buf.readFloatLE(this.at); this.at += 4; return v; }
  f64() { this.need(8); const v = this.buf.readDoubleLE(this.at); this.at += 8; return v; }

  /** u64 as a Number. Beyond 2^53 it is reported as a string rather than rounded. */
  u64() {
    this.need(8);
    const v = this.buf.readBigUInt64LE(this.at);
    this.at += 8;
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
  }

  i64() {
    this.need(8);
    const v = this.buf.readBigInt64LE(this.at);
    this.at += 8;
    return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(v) : v.toString();
  }

  /** @param {boolean} wide  version 1 prefixes lengths with u32, later with u64 */
  str(wide) {
    const len = wide ? this.u64() : this.u32();
    if (typeof len !== "number" || len < 0 || len > 64 * 1024 * 1024) {
      throw new Error("a metadata string claims an implausible length");
    }
    this.need(len);
    const s = this.buf.toString("utf8", this.at, this.at + len);
    this.at += len;
    return s;
  }

  /** @param {number} type @param {boolean} wide */
  value(type, wide, depth = 0) {
    switch (type) {
      case T.UINT8: return this.u8();
      case T.INT8: { this.need(1); return this.buf.readInt8(this.at++); }
      case T.UINT16: return this.u16();
      case T.INT16: return this.i16();
      case T.UINT32: return this.u32();
      case T.INT32: return this.i32();
      case T.FLOAT32: return this.f32();
      case T.BOOL: return this.u8() !== 0;
      case T.STRING: return this.str(wide);
      case T.UINT64: return this.u64();
      case T.INT64: return this.i64();
      case T.FLOAT64: return this.f64();
      case T.ARRAY: {
        /* Nested arrays are legal and unbounded recursion is not. Two levels
           is more than any real file uses. */
        if (depth > 2) throw new Error("metadata arrays are nested too deeply");
        const elem = this.u32();
        const count = wide ? this.u64() : this.u32();
        if (typeof count !== "number" || count < 0 || count > 4_000_000) {
          throw new Error("a metadata array claims an implausible length");
        }
        /* Token vocabularies are arrays of 150,000 strings. Reading them costs
           more than the panel can show, so the length is kept and the contents
           are not — an honest summary rather than a truncated list presented
           as the whole. */
        if (count > 512) {
          for (let i = 0; i < count; i++) this.skip(elem, wide, depth + 1);
          return { elided: true, count, type: elem };
        }
        const out = [];
        for (let i = 0; i < count; i++) out.push(this.value(elem, wide, depth + 1));
        return out;
      }
      default:
        throw new Error(`metadata type ${type} is not one this reader knows`);
    }
  }

  /** Advance past a value without keeping it. @param {number} type */
  skip(type, wide, depth = 0) {
    this.value(type, wide, depth);
  }
}

/**
 * Read a GGUF file's header.
 *
 * @param {string} path
 * @returns {{ok: true, version: number, tensors: number|string, keys: number,
 *             meta: Record<string, any>, bytes: number}
 *          | {ok: false, reason: string}}
 */
export function readGgufHeader(path) {
  let fd;
  try {
    const size = statSync(path).size;
    fd = openSync(path, "r");
    const want = Math.min(MAX_HEADER, size);
    const buf = Buffer.alloc(want);
    const got = readSync(fd, buf, 0, want, 0);
    if (got < 24) return { ok: false, reason: "The file is too small to be a model." };

    const r = new Reader(buf.subarray(0, got));
    if (!buf.subarray(0, 4).equals(MAGIC)) {
      return {
        ok: false,
        reason: buf.subarray(0, 1).toString() === "<"
          ? "The file is a web page, not a model. The download probably hit an error page."
          : "The file does not start with the GGUF marker, so it is not a model file.",
      };
    }
    r.at = 4;
    const version = r.u32();
    if (version < 1 || version > 3) {
      return { ok: false, reason: `This is GGUF version ${version}, which this build does not read.` };
    }
    const wide = version >= 2;
    const tensors = wide ? r.u64() : r.u32();
    const keys = wide ? r.u64() : r.u32();
    if (typeof keys !== "number" || keys < 0 || keys > 100_000) {
      return { ok: false, reason: "The header claims an implausible number of metadata keys." };
    }

    /** @type {Record<string, any>} */
    const meta = {};
    for (let i = 0; i < keys; i++) {
      const key = r.str(wide);
      const type = r.u32();
      meta[key] = r.value(type, wide);
    }
    return { ok: true, version, tensors, keys, meta, bytes: size };
  } catch (/** @type {any} */ e) {
    /* A truncated read of a header larger than the cap lands here, and says so
       rather than reporting the file as corrupt. */
    return { ok: false, reason: `The header could not be read: ${e && e.message ? e.message : e}` };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The first key present out of several spellings. @param {Record<string, any>} meta */
function pick(meta, ...keys) {
  for (const k of keys) if (meta[k] !== undefined) return meta[k];
  return null;
}

/**
 * The facts the inspector shows, from the header.
 *
 * Architecture-specific keys are prefixed with the architecture itself
 * (`qwen2.context_length`), so the architecture has to be read before anything
 * else can be looked up. Every field is null when the file does not carry it;
 * none is guessed from the name.
 *
 * @param {Record<string, any>} meta
 */
export function summarise(meta) {
  const arch = typeof meta["general.architecture"] === "string"
    ? meta["general.architecture"] : null;
  const a = (suffix) => (arch ? meta[`${arch}.${suffix}`] : undefined);

  const template = pick(meta, "tokenizer.chat_template");
  const hasTemplate = typeof template === "string" && template.length > 0;

  return {
    architecture: arch,
    name: typeof meta["general.name"] === "string" ? meta["general.name"] : null,
    /* The parameter count as the producer labelled it -- "7B", "30B-A3B". The
       badge in the table shows this and nothing else: reading a size out of
       the file name would be reading the name, which is the thing this page
       exists not to do. */
    sizeLabel: typeof meta["general.size_label"] === "string" ? meta["general.size_label"] : null,
    /* A repository, only where the file names one. Most do not, so "Open on
       Hugging Face" is usually absent -- which is right, because a URL built
       from a file name is a guess at somebody else’s address. */
    repo: typeof meta["general.repo_url"] === "string" ? meta["general.repo_url"]
      : typeof meta["general.source.url"] === "string" ? meta["general.source.url"]
        : typeof meta["general.base_model.0.repo_url"] === "string"
          ? meta["general.base_model.0.repo_url"] : null,
    license: typeof meta["general.license"] === "string" ? meta["general.license"] : null,
    /* The real ceiling, from the file. The Load tab clamps the context slider
       to this, so a person cannot ask for more than the model has. */
    contextLength: numberOrNull(a("context_length")),
    blockCount: numberOrNull(a("block_count")),
    embeddingLength: numberOrNull(a("embedding_length")),
    headCount: numberOrNull(a("attention.head_count")),
    /* Same evidence rule as the browser: the template is where llama.cpp
       drives tools, so a template that handles them is the model's own authors
       wiring it, and no template at all is unknown rather than absent. */
    toolUse: hasTemplate
      ? { present: /\btools\b/.test(template) && /tool_call/.test(template),
        evidence: /\btools\b/.test(template) && /tool_call/.test(template)
          ? "Its chat template handles tool calls."
          : "Its chat template has no tool-call section." }
      : { present: null, evidence: "The file carries no chat template, so this is unknown." },
    chatTemplate: hasTemplate ? template : null,
  };
}

/** @param {any} v */
function numberOrNull(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Metadata as rows a person can read, for the raw view.
 *
 * Sorted, with the general keys first, because a GGUF header is a flat bag of
 * a hundred keys and the ones somebody opened this to see are all prefixed
 * `general.`. Long values are marked rather than truncated silently.
 *
 * @param {Record<string, any>} meta
 */
export function metaRows(meta) {
  const rows = Object.entries(meta).map(([key, value]) => {
    let text;
    if (value && typeof value === "object" && value.elided) {
      text = `${value.count.toLocaleString("en-US")} values`;
    } else if (Array.isArray(value)) {
      text = value.length > 8
        ? `[${value.slice(0, 8).join(", ")}, … ${value.length} total]`
        : `[${value.join(", ")}]`;
    } else {
      text = String(value);
    }
    return { key, value: text, long: text.length > 160 };
  });

  rows.sort((a, b) => {
    const ga = a.key.startsWith("general.") ? 0 : 1;
    const gb = b.key.startsWith("general.") ? 0 : 1;
    return ga !== gb ? ga - gb : a.key.localeCompare(b.key);
  });
  return rows;
}

export { INTERESTING };
