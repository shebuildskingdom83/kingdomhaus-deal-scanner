import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { homepageAuthPolicy, landingPrefix, landingSource, unifiedWebsite } from "../scripts/unifiedWebsite";

let server: ViteDevServer;
let origin: string;
beforeAll(async () => {
  server = await createServer({ configFile: false, cacheDir: ".cloud-test-artifacts/unified/vite-cache-middleware", plugins: [unifiedWebsite()],
    optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { host: "127.0.0.1", port: 5182, strictPort: true } });
  await server.listen();
  const address = server.httpServer!.address() as { port: number };
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await server?.close(); });

describe("development-only unified entrance", () => {
  it("serves the current approved homepage and its scoped CSP without Vite injection", async () => {
    const response = await fetch(origin + "/");
    const html = await response.text();
    const policy = homepageAuthPolicy(server.config.env.VITE_FIREBASE_AUTH_DOMAIN);
    expect(html).toBe((await readFile(path.join(landingSource, "index.html"), "utf8")).replace(/\bassets\//g, landingPrefix + "assets/")
      .replace("script-src 'self'", policy.script).replace("connect-src 'none'", policy.connect)
      .replace("form-action 'none'", `${policy.frame}; form-action 'none'`));
    expect(html).toContain("Content-Security-Policy");
    expect(html.match(/class="[^"]*launch-control/g)).toHaveLength(4);
    expect(html).not.toContain("/@vite/client");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await (await fetch(origin + "/index.html")).text()).toBe(html);
  });
  it("leaves cloud authentication entry and API proxy routing to the scanner", async () => {
    const response = await fetch(origin + "/cloud");
    const html = await response.text();
    expect(html).toContain("/src/main.tsx");
    expect(html).not.toContain("Content-Security-Policy");
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect((await fetch(origin + "/api/route-check", { headers: { Accept: "application/json" } })).status).toBe(404);
    const config = await readFile("vite.config.ts", "utf8");
    expect(config).toContain('"/api": "http://127.0.0.1:8787"');
    expect(unifiedWebsite().apply).toBe("serve");
  });
  it("reuses local destination configuration with this origin and namespaces dynamic photos", async () => {
    const module = await (await fetch(origin + landingPrefix + "assets/analyzer-destination.js")).text();
    expect(module).toBe(`export const ANALYZER_URL = "${origin}/cloud";\n`);
    const app = await (await fetch(origin + landingPrefix + "assets/app.js")).text();
    expect(app).toContain(landingPrefix + "assets/${deal.photo}");
    const data = await (await fetch(origin + landingPrefix + "assets/preview-data.js")).text();
    expect(data).toContain(landingPrefix + "assets/photos/");
    const launch = await (await fetch(origin + landingPrefix + "assets/analyzer-launch.js")).text();
    expect(launch.startsWith('import "/src/landingAuthEntry.ts";')).toBe(true);
  });
  it("serves assets and HEAD, rejects traversal and never falls back to scanner HTML for missing assets", async () => {
    const css = await fetch(origin + landingPrefix + "assets/styles.css");
    expect(css.headers.get("content-type")).toContain("text/css");
    expect((await css.text()).length).toBeGreaterThan(1000);
    const head = await fetch(origin + landingPrefix + "assets/brand/favicon.png", { method: "HEAD" });
    expect(head.status).toBe(200); expect(await head.text()).toBe("");
    for (const relative of ["assets/missing.js", "%2e%2e%5cpackage.json", "%2Fetc%2Fpasswd", "%ZZ", "index.html", "%2e%2e%2f.openai/analyzer-launch.json"]) {
      const response = await fetch(origin + landingPrefix + relative);
      expect(response.status, relative).toBe(404);
    }
    expect((await fetch(origin + "/", { method: "POST" })).status).toBe(405);
  });
});

describe("homepage-only authentication CSP", () => {
  it("permits exact authentication endpoints without arbitrary origins or unsafe scripts", () => {
    const policy = homepageAuthPolicy("synthetic-project.firebaseapp.com");
    expect(policy.frame).toBe("frame-src 'self' https://synthetic-project.firebaseapp.com");
    expect(policy.connect).toContain("https://identitytoolkit.googleapis.com");
    expect(policy.connect).toContain("https://securetoken.googleapis.com");
    expect(policy.script).toBe("script-src 'self' https://apis.google.com");
    expect(JSON.stringify(policy)).not.toMatch(/unsafe-eval|\*|127\.0\.0\.1/);
  });
  it.each([undefined, 'evil.test; script-src *', 'https://evil.test', 'evil.test:443', 'evil..test'])("rejects malformed auth hostnames (%s)", domain => {
    expect(homepageAuthPolicy(domain).frame).toBe("frame-src 'self'");
  });
  it("allows the local auth emulator only in the synthetic emulator mode", () => {
    expect(homepageAuthPolicy(undefined, true).connect).toContain("http://127.0.0.1:9099");
    expect(homepageAuthPolicy(undefined).connect).not.toContain("9099");
  });
});
