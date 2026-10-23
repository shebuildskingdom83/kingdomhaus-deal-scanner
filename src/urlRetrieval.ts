import { authenticatedApi } from "./authenticatedApi";
import { approvedBizBuySellUrl } from "./hybridListing";
import type { UrlFetchResponse } from "./types";
import { retrievalFailure } from "./reporting";

type Ready = Extract<UrlFetchResponse, { listingText: string }>;
export async function retrieveListing(url: string, options: {
  confirm: (notice: string) => boolean;
  progress: (message: string) => void;
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  wait?: () => Promise<void>;
  signal?: AbortSignal;
  assertCurrent?: () => void;
}): Promise<Ready | null> {
  const check = () => { options.signal?.throwIfAborted(); options.assertCurrent?.(); };
  const request = options.fetcher ?? authenticatedApi;
  const fetcher = (input: string, init?: RequestInit) => { check(); return request(input, { ...init, signal: options.signal ?? init?.signal }); };
  check();
  const parsed = new URL(url);
  const isBizBuySell = ["www.bizbuysell.com", "bizbuysell.com"].includes(parsed.hostname.toLowerCase());
  if (isBizBuySell) {
    approvedBizBuySellUrl(url);
    const config = await (await fetcher("/api/retrieval-config")).json();
    check();
    if (!config.enabled) throw new Error("Automatic retrieval is not configured or unavailable for this account. Paste the listing details below.");
    if (!options.confirm("Retrieve this listing using an external, chargeable service? Usage will be billed to the configured retrieval account. A server-side spending limit applies. Check for unfinished retrievals before continuing. No automatic paid retries.")) return null;
  }
  options.progress("Retrieving listing information...");
  let payload = await (await fetcher("/api/fetch-listing", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, ...(isBizBuySell ? { paidScanConfirmed: true, requestId: crypto.randomUUID() } : {}) })
  })).json() as UrlFetchResponse;
  check();
  const deadline = Date.now() + 660_000;
  while (payload.ok && "status" in payload) {
    options.progress("Retrieving listing information...");
    if (Date.now() > deadline) throw new Error("Retrieval is taking longer than expected. Check the existing retrieval with your administrator before starting another chargeable scan. Paste listing text to continue.");
    await (options.wait?.() ?? new Promise<void>((resolve, reject) => {
      const stop = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", stop); reject(new Error("Retrieval cancelled after the account or workspace changed.")); };
      const timer = setTimeout(() => { options.signal?.removeEventListener("abort", stop); resolve(); }, 2000);
      options.signal?.addEventListener("abort", stop, { once: true });
      if (options.signal?.aborted) stop();
    }));
    check();
    payload = await (await fetcher(`/api/listing-retrieval/${payload.jobId}`)).json() as UrlFetchResponse;
    check();
  }
  if (!payload.ok) throw new Error(retrievalFailure(payload.error));
  return { ...payload, message: "Listing retrieved successfully." };
}
