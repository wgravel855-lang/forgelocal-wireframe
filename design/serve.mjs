// Minimal static server so the generated site can be checked over http.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const PORT = Number(process.env.FORGELOCAL_PORT) || 4315;
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json" };

/**
 * The policy the desktop window enforces, read from the Tauri config so the
 * two cannot drift. Sent only when FORGELOCAL_CSP is set: the hosted
 * prototype is served by Vercel and has its own headers.
 */
const desktopCsp = () => {
  if (!process.env.FORGELOCAL_CSP) return null;
  const conf = join(dirname(fileURLToPath(import.meta.url)), "..", "desktop", "src-tauri", "tauri.conf.json");
  try {
    const csp = JSON.parse(readFileSync(conf, "utf8"))?.app?.security?.csp;
    if (typeof csp === "string" && csp) { console.log("enforcing the desktop CSP"); return csp; }
    console.log("the desktop config sets no CSP; nothing to enforce");
  } catch (err) {
    console.log(`could not read the desktop CSP: ${err.message}`);
  }
  return null;
};
const CSP = desktopCsp();

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const rel = p.split("/").filter((seg) => seg && seg !== "." && seg !== "..").join("/");
  const file = normalize(join(root, rel));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  let body;
  try { body = await readFile(file); }
  catch { res.writeHead(404, { "content-type": "text/plain" }).end("not found"); return; }
  const headers = { "content-type": types[extname(file)] ?? "application/octet-stream" };
  if (CSP) headers["content-security-policy"] = CSP;
  res.writeHead(200, headers);
  res.end(body);
}).listen(PORT, () => console.log(`serving on http://localhost:${PORT}`));
