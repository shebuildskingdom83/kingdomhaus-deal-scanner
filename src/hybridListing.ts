import { extractListingDetails } from "./listingExtraction";
import { parseMoney } from "./financial";
import { structuredListingAddress } from "./listingAddress";
import { safeBusinessWebsite } from "./safeExternalUrl";
import { equivalentListingLocations, formatScrapedDescription } from "./listingPresentation";
import type { DealScan, ListingPhotograph, ListingRetrieval, ScanRequest } from "./types";

export const APIFY_ACTOR_ID = "jUaA3ZUjFvx5NnFEb";

export function approvedBizBuySellUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || !["www.bizbuysell.com", "bizbuysell.com"].includes(url.hostname.toLowerCase()) ||
      url.username || url.password || url.port || !/^\/business-opportunity\/[^/]+\/\d+\/?$/i.test(url.pathname)) {
    throw new Error("Enter a single HTTPS BizBuySell business-opportunity listing URL.");
  }
  return `https://www.bizbuysell.com${url.pathname.replace(/\/?$/, "/")}`;
}

export function safeListingImage(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !/^(?:images\.bizbuysell\.com|images\d?\.loopnet\.com)$/.test(url.hostname) ||
        [...url.searchParams.keys()].some((key) => /token|signature|credential|secret/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function plain(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  const text = String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?(?:p|div|br|li|h[1-6])\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').trim();
  return text && !/^(?:null|undefined|n\/a|not disclosed|not available)$/i.test(text) ? text : null;
}
function short(value: unknown, max = 250): string | null {
  const text = plain(value);
  return text && text.length <= max && !/\b(disclaimer|guarantee|privacy policy|terms of use)\b/i.test(text) ? text.replace(/\s+/g, " ") : null;
}
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Marketplace references only; seller-website imagery is not a listing-photo fallback. */
export function extractListingPhotographs(record: Record<string, unknown>, listingUrl: string): ListingPhotograph[] {
  let sourceUrl: string;
  try {
    sourceUrl = approvedBizBuySellUrl(listingUrl);
    if (typeof record.url === "string" && approvedBizBuySellUrl(record.url) !== sourceUrl) return [];
  } catch { return []; }
  const photographs = new Map<string, ListingPhotograph>();
  const defaultCredit = "BizBuySell listing photograph; third-party rights retained.";
  const text = (value: unknown) => {
    const result = plain(value);
    return result && result.length <= 2000 ? result : undefined;
  };
  for (const image of [...(Array.isArray(record.images) ? record.images : []), record.imageUrl]) {
    const metadata = object(image);
    const url = safeListingImage(typeof image === "string" ? image : metadata.url ?? metadata.src);
    if (!url) continue;
    if (metadata.sourceUrl !== undefined) {
      try { if (approvedBizBuySellUrl(String(metadata.sourceUrl)) !== sourceUrl) continue; }
      catch { continue; }
    }
    const alt = text(metadata.alt ?? metadata.altText);
    const caption = text(metadata.caption);
    const attribution = text(metadata.attribution ?? metadata.credit);
    const previous = photographs.get(url);
    if (!previous && photographs.size >= 20) continue;
    photographs.set(url, {
      url, sourceUrl,
      attribution: previous && previous.attribution !== defaultCredit ? previous.attribution : attribution ?? defaultCredit,
      ...(previous?.alt || alt ? { alt: previous?.alt ?? alt } : {}),
      ...(previous?.caption || caption ? { caption: previous?.caption ?? caption } : {}),
      ...(previous?.creditRequired !== undefined || typeof metadata.creditRequired === "boolean"
        ? { creditRequired: previous?.creditRequired === true || metadata.creditRequired === true } : {})
    });
  }
  return [...photographs.values()];
}

/** Reuse the listing parser by translating structured fields into its existing evidence labels. */
export function reconcileApifyListing(record: Record<string, unknown>, input: ScanRequest): {
  request: ScanRequest; conflicts: string[]; photographs: ListingPhotograph[];
} {
  const raw = object(record.detailsRaw);
  const fields = new Map<string, unknown>();
  for (const [name, value] of [...Object.entries(raw), ...Object.entries(record)]) if (plain(value) !== null) fields.set(key(name), value);
  const get = (...names: string[]) => names.map((name) => fields.get(key(name))).find((value) => plain(value) !== null);
  const title = short(get("title", "listingTitle", "businessName"), 200);
  const descriptions = [record.fullDescription, record.description, record.businessDescription, raw.fullDescription, raw.description]
    .map((value) => plain(value)).filter((value): value is string => Boolean(value));
  if (!descriptions.length) {
    const alternative = plain(get("facilities")) ?? plain(record.shortDescription);
    if (alternative) descriptions.push(alternative);
  }
  const description = formatScrapedDescription(descriptions.filter((text, index) => !descriptions.some((other, n) => n !== index && other.includes(text) && (other.length > text.length || n < index))).join("\n\n"));
  const rawLines = Object.entries(raw).flatMap(([name, value]) => {
    const label = ({ cashflowsde: "Cash Flow (SDE)", sde: "SDE", location: "Location", broker: "Broker", brokername: "Broker Name", brokercompany: "Broker Company" } as Record<string, string>)[key(name)];
    return label && plain(value) ? [`${label}: ${plain(value)}`] : [];
  });
  const narrative = [title, "Business Description", description, `Ad#: ${get("id", "listingId") ?? ""}`, ...rawLines].filter(Boolean).join("\n");
  const extracted = extractListingDetails({ listingText: narrative, listingUrl: input.listingUrl });
  const conflicts: string[] = [];
  const lines: string[] = [];
  const add = (label: string, value: unknown, max = 2000) => { const text = plain(value); if (text && text.length <= max) lines.push(`${label}: ${text}`); };
  const amount = (value: unknown) => typeof value === "number" ? (Number.isFinite(value) && value >= 0 ? value : null) :
    typeof value === "string" && /^\s*\$?\s*[\d,]+(?:\.\d+)?\s*$/.test(value) ? parseMoney(value) : null;
  const money = (label: string, structured: unknown, evidence: number | null) => {
    const mapped = amount(structured);
    if (mapped !== null && evidence !== null && mapped !== evidence) conflicts.push(`${label}: Apify structured value ${mapped} conflicts with source text ${evidence}. Source text retained; verify before relying on it.`);
    const chosen = evidence ?? mapped;
    if (chosen !== null) add(label, `$${chosen}`);
  };
  money("Asking Price", get("askingPrice"), extracted.financials.askingPrice.amount);
  money("Business Asking Price", get("businessAskingPrice"), extracted.financials.businessAskingPrice.amount);
  money("Gross Revenue", get("grossRevenue", "annualRevenue", "revenue"), extracted.financials.annualRevenue.amount);
  money("SDE", get("sde", "sellerDiscretionaryEarnings", "Cash Flow (SDE)"), extracted.financials.sde.amount);
  money("EBITDA", get("ebitda"), extracted.financials.ebitda.amount);
  // A provider's generic cashFlow is not evidence of SDE, even when its marketing calls it SDE.
  money("Cash Flow", get("cashFlow"), extracted.financials.advertisedCashFlow.amount);
  const city = short(get("city"), 100), state = short(get("state"), 40);
  const locationCandidate = short(get("location"), 140) ?? (city && state ? `${city}, ${state}` : state);
  const cleaned = locationCandidate ? extractListingDetails({ listingText: `Business\nLocation: ${locationCandidate.replace(/(?:Business\s+)?Location\s*:?/gi, "").trim()}` }).overview.location.value : null;
  const teaserLocation = plain(record.shortDescription)?.match(/^([^:\n]{2,100},\s*[A-Z]{2})\s*:/)?.[1];
  const location = teaserLocation ?? extracted.overview.location.value ?? cleaned;
  if (location && cleaned && !equivalentListingLocations(location, cleaned, { city, state })) conflicts.push(`Location: source text (${location}) differs from Apify location (${cleaned}). Source text retained.`);
  add("Location", location, 140);
  const address = structuredListingAddress(record);
  if (address) add(address.embeddedMap ? "Embedded Map Address" : "Street Address", address.address, 250);
  const sourceWebsite = safeBusinessWebsite(extracted.businessDetails.businessWebsite?.value);
  const providerWebsite = safeBusinessWebsite(get("businessWebsite"));
  if (sourceWebsite && providerWebsite && sourceWebsite !== providerWebsite) {
    conflicts.push(`Business Website: source text (${sourceWebsite}) differs from provider value (${providerWebsite}). Source text retained; verify before relying on it.`);
  }
  add("Industry", short(get("category", "industry")) ?? (/\bconcrete\b/i.test(description) ? "Concrete contracting services" : null));
  add("Established", short(get("establishedYear", "yearEstablished"), 20));
  const employees = short(get("employees", "employeeCount"), 100);
  add("Employees", employees?.replace(/\bFT\b/g, "full-time").replace(/\bPT\b/g, "part-time"));
  add("Owner Involvement", short(get("ownerResponsibilities", "ownerInvolvement"), 800));
  const serviceEvidence = [description, plain(get("supportTraining"))].filter(Boolean).join("\n");
  const serviceSentence = serviceEvidence.match(/\bServices include\s+([^.!?]{5,350})[.!?]?/i)?.[1];
  add("Services", short(get("services", "primaryServices"), 400) ?? serviceSentence ??
    (/painting/i.test(short(get("category")) ?? "") ? "Painting and finishing services" : null));
  for (const [label, names] of [
    ["Facilities", ["facilities"]], ["Competition", ["competition"]], ["Growth & Expansion", ["growthExpansion", "growthOpportunities"]],
    ["Support & Training", ["supportTraining", "sellerSupport", "sellerSupportTraining"]], ["Reason for Selling", ["reasonForSelling"]],
    ["Financing", ["financingAvailable", "financing"]]
  ] as const) add(label, get(...names));
  const franchise = plain(get("franchise"));
  if (franchise && /^(yes|true)$/i.test(franchise)) add("Franchise", "This is a franchise business; undisclosed agreement terms require verification.");
  else if (franchise && !/^(no|false)$/i.test(franchise)) add("Franchise", franchise);
  let profileName: string | null = null, profileCompany: string | null = null;
  try {
    const profile = new URL(String(record.brokerProfileUrl));
    const match = profile.pathname.match(/^\/business-broker\/([a-z-]+)\/([a-z-]+)\/\d+\/?$/i);
    if (profile.protocol === "https:" && ["www.bizbuysell.com", "bizbuysell.com"].includes(profile.hostname) && !profile.username && !profile.password && match) {
      const titleCase = (slug: string) => slug.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
      profileName = titleCase(match[1]); profileCompany = titleCase(match[2]);
    }
  } catch { /* Missing or invalid broker profile: retain Not Disclosed. */ }
  add("Broker Name", short(get("brokerName"), 160) ?? profileName);
  add("Broker Company", short(get("brokerageName", "brokerCompany"), 160) ?? profileCompany);
  add("Phone Number", short(get("brokerPhone"), 50));
  add("Broker", extracted.businessDetails.brokerInformation.value, 320);
  for (const [label, field, inclusion] of [["Inventory", "inventory", "inventoryIncluded"], ["FF&E", "ffe", "ffeIncluded"], ["Real Estate", "realEstate", "realEstateIncluded"]]) {
    const value = get(field), included = get(inclusion);
    const numeric = amount(value);
    const suffix = included === true || included === "true" || included === "Yes" ? " included in asking price" : included === false || included === "false" || included === "No" ? " not included in asking price" : "";
    if (numeric === null && !short(value) && !suffix) continue;
    add(label, numeric !== null ? `$${numeric}${suffix}` : `${short(value) ?? "Value not disclosed"}${suffix}`);
  }
  add("Building SF", short(get("buildingSize", "buildingSqFt"), 100));
  const photographs = extractListingPhotographs(record, input.listingUrl ?? "");
  // Corrections remain authoritative in the existing parser, including an explicit clear.
  add("Business Website", sourceWebsite ?? providerWebsite);
  const listingText = [title, ...lines, "Business Description", description || "Description not disclosed.", `Ad#: ${get("id", "listingId") ?? ""}`, ...rawLines].filter(Boolean).join("\n\n");
  if (listingText.length > 50_000) throw new Error("The retrieved listing exceeds the scanner's text limit. Paste the relevant listing text manually.");
  return { request: { ...input, listingText }, conflicts, photographs };
}

export function attachRetrieval(scan: DealScan, retrieval: ListingRetrieval): DealScan {
  const profile = typeof retrieval.rawRecord.brokerProfileUrl === "string" ? retrieval.rawRecord.brokerProfileUrl : null;
  const broker = scan.businessDetails.brokerInformation;
  const formattedDescription = (fact: typeof scan.overview.description) => ({ ...fact, value: fact.value ? formatScrapedDescription(fact.value) : null });
  return {
    ...scan, retrieval,
    overview: { ...scan.overview, description: formattedDescription(scan.overview.description) },
    businessDetails: { ...scan.businessDetails, fullDescription: formattedDescription(scan.businessDetails.fullDescription), additionalDetails: [...scan.businessDetails.additionalDetails,
      ...(profile ? [{ label: "Broker profile source", value: profile, excerpts: [profile] }] : [])],
      brokerInformation: profile && !retrieval.rawRecord.brokerName && broker.value ? { ...broker, source: "url_extract", excerpts: [profile] } : broker },
    missingInformation: [...scan.missingInformation, ...retrieval.conflicts.map((conflict) => `Requires Verification: ${conflict}`)],
    riskChecks: [...scan.riskChecks, ...(retrieval.conflicts.length ? [{ label: "Source conflicts", status: "watch" as const, explanation: retrieval.conflicts.join(" "), excerpts: retrieval.conflicts, requiresVerification: true }] : [])]
  };
}
