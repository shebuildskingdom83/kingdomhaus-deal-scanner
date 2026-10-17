import { approvedBizBuySellUrl } from "./hybridListing";
import type { UrlFetchResponse } from "./types";

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
    if (!config.enabled) throw new Error(config.message || "Apify is not configured. Paste the listing details below.");
    if (!options.confirm(`Retrieve one BizBuySell listing through Apify? Charges apply. This run has a $${Number(config.maxChargeUsd).toFixed(2)} spending limit. Check for any earlier unfinished run before continuing. No automatic paid retries.`)) return null;
  }
  options.progress(isBizBuySell ? "Starting one Apify retrieval..." : "Retrieving public listing text...");
  let payload = await (await fetcher("/api/fetch-listing", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, ...(isBizBuySell ? { paidScanConfirmed: true, requestId: crypto.randomUUID() } : {}) })
  })).json() as UrlFetchResponse;
  const deadline = Date.now() + 660_000;
  while (payload.ok && "status" in payload) {
    options.progress(`${payload.message} Spending limit: $${payload.maxChargeUsd.toFixed(2)}.${payload.usageUsd === null ? " Usage not yet available." : ` Reported usage: $${payload.usageUsd.toFixed(4)} (preliminary).`}`);
    if (Date.now() > deadline) throw new Error("Retrieval is taking longer than expected. Check the existing run in Apify before starting another paid scan. You can paste listing text to continue.");
    await (options.wait?.() ?? new Promise((resolve) => setTimeout(resolve, 2000)));
    payload = await (await fetcher(`/api/listing-retrieval/${payload.jobId}`)).json() as UrlFetchResponse;
  }
  if (!payload.ok) throw new Error(payload.error);
  return payload;
}
