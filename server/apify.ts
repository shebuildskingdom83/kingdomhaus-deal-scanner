import { randomUUID } from "node:crypto";
import { APIFY_ACTOR_ID, approvedBizBuySellUrl, reconcileApifyListing } from "../src/hybridListing";
import type { ListingRetrieval, ScanRequest, UrlFetchResponse } from "../src/types";

type Ready = Extract<UrlFetchResponse, { listingText: string }>;
type Job = {
  id: string; requestId: string; url: string; runId?: string; response: UrlFetchResponse;
  retrieval?: ListingRetrieval; record?: Record<string, unknown>; pending?: Promise<UrlFetchResponse>; checkedAt: number;
  terminal?: boolean;
  usageUsd?: number | null;
};
type Config = { token?: string; maxChargeUsd?: string; timeoutSecs?: string };
type Fetch = typeof fetch;
const fallback = " You can paste the listing details below and scan manually.";
const asObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const usd = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
class ApifyHttpError extends Error { constructor(readonly status: number) { super(`Apify HTTP ${status}`); } }
function accessReason(error: unknown): string {
  if (!(error instanceof ApifyHttpError)) return "";
  if ([401, 403].includes(error.status)) return "Apify denied access. Check the server token and Actor permissions. ";
  if (error.status === 402) return "Check Apify account credit and required plan access. ";
  if (error.status === 429) return "Apify rate-limited this request. ";
  return `Apify returned HTTP ${error.status}. `;
}

