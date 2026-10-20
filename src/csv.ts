import type { DealScan } from "./types";
import type { AcquisitionRecord } from "./acquisitionRecord";
import { calculateAcquisitionCashFlow, createCashFlowAssumptions, currentCashFlowFields, improvementCashFlowFields, parseCashFlowInput } from "./acquisitionCashFlow";
import type { CashFlowAssumptions } from "./acquisitionCashFlow";
import { safeRatio } from "./financial";
import { businessComponentAmount, publicReportText } from "./reporting";
import { safeBusinessWebsite } from "./safeExternalUrl";
import { resolvedStreetAddress } from "./listingAddress";

type Cell = string | number | null;
type Row = Record<string, Cell>;

function summary(scan: DealScan, name: string, savedAt: string | null): Row {
  const f = scan.financials;
  const streetAddress = resolvedStreetAddress(scan);
  return {
    "Acquisition name": name,
    "Listing title": scan.businessDetails.listingTitle.value,
    "Listing URL": scan.listingUrl ?? scan.businessDetails.url.value,
    "Business Website": safeBusinessWebsite(scan.businessDetails.businessWebsite?.value),
    "Street address": streetAddress.value,
    "Street address source": streetAddress.source,
    "Street address evidence": streetAddress.excerpts.join("\n"),
    "Source": scan.businessDetails.source.value,
    "Location": scan.overview.location.value,
    "Industry": scan.overview.industry.value,
    "Total asking price (USD)": f.askingPrice.amount,
    "Business component price (USD)": businessComponentAmount(f),
    "Real estate disclosed component/value (USD)": f.realEstate.value.amount,
    "Real estate inclusion": f.realEstate.includedStatus,
    "Gross Annual Revenue (USD)": f.annualRevenue.amount,
    "Advertised cash flow (USD)": f.advertisedCashFlow.amount,
    "Advertised cash flow seller label": f.advertisedCashFlow.sellerTerminology,
    "SDE (seller-reported or corrected, unverified) (USD)": f.sde.amount,
    "SDE source classification": f.sde.source,
    "EBITDA (USD)": f.ebitda.amount,
    "Inventory value (USD)": f.inventory.value.amount,
    "Inventory inclusion": f.inventory.includedStatus,
    "FF&E value (USD)": f.ffe.value.amount,
    "FF&E inclusion": f.ffe.includedStatus,
    "Known additional acquisition costs (USD)": f.knownAdditionalAcquisitionCosts.amount,
    "Combined asking / SDE (x)": scan.ratios.askingPriceToSde,
    "Business-only asking / SDE (x)": scan.ratios.businessAskingPriceToSde,
    "Combined asking / advertised cash flow (x)": safeRatio(f.askingPrice.amount, f.advertisedCashFlow.amount),
    "Business-only asking / advertised cash flow (x)": safeRatio(businessComponentAmount(f), f.advertisedCashFlow.amount),
    "Combined asking / EBITDA (x)": scan.ratios.askingPriceToEbitda,
    "SDE margin (%)": scan.ratios.sdeToRevenue === null ? null : Number((scan.ratios.sdeToRevenue * 100).toFixed(2)),
    "Owner dependence": scan.overview.ownerInvolvement.value,
    "Material risk flags": scan.riskChecks.filter(risk => risk.status !== "clear" || risk.requiresVerification).map(risk => risk.label + ": " + risk.explanation).join("\n"),
    "Financial verification status": "Not independently verified; seller claims and user corrections require diligence",
    "Preliminary recommendation (not approval)": scan.decision.recommendation,
    "Saved date": savedAt,
    "Report generation date": scan.createdAt
  };
}

function cell(value: Cell): string {
  if (value === null) return '""';
  if (typeof value === "number") return Number.isFinite(value) ? '"' + value + '"' : '""';
  let text = publicReportText(value);
  // Quote escaping alone does not prevent spreadsheet formulas.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function encodeCsv(rows: Row[], columns = Object.keys(rows[0] ?? {})): string {
  return "\uFEFF" + [columns.map(cell).join(","), ...rows.map(row => columns.map(key => cell(row[key] ?? null)).join(","))].join("\r\n") + "\r\n";
}

export function buildCurrentAcquisitionCsv(scan: DealScan, assumptions = createCashFlowAssumptions()): string {
  const result = calculateAcquisitionCashFlow(scan.financials, assumptions);
  const row = summary(scan, scan.overview.businessName.value ?? "Not Disclosed", null);
  Object.assign(row, {
    "Current Operations starting metric": result.starting.label,
    "Current Operations starting source": result.starting.source,
    "Current Operations starting amount (USD)": result.starting.amount,
    "Current Operations normalization notes": assumptions.normalizationNotes,
    "Current Operations overlap reviewed by user": String(assumptions.currentReviewed),
    ...Object.fromEntries(currentCashFlowFields.map(field => ["Current Operations: " + field.label + " (USD)", parseCashFlowInput(assumptions[field.key], field.signed)])),
    "Current Operations annual cash remaining (USD)": result.current.annual,
    "Current Operations monthly cash remaining (USD)": result.current.monthly,
    "Current Operations incomplete inputs": result.current.missing.join("; "),
    "KingdomHaus Improvements savings basis (user assessment)": assumptions.savingsBasis,
    "KingdomHaus Improvements overlap reviewed by user": String(assumptions.improvementsReviewed),
    ...Object.fromEntries(improvementCashFlowFields.map(field => ["KingdomHaus Improvements: " + field.label + " (USD)", parseCashFlowInput(assumptions[field.key])])),
    "One-time implementation costs (USD)": result.improvements.implementationCosts,
    "KingdomHaus Improvements annual cash remaining (USD)": result.improvements.annual,
    "KingdomHaus Improvements monthly cash remaining (USD)": result.improvements.monthly,
    "KingdomHaus Improvements annual difference (USD)": result.improvements.difference,
    "KingdomHaus Improvements first-year cash (USD)": result.improvements.firstYear,
    "KingdomHaus Improvements incomplete inputs": result.improvements.missing.join("; ")
  });
  return encodeCsv([row]);
}

export function buildSavedAcquisitionsCsv(records: AcquisitionRecord[]): string {
  const rows = records.map(record => ({ ...summary(record.state.scan, record.name, record.createdAt), "Last updated": record.updatedAt }));
  return encodeCsv(rows);
}

export function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
