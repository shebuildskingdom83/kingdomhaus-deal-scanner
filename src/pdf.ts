import { formatMoney, formatRatio } from "./financial";
import type { DealScan } from "./types";
import { calculateAcquisitionCashFlow, cashFlowDisclaimer, currentCashFlowFields, formatCashFlowMoney, improvementCashFlowFields, parseCashFlowInput } from "./acquisitionCashFlow";
import type { CashFlowAssumptions } from "./acquisitionCashFlow";

const pageWidth = 612;
const pageHeight = 792;
const margin = 54;
const lineHeight = 15;

export function downloadScanPdf(scan: DealScan, assumptions?: CashFlowAssumptions) {
  const lines = buildReportLines(scan, assumptions);
  const chunks = paginate(lines, 43);
  const objects: string[] = [];

  const fontId = addObject(objects, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageRefs: number[] = [];

  for (const chunk of chunks) {
    const stream = buildPageStream(chunk);
    const contentId = addObject(objects, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(
      objects,
      `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageRefs.push(pageId);
  }

  const pagesId = addObject(objects, `<< /Type /Pages /Kids [${pageRefs.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`);
  for (const pageId of pageRefs) {
    objects[pageId - 1] = objects[pageId - 1].replace("/Parent 0 0 R", `/Parent ${pagesId} 0 R`);
  }
  const catalogId = addObject(objects, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const pdf = assemblePdf(objects, catalogId);
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileSafe(scan.overview.businessName.value ?? "deal-scan")}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

export function buildReportLines(scan: DealScan, assumptions?: CashFlowAssumptions): string[] {
  return [
    "KingdomHaus Deal Scanner",
    `Generated: ${new Date(scan.createdAt).toLocaleString()}`,
    `Mode: ${scan.analysisMode === "ai" ? "AI-assisted preliminary screen" : "Rule-based preliminary screen"}`,
    "",
    "Preliminary Decision",
    `${scan.decision.recommendation}: ${scan.decision.explanation}`,
    "",
    "Business Overview",
    `Listing title: ${scan.businessDetails.listingTitle.value ?? "Not Disclosed"}`,
    `Source: ${scan.businessDetails.source.value ?? "Not Disclosed"}`,
    `URL: ${scan.businessDetails.url.value ?? "Not Disclosed"}`,
    `Ad number: ${scan.businessDetails.adNumber.value ?? "Not Disclosed"}`,
    `Business: ${scan.overview.businessName.value ?? "Not Disclosed"}`,
    `Industry: ${scan.overview.industry.value ?? "Not Disclosed"}`,
    `Services: ${scan.overview.services.value ?? "Not Disclosed"}`,
    `Business model: ${scan.overview.revenueModel.value ?? "Not Disclosed"}`,
    `Customer segments: ${scan.overview.customerSegments?.value ?? "Not Disclosed"}`,
    `Employee count: ${scan.overview.employeeCount.value ?? "Not Disclosed"}`,
    `Location: ${scan.overview.location.value ?? "Not Disclosed"}`,
    `Established: ${scan.overview.yearEstablished.value ?? "Not Disclosed"}`,
    `Owner involvement: ${scan.overview.ownerInvolvement.value ?? "Not Disclosed"}`,
    `Reason for sale: ${scan.overview.reasonForSale.value ?? "Not Disclosed"}`,
    `Broker: ${scan.businessDetails.brokerInformation.value ?? "Not Disclosed"}`,
    ...(scan.retrieval ? [
      `Retrieved via Apify Actor ${scan.retrieval.actorId} at ${scan.retrieval.retrievedAt}. Seller information remains unverified.`,
      `Reported retrieval usage: ${scan.retrieval.usageUsd === null ? "Not available" : `$${scan.retrieval.usageUsd.toFixed(4)} (may be preliminary)`}; run spending limit: $${scan.retrieval.maxChargeUsd.toFixed(2)}.`,
      ...scan.retrieval.conflicts.map((conflict) => `Source conflict - requires verification: ${conflict}`),
      ...scan.retrieval.photographs.map((photo) => `Listing photograph reference: ${photo.url}; source: ${photo.sourceUrl}; ${photo.attribution}`)
    ] : []),
    "",
    "Business Details",
    `Description: ${scan.businessDetails.fullDescription.value ?? "Not Disclosed"}`,
    `Facilities: ${scan.businessDetails.facilities.value ?? "Not Disclosed"}`,
    `Competition: ${scan.businessDetails.competition.value ?? "Not Disclosed"}`,
    `Growth opportunities: ${scan.businessDetails.growthOpportunities.value ?? "Not Disclosed"}`,
    `Financing: ${scan.businessDetails.financing.value ?? "Not Disclosed"}`,
    `Seller support and training: ${scan.businessDetails.sellerSupportTraining.value ?? "Not Disclosed"}`,
    "",
    "Financial Snapshot",
    `Total asking price: ${formatMoney(scan.financials.askingPrice.amount)}`,
    `Business component price: ${formatMoney(scan.financials.businessAskingPrice.amount)}`,
    `Gross Annual Revenue: ${formatMoney(scan.financials.annualRevenue.amount)}`,
    `SDE: ${formatMoney(scan.financials.sde.amount)}`,
    `EBITDA: ${formatMoney(scan.financials.ebitda.amount)}`,
    `Advertised cash flow: ${formatMoney(scan.financials.advertisedCashFlow.amount)} (${scan.financials.advertisedCashFlow.sellerTerminology ?? "seller term not disclosed"})`,
    `Inventory: ${formatMoney(scan.financials.inventory.value.amount)} (${scan.financials.inventory.includedStatus.replace("_", " ")})`,
    `FF&E: ${formatMoney(scan.financials.ffe.value.amount)} (${scan.financials.ffe.includedStatus.replace("_", " ")})`,
    `Real estate: ${formatMoney(scan.financials.realEstate.value.amount)} (${scan.financials.realEstate.includedStatus.replace("_", " ")})`,
    `Real estate ownership: ${scan.financials.realEstate.ownership.value ?? "Not Disclosed"}`,
    `Building size: ${scan.financials.realEstate.buildingSize.value ?? "Not Disclosed"}`,
    `Known additional acquisition costs: ${formatMoney(scan.financials.knownAdditionalAcquisitionCosts.amount)}`,
    `Combined asking price / SDE: ${formatRatio(scan.ratios.askingPriceToSde)}`,
    `Business-only asking price / SDE: ${formatRatio(scan.ratios.businessAskingPriceToSde)}`,
    `Asking price / EBITDA: ${formatRatio(scan.ratios.askingPriceToEbitda)}`,
    `SDE margin: ${formatPercent(scan.ratios.sdeToRevenue)}`,
    ...buildCashFlowLines(scan, assumptions),
    "",
    "Deal Clarity Summary",
    `Strategic fit: ${scan.claritySummary.strategicFit}`,
    `Attractive characteristics: ${scan.claritySummary.attractiveCharacteristics}`,
    `Seller dependence: ${scan.claritySummary.sellerDependence}`,
    `Equipment continuity: ${scan.claritySummary.equipmentContinuity}`,
    `Financial questions: ${scan.claritySummary.financialQuestions}`,
    `Major risks: ${scan.claritySummary.majorRisks}`,
    "",
    "Risk Checks",
    ...scan.riskChecks.flatMap((risk) => [
      `${risk.label}: ${risk.requiresVerification ? "REQUIRES VERIFICATION" : risk.status.toUpperCase()} - ${risk.explanation}`,
      ...(risk.verificationItems ?? []).map((item) => `Requires Verification: ${item}`)
    ]),
    "",
    "Missing Information",
    ...(scan.missingInformation.length > 0 ? scan.missingInformation : ["None listed."]),
    "",
    "Additional Listing Details",
    ...scan.businessDetails.additionalDetails.map((detail) => `${detail.label}: ${detail.value}`)
  ].flatMap(wrapLine);
}

function buildCashFlowLines(scan: DealScan, assumptions?: CashFlowAssumptions): string[] {
  if (!assumptions) return [];
  const result = calculateAcquisitionCashFlow(scan.financials, assumptions);
  if (result.current.annual === null) return [];
  const money = (amount: number | null) => amount === null ? "Unknown" : formatCashFlowMoney(amount);

  const lines = [
    "",
    "Post-Acquisition Cash Flow - Preliminary Estimates",
    "Current Operations - User Assumptions",
    `Starting metric: ${result.starting.label}`,
    `Starting amount: ${money(result.starting.amount)}`,
    `Amount source: ${result.starting.source.replace(/_/g, " ")} - not independently verified`,
    `Normalization assumptions: ${assumptions.normalizationNotes.trim() || "No separate notes supplied; user reviewed owner replacement and expense overlap."}`,
    ...currentCashFlowFields.map((field) => `${field.label}: ${money(parseCashFlowInput(assumptions[field.key], field.signed))}`),
    "Only incremental adjustments and costs deducted; owner replacement and overlap reviewed by user.",
    `Adjusted starting cash flow: ${money(result.current.adjustedStarting)}`,
    `Estimated annual cash remaining: ${money(result.current.annual)}`,
    `Estimated monthly cash remaining: ${money(result.current.monthly)}`
  ];

  if (result.improvements.annual !== null) {
    lines.push(
      "",
      "KingdomHaus Improvements - Separate Scenario",
      assumptions.savingsBasis === "proposed" ? "Savings basis: Proposed, hypothetical user assumptions; not achieved." :
        "Savings basis: Verified by user; scanner has not verified savings or future results.",
      ...improvementCashFlowFields.map((field) => `${field.label}: ${money(parseCashFlowInput(assumptions[field.key]))}`),
      "Replacement responsibilities, offsetting costs, and savings overlap reviewed by user.",
      `Estimated annual cash after improvements: ${money(result.improvements.annual)}`,
      `Estimated monthly cash after improvements: ${money(result.improvements.monthly)}`,
      `Annual difference from Current Operations: ${money(result.improvements.difference)}`,
      `One-time implementation costs: ${money(result.improvements.implementationCosts)}`,
      `First-year cash after implementation: ${result.improvements.firstYear === null ? "Incomplete - implementation costs unknown" : money(result.improvements.firstYear)}`
    );
  }
  lines.push(cashFlowDisclaimer, "Estimates are not guaranteed cash distributions.");
  return lines;
}

function formatPercent(value: number | null): string {
  return value === null ? "Not Disclosed" : `${(value * 100).toFixed(2)}%`;
}

function wrapLine(line: string): string[] {
  if (line.includes("\n")) return line.split(/\r?\n/).flatMap(wrapLine);
  const clean = toPdfText(line);
  if (clean.length <= 88) {
    return [clean];
  }

  const words = clean.split(" ").flatMap((word) => word.match(/.{1,88}/g) ?? []);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 88) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function paginate(lines: string[], size: number): string[][] {
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += size) {
    pages.push(lines.slice(index, index + size));
  }
  return pages.length > 0 ? pages : [["KingdomHaus Deal Scanner"]];
}

function buildPageStream(lines: string[]): string {
  const commands = ["BT", "/F1 11 Tf", `${margin} ${pageHeight - margin} Td`];
  lines.forEach((line, index) => {
    if (index > 0) {
      commands.push(`0 -${lineHeight} Td`);
    }
    commands.push(`(${escapePdf(line)}) Tj`);
  });
  commands.push("ET");
  return commands.join("\n");
}

function assemblePdf(objects: string[], catalogId: number): string {
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function addObject(objects: string[], content: string): number {
  objects.push(content);
  return objects.length;
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function toPdfText(value: string): string {
  return value.replace(/\s+/g, " ").normalize("NFKD").replace(/[^\x20-\x7E]/g, "");
}

function fileSafe(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "deal-scan";
}