export class ApifyListingService {
  private jobs = new Map<string, Job>();
  private requests = new Map<string, Job>();
  readonly maxChargeUsd: number;
  readonly timeoutSecs: number;
  readonly enabled: boolean;
  constructor(private config: Config, private fetcher: Fetch = fetch) {
    this.maxChargeUsd = Number(config.maxChargeUsd ?? "0.25");
    this.timeoutSecs = Number(config.timeoutSecs ?? "180");
    this.enabled = Boolean(config.token?.trim()) && Number.isFinite(this.maxChargeUsd) && this.maxChargeUsd > 0 && this.maxChargeUsd <= 10 &&
      Number.isInteger(this.timeoutSecs) && this.timeoutSecs >= 30 && this.timeoutSecs <= 600;
  }
  settings() {
    return { enabled: this.enabled, maxChargeUsd: Number.isFinite(this.maxChargeUsd) ? this.maxChargeUsd : null,
      message: this.enabled ? "Apify charges apply to each explicitly confirmed run. Usage may be preliminary until billing settles." : "Apify retrieval is not configured. Paste the listing details to continue." };
  }
  async start(value: unknown): Promise<UrlFetchResponse> {
    const input = asObject(value);
    let url: string;
    try { url = approvedBizBuySellUrl(typeof input.url === "string" ? input.url : ""); }
    catch { return { ok: false, error: "Enter a single HTTPS BizBuySell business-opportunity listing URL." + fallback }; }
    if (!this.enabled) return { ok: false, error: this.settings().message };
    if (input.paidScanConfirmed !== true) return { ok: false, error: "Confirm the Apify usage charge before starting a scan." };
    if (typeof input.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(input.requestId)) return { ok: false, error: "A valid scan request ID is required." };
    const prior = this.requests.get(input.requestId);
    if (prior) return prior.url === url ? prior.pending ?? prior.response : { ok: false, error: "This request ID belongs to a different listing." };
    const active = [...this.jobs.values()].find((job) => job.url === url && !job.terminal);
    if (active) return active.pending ?? active.response;
    if (this.jobs.size >= 100) return { ok: false, error: "The local retrieval session is full. Restart the API after checking that no Apify runs are active." };
    const job: Job = { id: randomUUID(), requestId: input.requestId, url, checkedAt: 0, response: { ok: false, error: "Retrieval has not started." } };
    this.jobs.set(job.id, job); this.requests.set(job.requestId, job);
    // Reserve the request before awaiting the chargeable POST. Never retry this POST.
    job.pending = this.launch(job);
    try { return await job.pending; } finally { job.pending = undefined; }
  }
  private async launch(job: Job): Promise<UrlFetchResponse> {
    try {
      const params = new URLSearchParams({ maxTotalChargeUsd: String(this.maxChargeUsd), maxItems: "1", timeout: String(this.timeoutSecs), restartOnError: "false" });
      const result = asObject(await this.api(`/actors/${APIFY_ACTOR_ID}/runs?${params}`, {
        method: "POST", body: JSON.stringify({ mode: "url", urls: [job.url], fetchDetails: true, maxListings: 1, maxPages: 1, incrementalMode: false, mcpConnectors: [] })
      }));
      const run = asObject(result.data);
      if (typeof run.id !== "string" || !/^[a-zA-Z0-9]+$/.test(run.id)) throw new Error("invalid-run");
      job.runId = run.id;
      job.response = { ok: true, status: "running", jobId: job.id, message: "Apify retrieval started. Waiting for the listing.", usageUsd: usd(run.usageTotalUsd), maxChargeUsd: this.maxChargeUsd };
    } catch (error) {
      if (error instanceof ApifyHttpError && error.status >= 400 && error.status < 500) job.terminal = true;
      job.response = { ok: false, error: accessReason(error) + "Apify could not confirm that retrieval started. Check your Apify runs before starting another paid scan; this request will not be retried." + fallback };
    }
    return job.response;
  }
  async status(id: string): Promise<UrlFetchResponse> {
    const job = this.jobs.get(id);
    if (!job) return { ok: false, error: "Retrieval session not found. Check Apify before starting another paid scan." + fallback };
    if (job.pending) return job.pending;
    if (!job.response.ok || !("status" in job.response)) return job.response;
    if (Date.now() - job.checkedAt < 1500) return job.response;
    job.checkedAt = Date.now();
    job.pending = this.check(job);
    try { return await job.pending; } finally { job.pending = undefined; }
  }
  private async check(job: Job): Promise<UrlFetchResponse> {
    try {
      const run = asObject(asObject(await this.api(`/actor-runs/${job.runId}`)).data);
      const usageUsd = usd(run.usageTotalUsd);
      job.usageUsd = usageUsd;
      if (run.status === "SUCCEEDED") {
        if (typeof run.defaultDatasetId !== "string" || !/^[a-zA-Z0-9]+$/.test(run.defaultDatasetId)) throw new Error("missing-dataset");
        const items = await this.api(`/datasets/${run.defaultDatasetId}/items?format=json&clean=true&limit=2`);
        if (!Array.isArray(items) || items.length !== 1) throw new Error("empty-or-multiple");
        const record = asObject(items[0]);
        const expectedId = job.url.match(/\/(\d+)\/$/)?.[1];
        const returnedId = record.id ?? record.listingId;
        if (returnedId === undefined && typeof record.url !== "string") throw new Error("missing-listing-identity");
        if (returnedId !== undefined && String(returnedId) !== expectedId) throw new Error("wrong-listing");
        if (typeof record.url === "string" && approvedBizBuySellUrl(record.url) !== job.url) throw new Error("wrong-listing-url");
        const reconciled = reconcileApifyListing(record, { listingUrl: job.url, listingText: "" });
        job.record = record;
        job.retrieval = { provider: "apify", actorId: APIFY_ACTOR_ID, retrievedAt: new Date().toISOString(), sourceUrl: job.url,
          maxChargeUsd: this.maxChargeUsd, usageUsd, rawRecord: record, conflicts: reconciled.conflicts, photographs: reconciled.photographs };
        const ready: Ready = { ok: true, listingText: reconciled.request.listingText, title: typeof record.title === "string" ? record.title : null,
          source: "BizBuySell via Apify", finalUrl: job.url, retrievalId: job.id, usageUsd, maxChargeUsd: this.maxChargeUsd,
          message: `Listing retrieved through Apify.${usageUsd === null ? " Usage cost is not yet available." : ` Reported run usage: $${usageUsd.toFixed(4)} (may be preliminary).`}` };
        job.response = ready;
        job.terminal = true;
      } else if (["FAILED", "TIMED-OUT", "ABORTED"].includes(String(run.status))) {
        job.terminal = true;
        job.response = { ok: false, error: `Apify retrieval ${String(run.status).toLowerCase()}.${usageUsd === null ? " Usage cost unavailable." : ` Reported usage: $${usageUsd.toFixed(4)}.`} No new run was started.` + fallback };
      } else {
        job.response = { ok: true, status: "running", jobId: job.id, message: "Apify is retrieving listing details.", usageUsd, maxChargeUsd: this.maxChargeUsd };
      }
    } catch (error) {
      job.response = { ok: false, error: accessReason(error) + "Apify results could not be read or did not contain exactly the requested listing. Check the existing run in Apify; no new run was started." +
        (job.usageUsd === null || job.usageUsd === undefined ? " Usage cost unavailable." : ` Reported usage: $${job.usageUsd.toFixed(4)} (may be preliminary).`) + fallback };
    }
    return job.response;
  }
  reconcile(id: string, request: ScanRequest) {
    const job = this.jobs.get(id);
    if (!job?.record || !job.retrieval || job.url !== approvedBizBuySellUrl(request.listingUrl ?? "")) throw new Error("The retrieval session does not match this listing. Paste the listing text to scan manually.");
    const mapped = reconcileApifyListing(job.record, request);
    return { request: mapped.request, retrieval: { ...job.retrieval, conflicts: mapped.conflicts, photographs: mapped.photographs } };
  }
  private async api(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetcher(`https://api.apify.com/v2${path}`, {
      ...init, redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${this.config.token}`, "Content-Type": "application/json", Accept: "application/json" }
    });
    if (!response.ok) throw new ApifyHttpError(response.status);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Apify returned no response body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_500_000) { await reader.cancel(); throw new Error("Apify response too large"); }
      chunks.push(value);
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    return JSON.parse(text);
  }
}
