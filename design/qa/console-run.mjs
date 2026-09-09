// @ts-check
/**
 * Runs the runtime-error gate one route per process.
 *
 * Eight jsdom windows in a single process contaminate each other: the
 * controller registers timers, observers and document listeners, and a
 * straggler from route N reports into route N+1's console. A browser loads one
 * document at a time, so the check should too. Each route gets its own process,
 * which is both faithful and free of that interference.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const ROUTES = [
  "/app/",
  "/app/running/",
  "/app/permission/",
  "/app/review/",
  "/app/models/",
  "/app/models/installed/",
  "/app/models/downloads/",
  "/app/settings/",
  // The landing page now runs controller code of its own (the header hairline,
  // the reveal observer) and embeds a full workspace render, so it belongs in
  // the gate rather than being assumed static.
  "/",
  "/setup/",
  "/setup/model/",
  "/setup/project/",
  "/setup/permissions/",
];

let failed = 0;
for (const route of ROUTES) {
  const res = spawnSync(process.execPath, [join(here, "console-one.mjs"), route], {
    encoding: "utf8",
    stdio: "pipe",
  });
  const out = (res.stdout || "").trim();
  const err = (res.stderr || "").trim();
  if (res.status === 0) {
    console.log(`  ok    ${route}`);
  } else {
    failed++;
    console.log(`  FAIL  ${route}`);
    for (const line of (out + "\n" + err).split("\n").filter(Boolean)) {
      console.log(`          ${line}`);
    }
  }
}

console.log(failed
  ? `console gate: ${failed} of ${ROUTES.length} routes reported errors`
  : `console gate: ${ROUTES.length} routes, no page errors, rejections, console.error or console.warn`);
process.exit(failed ? 1 : 0);
