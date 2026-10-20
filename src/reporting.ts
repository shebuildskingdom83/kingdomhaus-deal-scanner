import type { DealScan, FinancialSnapshot } from "./types";

export const resultsDisclaimer = "KingdomHaus Intelligence provides preliminary acquisition analysis for informational and internal evaluation purposes. Seller-reported figures, assumptions, and automated findings have not been independently verified. Results are not investment, financial, legal, or tax advice and should not substitute for professional due diligence.";

export function publicReportText(text: string): string {
  return text.replace(/\bApify\b/gi, "listing retrieval service").replace(/\bPuter\b/gi, "external AI service");
}

// Only a disclosed component supports a business-only valuation or multiple.
export function businessComponentAmount(financials: FinancialSnapshot): number | null {
  return financials.businessAskingPrice.amount;
}

export function diligenceReadout(label: string, explanation: string): string {
  const action = explanation.indexOf("Verify who will cover");
  return /owner dependence|owner and key-person dependence/i.test(label) && action >= 0
    ? explanation.slice(action) : explanation;
}

export function claritySellerDependence(scan: DealScan): string {
  const original = scan.claritySummary.sellerDependence;
  const owner = scan.overview.ownerInvolvement.value;
  if (!owner || !original.startsWith("Seller reports: ") || !original.includes(owner)) return original;
  return "The disclosed owner role creates post-close operating continuity questions. No replacement pay or available staff capacity is assumed." +
    (/Certified Welding Inspector|\bCWI\b/i.test(owner) ? " The owner-held CWI credential adds a qualification dependency to evaluate." : "");
}

export function retrievalFailure(text: string): string {
  if (!/apify|actor|usage cost|spending limit|reported usage/i.test(text)) return text;
  const fallback = " Copy the listing details and paste them below to continue.";
  if (/not configured/i.test(text)) return "Automatic retrieval is not configured." + fallback;
  if (/denied|401|403|permissions/i.test(text)) return "The retrieval service denied access." + fallback;
  if (/credit|402|plan access/i.test(text)) return "The retrieval account needs billing or access review. No automatic retry will run." + fallback;
  if (/rate.limit|429/i.test(text)) return "The retrieval service is busy. No automatic retry will run." + fallback;
  return "Retrieval could not be completed. Check the existing retrieval with your administrator before starting another chargeable scan; it will not be retried automatically." + fallback;
}
