import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseMoney } from "../src/financial";
import { reconcileApifyListing, attachRetrieval, APIFY_ACTOR_ID } from "../src/hybridListing";
import { buildLocalPreviewScan } from "../src/validation";
import { createCashFlowAssumptions, calculateAcquisitionCashFlow } from "../src/acquisitionCashFlow";
import { AcquisitionRepository, formFromScan, makeRecord, parseBackup, serializeBackup } from "../src/storage";
import { buildCurrentAcquisitionCsv, buildSavedAcquisitionsCsv } from "../src/csv";
import { ResultsScreen } from "../src/App";
import { downloadScanPdf } from "../src/pdf";
import { buildPuterPrompt } from "../src/puterPoc";

// Fictional identity and narrative; monetary constants reproduce the reported
// scale/rounding failure without retaining a real listing or acquisition backup.
const url = "https://www.bizbuysell.com/business-opportunity/fictional-design-fixture/9900106/";
const description = "Fictional showroom platform for offline regression testing. The example product lines have 68.5% and 73.2% contribution margins.\nNormalized Seller's Discretionary Earnings (SDE): approximately $1.53 million\nExample departmental receipts: $1.31 million. Example combined contribution: $1.38 million.\nThe fictional seller offers a structured transition.";
const provider = () => ({ id: "9900106", url, title: "$1.53M SDE Fictional Showroom Platform", fullDescription: description,
  askingPrice: 4500000, grossRevenue: 3230000, cashFlow: 1525000, ebitda: 1350000,
  category: "Synthetic showroom services", location: "Example County, SC", employees: "7 full-time",
  facilities: "Fictional showroom and workshop.", supportTraining: "Fictional structured transition.",
  growthExpansion: "Fictional cross-selling opportunities.", reasonForSelling: "Fictional retirement.",
  brokerName: "Jordan Example", brokerCompany: "Example Brokerage",
  businessWebsite: "https://showroom.example/", images: [{ url: "https://images.bizbuysell.com/fictional-showroom.jpg", alt: "Synthetic listing image" }] });
