// @ts-check
/**
 * Secret redaction.
 *
 * Tool output goes three places that all outlive the moment: the model's
 * context, the event log, and the screen. A key that appears in any of them
 * has leaked. So redaction happens at the point output is produced, not at the
 * point it is displayed.
 *
 * This is a reducer of risk, not a guarantee. It catches the shapes that
 * actually appear in repositories: provider key prefixes, `KEY=value` in env
 * files, bearer tokens, private key blocks, connection strings. It cannot
 * catch a secret that looks like an ordinary word, and nothing claims it does.
 */

const PLACEHOLDER = "[redacted]";

/** Patterns with a capture group are replaced only in that group. */
const PATTERNS = [
  // Provider keys with recognisable prefixes.
  { re: /\b(sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,})\b/g, group: 0 },
  { re: /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g, group: 0 },
  { re: /\b(xox[abprs]-[A-Za-z0-9-]{10,})\b/g, group: 0 },
  { re: /\b(AKIA[0-9A-Z]{16})\b/g, group: 0 },
  { re: /\b(AIza[0-9A-Za-z_-]{30,})\b/g, group: 0 },
  { re: /\b(hf_[A-Za-z0-9]{20,})\b/g, group: 0 },
  // A JWT: three base64url segments.
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, group: 0 },
  // Authorization headers.
  { re: /\b(?:bearer|token|basic)\s+([A-Za-z0-9._~+/=-]{16,})/gi, group: 1 },
  // KEY=value in env files and shell output. The name must look like a secret.
  {
    re: /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|CREDENTIALS?)[A-Z0-9_]*)\s*[:=]\s*["']?([^\s"']{6,})/gi,
    group: 2,
  },
  // Connection strings with inline credentials.
  { re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@]{3,})@/gi, group: 1 },
  // PEM blocks: replace the body, keep the header so the reader knows what it was.
  {
    re: /(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g,
    group: "pem",
  },
];

/**
 * @param {string} text
 * @returns {string}
 */
export function redact(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;
  for (const { re, group } of PATTERNS) {
    out = out.replace(re, (match, ...caps) => {
      if (group === "pem") return `${caps[0]}\n${PLACEHOLDER}\n${caps[1]}`;
      if (group === 0) return PLACEHOLDER;
      const captured = caps[group - 1];
      if (typeof captured !== "string") return match;
      return match.replace(captured, PLACEHOLDER);
    });
  }
  return out;
}

/** Whether redaction changed anything, for a "output was redacted" note. */
export function wasRedacted(text) {
  return typeof text === "string" && redact(text) !== text;
}

/**
 * The environment a child process receives.
 *
 * An allowlist, because the parent environment of a developer machine holds
 * cloud credentials, npm tokens and provider keys, and a command the model
 * chose has no business inheriting them.
 *
 * @param {NodeJS.ProcessEnv} parent
 * @param {{cwd: string, extra?: Record<string,string>}} opts
 */
export function childEnv(parent, { cwd, extra = {} }) {
  const ALLOW = [
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP",
    "HOME", "HOMEDRIVE", "HOMEPATH", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
    "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA", "SYSTEMDRIVE",
    "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "LANG", "LC_ALL", "TZ",
  ];
  /** @type {Record<string,string>} */
  const env = {};
  for (const key of Object.keys(parent)) {
    if (ALLOW.includes(key.toUpperCase()) && typeof parent[key] === "string") {
      env[key] = /** @type {string} */ (parent[key]);
    }
  }
  env.PWD = cwd;
  env.CI = "1";              // stops tools opening editors and pagers
  env.NO_COLOR = "1";        // ANSI in the model's context is noise
  env.TERM = "dumb";
  env.FORCE_COLOR = "0";
  env.PYTHONIOENCODING = "utf-8";
  env.PYTHONUNBUFFERED = "1";
  return { ...env, ...extra };
}
