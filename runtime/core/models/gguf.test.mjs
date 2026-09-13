// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readGgufHeader, summarise, metaRows } from "./gguf.mjs";

/* ------------------------------------------------------------ a writer */
/* The parser reads bytes that arrived over the network from a stranger, so
   the tests hand it bytes rather than an object. This writes the format the
   specification describes, including the shapes a real file never has. */

const T = { UINT32: 4, FLOAT32: 6, BOOL: 7, STRING: 8, ARRAY: 9, UINT64: 10 };

class W {
  constructor(wide = true) { this.parts = []; this.wide = wide; }
  raw(b) { this.parts.push(Buffer.from(b)); return this; }
  u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return this.raw(b); }
  u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return this.raw(b); }
  f32(n) { const b = Buffer.alloc(4); b.writeFloatLE(n); return this.raw(b); }
  len(n) { return this.wide ? this.u64(n) : this.u32(n); }
  str(s) { const b = Buffer.from(s, "utf8"); return this.len(b.length).raw(b); }
  done() { return Buffer.concat(this.parts); }
}

/**
 * A whole file: magic, version, counts, then the pairs.
 *
 * `keyCount` is separate from `pairs.length` on purpose, so a test can write
 * a header that lies about how many keys follow it.
 *
 * @param {any[][]} pairs  [key, type tag, a function that writes the value]
 * @param {{version?: number, tensors?: number, keyCount?: number|null}} [opts]
 */
function gguf(pairs, { version = 3, tensors = 0, keyCount = null } = {}) {
  const wide = version >= 2;
  const w = new W(wide);
  w.raw("GGUF").u32(version);
  if (wide) w.u64(tensors); else w.u32(tensors);
  const n = keyCount === null ? pairs.length : keyCount;
  if (wide) w.u64(n); else w.u32(n);
  for (const [key, type, write] of pairs) {
    w.str(key);
    w.u32(type);
    write(w);
  }
  return w.done();
}

const str = (s) => (w) => w.str(s);
const u32 = (n) => (w) => w.u32(n);

/**
 * The metadata of a file that must parse.
 *
 * Asserting here keeps each test below to one line and narrows the result
 * away from its failure arm, so a test that meant to read a good file says so
 * rather than quietly reading `undefined` off a failure.
 *
 * @param {string} path @returns {Record<string, any>}
 */
function meta(path) {
  const r = readGgufHeader(path);
  if (r.ok === false) throw new assert.AssertionError({ message: r.reason });
  return r.meta;
}

let dir;
const file = (name, bytes) => {
  dir ??= mkdtempSync(join(tmpdir(), "gguf-"));
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
};
test.after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

const QWEN = [
  ["general.architecture", T.STRING, str("qwen2")],
  ["general.name", T.STRING, str("Qwen2.5 Coder 7B Instruct GGUF")],
  ["general.size_label", T.STRING, str("7B")],
  ["qwen2.context_length", T.UINT32, u32(131072)],
  ["qwen2.block_count", T.UINT32, u32(28)],
  ["qwen2.embedding_length", T.UINT32, u32(3584)],
  ["qwen2.attention.head_count", T.UINT32, u32(28)],
  ["tokenizer.chat_template", T.STRING, str("{% if tools %}...{{ tool_call }}{% endif %}")],
];

/* ------------------------------------------------------------ the header */

test("a v3 header is read as it was written", () => {
  const r = readGgufHeader(file("ok.gguf", gguf(QWEN, { tensors: 339 })));
  assert.equal(r.ok, true);
  assert.equal(r.version, 3);
  assert.equal(r.tensors, 339);
  assert.equal(r.keys, QWEN.length);
  assert.equal(r.meta["general.architecture"], "qwen2");
  assert.equal(r.meta["qwen2.context_length"], 131072);
  assert.equal(r.bytes > 0, true);
});

