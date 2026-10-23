import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

export const landingSource = path.resolve(process.cwd(), "website/landing");
export const landingPrefix = "/__kingdomhaus/";
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".webp": "image/webp", ".png": "image/png",
  ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8"
};

export function homepageAuthPolicy(authDomain: string | undefined, emulator = false) {
  // Only a configured bare DNS hostname can become a CSP source, never arbitrary header text.
  const domain = authDomain && authDomain.split(".").length > 1 && authDomain.split(".").every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ? `https://${authDomain}` : "";
  const emulatorSources = emulator ? " http://127.0.0.1:9099 http://localhost:9099" : "";
  return {
    script: "script-src 'self' https://apis.google.com",
    connect: `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com${domain ? " " + domain : ""}${emulatorSources}`,
    frame: `frame-src 'self'${domain ? " " + domain : ""}${emulatorSources}`
  };
}

/** Local composition only. Neither application's sources or build output are rewritten. */
export function unifiedWebsite(source = landingSource): Plugin {
  return {
    name: "kingdomhaus-unified-local-website",
    apply: "serve",
    async configureServer(server) {
      const root = await realpath(source);
      await readFile(path.join(root, "index.html"));
      const policy = homepageAuthPolicy(server.config.env.VITE_FIREBASE_AUTH_DOMAIN, server.config.mode === "cloud-emulator");
      server.middlewares.use(async (request, response, next) => {
        const pathname = (request.url || "/").split("?")[0];
        const home = pathname === "/" || pathname === "/index.html";
        if (!home && !pathname.startsWith(landingPrefix)) return next();
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405, { Allow: "GET, HEAD" }).end(); return;
        }
        try {
          let data: string | Buffer;
          let extension: string;
          if (pathname === landingPrefix + "assets/analyzer-destination.js") {
            const origin = new URL("http://" + request.headers.host);
            if (!["localhost", "127.0.0.1"].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== "/") {
              response.writeHead(403).end(); return;
            }
            data = `export const ANALYZER_URL = ${JSON.stringify(new URL("/cloud", origin).href)};\n`;
            extension = ".js";
          } else {
            const relative = home ? "index.html" : decodeURIComponent(pathname.slice(landingPrefix.length));
            const target = path.resolve(root, relative);
            if (!target.startsWith(root + path.sep)) throw new Error("Outside landing assets");
            const canonical = await realpath(target);
            if (!canonical.startsWith(root + path.sep) || !(await stat(canonical)).isFile()) throw new Error("Invalid asset");
            extension = path.extname(canonical);
            if (!mime[extension] || (!home && extension === ".html")) throw new Error("Unsupported asset");
            data = await readFile(canonical);
            if ([".html", ".js", ".css"].includes(extension)) {
              // Includes srcset and dynamically selected photos; relative module imports stay intact.
              data = data.toString("utf8").replace(/\bassets\//g, landingPrefix + "assets/");
              if (home) data = data.replace("script-src 'self'", policy.script)
                .replace("connect-src 'none'", policy.connect)
                .replace("form-action 'none'", `${policy.frame}; form-action 'none'`);
              if (pathname === landingPrefix + "assets/analyzer-launch.js") {
                // A static dependency installs the handler before the existing app enables its CTAs.
                data = 'import "/src/landingAuthEntry.ts";\n' + data;
              }
              if (pathname === landingPrefix + "assets/styles.css") {
                data += "\n.landing-auth-feedback{font-size:.875rem;line-height:1.5;margin:.75rem 0 0;max-width:40ch;overflow-wrap:anywhere}.hero .landing-auth-feedback,.closing .landing-auth-feedback{margin-left:auto;margin-right:auto;text-align:center}\n";
              }
            }
          }
          response.writeHead(200, { "Content-Type": mime[extension] });
          response.end(request.method === "HEAD" ? undefined : data);
        } catch {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Landing asset not found");
        }
      });
    }
  };
}
