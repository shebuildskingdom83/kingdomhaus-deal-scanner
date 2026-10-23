import { createServer, request } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };

/** Loopback-only QA server matching Hosting's API-first routing; never a production runtime. */
export function createProductionPreview(directory: string, apiOrigin = "http://127.0.0.1:8787") {
  const backend = new URL(apiOrigin);
  if (backend.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(backend.hostname) ||
      backend.origin !== apiOrigin || backend.username || backend.password) throw new Error("Preview backend must be a loopback HTTP origin.");
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const pathname = (req.url ?? "/").split("?")[0];
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      const upstream = request(new URL(req.url!, backend), { method: req.method, headers: req.headers }, response => {
        res.writeHead(response.statusCode ?? 502, { ...response.headers, "cache-control": "no-store" }); response.pipe(res);
      });
      upstream.setTimeout(55_000, () => upstream.destroy());
      upstream.on("error", () => { if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "Local preview API is unavailable." })); });
      req.on("aborted", () => upstream.destroy());
      res.on("close", () => { if (!res.writableFinished) upstream.destroy(); });
      req.pipe(upstream); return;
    }
    if (!["GET", "HEAD"].includes(req.method ?? "")) { res.writeHead(405).end(); return; }
    try {
      const root = await realpath(directory);
      const decoded = decodeURIComponent(pathname);
      if (decoded.includes("\\") || decoded.includes("\0") || decoded.split("/").some(part => part === ".." || part.startsWith("."))) throw new Error("Invalid path");
      const relative = decoded === "/" ? "index.html" : decoded.slice(1);
      let target = path.resolve(root, relative);
      if (!target.startsWith(root + path.sep)) throw new Error("Outside build");
      const exists = await stat(target).then(value => value.isFile(), () => false);
      if (!exists) {
        if (path.extname(decoded) || decoded.startsWith("/assets/") || decoded.startsWith("/__kingdomhaus/")) throw new Error("Missing asset");
        target = path.join(root, "workspace.html");
      }
      const canonical = await realpath(target);
      if (!canonical.startsWith(root + path.sep)) throw new Error("Outside build");
      const type = mime[path.extname(canonical)];
      if (!type) throw new Error("Unsupported file");
      const data = await readFile(canonical);
      res.writeHead(200, { "Content-Type": type }); res.end(req.method === "HEAD" ? undefined : data);
    } catch { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found"); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createProductionPreview(path.resolve("dist/hosting")).listen(4176, "127.0.0.1", () => console.log("Production QA preview: http://127.0.0.1:4176 (API must run separately on 8787)."));
}