test("version 1's narrow lengths are read as version 1, not as version 3", () => {
  const r = readGgufHeader(file("v1.gguf", gguf(QWEN, { version: 1 })));
  assert.equal(r.ok, true);
  assert.equal(r.version, 1);
  assert.equal(r.meta["general.name"], "Qwen2.5 Coder 7B Instruct GGUF");
});

test("every value type survives the round trip", () => {
  const r = readGgufHeader(file("types.gguf", gguf([
    ["a.u32", T.UINT32, u32(7)],
    ["a.u64", T.UINT64, (w) => w.u64(9007199254740990)],
    ["a.f32", T.FLOAT32, (w) => w.f32(0.5)],
    ["a.bool", T.BOOL, (w) => w.raw(Buffer.from([1]))],
    ["a.str", T.STRING, str("x")],
    ["a.arr", T.ARRAY, (w) => w.u32(T.UINT32).u64(3).u32(1).u32(2).u32(3)],
  ])));
  assert.equal(r.ok, true);
  assert.equal(r.meta["a.u32"], 7);
  assert.equal(r.meta["a.u64"], 9007199254740990);
  assert.equal(r.meta["a.f32"], 0.5);
  assert.equal(r.meta["a.bool"], true);
  assert.equal(r.meta["a.str"], "x");
  assert.deepEqual(r.meta["a.arr"], [1, 2, 3]);
});

test("a vocabulary is counted, not read into memory", () => {
  const w = (ww) => {
    ww.u32(T.STRING).u64(2000);
    for (let i = 0; i < 2000; i++) ww.str("tok" + i);
  };
  const r = readGgufHeader(file("vocab.gguf", gguf([["tokenizer.ggml.tokens", T.ARRAY, w]])));
  assert.equal(r.ok, true);
  /* The length is the honest summary; 2000 strings are not what the panel
     needs and reading them is what makes a metadata view cost a second. */
  assert.deepEqual(r.meta["tokenizer.ggml.tokens"], { elided: true, count: 2000, type: T.STRING });
});

/* ------------------------------------ what it does with bytes it distrusts */

test("a file that is not a model says what it is instead", () => {
  const html = readGgufHeader(file("err.gguf", Buffer.from(
    "<!doctype html><title>404</title>" + "x".repeat(200))));
  assert.equal(html.ok, false);
  assert.match(html.reason, /web page/i);
  assert.match(html.reason, /error page/i);

  const other = readGgufHeader(file("zip.gguf", Buffer.from("PK" + "x".repeat(200))));
  assert.equal(other.ok, false);
  assert.match(other.reason, /GGUF marker/);
});

test("a file too short to hold a header is not parsed as one", () => {
  const r = readGgufHeader(file("tiny.gguf", Buffer.from("GGUF")));
  assert.equal(r.ok, false);
  assert.match(r.reason, /too small/i);
});

test("a version this build cannot read is named, not guessed at", () => {
  const r = readGgufHeader(file("v9.gguf", gguf(QWEN, { version: 9 })));
  assert.equal(r.ok, false);
  assert.match(r.reason, /version 9/);
});

test("an implausible key count is refused before anything is allocated", () => {
  const r = readGgufHeader(file("keys.gguf", gguf([], { keyCount: 500000 })));
  assert.equal(r.ok, false);
  assert.match(r.reason, /implausible number of metadata keys/);
});

test("a string claiming more bytes than exist fails without throwing", () => {
  const w = new W(true);
  w.raw("GGUF").u32(3).u64(0).u64(1);
  w.str("some.key").u32(T.STRING).u64(1024 * 1024 * 1024);
  const r = readGgufHeader(file("liar.gguf", w.done()));
  assert.equal(r.ok, false);
  assert.match(r.reason, /implausible length|ends before/);
});

test("a truncated header reports the truncation", () => {
  const whole = gguf(QWEN);
  const r = readGgufHeader(file("cut.gguf", whole.subarray(0, whole.length - 40)));
  assert.equal(r.ok, false);
  assert.match(r.reason, /could not be read|ends before/);
});

