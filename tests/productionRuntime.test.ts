import { describe, expect, it, vi } from "vitest";
import { createScannerServer } from "../server/api";
import { apiAllowedOrigins, providerEnvironment, runtimeConfiguration } from "../server/runtime";

const env = { NODE_ENV: "production", PORT: "8080", FIREBASE_PROJECT_ID: "kingdomhaus-deal-scanner",
  FIREBASE_FOUNDER_UID: "synthetic-founder", APP_ORIGIN: "https://synthetic-app.web.app" };

describe("production runtime safety", () => {
  it("binds hosted production to PORT on all interfaces while retaining loopback development", () => {
    expect(runtimeConfiguration(env)).toEqual({ host: "0.0.0.0", port: 8080 });
    expect(runtimeConfiguration({})).toEqual({ host: "127.0.0.1", port: 8787 });
  });
  it.each([{ PORT: "0" }, { PORT: "8080oops" }, { FIREBASE_PROJECT_ID: "other-project" },
    { FIREBASE_FOUNDER_UID: "" }, { FIREBASE_FOUNDER_UID: "FOUNDER_UID_NOT_CONFIGURED" },
    { FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }, { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }])("fails closed for invalid hosted configuration %j", override => {
    expect(() => runtimeConfiguration({ ...env, ...override })).toThrow();
  });
  it("strips paid-provider credentials even when supplied accidentally; development is unchanged", () => {
    const source = { ...env, OPENAI_API_KEY: "synthetic-key", APIFY_API_TOKEN: "synthetic-token", APIFY_MAX_RUNS_PER_PROCESS: "1" };
    expect(providerEnvironment(source).OPENAI_API_KEY).toBeUndefined();
    expect(providerEnvironment(source).APIFY_API_TOKEN).toBeUndefined();
    expect(source.OPENAI_API_KEY).toBe("synthetic-key");
    expect(providerEnvironment({ OPENAI_API_KEY: "synthetic-key" }).OPENAI_API_KEY).toBe("synthetic-key");
  });
  it.each([undefined, "https://app.web.app/", "https://app.web.app/path", "http://app.web.app", "https://user:pass@app.web.app", "https://app.web.app:443", "https://localhost"])("requires one exact production HTTPS origin (%s)", origin => {
    expect(() => apiAllowedOrigins({ ...env, APP_ORIGIN: origin })).toThrow();
  });
  it("allows only the configured hosted origin and preserves development origins", () => {
    expect([...apiAllowedOrigins(env)]).toEqual([env.APP_ORIGIN]);
    expect(apiAllowedOrigins({}).has("http://localhost:5176")).toBe(true);
  });
  it("serves authenticated hosted API JSON with paid credentials suppressed and no outbound calls", async () => {
    const provider = vi.fn(() => { throw new Error("Provider calls forbidden"); });
    const server = createScannerServer({ env: { ...env, OPENAI_API_KEY: "synthetic-key", APIFY_API_TOKEN: "synthetic-token",
      APIFY_MAX_CHARGE_USD: "1", APIFY_MAX_RUNS_PER_PROCESS: "1" }, providerFetch: provider,
      verifyToken: async token => {
        if (token === "founder") return { uid: "synthetic-founder" };
        if (token === "pilot") return { uid: "synthetic-pilot", kingdomhausPilot: true };
        if (token === "string-claim") return { uid: "synthetic-pilot", kingdomhausPilot: "true" };
        throw { code: "auth/invalid-id-token" };
      } });
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No test listener");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      for (const [token, status] of [["founder", 200], ["pilot", 200], ["string-claim", 403], ["invalid", 401], ["", 401]] as const) {
        const response = await fetch(base + "/api/retrieval-config", { headers: { Origin: env.APP_ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
        expect(response.status).toBe(status); expect(response.headers.get("content-type")).toContain("application/json");
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("access-control-allow-origin")).toBe(env.APP_ORIGIN);
        if (status === 200) expect((await response.json()).enabled).toBe(false);
      }
      const poll = await fetch(base + "/api/listing-retrieval/00000000-0000-0000-0000-000000000000", { headers: { Authorization: "Bearer pilot" } });
      expect(poll.status).toBe(403); expect(provider).not.toHaveBeenCalled();
    } finally { await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }); }
  });
});
