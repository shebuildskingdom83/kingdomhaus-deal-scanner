import { extractListingPhotographs, safeListingImage } from "./hybridListing";
import type { DealScan, ListingPhotograph } from "./types";
import { websiteProjectPhotographs, websiteProjectsBelongToScan } from "./websiteProjectMedia";

export function sameListing(first: string | null | undefined, second: string | null | undefined): boolean {
  if (!first || !second) return false;
  try {
    const a = new URL(first), b = new URL(second);
    return a.protocol === "https:" && b.protocol === "https:" && !a.username && !b.username &&
      !a.password && !b.password && a.origin === b.origin &&
      a.pathname.replace(/\/+$/, "") === b.pathname.replace(/\/+$/, "");
  } catch { return false; }
}

export function retainedPhotographs(scan: DealScan): ListingPhotograph[] {
  const retrieval = scan.retrieval;
  if (!retrieval) return [];
  const existing = (retrieval.photographs ?? []).filter(photo => safeListingImage(photo.url));
  const raw = retrieval.rawRecord;
  const rawUrl = typeof raw?.url === "string" ? raw.url : undefined;
  if (rawUrl && !sameListing(rawUrl, retrieval.sourceUrl)) return existing.slice(0, 20);
  const recovered = extractListingPhotographs(raw ?? {}, retrieval.sourceUrl);
  const unique = new Map<string, ListingPhotograph>();
  for (const photo of [...existing, ...recovered]) if (!unique.has(photo.url)) unique.set(photo.url, photo);
  return [...unique.values()].slice(0, 20);
}

export function preserveListingMedia(next: DealScan, previous: DealScan | null): DealScan {
  if (!previous || !sameListing(next.listingUrl, previous.listingUrl)) return next;
  return {
    ...next,
    ...(!next.websiteProjectPhotographs && websiteProjectsBelongToScan(next) && previous.websiteProjectPhotographs ? {
      websiteProjectPhotographs: websiteProjectPhotographs(previous)
    } : {}),
    ...(!next.retrieval && previous.retrieval ? {
      retrieval: { ...previous.retrieval, rawRecord: {}, photographs: retainedPhotographs(previous) }
    } : {})
  };
}
