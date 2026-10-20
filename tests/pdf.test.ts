import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadScanPdf } from "../src/pdf";
import { buildLocalPreviewScan } from "../src/validation";
import { syntheticManufacturingFixture } from "./fixtures";
import { createCashFlowAssumptions } from "../src/acquisitionCashFlow";
import type { CashFlowAssumptions } from "../src/acquisitionCashFlow";

describe("PDF export", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates a downloadable PDF for a scan", () => {
    const scan = buildLocalPreviewScan({
      businessName: "Fictional Birch Climate",
      listingText: "Fictional Birch Climate. Synthetic test data only. Asking Price: $915,000. SDE: $183,000. Revenue: $1,098,000."
    });
    const link = {
      href: "",
      download: "",
      click: vi.fn()
    };
    const createElement = vi.fn(() => link);
    const createObjectURL = vi.fn(() => "blob:kingdomhaus-test");
    const revokeObjectURL = vi.fn();

    vi.stubGlobal("document", { createElement });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    downloadScanPdf(scan);

    expect(createElement).toHaveBeenCalledWith("a");
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(link.download).toBe("fictional-birch-climate.pdf");
    expect(link.click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:kingdomhaus-test");
  });

  it("includes corrected gross revenue and transaction split labels", async () => {
    const scan = buildLocalPreviewScan({
      listingText: syntheticManufacturingFixture
    });
    const link = {
      href: "",
      download: "",
      click: vi.fn()
    };
    const pdfBlobs: Blob[] = [];
    const createElement = vi.fn(() => link);
    const createObjectURL = vi.fn((blob: Blob) => {
      pdfBlobs.push(blob);
      return "blob:kingdomhaus-test";
    });

    vi.stubGlobal("document", { createElement });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });

    downloadScanPdf(scan);

    const pdfText = await pdfBlobs[0].text();
    expect(pdfText).toContain("Gross Annual Revenue: $775,132");
    expect(pdfText).toContain("SDE: $227,261");
    expect(pdfText).toContain("Inventory: Not Disclosed \\(included\\)");
    expect(pdfText).toContain("FF&E: Not Disclosed \\(included\\)");
    expect(pdfText).toContain("Real estate: $675,000 \\(included\\)");
    expect(pdfText).toContain("Total asking price: $1,240,000");
    expect(pdfText).toContain("Business component price: $565,000");
    expect(pdfText).toContain("Combined asking price / SDE: 5.46x");
    expect(pdfText).toContain("Business-only asking price / SDE: 2.49x");
    expect(pdfText).toContain("SDE margin: 29.32%");
  });

  const assumptions = (): CashFlowAssumptions => ({
    ...createCashFlowAssumptions(), normalizationAdjustment: "0", debtService: "120000", managementCosts: "60000",
    capexReserve: "12000", workingCapitalReserve: "12000", currentReviewed: true,
    payrollSavings: "80000", operatingSavings: "12000", improvementCosts: "30000", improvementsReviewed: true,
    implementationCosts: "20000"
  });

  async function exportCashFlow(inputs?: CashFlowAssumptions, sde = "$240,000") {
    const scan = buildLocalPreviewScan({ listingText: syntheticManufacturingFixture, corrections: { sde } });
    let blob: Blob | undefined;
    vi.stubGlobal("document", { createElement: () => ({ click: vi.fn() }) });
    vi.stubGlobal("URL", { createObjectURL: (value: Blob) => { blob = value; return "blob:test"; }, revokeObjectURL: vi.fn() });
    downloadScanPdf(scan, inputs);
    return (await blob!.text()).replace(/\\([()])/g, "$1");
  }

  it("omits incomplete or unused calculator results from PDF", async () => {
    expect(await exportCashFlow()).not.toContain("Post-Acquisition Cash Flow");
    expect(await exportCashFlow(createCashFlowAssumptions())).not.toContain("Post-Acquisition Cash Flow");
    expect(await exportCashFlow({ ...assumptions(), managementCosts: "" })).not.toContain("Post-Acquisition Cash Flow");
  });

  it("exports complete baseline, separate improvement assumptions, and one-time costs", async () => {
    const text = await exportCashFlow(assumptions());
    expect(text).toContain("Post-Acquisition Cash Flow - Preliminary Estimates");
    expect(text).toContain("Starting metric: SDE");
    expect(text).toContain("Starting amount: $240,000");
    expect(text).toContain("Amount source: user correction - not independently verified");
    expect(text).toContain("Estimated annual cash remaining: $36,000");
    expect(text).toContain("Estimated monthly cash remaining: $3,000");
    expect(text).toContain("KingdomHaus Improvements - Separate Scenario");
    expect(text).toContain("Proposed, hypothetical user assumptions; not achieved.");
    expect(text).toContain("Estimated annual cash after improvements: $98,000");
    expect(text).toContain("Annual difference from Current Operations: $62,000");
    expect(text).toContain("One-time implementation costs: $20,000");
    expect(text).toContain("First-year cash after implementation: $78,000");
  });

  it("exports corrected source values and negative results without adding incomplete improvements", async () => {
    const text = await exportCashFlow({ ...assumptions(), payrollSavings: "" }, "$180,000");
    expect(text).toContain("Starting amount: $180,000");
    expect(text).toContain("Estimated annual cash remaining: -$24,000");
    expect(text).toContain("Estimated monthly cash remaining: -$2,000");
    expect(text).not.toContain("KingdomHaus Improvements - Separate Scenario");
  });

  it("wraps long normalization notes without losing content or overflowing a line", async () => {
    const note = "buyer-assumption-".repeat(20);
    const text = await exportCashFlow({ ...assumptions(), normalizationNotes: note });
    const lines = [...text.matchAll(/^\((.*)\) Tj$/gm)].map((match) => match[1]);
    expect(lines.every((line) => line.length <= 88)).toBe(true);
    expect(lines.join("")).toContain(note);
  });
});
