// @ts-check
/**
 * One rule, in its own file because it needs real parsing rather than a regex
 * pass over a line.
 *
 * A module-scope binding whose initialiser CALLS a helper declared further down
 * the same scope is a temporal dead zone: the value is built at load time,
 * before the helper exists, and the whole module throws on import. This shipped
 * once as `const CAPICON = { chat: svg(...) }` and broke the catalog with
 * "Cannot access 'svg' before initialization".
 *
 * A helper captured inside an arrow or function body is fine, because that body
 * is not evaluated until the module has finished loading.
 */

/**
 * Blank out what is inside string and template literals.
 *
 * A call cannot happen inside a string, but `INSERT INTO blobs (id, ...)` in a
 * SQL template reads exactly like `blobs(` to a regex, and the store module
 * declares a `const blobs` further down. Quote characters are kept so the
 * result has the same length and line structure, which is what the line
 * numbers in the messages depend on.
 *
 * Template interpolations are NOT blanked: `${helper()}` really does run when
 * the template is evaluated, which is the whole point of this rule.
 *
 * @param {string} text
 */
function blankLiterals(text) {
  let out = "";
  let i = 0;
  /** @type {string|null} */
  let quote = null;
  /** Depth of ${ } we are inside, so a nested template closes correctly. */
  const interp = [];

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (quote === null) {
      if (c === "'" || c === '"' || c === "`") { quote = c; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }

    if (c === "\\") { out += "  "; i += 2; continue; }          // an escape, blanked in pairs
    if (c === quote) { quote = null; out += c; i += 1; continue; }
    if (quote === "`" && c === "$" && next === "{") {
      // Step back out into code until the matching brace.
      const start = i;
      let depth = 0;
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === "{") depth += 1;
        else if (text[j] === "}") { depth -= 1; if (depth === 0) break; }
      }
      out += text.slice(start, j + 1);
      i = j + 1;
      interp.length = 0;
      continue;
    }
    // Inside a literal: keep newlines so line numbers survive, blank the rest.
    out += c === "\n" ? "\n" : " ";
    i += 1;
  }
  return out;
}

/**
 * @param {string} src
 * @returns {string[]} one message per problem
 */
export function findTemporalDeadZones(src) {
  src = blankLiterals(src);
  const lines = src.split("\n");

  /** Declarations at the IIFE's own indent level. @type {Record<string, number>} */
  const declared = {};
  lines.forEach((line, i) => {
    const m = line.match(/^ {2}(?:const|let)\s+([A-Za-z_$][\w$]*)/);
    if (m && declared[m[1]] === undefined) declared[m[1]] = i;
  });

  const depthOf = (t) =>
    (t.match(/[{[(]/g) || []).length - (t.match(/[}\])]/g) || []).length;

  /** @type {string[]} */
  const problems = [];

  lines.forEach((line, i) => {
    const m = line.match(/^ {2}const\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)$/);
    if (!m) return;

    // Gather the initialiser expression across however many lines it spans.
    let body = m[2];
    let depth = depthOf(m[2]);
    for (let j = i + 1; depth > 0 && j < lines.length && j < i + 60; j++) {
      body += "\n" + lines[j];
      depth += depthOf(lines[j]);
    }

    // Lazy: nothing here runs at load time.
    if (/=>|\bfunction\b/.test(body)) return;

    for (const call of body.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = call[1];
      if (declared[name] !== undefined && declared[name] > i && name !== m[1]) {
        problems.push(
          `temporal dead zone: const ${m[1]} on line ${i + 1} calls ${name}(), `
          + `which is declared on line ${declared[name] + 1}`);
      }
    }
  });

  return problems;
}
