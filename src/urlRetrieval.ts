import { approvedBizBuySellUrl } from "./hybridListing";
import type { UrlFetchResponse } from "./types";
import { retrievalFailure } from "./reporting";

type Ready = Extract<UrlFetchResponse, { listingText: string }>;
export async function retrieveListing(url: string, options: {
  confirm: (notice: string) => boolean;
  progress: (message: string) => void;
  fetcher?: typeof fetch;
  wait?: () => Promise<void>;
}): Promise<Ready | null> {
  const fetcher = options.fetcher ?? fetch;
  const parsed = new URL(url);
  const isBizBuySell = ["www.bizbuysell.com", "bizbuysell.com"].includes(parsed.hostname.toLowerCase());
  if (isBizBuySell) {
    approvedBizBuySellUrl(url);
    const config = await (await fetcher("/api/retrieval-config")).json();
    if (!config.enabled) throw new Error("Automatic retrieval is not configured. Paste the listing details below.");
    if (!options.confirm("Retrieve this listing using an external, chargeable service? Usage will be billed to the configured retrieval account. A server-side spending limit applies. Check for unfinished retrievals before continuing. No automatic paid retries.")) return null;
  }
  options.progress("Retrieving listing information...");
  let payload = await (await fetcher("/api/fetch-listing", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, ...(isBizBuySell ? { paidScanConfirmed: true, requestId: crypto.randomUUID() } : {}) })
  })).json() as UrlFetchResponse;
  const deadline = Date.now() + 660_000;
  while (payload.ok && "status" in payload) {
    options.progress("Retrieving listing information...");
    if (Date.now() > deadline) throw new Error("Retrieval is taking longer than expected. Check the existing retrieval with your administrator before starting another chargeable scan. Paste listing text to continue.");
    await (options.wait?.() ?? new Promise((resolve) => setTimeout(resolve, 2000)));
    payload = await (await fetcher(`/api/listing-retrieval/${payload.jobId}`)).json() as UrlFetchResponse;
  }
  if (!payload.ok) throw new Error(retrievalFailure(payload.error));
  return { ...payload, message: "Listing retrieved successfully." };
}
