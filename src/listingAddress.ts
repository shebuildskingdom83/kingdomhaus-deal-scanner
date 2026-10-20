import type { DealScan, TextFact } from "./types";
import { listingStateCode } from "./listingPresentation";

export function explicitStreetAddress(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 250 || /[<>\r\n]/.test(value)) return null;
  let text = value.trim().replace(/\s+/g, " ");
  const parts = text.split(",").map(part => part.trim());
  if (/^(?:United States(?: of America)?|USA|US)$/i.test(parts.at(-1) ?? "")) parts.pop();
  if (/\bCounty$/i.test(parts.at(-2) ?? "")) parts.splice(-2, 1);
  if (parts.length === 3) {
    const region = parts[2].match(/^(.+?)(\s+\d{5}(?:-\d{4})?)?$/);
    const state = region ? listingStateCode(region[1]) : null;
    if (state) text = `${parts[0]}, ${parts[1]}, ${state}${region?.[2] ?? ""}`;
  }
  // Require a numbered street and explicit locality/state; never geocode a pin or area.
  return /^\d{1,6}[A-Za-z]?\s+(?:[\w.'-]+\s+){1,10}(?:Hwy|Highway|St|Street|Rd|Road|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way|Pkwy|Parkway|Pl|Place|Cir|Circle)\.?(?:\s+(?:N|S|E|W|NE|NW|SE|SW))?(?:,?\s+(?:Suite|Ste|Unit|#)\s*[\w-]+)?,\s*[A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/i.test(text) ? text : null;
}

function mapAddress(value: unknown): string | null {
  const direct = explicitStreetAddress(value);
  if (direct) return direct;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const formatted = explicitStreetAddress(item.formattedAddress ?? item.address);
  if (formatted) return formatted;
  const embedded = explicitMapAddressFromUrl(item.src ?? item.url);
  if (embedded) return embedded;
  const street = item.streetAddress, city = item.addressLocality ?? item.city, state = item.addressRegion ?? item.state;
  if (![street, city, state].every(part => typeof part === "string")) return null;
  return explicitStreetAddress(`${street}, ${city}, ${state}${typeof item.postalCode === "string" ? " " + item.postalCode : ""}`);
}

export function explicitMapAddressFromUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 5000) return null;
  try {
    const url = new URL(value.replace(/&amp;/g, "&"));
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["www.google.com", "maps.google.com", "www.bing.com"].includes(url.hostname) ||
      !/\/maps?(?:\/|$)/.test(url.pathname)) return null;
    for (const key of ["q", "query", "daddr"]) {
      const address = explicitStreetAddress(url.searchParams.get(key));
      if (address) return address;
    }
    for (const token of (url.searchParams.get("pb") ?? "").matchAll(/![12]s([^!]+)/g)) {
      const address = explicitStreetAddress(decodeURIComponent(token[1]));
      if (address) return address;
    }
  } catch { /* No address is better than a guess from malformed map data. */ }
  return null;
}

export function embeddedMapAddressFromHtml(html: string): string | null {
  for (const frame of html.matchAll(/<iframe\b[^>]{0,8000}>/gi)) {
    if (/\bbroker\b/i.test(frame[0])) continue;
    const src = frame[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    const address = explicitMapAddressFromUrl(src);
    if (address) return address;
  }
  return null;
}

export function structuredListingAddress(record: Record<string, unknown>): { address: string; embeddedMap: boolean } | null {
  const raw = record.detailsRaw && typeof record.detailsRaw === "object" ? record.detailsRaw as Record<string, unknown> : {};
  for (const value of [record.embeddedMap, record.map, record.mapAddress, record.mapUrl, record.embeddedMapUrl, raw.embeddedMap, raw.mapAddress, raw["Map Address"]]) {
    const address = mapAddress(value) ?? explicitMapAddressFromUrl(value);
    if (address) return { address, embeddedMap: true };
  }
  for (const value of [record.fullDescription, record.description, record.businessDescription]) {
    if (typeof value !== "string") continue;
    const address = embeddedMapAddressFromHtml(value);
    if (address) return { address, embeddedMap: true };
  }
  for (const value of [record.streetAddress, record.businessAddress, raw.streetAddress, raw["Street Address"], raw["Business Address"]]) {
    const address = mapAddress(value);
    if (address) return { address, embeddedMap: false };
  }
  return null;
}

export function streetAddressFact(listingText: string, listingUrl?: string, corrections?: Record<string, string>): TextFact {
  const corrected = Object.hasOwn(corrections ?? {}, "streetAddress");
  const match = listingText.match(/^\s*(Embedded Map Address|Street Address|Business Address)\s*:\s*([^\r\n]+)/im);
  const address = explicitStreetAddress(corrected ? corrections?.streetAddress : match?.[2]);
  return {
    value: address,
    source: !address ? "not_disclosed" : corrected ? "user_correction" : match?.[1].toLowerCase() === "embedded map address" ? "url_extract" : "seller_claim",
    excerpts: !address ? [] : [corrected ? `User-supplied street address: ${address}. Not independently verified.` : match![0].trim(), ...(listingUrl ? [listingUrl] : [])]
  };
}

export function preserveStreetAddressEvidence(next: DealScan, previous: DealScan | null): DealScan {
  if (!previous || !next.listingUrl || next.listingUrl !== previous.listingUrl) return next;
  const before = previous.businessDetails.streetAddress, after = next.businessDetails.streetAddress;
  return before?.value && before.value === after?.value ? { ...next, businessDetails: { ...next.businessDetails, streetAddress: before } } : next;
}

/** One precedence rule for imports, recovery, rendering and exports. */
export function resolvedStreetAddress(scan: DealScan): TextFact {
  const correction = explicitStreetAddress(scan.correctedFields.streetAddress);
  const existing = scan.businessDetails.streetAddress;
  const structured = explicitStreetAddress(existing?.value);
  if (correction) {
    if (structured === correction && existing && existing.source !== "not_disclosed") return existing;
    return {
      value: correction, source: "user_correction",
      excerpts: [...(existing?.excerpts ?? []),
        ...(structured && structured !== correction ? [`Imported structured address before correction: ${existing!.value}`] : []),
        `User-supplied street address: ${correction}. Not independently verified.`]
    };
  }
  if (structured && existing) return existing;
  const extracted = streetAddressFact(scan.listingText, scan.listingUrl ?? undefined);
  if (extracted.value) return extracted;
  const raw = scan.retrieval?.rawRecord;
  const map = embeddedMapAddressFromHtml(scan.listingText) ?? (raw ? structuredListingAddress(raw)?.address : null);
  return map ? { value: map, source: "url_extract", excerpts: [`Explicit listing-map address: ${map}`, ...(scan.listingUrl ? [scan.listingUrl] : [])] }
    : { value: null, source: "not_disclosed", excerpts: existing?.excerpts ?? [] };
}

export function hydrateStreetAddress(scan: DealScan): DealScan {
  const address = resolvedStreetAddress(scan);
  if (!address.value || address === scan.businessDetails.streetAddress) return scan;
  return { ...scan, businessDetails: { ...scan.businessDetails, streetAddress: address } };
}