const reconcile = (data: Record<string, unknown> = provider(), corrections?: Record<string, string>) => {
  const result = reconcileApifyListing(data, { listingText: "", listingUrl: url, corrections });
  return { result, scan: buildLocalPreviewScan(result.request) };
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("million-dollar seller earnings extraction", () => {
  it.each(["$1,525,000", "$1525000", "$1.525M", "1.525 million", "$1.525 million", "1525k", "$1525K", "1,525 thousand", "1,525,000"])("parses complete currency %s", value => {
    expect(parseMoney(value)).toBe(1525000);
  });

  it.each(["Cash Flow (SDE): $1,525,000", "Cash Flow (SDE): $1.525M", "Cash Flow (SDE)\n$1.525 million",
    "SDE: $1.525 million", "Normalized Seller's Discretionary Earnings: approximately $1.525 million",
    "Normalized Seller\u2019s Discretionary Earnings (SDE): $1.525M", "Seller's Discretionary Earnings: $1,525,000"])("retains seller-reported classification for %s", earnings => {
    const scan = buildLocalPreviewScan({ listingText: `Fictional example\nAsking Price: $4,500,000\nGross Revenue: $3,230,000\n${earnings}\nEBITDA: $1,350,000` });
    expect(scan.financials.sde).toMatchObject({ amount: 1525000, source: "seller_claim" });
    expect(scan.financials.advertisedCashFlow.amount).toBe(1525000);
    expect(scan.financials.ebitda.amount).toBe(1350000);
    expect(scan.ratios.askingPriceToSde).toBe(2.95);
    expect(scan.ratios.sdeToRevenue).toBe(0.4721);
  });

  it("reconciles rounded narrative SDE with precise provider cashFlow, rather than overriding it with 1.53", () => {
    const { result, scan } = reconcile();
    expect(result.conflicts).toEqual([]);
    expect(scan.financials.sde).toMatchObject({ amount: 1525000, raw: "$1525000", source: "seller_claim" });
    expect(scan.financials.advertisedCashFlow).toMatchObject({ amount: 1525000, sellerTerminology: "Cash Flow (SDE)" });
    expect(scan.financials.sde.excerpts.join(" ")).toContain("$1525000");
    expect(result.request.listingText).toContain("$1.53 million");
    expect(scan.ratios).toMatchObject({ askingPriceToSde: 2.95, askingPriceToEbitda: 3.33, sdeToRevenue: 0.4721 });
    const final = attachRetrieval(scan, { provider: "apify", actorId: APIFY_ACTOR_ID, retrievedAt: scan.createdAt,
      sourceUrl: url, maxChargeUsd: 0.25, usageUsd: null, rawRecord: provider(), conflicts: result.conflicts, photographs: result.photographs });
    expect(final.missingInformation.some(value => /source text 1\.53\b/.test(value))).toBe(false);
    expect(final.riskChecks.some(value => value.label === "Source conflicts")).toBe(false);
  });

  it.each(["$1,525,000", "1525000", "$1.525M", "$1.525 million"])("supports a precise provider currency string %s", cashFlow => {
    expect(reconcile({ ...provider(), cashFlow }).scan.financials.sde.amount).toBe(1525000);
  });

  it("prefers explicit Cash Flow (SDE) over a rounded title and narrative", () => {
    const { scan } = reconcile({ ...provider(), detailsRaw: { "Cash Flow (SDE)": "$1,525,000" } });
    expect(scan.financials.sde.amount).toBe(1525000);
  });

  it("keeps unsupported cash flow generic and undisclosed fields missing", () => {
    const { scan } = reconcile({ cashFlow: 1525000, title: "Fictional generic cash flow example", description: "No earnings classification is supplied in this fictional fixture." });
    expect(scan.financials.sde.amount).toBeNull();
    expect(scan.financials.ebitda.amount).toBeNull();
    expect(scan.financials.advertisedCashFlow.amount).toBe(1525000);
    expect(scan.overview.employeeCount.value).toBeNull();
  });

  it("preserves material source conflicts and does not merge different earnings figures", () => {
    const { scan, result } = reconcile({ ...provider(), cashFlow: 1200000 });
    expect(result.conflicts.some(value => value.includes("1200000") && value.includes("1530000"))).toBe(true);
    expect(scan.financials.sde.amount).toBe(1530000);
    expect(scan.financials.sde.source).toBe("seller_claim");
    const final = attachRetrieval(scan, { provider: "apify", actorId: APIFY_ACTOR_ID, retrievedAt: scan.createdAt,
      sourceUrl: url, maxChargeUsd: 0.25, usageUsd: null, rawRecord: {}, conflicts: result.conflicts, photographs: [] });
    expect(final.riskChecks.some(value => value.label === "Source conflicts" && value.requiresVerification)).toBe(true);
    expect(final.missingInformation.some(value => value.includes("1200000"))).toBe(true);
  });

  it("preserves explicit corrections above rounded and precise automated earnings", () => {
    const { scan } = reconcile(provider(), { sde: "$1,600,000", advertisedCashFlow: "$1,525,000" });
    expect(scan.financials.sde).toMatchObject({ amount: 1600000, source: "user_correction" });
    expect(scan.financials.advertisedCashFlow.amount).toBe(1525000);
    expect(scan.financials.ebitda.amount).toBe(1350000);
  });

  it("keeps a separately disclosed generic cash-flow stream distinct from SDE", () => {
    const { scan, result } = reconcile({ ...provider(), fullDescription: "Fictional business.\nSDE: $1.53 million\nCash Flow: $2.1 million" });
    expect(scan.financials.sde.amount).toBe(1525000);
    expect(scan.financials.advertisedCashFlow).toMatchObject({ amount: 2100000, sellerTerminology: "Cash Flow" });
    expect(result.conflicts).toHaveLength(1);
  });

  it("supports an explicit normalized-earnings provider label without inventing a generic cash-flow classification", () => {
    const { scan } = reconcile({ title: "Fictional provider label example", detailsRaw: { "Normalized Seller's Discretionary Earnings": "$1.525 million" } });
    expect(scan.financials.sde).toMatchObject({ amount: 1525000, source: "seller_claim" });
  });

  it("preserves decimal-bearing description claims and other mapped details", () => {
    const { scan, result } = reconcile();
    const text = scan.businessDetails.fullDescription.value!;
    for (const value of ["68.5%", "73.2%", "$1.53 million", "$1.31 million", "$1.38 million", "structured transition"])
      expect(text).toContain(value);
    expect(scan.overview.employeeCount.value).toBe("7 full-time");
    expect(scan.businessDetails.facilities.value).toContain("Fictional showroom");
    expect(scan.businessDetails.businessWebsite?.value).toBe("https://showroom.example/");
    expect(scan.businessDetails.brokerInformation.value).toContain("Jordan Example");
    expect(result.photographs).toHaveLength(1);
    expect(result.photographs[0].sourceUrl).toBe(url);
    expect(scan.listingText.replace(/\s+/g, " ")).toContain(description.replace(/\s+/g, " "));
  });

  it("propagates normalized earnings through dashboard, cash-flow source, storage, JSON, CSV and PDF", async () => {
    const { scan } = reconcile();
    const assumptions = createCashFlowAssumptions();
    expect(buildPuterPrompt(scan)).toContain('1525000');
    expect(buildPuterPrompt(scan)).toContain('1350000');
    expect(calculateAcquisitionCashFlow(scan.financials, assumptions).starting).toMatchObject({ metric: "sde", amount: 1525000 });
    const record = makeRecord({ scan, form: formFromScan(scan), cashFlow: assumptions });
    let raw: string | null = null;
    const store = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
    const repo = new AcquisitionRepository(() => store); repo.load(); repo.save(record, null);
    const reopened = new AcquisitionRepository(() => store).load().records[0];
    expect(reopened.state).toEqual(record.state);
    const restored = parseBackup(serializeBackup(reopened));
    expect(restored.state).toEqual(reopened.state);
    const html = renderToStaticMarkup(<ResultsScreen scan={restored.state.scan} form={restored.state.form}
      message={null} errors={[]} isLoading={false} isFetchingUrl={false} onBack={() => {}} onDownload={() => {}}
      onFieldChange={() => {}} onRefresh={() => {}} onScanFromUrl={() => {}} />);
    expect(html).toContain("$1,525,000");
    expect(html).toContain("47.21%");
    expect(html).toContain("2.95x");
    expect(html).toContain("Seller-reported SDE");
    expect(html).toContain("verify SDE, EBITDA, revenue");
    expect(html).not.toContain("2941176.47");
    for (const csv of [buildCurrentAcquisitionCsv(restored.state.scan, assumptions), buildSavedAcquisitionsCsv([restored])]) {
      expect(csv).toContain('"1525000"'); expect(csv).toContain('"47.21"'); expect(csv).toContain('"2.95"');
    }
    const blobs: Blob[] = [];
    vi.stubGlobal("document", { createElement: () => ({ click() {}, href: "", download: "" }) });
    vi.stubGlobal("URL", { createObjectURL: (blob: Blob) => { blobs.push(blob); return "blob:synthetic"; }, revokeObjectURL() {} });
    downloadScanPdf(restored.state.scan, assumptions);
    const pdf = await blobs[0].text();
    expect(pdf).toContain("$1,525,000"); expect(pdf).toContain("47.21%"); expect(pdf).toContain("2.95x");
    expect(pdf).not.toContain("2941176.47");
  });
});
