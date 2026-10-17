import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultsScreen, type FormState } from "../src/App";
import { calculateAcquisitionCashFlow, createCashFlowAssumptions } from "../src/acquisitionCashFlow";
import { downloadScanPdf } from "../src/pdf";
import { buildPuterPrompt } from "../src/puterPoc";
import { buildLocalPreviewScan, normalizeAiScan } from "../src/validation";
import { painting2505993Fixture, painting2505993Url } from "./painting2505993Fixture";

const request = { listingText: painting2505993Fixture, listingUrl: painting2505993Url };
const scanListing = () => buildLocalPreviewScan(request);
const currentAssumptions = () => ({
  ...createCashFlowAssumptions(), normalizationAdjustment: "0", debtService: "12000", managementCosts: "30000",
  capexReserve: "3000", workingCapitalReserve: "2400", currentReviewed: true
});
const form: FormState = {
  businessName: "", listingUrl: painting2505993Url, listingText: painting2505993Fixture, askingPrice: "", businessAskingPrice: "",
  annualRevenue: "", sde: "", ebitda: "", advertisedCashFlow: "", inventory: "", ffe: "", realEstate: ""
};

describe("Painting Co. 2505993 regression", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("extracts source financials and clean operational facts from the full listing body", () => {
    const scan = scanListing();
    expect(scan.businessDetails.listingTitle.value).toBe("Painting Co. $350K+ Sales, Exclusive Area (Unbroker Exclusive)");
    expect(scan.businessDetails.brokerInformation.value).toBe("Cory Hogan \u2014 Unbroker");
    expect(scan.businessDetails.brokerInformation.source).toBe("seller_claim");
    expect(scan.businessDetails.brokerInformation.excerpts.join(" ")).toContain("Cory Hogan Unbroker");
    expect(scan.overview.location.value).toBe("Mecklenburg County, NC");
    expect(scan.overview.industry.value).toBe("Painting services");
    expect(scan.overview.services.value).toBe("Residential and commercial painting franchise services");
    expect(scan.overview.revenueModel.value).toBe("Mobile painting services franchise");
    expect(scan.overview.customerSegments?.value).toBe("85% Residential / 15% Commercial Revenue Mix");
    expect(scan.overview.employeeCount.value).toBe("1 Employee");
    expect(scan.overview.ownerInvolvement.value).toContain("sales, scheduling, and customer communication");
    expect(scan.overview.ownerInvolvement.value).toContain("40-hour workweek");
    expect(scan.overview.ownerInvolvement.value).not.toMatch(/retirement|24-hour|Disclaimer|Unbroker/);
    expect(scan.businessDetails.sellerSupportTraining.value).toContain("Seller will provide training on daily operations");
    expect(scan.businessDetails.sellerSupportTraining.value).toContain("Ongoing franchisor support");
    expect(scan.businessDetails.sellerSupportTraining.value).not.toMatch(/Reason for Selling|planned retirement|Franchise:/);
    expect(scan.businessDetails.facilities.value).toContain("No significant equipment or inventory is included in the sale.");
    expect(scan.businessDetails.facilities.value).toContain("operational flexibility within the defined service area.");
    expect(scan.businessDetails.competition.value).toContain("both residential and commercial segments.");
    expect(scan.businessDetails.growthOpportunities.value).toContain("reduce owner involvement in job execution.");
    expect(scan.businessDetails.growthOpportunities.value).toContain("under new motivated ownership.");
    expect(scan.businessDetails.fullDescription.value).not.toMatch(/Disclaimer|does not guarantee|Prospective buyers/);
    expect(scan.listingText).toBe(painting2505993Fixture);
    expect(scan.businessDetails.additionalDetails.find((item) => item.label === "Complete source text")?.value).toContain("does not guarantee");
    expect(scan.financials.askingPrice.amount).toBe(137500);
    expect(scan.financials.annualRevenue.amount).toBe(352757);
    expect(scan.financials.sde.amount).toBe(66392);
    expect(scan.financials.advertisedCashFlow.amount).toBe(66392);
    expect(scan.financials.ebitda.amount).toBeNull();
    expect(scan.financials.inventory.includedStatus).toBe("not_included");
    expect(scan.financials.inventory.value.amount).toBeNull();
    expect(scan.financials.ffe.includedStatus).toBe("not_included");
    expect(scan.financials.ffe.value.amount).toBeNull();
  });

  it("flags all seven franchise questions without inventing fees or permissions", () => {
    const scan = scanListing();
    const check = scan.riskChecks.find((risk) => risk.label === "Franchise requirements");
    expect(check?.status).toBe("unknown");
    expect(check?.requiresVerification).toBe(true);
    expect(check?.verificationItems).toEqual([
      "Franchisor approval of ownership transfers", "Franchise transfer fees", "Royalty and marketing fees", "Territory restrictions",
      "Operating requirements", "Franchise agreement terms and renewal conditions", "Whether shared management across KingdomHaus companies is permitted"
    ]);
    expect(check?.excerpts.join(" ")).toMatch(/franchise/i);
    for (const point of check?.verificationItems ?? []) expect(scan.missingInformation).toContain(`Requires Verification: ${point}.`);
    expect(check?.explanation).not.toMatch(/\$|\d%|is prohibited|is permitted/);
    expect(scan.riskChecks.find((risk) => risk.label === "Owner dependence")?.explanation).toContain("Verify who will cover these responsibilities");
    expect(scan.claritySummary.sellerDependence).toContain("no salary or available KingdomHaus staffing is assumed");
  });

  it.each([
    ["Cory Hogan Unbroker", "Cory Hogan \u2014 Unbroker"],
    ["Cory Hogan\nUnbroker", "Cory Hogan \u2014 Unbroker"]
  ])("recognizes the attribution format %s", (attribution, expected) => {
    const scan = buildLocalPreviewScan({ ...request, listingText: painting2505993Fixture.replace("Cory Hogan Unbroker", attribution) });
    expect(scan.businessDetails.brokerInformation.value).toBe(expected);
  });

  it("extracts explicit broker name/company labels and rejects a disclaimer posing as broker data", () => {
    const valid = buildLocalPreviewScan({ listingText: "Service Company\nBusiness Description\nResidential services business.\nBroker Name: Cory Hogan\nBroker Company: Unbroker" });
    expect(valid.businessDetails.brokerInformation.value).toBe("Cory Hogan \u2014 Unbroker");
    const missing = buildLocalPreviewScan({ ...request, listingText: painting2505993Fixture.split("Business Listed By:")[0] });
    expect(missing.businessDetails.brokerInformation).toMatchObject({ value: null, source: "not_disclosed" });
    const disclaimer = buildLocalPreviewScan({ listingText: "Service Company\nBusiness Description\nIndependent service business.\nBroker: Unbroker LLC does not guarantee the accuracy of seller information." });
    expect(disclaimer.businessDetails.brokerInformation.value).toBeNull();
  });

  it("does not infer a franchise or painting service from independent businesses and footer navigation", () => {
    const scan = buildLocalPreviewScan({ listingText: "Independent Bakery\nBusiness Description\nIndependent retail bakery. This business is not a franchise.\nAd#:1234567\nFranchises for Sale\nFind a Broker" });
    expect(scan.riskChecks.some((risk) => risk.requiresVerification)).toBe(false);
    expect(scan.overview.industry.value).not.toBe("Painting services");
    expect(scan.businessDetails.brokerInformation.value).toBeNull();
  });

  it("keeps unknown owner duties unknown instead of using retirement as an operating role", () => {
    const scan = buildLocalPreviewScan({ listingText: "Service Company\nBusiness Description\nServices to local homeowners. The owner is retiring and willing to assist with transition." });
    expect(scan.overview.ownerInvolvement.value).toBeNull();
    expect(scan.businessDetails.sellerSupportTraining.value).toContain("assist with transition");
    expect(scan.riskChecks.find((risk) => risk.label === "Owner dependence")?.status).toBe("unknown");
  });

  it("preserves deterministic source facts and franchise verification in AI-normalized reports", () => {
    const scan = normalizeAiScan({
      overview: { ownerInvolvement: { value: "Absentee ownership", source: "ai_inference" }, services: { value: painting2505993Fixture, source: "ai_inference" } },
      businessDetails: { brokerInformation: { value: "Unbroker LLC does not guarantee accuracy", source: "seller_claim" } },
      riskChecks: [{ label: "Owner dependence", status: "clear", explanation: "No replacement required." }]
    }, request, "test-model");
    expect(scan.businessDetails.brokerInformation.value).toBe("Cory Hogan \u2014 Unbroker");
    expect(scan.overview.services.value).toBe("Residential and commercial painting franchise services");
    expect(scan.overview.ownerInvolvement.value).toContain("40-hour workweek");
    expect(scan.riskChecks.find((risk) => risk.label === "Owner dependence")?.status).toBe("watch");
    expect(scan.riskChecks.find((risk) => risk.label === "Franchise requirements")?.verificationItems).toHaveLength(7);
    expect(scan.missingInformation.filter((point) => point.startsWith("Requires Verification:"))).toHaveLength(7);
    const prompt = buildPuterPrompt(scan);
    expect(prompt).toContain('"sde":66392');
    expect(prompt).toContain('"ebitda":null');
    expect(prompt).toContain("Cory Hogan");
  });

  it("does not promote generic cash flow because its context mentions historical SDE", () => {
    const scan = normalizeAiScan({ financials: { advertisedCashFlow: {
      amount: 66392, raw: "$66,392", source: "seller_claim", sellerTerminology: "Cash Flow",
      excerpts: ["Cash Flow: $66,392. Historical SDE is not supplied."]
    } } }, { listingText: "Service business.\nCash Flow: $66,392\nGross Revenue: $352,757\nHistorical SDE is not supplied." }, "test-model");
    expect(scan.financials.sde.amount).toBeNull();
    expect(scan.financials.advertisedCashFlow.amount).toBe(66392);
  });

  it("does not borrow revenue or other section values when a financial header is empty", () => {
    const scan = buildLocalPreviewScan({ listingText: "Service Company\nBusiness Description\nLocal services business.\nAd#:1234567\nEBITDA:\nGross Revenue:$352,757\nCash Flow:$66,392" });
    expect(scan.financials.ebitda.amount).toBeNull();
    expect(scan.financials.sde.amount).toBeNull();
    expect(scan.financials.annualRevenue.amount).toBe(352757);
    expect(scan.financials.advertisedCashFlow.amount).toBe(66392);
  });

  it("renders clean broker and business facts, owner context, and Requires Verification in the existing dashboard", () => {
    const html = renderToStaticMarkup(<ResultsScreen scan={scanListing()} form={form} message={null} errors={[]}
      isLoading={false} isFetchingUrl={false} onBack={() => undefined} onDownload={() => undefined}
      onFieldChange={() => undefined} onRefresh={() => undefined} onScanFromUrl={() => undefined} />);
    expect(html).toContain("Cory Hogan \u2014 Unbroker");
    expect(html).toContain("Business model");
    expect(html).toContain("85% Residential / 15% Commercial Revenue Mix");
    expect(html).toContain("Requires Verification");
    expect(html).toContain("Franchisor approval of ownership transfers");
    expect(html).toContain("shared management across KingdomHaus companies");
    expect(html).toContain("Seller-reported owner role:");
    expect(html).toContain("40-hour workweek");
    expect(html).toContain("Principal and interest");
    expect(html).toContain("Estimates are not guaranteed cash distributions.");
    expect(html).not.toContain("Unbroker LLC does not guarantee");
    expect(html).toContain("KingdomHaus Intelligence");
    expect(html).toContain("Send to Notion");
  });

  it("calculates current cash once, keeps owner compensation explicit, and separates proposed savings and one-time costs", () => {
    const scan = scanListing();
    const defaults = calculateAcquisitionCashFlow(scan.financials, createCashFlowAssumptions());
    expect(defaults.starting.metric).toBe("sde");
    expect(defaults.starting.amount).toBe(66392);
    expect(defaults.current.annual).toBeNull();
    const assumptions = currentAssumptions();
    const baseline = calculateAcquisitionCashFlow(scan.financials, assumptions);
    expect(baseline.current.annual).toBe(18992);
    expect(baseline.current.monthly).toBe(1582.67);
    // A replacement cost already reflected in the earnings bridge is not entered a second time.
    expect(calculateAcquisitionCashFlow(scan.financials, { ...assumptions, normalizationAdjustment: "-30000", managementCosts: "0" }).current.annual).toBe(18992);
    expect(calculateAcquisitionCashFlow(scan.financials, { ...assumptions, managementCosts: "" }).current.annual).toBeNull();
    const improved = calculateAcquisitionCashFlow(scan.financials, { ...assumptions, payrollSavings: "8000", operatingSavings: "4000", improvementCosts: "3000", improvementsReviewed: true, implementationCosts: "5000" });
    expect(improved.current.annual).toBe(18992);
    expect(improved.improvements).toMatchObject({ annual: 27992, difference: 9000, firstYear: 22992 });
  });

  it("includes owner duties, broker attribution, franchise checks, and preliminary calculator output in PDF", async () => {
    let blob: Blob | undefined;
    vi.stubGlobal("document", { createElement: () => ({ click: vi.fn() }) });
    vi.stubGlobal("URL", { createObjectURL: (pdf: Blob) => { blob = pdf; return "blob:test"; }, revokeObjectURL: vi.fn() });
    downloadScanPdf(scanListing(), currentAssumptions());
    const pdf = (await blob!.text()).replace(/\\([()])/g, "$1");
    const text = [...pdf.matchAll(/^\((.*)\) Tj$/gm)].map((match) => match[1]).join(" ");
    expect(text).toContain("Broker: Cory Hogan");
    expect(text).toContain("Unbroker");
    expect(text).toContain("40-hour workweek");
    expect(text).toContain("Franchise requirements: REQUIRES VERIFICATION");
    expect(text).toContain("Franchise transfer fees");
    expect(text).toContain("within the defined service area. Previous years");
    expect(text).toContain("Estimated annual cash remaining: $18,992");
    expect(text).toContain("Estimates are not guaranteed cash distributions.");
  });
});
