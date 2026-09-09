// @ts-check
/**
 * Command classification.
 *
 * Some operations must not be reachable by an approval the user gave earlier
 * for something else. Approving `git status` once should never end up
 * authorising `git push --force`, and no mode should quietly run `rm -rf` or
 * an elevation request.
 *
 * This classifier is deliberately conservative and deliberately shallow: it
 * reads argv, not shell strings, because a shell string can hide anything. The
 * runtime never builds a shell line from model output; it passes argv arrays,
 * which is what makes classification meaningful at all.
 *
 * It is a policy layer, not a sandbox. It is stated that way everywhere it is
 * surfaced.
 */

export const Danger = Object.freeze({
  /** never runs, in any mode, with any approval */
  BLOCKED: "blocked",
  /** always prompts, and a session grant can never cover it */
  CONFIRM: "confirm",
  /** ordinary; the mode policy decides */
  ORDINARY: "ordinary",
});

/** @param {string[]} argv @returns {{level: string, reason: string}} */
export function classifyCommand(argv) {
  if (!Array.isArray(argv) || argv.length === 0 || typeof argv[0] !== "string") {
    return { level: Danger.BLOCKED, reason: "no command was given" };
  }
  const exe = basename(argv[0]).toLowerCase();
  const rest = argv.slice(1).map((a) => String(a));
  const lower = rest.map((a) => a.toLowerCase());
  const line = [exe, ...lower].join(" ");

  // Elevation. There is no approval flow for this: the runtime does not ask
  // for administrator rights on the user's behalf.
  if (["sudo", "runas", "gsudo"].includes(exe)) {
    return { level: Danger.BLOCKED, reason: "requests administrator rights" };
  }
  if (/\b(start-process)\b/.test(line) && /-verb\s+runas/.test(line)) {
    return { level: Danger.BLOCKED, reason: "requests administrator rights" };
  }

  // System state: registry, disk, boot, accounts, security settings.
  if (["reg", "regedit", "diskpart", "format", "bcdedit", "bootrec",
       "net", "netsh", "cipher", "takeown", "icacls", "secedit",
       "vssadmin", "wmic", "sc", "shutdown"].includes(exe)) {
    return { level: Danger.BLOCKED, reason: `${exe} changes system or account state` };
  }
  if (/(set|remove|new)-(itemproperty|localuser|localgroup|acl|mppreference)/.test(line)) {
    return { level: Danger.BLOCKED, reason: "changes system, account or security settings" };
  }
  if (/\b(cmdkey|vaultcmd)\b/.test(line) || /get-credential\b/.test(line)) {
    return { level: Danger.BLOCKED, reason: "reads or writes the credential store" };
  }

  // Changing the permission policy itself, which would make every other rule
  // here advisory.
  if (rest.some((a) => /(^|[\\/])(forgelocal\.(json|config)|\.forgelocal)([\\/]|$)/i.test(a))) {
    return { level: Danger.BLOCKED, reason: "changes ForgeLocal's own permission configuration" };
  }

  // Destructive recursive deletion.
  if (exe === "rm" && lower.some((a) => /^-{1,2}[a-z]*r/.test(a) || a === "--recursive")) {
    return { level: Danger.CONFIRM, reason: "deletes a directory tree" };
  }
  if (["rd", "rmdir"].includes(exe) && lower.some((a) => a === "/s" || a === "-recurse")) {
    return { level: Danger.CONFIRM, reason: "deletes a directory tree" };
  }
  if (/remove-item/.test(line) && /-recurse/.test(line)) {
    return { level: Danger.CONFIRM, reason: "deletes a directory tree" };
  }

  // Destructive or outward-facing git.
  if (exe === "git") {
    const sub = lower[0] ?? "";
    if (sub === "push") {
      const forced = lower.some((a) => a === "-f" || a === "--force" || a.startsWith("--force-with-lease"));
      return {
        level: Danger.CONFIRM,
        reason: forced ? "force-pushes to a remote" : "publishes commits to a remote",
      };
    }
    if (sub === "reset" && lower.includes("--hard")) {
      return { level: Danger.CONFIRM, reason: "discards local changes" };
    }
    if (sub === "clean" && lower.some((a) => /^-{1,2}[a-z]*[fdx]/.test(a))) {
      return { level: Danger.CONFIRM, reason: "deletes untracked files" };
    }
    if (["filter-branch", "gc"].includes(sub) || (sub === "branch" && lower.includes("-d"))) {
      return { level: Danger.CONFIRM, reason: "rewrites or discards history" };
    }
  }

  // Publishing, deploying, external side effects.
  if (exe === "npm" && ["publish", "deploy", "unpublish"].includes(lower[0] ?? "")) {
    return { level: Danger.CONFIRM, reason: `npm ${lower[0]} has effects outside this machine` };
  }
  if (["vercel", "netlify", "gh", "docker", "kubectl", "aws", "az", "gcloud", "terraform", "heroku", "fly"].includes(exe)) {
    return { level: Danger.CONFIRM, reason: `${exe} can act on remote infrastructure` };
  }
  if (exe === "pip" && lower[0] === "upload") {
    return { level: Danger.CONFIRM, reason: "publishes a package" };
  }

  // Network fetch, and running what was fetched.
  if (["curl", "wget", "iwr", "invoke-webrequest", "scp", "rsync", "ftp"].includes(exe)) {
    return { level: Danger.CONFIRM, reason: "transfers data over the network" };
  }
  if (/(invoke-webrequest|invoke-restmethod|curl|wget)/.test(line) && /(iex|invoke-expression|\|\s*(ba)?sh)/.test(line)) {
    return { level: Danger.BLOCKED, reason: "downloads and executes code in one step" };
  }

  // A shell invoked with an inline script re-opens everything above, because
  // the argv the classifier can see stops being the command that runs.
  if (["powershell", "pwsh", "cmd", "sh", "bash", "zsh", "wsl"].includes(exe)) {
    const inline = lower.some((a) =>
      ["-c", "/c", "-command", "-encodedcommand", "-e", "-ec", "/k"].includes(a));
    if (inline) {
      return {
        level: Danger.CONFIRM,
        reason: "runs an inline shell script, which this policy cannot inspect",
      };
    }
  }

  return { level: Danger.ORDINARY, reason: "" };
}

/** @param {string} p */
function basename(p) {
  const s = String(p).replace(/[\\/]+$/, "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  const name = i === -1 ? s : s.slice(i + 1);
  return name.replace(/\.(exe|cmd|bat|ps1)$/i, "");
}
