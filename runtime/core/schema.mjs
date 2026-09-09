// @ts-check
/**
 * A small, strict JSON Schema validator.
 *
 * Tool arguments arrive from a language model, so validation is a security
 * boundary, not a convenience. That argues for a validator whose behaviour is
 * fully readable in one file over a general-purpose one whose defaults must be
 * audited: this one supports exactly the keywords the tool contracts use, and
 * rejects a schema that uses anything else rather than ignoring it.
 *
 * Strictness that is not optional here:
 *   - `additionalProperties: false` is required on every object schema
 *   - an unknown property is an error, never dropped
 *   - a missing required property is an error, never defaulted
 *   - type coercion does not exist: "3" is not 3
 */

const KEYWORDS = new Set([
  "type", "properties", "required", "additionalProperties", "items",
  "enum", "minimum", "maximum", "minLength", "maxLength", "minItems",
  "maxItems", "description", "default", "pattern",
]);

export class SchemaError extends Error {
  /** @param {string} message @param {string} path */
  constructor(message, path) {
    super(path ? `${path}: ${message}` : message);
    this.name = "SchemaError";
    this.path = path;
    this.code = "SCHEMA_INVALID";
  }
}

/**
 * Check that a schema itself is well formed and strict. Called once per tool
 * at module load, so a tool that forgets `additionalProperties: false` fails
 * the test suite rather than shipping an open contract.
 * @param {any} schema @param {string} [path]
 */
export function assertStrictSchema(schema, path = "") {
  if (!schema || typeof schema !== "object") {
    throw new SchemaError("schema must be an object", path);
  }
  for (const k of Object.keys(schema)) {
    if (!KEYWORDS.has(k)) throw new SchemaError(`unsupported schema keyword "${k}"`, path);
  }
  if (schema.type === "object") {
    if (schema.additionalProperties !== false) {
      throw new SchemaError("object schemas must set additionalProperties: false", path);
    }
    for (const [name, sub] of Object.entries(schema.properties ?? {})) {
      assertStrictSchema(sub, path ? `${path}.${name}` : name);
    }
    for (const r of schema.required ?? []) {
      if (!schema.properties || !(r in schema.properties)) {
        throw new SchemaError(`required property "${r}" is not defined`, path);
      }
    }
  }
  if (schema.type === "array") {
    if (!schema.items) throw new SchemaError("array schemas must declare items", path);
    assertStrictSchema(schema.items, `${path}[]`);
  }
  return schema;
}

/**
 * Validate a value. Returns every problem, not just the first, because a model
 * that gets one correction per attempt burns turns.
 * @param {any} schema @param {any} value
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validate(schema, value) {
  /** @type {string[]} */
  const errors = [];
  walk(schema, value, "", errors);
  return { ok: errors.length === 0, errors };
}

/**
 * Validate and throw, for call sites where an invalid value is a bug.
 * @param {any} schema @param {any} value @param {string} [what]
 */
export function parse(schema, value, what = "arguments") {
  const { ok, errors } = validate(schema, value);
  if (!ok) throw new SchemaError(`invalid ${what}: ${errors.join("; ")}`, "");
  return value;
}

/** @param {any} schema @param {any} v @param {string} path @param {string[]} out */
function walk(schema, v, path, out) {
  const at = path || "(root)";

  if (schema.type === "object") {
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      return out.push(`${at} must be an object`);
    }
    const props = schema.properties ?? {};
    for (const r of schema.required ?? []) {
      if (!(r in v)) out.push(`${path ? `${path}.` : ""}${r} is required`);
    }
    for (const [k, val] of Object.entries(v)) {
      const sub = props[k];
      if (!sub) {
        out.push(`${at} has unknown property "${k}"`);
        continue;
      }
      if (val === undefined) continue;
      walk(sub, val, path ? `${path}.${k}` : k, out);
    }
    return;
  }

  if (schema.type === "array") {
    if (!Array.isArray(v)) return out.push(`${at} must be an array`);
    if (schema.minItems !== undefined && v.length < schema.minItems) {
      out.push(`${at} needs at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && v.length > schema.maxItems) {
      out.push(`${at} allows at most ${schema.maxItems} item(s)`);
    }
    v.forEach((item, i) => walk(schema.items, item, `${path}[${i}]`, out));
    return;
  }

  if (schema.type === "string") {
    if (typeof v !== "string") return out.push(`${at} must be a string`);
    if (schema.minLength !== undefined && v.length < schema.minLength) {
      out.push(`${at} must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && v.length > schema.maxLength) {
      out.push(`${at} must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(v)) {
      out.push(`${at} does not match ${schema.pattern}`);
    }
  } else if (schema.type === "integer") {
    if (!Number.isInteger(v)) return out.push(`${at} must be an integer`);
    range(schema, v, at, out);
  } else if (schema.type === "number") {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return out.push(`${at} must be a number`);
    }
    range(schema, v, at, out);
  } else if (schema.type === "boolean") {
    if (typeof v !== "boolean") return out.push(`${at} must be true or false`);
  }

  if (schema.enum && !schema.enum.includes(v)) {
    out.push(`${at} must be one of ${schema.enum.join(", ")}`);
  }
}

/** @param {any} schema @param {number} v @param {string} at @param {string[]} out */
function range(schema, v, at, out) {
  if (schema.minimum !== undefined && v < schema.minimum) {
    out.push(`${at} must be at least ${schema.minimum}`);
  }
  if (schema.maximum !== undefined && v > schema.maximum) {
    out.push(`${at} must be at most ${schema.maximum}`);
  }
}
