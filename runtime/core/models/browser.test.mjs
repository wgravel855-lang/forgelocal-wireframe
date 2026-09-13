// @ts-check
/**
 * Tests for the model browser's view model.
 *
 * Almost every one is about the same distinction: what was measured versus
 * what would look plausible. A model browser is a screen full of numbers about
 * somebody else's work, and each of them is something a person might act on —
 * so an unknown has to survive all the way to the interface as an unknown.
 *
 * No network. describeModel is exercised against recorded shapes, because a
 * test that needs Hugging Face to be up is a test that fails for reasons
 * unrelated to the code.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capabilitiesFrom, groupVariants, leadParagraph, monogramFor, parameterLabel,
  quantOf, shardOf, stripFrontMatter, installStateFor, compatibilityFor,
} from "./browser.mjs";

const file = (name, bytes) => ({
  name, bytes, quantization: quantOf(name), sha256: "a".repeat(64),
  url: `https://huggingface.co/o/r/resolve/main/${name}`, format: "GGUF",
});

/* ------------------------------------------------------ 1. the shard trap */

test("a shard is recognised as part of a model, not as a model", () => {
  assert.deepEqual(shardOf("m-q8_0-00002-of-00003.gguf"), { base: "m-q8_0", part: 2, of: 3 });
  assert.deepEqual(shardOf("m-q8_0.gguf"), { base: "m-q8_0", part: null, of: null });
});

test("shards collapse into one download, with the total size", () => {
  /* Listing them separately offers somebody a 0.18GB "Q8_0" that is the tail
     of an 8GB file and will not load. This is what a picker built naively
     from a file listing does. */
  const grouped = groupVariants([
    file("m-q8_0-00001-of-00003.gguf", 4e9),
    file("m-q8_0-00002-of-00003.gguf", 4e9),
    file("m-q8_0-00003-of-00003.gguf", 1e8),
  ]);
  assert.equal(grouped.length, 1, "three shards were offered as three downloads");
  assert.equal(grouped[0].bytes, 8.1e9, "the size is not the total of the set");
  assert.equal(grouped[0].parts?.count, 3);
  assert.equal(grouped[0].name, "m-q8_0.gguf");
  assert.match(grouped[0].url, /00001-of-00003/,
    "the set is not identified by its first shard, which is what llama.cpp is pointed at");
});

test("a model published both whole and split is not counted twice", () => {
  /* Qwen2.5-Coder-7B-Instruct-GGUF really does this: a 4.68GB q4_k_m.gguf and
     a q4_k_m-00001-of-00002 pair holding the same weights. Merging by base
     name reported that 4.68GB download as 9.37GB. */
  const grouped = groupVariants([
    file("m-q4_k_m.gguf", 4.68e9),
    file("m-q4_k_m-00001-of-00002.gguf", 3.99e9),
    file("m-q4_k_m-00002-of-00002.gguf", 0.69e9),
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].bytes, 4.68e9, "the whole file and its split were added together");
  assert.equal(grouped[0].parts, null, "the single-file download was reported as split");
  assert.equal(grouped[0].name, "m-q4_k_m.gguf");
});

test("quantisation is read past a shard suffix", () => {
  assert.equal(quantOf("m-q4_k_m-00001-of-00002.gguf"), "Q4_K_M");
  assert.equal(quantOf("m-fp16-00003-of-00004.gguf"), "FP16");
  assert.equal(quantOf("m.gguf"), "unknown", "a name with no quantisation got one anyway");
});

/* ------------------------------------------- 2. capabilities need evidence */

test("tool use is decided by the chat template, which is where it lives", () => {
  /* llama.cpp drives tools through the template, so a template that handles
     them is the model's own authors wiring tool calling. This is the one
     capability that can be settled rather than guessed. */
  const withTools = capabilitiesFrom({
    gguf: { chat_template: "{%- if tools %}{{- tool_call }}{%- endif %}" },
    pipeline_tag: "text-generation",
  });
  assert.equal(withTools.toolUse.present, true);
  assert.match(withTools.toolUse.evidence, /chat template/);

  const without = capabilitiesFrom({
    gguf: { chat_template: "{{ messages }}" }, pipeline_tag: "text-generation",
  });
  assert.equal(without.toolUse.present, false,
    "a template with no tool handling was not reported as lacking it");
});

test("a model with no published template is unknown, not incapable", () => {
  const c = capabilitiesFrom({ pipeline_tag: "text-generation" });
  assert.equal(c.toolUse.present, null);
  assert.match(c.toolUse.evidence, /unknown/i);
});

test("tags never establish tool use on their own", () => {
  /* The failure mode this guards: "function-calling" in the tag list is the
     uploader's word for it, and a badge promising an agent loop needs more. */
  const c = capabilitiesFrom({
    tags: ["function-calling", "tools", "agent"],
    gguf: { chat_template: "{{ messages }}" },
    pipeline_tag: "text-generation",
  });
  assert.equal(c.toolUse.present, false, "a tag talked the model into tool use");
});

