// Expands includes inside a screen body.
//
//   <!--#include sidebar.html {"active":"s2"} -->
//
// Reads design/partials/<file>, substitutes {{key}} from the JSON object
// (raw, so a param may itself be markup) and recurses, so a param can carry
// another include. Unmatched {{key}} placeholders resolve to "".
//
// The JSON is scanned with brace counting and string awareness rather than a
// regex, because a nested include inside a param contains both "}" and "-->".

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const partialsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "partials");
const OPEN = "<!--#include";

// Given src and the index of "{", return the index just past the matching "}".
function endOfJson(src, start) {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  throw new Error("unterminated include params");
}

export function expand(html, depth = 0) {
  if (depth > 8) throw new Error("include nesting too deep");

  let out = "";
  let i = 0;
  for (;;) {
    const at = html.indexOf(OPEN, i);
    if (at === -1) { out += html.slice(i); break; }
    out += html.slice(i, at);

    let p = at + OPEN.length;
    while (html[p] === " " || html[p] === "\t") p++;
    const nameEnd = (() => { let j = p; while (/[\w.-]/.test(html[j] ?? "")) j++; return j; })();
    const file = html.slice(p, nameEnd);
    if (!file) throw new Error("include with no filename");

    p = nameEnd;
    while (html[p] === " " || html[p] === "\t" || html[p] === "\n") p++;

    let params = {};
    if (html[p] === "{") {
      const end = endOfJson(html, p);
      const raw = html.slice(p, end);
      try { params = JSON.parse(raw); }
      catch (e) { throw new Error(`bad include params for ${file}: ${e.message}`); }
      p = end;
    }

    while (html[p] === " " || html[p] === "\t" || html[p] === "\n") p++;
    if (html.slice(p, p + 3) !== "-->") throw new Error(`unterminated include for ${file}`);
    i = p + 3;

    let part;
    try { part = readFileSync(join(partialsDir, file), "utf8"); }
    catch { throw new Error(`missing partial: ${file}`); }

    part = part.replace(/\{\{(\w+)\}\}/g, (_, k) => params[k] ?? "");
    out += expand(part, depth + 1).trimEnd();
  }
  return out;
}

export function readBody(partsDir, name) {
  return expand(readFileSync(join(partsDir, `${name}.body.html`), "utf8"));
}