test("an unknown value type stops the read rather than shifting every key after it", () => {
  const r = readGgufHeader(file("type.gguf", gguf([["a", 77, u32(1)]])));
  assert.equal(r.ok, false);
  assert.match(r.reason, /type 77/);
});

test("a missing file is a stated failure, not a throw", () => {
  const r = readGgufHeader(join(tmpdir(), "definitely-not-here-9e3f.gguf"));
  assert.equal(r.ok, false);
  assert.equal(typeof r.reason, "string");
});

/* ----------------------------------------------------------- the summary */

test("summarise reads architecture-prefixed keys through the architecture", () => {
  const s = summarise(meta(file("sum.gguf", gguf(QWEN))));
  assert.equal(s.architecture, "qwen2");
  assert.equal(s.name, "Qwen2.5 Coder 7B Instruct GGUF");
  assert.equal(s.sizeLabel, "7B");
  assert.equal(s.contextLength, 131072);
  assert.equal(s.blockCount, 28);
  assert.equal(s.embeddingLength, 3584);
});

test("summarise returns null for what the file does not say, and never a guess", () => {
  const s = summarise(meta(file("bare.gguf", gguf([
    ["general.architecture", T.STRING, str("llama")],
  ]))));
  assert.equal(s.contextLength, null);
  assert.equal(s.blockCount, null);
  assert.equal(s.sizeLabel, null);
  assert.equal(s.name, null);
  /* No repository, so the page shows no "Open on Hugging Face". */
  assert.equal(s.repo, null);
  assert.equal(s.license, null);
});

test("tool use is claimed from the template, and unknown without one", () => {
  const withTools = summarise(meta(file("t1.gguf", gguf(QWEN))));
  assert.equal(withTools.toolUse.present, true);
  assert.match(withTools.toolUse.evidence, /chat template/);

  const plain = summarise(meta(file("t2.gguf", gguf([
    ["general.architecture", T.STRING, str("llama")],
    ["tokenizer.chat_template", T.STRING, str("{{ messages }}")],
  ]))));
  assert.equal(plain.toolUse.present, false);

  /* No template at all is unknown, not absent. */
  const none = summarise(meta(file("t3.gguf", gguf([
    ["general.architecture", T.STRING, str("llama")],
  ]))));
  assert.equal(none.toolUse.present, null);
  assert.match(none.toolUse.evidence, /unknown/);
});

test("a repository is only reported where the file names one", () => {
  const s = summarise(meta(file("repo.gguf", gguf([
    ["general.architecture", T.STRING, str("qwen2")],
    ["general.repo_url", T.STRING, str("https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF")],
  ]))));
  assert.match(String(s.repo), /huggingface\.co\/Qwen/);
});

/* -------------------------------------------------------------- raw rows */

test("metaRows puts the general keys first and marks the long ones", () => {
  const rows = metaRows(meta(file("rows.gguf", gguf([
    ["zzz.last", T.UINT32, u32(1)],
    ["general.name", T.STRING, str("A")],
    ["aaa.middle", T.UINT32, u32(2)],
    ["general.architecture", T.STRING, str("qwen2")],
    ["long.value", T.STRING, str("y".repeat(300))],
  ]))));
  assert.deepEqual(rows.slice(0, 2).map((x) => x.key),
    ["general.architecture", "general.name"]);
  assert.equal(rows.find((x) => x.key === "long.value")?.long, true);
  assert.equal(rows.find((x) => x.key === "zzz.last")?.long, false);
});

test("metaRows summarises an elided array rather than printing an object", () => {
  const w = (ww) => { ww.u32(T.UINT32).u64(600); for (let i = 0; i < 600; i++) ww.u32(i); };
  const rows = metaRows(meta(file("big.gguf", gguf([["t.x", T.ARRAY, w]]))));
  assert.equal(rows.find((x) => x.key === "t.x")?.value, "600 values");
});