test("reasoning is unknown unless claimed, and the claim is attributed", () => {
  assert.equal(capabilitiesFrom({ tags: ["chat"] }).reasoning.present, null);
  const claimed = capabilitiesFrom({ tags: ["reasoning"] });
  assert.equal(claimed.reasoning.present, true);
  assert.match(claimed.reasoning.evidence, /uploader|not independently/i,
    "a self-applied tag was presented as a finding");
});

test("vision comes from the pipeline, and absence of one is unknown", () => {
  assert.equal(capabilitiesFrom({ pipeline_tag: "image-text-to-text" }).vision.present, true);
  assert.equal(capabilitiesFrom({ pipeline_tag: "text-generation" }).vision.present, false);
  assert.equal(capabilitiesFrom({}).vision.present, null);
});

test("every capability carries a reason, whatever it decided", () => {
  /* A badge is a claim, and a person should be able to find out why it is
     there. An empty evidence string is a badge with nothing behind it. */
  for (const info of [{}, { pipeline_tag: "text-generation" }, { gguf: { chat_template: "x" } }]) {
    for (const [name, cap] of Object.entries(capabilitiesFrom(info))) {
      assert.ok(cap.evidence && cap.evidence.length > 10, `${name} has no stated evidence`);
    }
  }
});

/* --------------------------------------------------- 3. numbers and prose */

test("a parameter count comes from the file, or is absent", () => {
  assert.equal(parameterLabel(7_615_616_512), "7.6B");
  assert.equal(parameterLabel(494_032_768), "494M");
  assert.equal(parameterLabel(null), null);
  assert.equal(parameterLabel(0), null, "zero parameters was reported as a count");
  assert.equal(parameterLabel(undefined), null);
});

test("front matter is not prose", () => {
  const md = "---\nlicense: apache-2.0\ntags:\n- code\n---\n\nReal text begins here.";
  assert.equal(stripFrontMatter(md), "Real text begins here.");
  assert.equal(stripFrontMatter("No front matter."), "No front matter.");
});

test("the description skips headings and badge rows", () => {
  const md = [
    "---\nlicense: mit\n---",
    "# Model-Name-GGUF",
    "[![badge](https://img.shields.io/x)](https://example.com) [![two](https://b)](https://c)",
    "This is a real description of the model that is long enough to be useful.",
  ].join("\n\n");
  const lead = leadParagraph(md);
  assert.equal(lead, "This is a real description of the model that is long enough to be useful.");
});

test("a README with no prose yields no description rather than a heading", () => {
  assert.equal(leadParagraph("# Just-A-Title\n\n## And another"), null,
    "a heading was used as the model's description");
  assert.equal(leadParagraph(null), null);
});

test("a long description is truncated with an ellipsis, not cut mid-word", () => {
  const lead = leadParagraph(`${"word ".repeat(200)}`, 60);
  assert.ok(lead, "a long paragraph produced no description");
  assert.ok(lead.length <= 60);
  assert.ok(lead.endsWith("…"));
});

test("a monogram comes from the author, who is who people recognise", () => {
  assert.equal(monogramFor("Qwen"), "QW");
  assert.equal(monogramFor("mistralai"), "MI");
  assert.equal(monogramFor("TheBloke"), "TH");
  assert.equal(monogramFor(""), "?");
});

/* ------------------------------------------------- 4. what this machine has */

test("a file on disk is not weights in memory", () => {
  const variants = [file("a.gguf", 1e9), file("b.gguf", 2e9)];
  const state = installStateFor(variants, [{ name: "a.gguf" }], null);
  assert.equal(state[0].installed, true);
  assert.equal(state[0].loaded, false, "an installed file was reported as loaded");
  assert.equal(state[1].installed, false);
});

test("only the model the provider names is loaded", () => {
  const variants = [file("a.gguf", 1e9), file("b.gguf", 2e9)];
  const state = installStateFor(variants, [{ name: "a.gguf" }, { name: "b.gguf" }], "b.gguf");
  assert.equal(state[0].loaded, false);
  assert.equal(state[1].loaded, true);
});

test("compatibility with no hardware is unknown, not optimistic", () => {
  const c = compatibilityFor(file("a.gguf", 4e9), null);
  assert.ok(c, "no compatibility result at all");
  assert.equal(c.verdict, "unknown", "a fit was produced with nothing measured");
  assert.equal(c.suggested, null);
});

test("compatibility with real hardware answers, and agrees with the model list", () => {
  const hw = {
    gpus: [{ vendor: "nvidia", name: "RTX 5070", vram_bytes: 12227 * 1024 * 1024 }],
    ram_bytes: 34 * 1024 ** 3, cpu_cores: 16,
  };
  const c = compatibilityFor(file("a.gguf", 4.68e9), hw);
  assert.ok(c, "no compatibility result at all");
  assert.equal(c.verdict, "fits");
  assert.ok(c.suggested, "a fitting model got no load suggestion");
  assert.ok(c.detail.includes("RTX 5070"), "the verdict does not name what it measured");
});
