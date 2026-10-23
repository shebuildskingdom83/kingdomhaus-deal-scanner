import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { createScannerServer } from "../server/api";
import { createProductionPreview } from "../scripts/previewProduction";

const root = path.resolve("dist/hosting");
let api: Server, preview: Server, base: string;
const port = (server: Server) => { const a = server.address(); if (!a || typeof a === "string") throw new Error("Missing listener"); return a.port; };
beforeAll(async () => {
  api = createScannerServer({ env: { FIREBASE_FOUNDER_UID: "synthetic-founder" }, verifyToken: async token => {
    if (token === "founder") return { uid: "synthetic-founder" };
    if (token === "pilot") return { uid: "synthetic-pilot", kingdomhausPilot: true };
    if (token === "unapproved") return { uid: "synthetic-unapproved" };
    throw { code: "auth/invalid-id-token" };
  } });
  await new Promise<void>(done => api.listen(0, "127.0.0.1", done));
  preview = createProductionPreview(root, `http://127.0.0.1:${port(api)}`);
  await new Promise<void>(done => preview.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${port(preview)}`;
});
afterAll(async () => {
  await Promise.all([preview, api].filter(Boolean).map(server => new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); })));
});

describe("packaged production application over HTTP", () => {
  it("serves the approved landing with the bundled authentication dependency before launch controls", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("See Beyond"); expect(html).not.toContain("/src/");
    expect(html).toContain("https://apis.google.com"); expect(html).toContain("frame-src 'self'");
    expect(html.match(/class="[^"]*launch-control/g)).toHaveLength(4);
    const launch = await (await fetch(base + "/__kingdomhaus/assets/analyzer-launch.js")).text();
    expect(launch).toMatch(/^import "\/assets\/landingAuth-[^"\s]+\.js";/);
    expect(launch).toContain('new URL("/cloud", landingOrigin).href');
    const dependency = launch.match(/^import "([^"]+)"/)![1];
    expect((await fetch(base + dependency)).headers.get("content-type")).toContain("javascript");
  });
  it.each(["/cloud", "/cloud/", "/cloud/deep/route"])("routes %s to the actual workspace entry with absolute assets", async route => {
    const response = await fetch(base + route), html = await response.text();
    expect(response.status).toBe(200); expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain("See Beyond"); expect(html).not.toContain("/src/");
    const scripts = [...html.matchAll(/(?:src|href)="(\/assets\/[^"\s]+)"/g)].map(match => match[1]);
    expect(scripts.length).toBeGreaterThan(1);
    for (const asset of scripts) { const r = await fetch(base + asset); expect(r.status, asset).toBe(200); expect(r.headers.get("content-type")).not.toContain("text/html"); }
    const js = await (await fetch(base + scripts.find(asset => asset.endsWith(".js"))!)).text();
    expect(js).toContain("CloudApp");
  });
  it("keeps landing images, CSS, dynamic preview photos and their original modules accessible", async () => {
    for (const asset of ["styles.css", "brand/favicon.png", "brand/kingdomhaus-logo-240.webp", "photos/painting-wide-480.webp", "app.js", "preview-data.js", "cashflow.js"]) {
      const response = await fetch(base + "/__kingdomhaus/assets/" + asset);
      expect(response.status, asset).toBe(200); expect(response.headers.get("content-type")).not.toContain("text/html");
    }
    const app = await (await fetch(base + "/__kingdomhaus/assets/app.js")).text();
    expect(app).toContain("/__kingdomhaus/assets/${deal.photo}");
    expect((await fetch(base + "/__kingdomhaus/assets/missing.js")).status).toBe(404);
    expect((await fetch(base + "/%2e%2e%5c.env")).status).toBe(404);
  });
  it("proxies API before the frontend fallback and returns authenticated JSON, never landing HTML", async () => {
    for (const [token, status] of [["founder", 200], ["pilot", 200], ["unapproved", 403], ["invalid", 401], ["", 401]] as const) {
      const response = await fetch(base + "/api/retrieval-config", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      expect(response.status).toBe(status); expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("cache-control")).toBe("no-store"); expect(await response.text()).not.toContain("<!doctype");
    }
    const unknown = await fetch(base + "/api/nonexistent", { headers: { Authorization: "Bearer founder" } });
    expect(unknown.status).toBe(404); expect(unknown.headers.get("content-type")).toContain("application/json");
  });
  it("has Hosting API rewrites before workspace fallback and isolates rules from hosting configuration", async () => {
    const config = JSON.parse(await readFile("firebase.hosting.json", "utf8"));
    expect(config.firestore).toBeUndefined(); expect(config.hosting.public).toBe("dist/hosting");
    expect(config.hosting.rewrites.map((entry: {source: string}) => entry.source)).toEqual(["/api", "/api/**", "**"]);
    expect(config.hosting.rewrites[1].run.pinTag).toBe(true);
    expect(config.hosting.rewrites[2].destination).toBe("/workspace.html");
  });
  it("returns JSON 502 when the local preview backend is unavailable, without SPA fallback", async () => {
    const reservation = createServer(); await new Promise<void>(done => reservation.listen(0, "127.0.0.1", done));
    const closedPort = port(reservation); await new Promise<void>(done => reservation.close(() => done()));
    const isolated = createProductionPreview(root, `http://127.0.0.1:${closedPort}`);
    await new Promise<void>(done => isolated.listen(0, "127.0.0.1", done));
    try { const r = await fetch(`http://127.0.0.1:${port(isolated)}/api/health`); expect(r.status).toBe(502); expect(r.headers.get("content-type")).toContain("application/json"); }
    finally { await new Promise<void>(done => { isolated.close(() => done()); isolated.closeAllConnections(); }); }
  });
});

describe("compiled backend entrypoint", () => {
  it("starts without local credential files, binds PORT, and returns JSON 401 before token verification", async () => {
    const reservation = createServer(); await new Promise<void>(done => reservation.listen(0, "127.0.0.1", done));
    const selected = port(reservation); await new Promise<void>(done => reservation.close(() => done()));
    const child: ChildProcess = spawn(process.execPath, [path.resolve("build/server/index.js")], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: "production", PORT: String(selected),
        FIREBASE_PROJECT_ID: "kingdomhaus-deal-scanner", FIREBASE_FOUNDER_UID: "synthetic-founder", APP_ORIGIN: "https://synthetic-app.web.app" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Compiled startup timeout")), 10000);
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("exit", () => { clearTimeout(timer); reject(new Error("Compiled backend exited before readiness")); });
        child.stdout!.once("data", data => { clearTimeout(timer); expect(String(data)).toContain(`0.0.0.0:${selected}`); resolve(); });
      });
      const response = await fetch(`http://127.0.0.1:${selected}/api/retrieval-config`);
      expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await (await fetch(`http://127.0.0.1:${selected}/api/health`)).json()).toEqual({ ok: true });
    } finally { if (child.exitCode === null) { child.kill(); await once(child, "exit"); } }
  });
});
