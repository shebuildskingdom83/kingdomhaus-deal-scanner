import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultsScreen, type FormState } from "../src/App";
import { buildLocalPreviewScan } from "../src/validation";
import { syntheticManufacturingFixture, syntheticManufacturingUrl } from "./fixtures";
import { PostAcquisitionCashFlow } from "../src/PostAcquisitionCashFlow";
import { createCashFlowAssumptions } from "../src/acquisitionCashFlow";

const emptyForm: FormState = {
  businessName: "",
  listingUrl: syntheticManufacturingUrl,
  listingText: syntheticManufacturingFixture,
  askingPrice: "",
  businessAskingPrice: "",
  annualRevenue: "",
  sde: "",
  ebitda: "",
  advertisedCashFlow: "",
  inventory: "",
  ffe: "",
  realEstate: ""
};

describe("results dashboard rendering", () => {
  it("renders normalized 9900101 SDE, asset inclusion, margin, and multiples", () => {
    const scan = buildLocalPreviewScan({
      listingUrl: syntheticManufacturingUrl,
      listingText: syntheticManufacturingFixture
    });

    const html = renderToStaticMarkup(
      <ResultsScreen
        scan={scan}
        form={emptyForm}
        message={null}
        errors={[]}
        isLoading={false}
        isFetchingUrl={false}
        onBack={() => undefined}
        onDownload={() => undefined}
        onFieldChange={() => undefined}
        onRefresh={() => undefined}
        onScanFromUrl={() => undefined}
      />
    );

    expect(html).toContain("$227,261");
    expect(html).toContain("29.32%");
    expect(html).toContain("Business-only asking / SDE");
    expect(html).toContain("2.49x");
    expect(html).toContain("Combined asking / SDE");
    expect(html).toContain("5.46x");
    expect(html).toContain("Central North Carolina");
    expect(html).toMatch(/Inventory[\s\S]*Included[\s\S]*Not Disclosed/i);
    expect(html).toMatch(/FF&amp;E[\s\S]*Included[\s\S]*Not Disclosed/i);
    expect(html).toMatch(/Real estate[\s\S]*Included[\s\S]*\$675,000/i);
    expect(html).toContain('<details class="cash-flow-calculator"><summary>Post-Acquisition Cash Flow</summary>');
    expect(html.indexOf("Post-Acquisition Cash Flow")).toBeGreaterThan(html.indexOf("Financial Intelligence"));
    expect(html.indexOf("Post-Acquisition Cash Flow")).toBeLessThan(html.indexOf('class="panel clarity-panel"'));
  });

  it("renders unknown assumptions as incomplete and clearly labels the starting metric", () => {
    const scan = buildLocalPreviewScan({ listingText: syntheticManufacturingFixture });
    const html = renderToStaticMarkup(<PostAcquisitionCashFlow financials={scan.financials}
      assumptions={createCashFlowAssumptions()} onChange={() => undefined} />);
    expect(html).toContain('value="227261"');
    expect(html).toContain("Seller-reported amount; unverified");
    expect(html).toContain("SDE includes owner benefits");
    expect(html).toContain("Incomplete");
    expect(html).toContain("Unknown");
    expect(html).toContain("Proposed savings scenario");
  });

  it("renders negative estimates and an EBITDA normalization requirement", () => {
    const scan = buildLocalPreviewScan({ listingText: syntheticManufacturingFixture, corrections: { ebitda: "$200,000" } });
    const assumptions = { ...createCashFlowAssumptions(), startingMetric: "ebitda" as const, normalizationAdjustment: "0", normalizationNotes: "Buyer cash bridge estimate.",
      debtService: "180000", managementCosts: "60000", capexReserve: "12000", workingCapitalReserve: "12000", currentReviewed: true };
    const html = renderToStaticMarkup(<PostAcquisitionCashFlow financials={scan.financials}
      assumptions={assumptions} onChange={() => undefined} />);
    expect(html).toContain("EBITDA is not available cash");
    expect(html).toContain('class="cash-flow-negative">-$64,000');
    expect(html).toContain("Normalization assumptions (required)");
  });
});
