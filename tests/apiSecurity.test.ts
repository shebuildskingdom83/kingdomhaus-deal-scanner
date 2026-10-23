import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "node:http";
import type { Server } from "node:http";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";
import { createScannerServer } from "../server/api";
import { authorize, readJson, UsageGuard, requireFounderPaidAccess } from "../server/apiSecurity";
import { ApifyListingService } from "../server/apify";
import { resolvePublicUrl } from "../server/publicListingTransport";

const founder = "synthetic-founder";
const listing = { listingText: "Synthetic acquisition listing with sufficient fictional business details for testing." };
const services: Server[] = [];
const provider = vi.fn<typeof fetch>();
const publicFetch = vi.fn<typeof fetch>();
const verify = vi.fn(async (token: string) => {
  if (token === "founder-token") return { uid: founder };
  if (token === "nonfounder-token") return { uid: "synthetic-other" };
  if (token === "pilot-token") return { uid: "synthetic-pilot", kingdomhausPilot: true };
  if (token === "truthy-claim-token") return { uid: "synthetic-pilot", kingdomhausPilot: "true" };
  throw { code: token === "outage" ? "auth/internal-error" : token === "wrong-project" ? "auth/argument-error" : `auth/${token}` };
});
async function start(env: Record<string, string | undefined> = {}) {
  const server = createScannerServer({ env: { FIREBASE_FOUNDER_UID: founder, ...env }, verifyToken: verify, providerFetch: provider, publicFetch });
  services.push(server); await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  return async (path: string, body?: string, token: string | null = "founder-token", method = body === undefined ? "GET" : "POST") => {
    const address = server.address(); if (!address || typeof address === "string") throw Error("No test server");
    return new Promise<{ status: number; data: any; headers: Record<string, unknown> }>((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port: address.port, path, method,
        headers: { "Content-Type": "application/json", Origin: "http://localhost:5176", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, res => {
        let text = ""; res.on("data", chunk => { text += chunk; }); res.on("end", () => resolve({ status: res.statusCode!, data: JSON.parse(text), headers: res.headers }));
      });
      req.on("error", reject); req.end(body);
    });
  };
}
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("Outbound fetch forbidden"); }));
  verify.mockClear(); provider.mockReset(); publicFetch.mockReset();
});
afterEach(async () => {
  await Promise.all(services.splice(0).map(server => new Promise<void>((done, reject) => { server.close(error => error ? reject(error) : done()); server.closeAllConnections(); })));
  vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("founder-only API with injected verification and zero live providers", () => {
  it("keeps health minimal and protects provider configuration", async () => {
    const send = await start();
    expect((await send("/api/health", undefined, null)).data).toEqual({ ok: true });
    expect(verify).not.toHaveBeenCalled();
    expect((await send("/api/retrieval-config", undefined, null)).status).toBe(401);
  });
  it("allows verified founder deterministic scans and the unified 5176 origin", async () => {
    const send = await start(); const response = await send("/api/scan", JSON.stringify(listing));
    expect(response.status).toBe(200); expect(response.data.ok).toBe(true);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5176");
    expect(provider).not.toHaveBeenCalled();
  });
  it.each([
    [null, 401], ["invalid-id-token", 401], ["id-token-expired", 401], ["id-token-revoked", 401],
    ["user-disabled", 401], ["wrong-project", 401], ["nonfounder-token", 403], ["outage", 503]
  ])("rejects %s with %s before invoking any provider", async (token, status) => {
    const send = await start({ OPENAI_API_KEY: "fictional", OPENAI_MAX_REQUESTS_PER_PROCESS: "2", OPENAI_MAX_OUTPUT_TOKENS: "900" });
    for (const path of ["/api/scan", "/api/fetch-listing", "/api/retrieval-config", "/api/listing-retrieval/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]) {
      expect((await send(path, path.includes("scan") || path.includes("fetch-listing") ? JSON.stringify(listing) : undefined, token)).status).toBe(status);
    }
    expect(provider).not.toHaveBeenCalled(); expect(publicFetch).not.toHaveBeenCalled();
  });
  it("fails closed with missing founder configuration", async () => {
    const send = await start({ FIREBASE_FOUNDER_UID: undefined });
    expect((await send("/api/scan", JSON.stringify(listing))).status).toBe(503);
    expect(verify).not.toHaveBeenCalled(); expect(provider).not.toHaveBeenCalled();
  });
  it.each(["/api/scan", "/api/fetch-listing"])("returns predictable JSON 400/413 for %s", async path => {
    const send = await start();
    expect((await send(path, "{")).status).toBe(400);
    expect((await send(path, JSON.stringify({ listingText: "é".repeat(51000) }))).status).toBe(413);
    expect(provider).not.toHaveBeenCalled(); expect(publicFetch).not.toHaveBeenCalled();
  });
  it("denies paid extraction until both approved usage and output limits exist", async () => {
    for (const limits of [{}, { OPENAI_MAX_REQUESTS_PER_PROCESS: "2" }, { OPENAI_MAX_OUTPUT_TOKENS: "900" }]) {
      const send = await start({ OPENAI_API_KEY: "fictional", ...limits });
      expect((await send("/api/scan", JSON.stringify(listing))).status).toBe(503);
    }
    expect(provider).not.toHaveBeenCalled();
  });
  it("deduplicates extraction, caps output and enforces the approved process quota", async () => {
    provider.mockResolvedValue(new Response(JSON.stringify({ output_text: "{}" })));
    const send = await start({ OPENAI_API_KEY: "fictional", OPENAI_MAX_REQUESTS_PER_PROCESS: "1", OPENAI_MAX_OUTPUT_TOKENS: "900" });
    const responses = await Promise.all([send("/api/scan", JSON.stringify(listing)), send("/api/scan", JSON.stringify(listing))]);
    expect(responses.map(item => item.status)).toEqual([200, 200]); expect(provider).toHaveBeenCalledTimes(1);
    const init = provider.mock.calls[0][1]!;
    expect(JSON.parse(String(init.body)).max_output_tokens).toBe(900);
    expect(init.signal).toBeInstanceOf(AbortSignal); expect(init.redirect).toBe("error");
    expect((await send("/api/scan", JSON.stringify({ ...listing, businessName: "Another fictional request" }))).status).toBe(429);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it.each(["http", "network"])("sanitizes %s provider failures and never retries uncertain extraction", async kind => {
    if (kind === "http") provider.mockResolvedValue(new Response("sensitive-provider-secret", { status: 500 }));
    else provider.mockRejectedValue(Error("sensitive-provider-secret"));
    const send = await start({ OPENAI_API_KEY: "fictional", OPENAI_MAX_REQUESTS_PER_PROCESS: "2", OPENAI_MAX_OUTPUT_TOKENS: "900" });
    for (let i = 0; i < 2; i++) {
      const response = await send("/api/scan", JSON.stringify(listing));
      expect(response.status).toBe(502); expect(JSON.stringify(response.data)).not.toContain("sensitive-provider-secret");
    }
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("permits approved Apify requests from 5176 after verified authentication", async () => {
    provider.mockResolvedValue(new Response(JSON.stringify({ data: { id: "syntheticRun" } })));
    const send = await start({ APIFY_API_TOKEN: "fictional", APIFY_MAX_CHARGE_USD: "0.1", APIFY_MAX_RUNS_PER_PROCESS: "1" });
    const body = JSON.stringify({ url: "https://www.bizbuysell.com/business-opportunity/synthetic/1234567/", paidScanConfirmed: true, requestId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    const result = await send("/api/fetch-listing", body);
    expect(result.status).toBe(200); expect(result.data.status).toBe("running");
    expect((await send(`/api/listing-retrieval/${result.data.jobId}`, undefined, "nonfounder-token")).status).toBe(403);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("revalidates redirected public URLs and blocks internal destinations", async () => {
    publicFetch.mockImplementation(async (url) => {
      await resolvePublicUrl(String(url), async () => [{ address: String(url).includes("internal") ? "127.0.0.1" : "93.184.216.34", family: 4 }]);
      return new Response(null, { status: 302, headers: { Location: "https://internal.test/listing" } });
    });
    const send = await start(); const result = await send("/api/fetch-listing", JSON.stringify({ url: "https://public.test/listing" }));
    expect(result.status).toBe(400); expect(publicFetch).toHaveBeenCalledTimes(2); expect(provider).not.toHaveBeenCalled();
  });
});

describe("controlled pilot admission with founder-only paid capabilities", () => {
  it("accepts only a boolean admission claim from the verified identity", async () => {
    expect(await authorize("Bearer pilot-token", founder, verify)).toBe("synthetic-pilot");
    expect(await authorize("Bearer founder-token", founder, verify)).toBe(founder);
    await expect(authorize("Bearer truthy-claim-token", founder, verify)).rejects.toMatchObject({ status: 403 });
    await expect(authorize("Bearer nonfounder-token", founder, verify)).rejects.toMatchObject({ status: 403 });
    expect(() => requireFounderPaidAccess("synthetic-pilot", founder)).toThrow(/founder only/);
    expect(() => requireFounderPaidAccess(founder, founder)).not.toThrow();
  });
  it("rejects malformed verified identity results even with a pilot admission claim", async () => {
    for (const uid of [undefined, "", "bad/uid", 123]) {
      await expect(authorize("Bearer fictional", founder, async () => ({ uid, kingdomhausPilot: true }) as any)).rejects.toMatchObject({ status: 401 });
    }
  });
  it("admits a pilot to nonchargeable config and deterministic scans without exposing paid capability", async () => {
    const send = await start({ APIFY_API_TOKEN: "fictional", APIFY_MAX_CHARGE_USD: "0.1", APIFY_MAX_RUNS_PER_PROCESS: "1" });
    expect((await send("/api/retrieval-config", undefined, "pilot-token")).data).toMatchObject({ enabled: false, maxChargeUsd: null });
    const result = await send("/api/scan", JSON.stringify(listing), "pilot-token");
    expect(result.status).toBe(200); expect(result.data.ok).toBe(true);
    expect(provider).not.toHaveBeenCalled();
  });
  it("rejects pilot OpenAI extraction, Apify launch, polling and reconciliation before provider calls", async () => {
    const send = await start({ OPENAI_API_KEY: "fictional", OPENAI_MAX_REQUESTS_PER_PROCESS: "1", OPENAI_MAX_OUTPUT_TOKENS: "900",
      APIFY_API_TOKEN: "fictional", APIFY_MAX_CHARGE_USD: "0.1", APIFY_MAX_RUNS_PER_PROCESS: "1" });
    const job = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    for (const [path, body] of [
      ["/api/scan", listing],
      ["/api/scan", { ...listing, retrievalId: job }],
      ["/api/fetch-listing", { url: "https://www.bizbuysell.com/business-opportunity/synthetic/1234567/", paidScanConfirmed: true, requestId: job, uid: founder }],
      ["/api/listing-retrieval/" + job, undefined]
    ] as const) expect((await send(path, body ? JSON.stringify(body) : undefined, "pilot-token")).status).toBe(403);
    expect(provider).not.toHaveBeenCalled(); expect(publicFetch).not.toHaveBeenCalled();
  });
  it("cannot grant admission or founder status using body, URL or header token text", async () => {
    const send = await start({ OPENAI_API_KEY: "fictional", OPENAI_MAX_REQUESTS_PER_PROCESS: "1", OPENAI_MAX_OUTPUT_TOKENS: "900" });
    const body = JSON.stringify({ ...listing, uid: founder, ownerUid: founder, kingdomhausPilot: true });
    expect((await send("/api/scan", body, "nonfounder-token")).status).toBe(403);
    expect((await send("/api/scan?uid=" + founder, body, "nonfounder-token")).status).toBe(403);
    expect((await send("/api/scan", body, "pilot-token")).status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });
});

describe("bounded verification, bodies and usage", () => {
  it("handles disconnect errors after rejecting an oversized upload", async () => {
    const stream = new PassThrough();
    const result = readJson(stream as unknown as IncomingMessage, 2);
    const assertion = expect(result).rejects.toMatchObject({ status: 413 });
    stream.write(Buffer.from("oversized"));
    expect(() => stream.emit("error", Error("synthetic disconnect"))).not.toThrow();
    await assertion; stream.destroy();
  });
  it("times out an unavailable verifier without granting access", async () => {
    vi.useFakeTimers();
    const result = authorize("Bearer fictional", founder, () => new Promise(() => {}));
    const assertion = expect(result).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(8000); await assertion;
  });
  it("returns 408 for stalled body uploads", async () => {
    vi.useFakeTimers(); const stream = new PassThrough();
    const result = readJson(stream as unknown as IncomingMessage, 100, 1000);
    const assertion = expect(result).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(1000); await assertion;
  });
  it("enforces concurrency, rate and configured usage without resetting usage each minute", () => {
    let now = 100000; const guard = new UsageGuard(3, 1, 2, () => now);
    const release = guard.acquire(); expect(() => guard.acquire()).toThrow(/active/);
    release(); release(); guard.acquire()(); expect(() => guard.acquire()).toThrow(/limit/);
    now += 60000; guard.acquire()(); expect(() => guard.acquire()).toThrow(/limit/);
  });
  it("never defaults a paid limit into existence", () => { expect(() => new UsageGuard(null).acquire()).toThrow(/approved/); });
});

describe("owner-scoped provider jobs", () => {
  it("isolates job access and both forms of deduplication", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ data: { id: "syntheticRun" } })));
    const service = new ApifyListingService({ token: "fictional", maxChargeUsd: "0.1", maxRuns: "3" }, transport);
    const input = { url: "https://www.bizbuysell.com/business-opportunity/synthetic/1234567/", paidScanConfirmed: true, requestId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
    const a = await service.start(input, "fictional-A");
    const b = await service.start(input, "fictional-B");
    expect(a).not.toEqual(b); expect(transport).toHaveBeenCalledTimes(2);
    expect(await service.start({ ...input, requestId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }, "fictional-A")).toEqual(a);
    expect(transport).toHaveBeenCalledTimes(2);
    await expect(service.start({ ...input, url: "https://www.bizbuysell.com/business-opportunity/another/1234568/", requestId: "cccccccc-cccc-cccc-cccc-cccccccccccc" }, "fictional-A")).rejects.toMatchObject({ status: 429 });
    if (!a.ok || !("status" in a)) throw Error("Expected fixture job");
    await expect(service.status(a.jobId, "fictional-B")).rejects.toMatchObject({ status: 404 });
    expect(() => service.reconcile(a.jobId, listing, "fictional-B")).toThrow(/not found/);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("requires explicit monetary and usage configuration before launch", async () => {
    const transport = vi.fn<typeof fetch>();
    for (const config of [{ token: "fictional" }, { token: "fictional", maxChargeUsd: "0.1" }, { token: "fictional", maxRuns: "1" }]) {
      const service = new ApifyListingService(config, transport); expect(service.enabled).toBe(false);
      expect((await service.start({}, founder)).ok).toBe(false);
    }
    expect(transport).not.toHaveBeenCalled();
  });
});
