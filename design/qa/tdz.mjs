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
 * @param {string} src
 * @returns {string[]} one message per problem
 */
export function findTemporalDeadZones(src) {
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
