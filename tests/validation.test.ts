import { describe, expect, it } from "vitest";
import { safeRatio } from "../src/financial";
import { buildLocalPreviewScan, normalizeAiScan, validateScanRequest } from "../src/validation";
import { bizBuySell2517190Fixture, bizBuySell2517190Url } from "./fixtures";

const listingText =
  "Established HVAC services company with $1.2M revenue and $240k SDE. Owner handles sales. Asking price is $850,000.";

describe("scan validation", () => {
  it("rejects short listings", () => {
    const result = validateScanRequest({ listingText: "too short" });
    expect(result.ok).toBe(false);
  });

  it("accepts valid listings and trims corrections", () => {
    const result = validateScanRequest({
      listingText,
      corrections: {
        askingPrice: " $850,000 ",
        oversized: "x".repeat(700)
      }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.corrections?.askingPrice).toBe("$850,000");
      expect(result.value.corrections?.oversized.length).toBe(500);
    }
  });

  it("normalizes AI output and recalculates ratios in app code", () => {
    const scan = normalizeAiScan(
      {
        overview: {
          businessName: { value: "Apex HVAC", source: "seller_claim", excerpts: ["Apex HVAC"] }
        },
        financials: {
          askingPrice: { amount: 850000, raw: "$850,000", source: "seller_claim", excerpts: ["Asking price is $850,000."] },
          annualRevenue: { amount: 1200000, raw: "$1.2M", source: "seller_claim", excerpts: ["$1.2M revenue"] },
          sde: { amount: 240000, raw: "$240k SDE", source: "seller_claim", excerpts: ["$240k SDE"] },
          ebitda: { amount: null, raw: null, source: "not_disclosed", excerpts: [] },
          advertisedCashFlow: {
            amount: 240000,
            raw: "$240k SDE",
            source: "seller_claim",
            sellerTerminology: "SDE",
            excerpts: ["$240k SDE"]
          }
        },
        claritySummary: {
          buying: "A local HVAC services company.",
          attractive: "Revenue and SDE are disclosed.",
          kingdomHausFit: "Could fit a services platform.",
          threats: "Owner handles sales.",
          unansweredQuestions: "Customer concentration.",
          verifyBeforeProceeding: "Tax returns and customer mix."
        },
        riskChecks: [],
        decision: { recommendation: "Investigate", explanation: "Promising, but owner dependence needs verification." }
      },
      { listingText },
      "test-model"
    );

    expect(scan.ratios.askingPriceToSde).toBe(3.54);
    expect(scan.ratios.askingPriceToEbitda).toBeNull();
    expect(scan.overview.location.value).toBeNull();
    expect(scan.riskChecks).toHaveLength(8);
  });

  it("retains BizBuySell 2534015 fields and treats excluded assets correctly", () => {
    const bizBuySellFixture = `
Well Established, Highly Profitable Printing and Packaging Company
Business Description
This print and packaging company is strategically located in an area with a high concentration of aerospace and defense companies, who are heavily reliant on the company's unique products and services. It has a long and well-established history, and is known for its high quality products.
Ad#:2534015
Business Location
Torrance, CA
Asking Price:
$3,500,000
Cash Flow:
$670,000
Gross Revenue:
$2,500,000
EBITDA:
N/A
FF&E:
$1,000,000
Included
Inventory:
$150,000
Not included
Real Estate:
$2,400,000
Not included in asking price
Established:
40
Employees:
10
Building SF:
40,000
Facilities:
The business is located in a large building that is paid off.
Competition:
The company provides specialized printing and packaging services.
Growth & Expansion:
The company is ready for an internet marketing effort, which could increase sales significantly.
Financing:
Seller financing is not available.
Support & Training:
The seller is willing to provide training and transition support.
Reason for Selling:
Retirement
Broker:
Sunbelt Business Brokers of Pasadena
`;

    const scan = buildLocalPreviewScan({
      businessName: "Well Established, Highly Profitable Printing and Packaging Company",
      listingUrl:
        "https://www.bizbuysell.com/business-opportunity/well-established-highly-profitable-printing-and-packaging-company/2534015/",
      listingText: bizBuySellFixture
    });

    expect(scan.analysisMode).toBe("rule_based");
    expect(scan.businessDetails.adNumber.value).toBe("2534015");
    expect(scan.businessDetails.fullDescription.value).toContain("aerospace and defense companies");
    expect(scan.businessDetails.fullDescription.value).not.toContain("Ad#:2534015");
    expect(scan.businessDetails.facilities.value).toContain("large building");
    expect(scan.overview.yearsOperating.value).toBe("Approximately 40 years");
    expect(scan.financials.askingPrice.amount).toBe(3500000);
    expect(scan.financials.annualRevenue.amount).toBe(2500000);
    expect(scan.financials.sde.amount).toBeNull();
    expect(scan.financials.advertisedCashFlow.amount).toBe(670000);
    expect(scan.financials.ebitda.amount).toBeNull();
    expect(scan.financials.ffe.value.amount).toBe(1000000);
    expect(scan.overview.employeeCount.value).toBe("10");
    expect(scan.overview.reasonForSale.value).toBe("Retirement");
    expect(scan.businessDetails.sellerSupportTraining.value).toContain("transition support");
    expect(scan.financials.inventory.includedStatus).toBe("not_included");
    expect(scan.financials.realEstate.includedStatus).toBe("not_included");
    expect(scan.financials.realEstate.buildingSize.value).toBe("40,000");
    expect(scan.financials.ffe.includedStatus).toBe("included");
    expect(scan.financials.knownAdditionalAcquisitionCosts.amount).toBe(150000);
    expect(scan.ratios.askingPriceToSde).toBeNull();
    expect(scan.ratios.askingPriceToEbitda).toBeNull();
    expect(safeRatio(scan.financials.askingPrice.amount, scan.financials.advertisedCashFlow.amount)).toBe(5.22);
    expect(scan.sellerClaims).not.toContain("2534015");
    expect(scan.businessDetails.additionalDetails.at(-1)?.label).toBe("Complete source text");
  });

  it("keeps long unstructured listing text out of titles and applies corrected values", () => {
    const longUnstructuredListing = `
Business Description This company serves commercial customers with specialized printing work. Asking Price: $3,500,000 Cash Flow: $670,000 Gross Revenue: $2,500,000 EBITDA: N/A FF&E: $1,000,000 Included Inventory: $150,000 Not included Real Estate: $2,400,000 Not included in asking price Employees: 10 Building SF: 40,000
`;

    const scan = buildLocalPreviewScan({
      listingText: longUnstructuredListing,
      corrections: {
        askingPrice: "$3,600,000",
        advertisedCashFlow: "$700,000",
        inventory: "$175,000 excluded",
        ffe: "$1,000,000 included"
      }
    });

    expect(scan.overview.businessName.value).toBeNull();
    expect(scan.businessDetails.listingTitle.value).toBeNull();
    expect(scan.financials.askingPrice.amount).toBe(3600000);
    expect(scan.financials.advertisedCashFlow.amount).toBe(700000);
    expect(scan.financials.inventory.value.amount).toBe(175000);
    expect(scan.financials.inventory.includedStatus).toBe("not_included");
    expect(scan.financials.ffe.includedStatus).toBe("included");
    expect(scan.financials.knownAdditionalAcquisitionCosts.amount).toBe(175000);
    expect(scan.financials.askingPrice.source).toBe("user_correction");
  });

  it("normalizes county location and excludes narrative inventory and FF&E claims", () => {
    const paintingFixture = `
Profitable Painting Co. Franchise Resale
Business Description
Residential and commercial painting franchise serving homeowners and local businesses with recurring exterior and interior painting demand.
Business Location
Location: Mecklenburg County, NC
Asking Price:
$350,000
Cash Flow:
$125,000
Gross Revenue:
$850,000
EBITDA:
N/A
Inventory:
No significant equipment or inventory is included in the sale.
FF&E:
No significant equipment or inventory is included in the sale.
Employees:
6
`;

    const scan = buildLocalPreviewScan({
      listingText: paintingFixture
    });

    expect(scan.overview.location.value).toBe("Mecklenburg County, NC");
    expect(scan.overview.location.value).not.toContain("Location:");
    expect(scan.businessDetails.listingTitle.value).toBe("Profitable Painting Co. Franchise Resale");
    expect(scan.overview.industry.value).toBe("Painting services");
    expect(scan.overview.services.value).toContain("painting franchise");
    expect(scan.financials.inventory.value.amount).toBeNull();
    expect(scan.financials.inventory.includedStatus).toBe("not_included");
    expect(scan.financials.ffe.value.amount).toBeNull();
    expect(scan.financials.ffe.includedStatus).toBe("not_included");
    expect(scan.financials.knownAdditionalAcquisitionCosts.amount).toBeNull();
    expect(scan.financials.askingPrice.amount).toBe(350000);
    expect(scan.financials.advertisedCashFlow.amount).toBe(125000);
  });

  it("separates included FF&E from equipment diligence gaps and de-duplicates seller claims", () => {
    const printingPackagingFixture = `
Printing and packaging business in Charlotte, North Carolina.
Established in 1950.
Asking price: $3,500,000. Annual revenue: $3,971,408. SDE: $990,000. EBITDA: $716,406.
18 full-time employees.
FF&E valued at $700,000 is included in the asking price.
Inventory valued at $150,000 is excluded.
Real estate is offered separately for $2,400,000.
One piece of equipment has an outstanding loan.
The owner is retiring and willing to assist with transition.
`;

    const scan = buildLocalPreviewScan({
      businessName: "Printing and packaging business in Charlotte, North Carolina",
      listingText: printingPackagingFixture
    });

    expect(scan.financials.ffe.value.amount).toBe(700000);
    expect(scan.financials.ffe.includedStatus).toBe("included");
    expect(scan.financials.inventory.includedStatus).toBe("not_included");
    expect(scan.financials.realEstate.includedStatus).toBe("not_included");
    expect(scan.financials.knownAdditionalAcquisitionCosts.amount).toBe(150000);
    expect(scan.overview.employeeCount.value).toBe("18 full-time employees");
    expect(scan.overview.reasonForSale.value).toBe("Retirement");
    expect(scan.businessDetails.sellerSupportTraining.value).toBe("The owner is retiring and willing to assist with transition.");
    expect(scan.claritySummary.equipmentContinuity).toContain("FF&E appears included in the asking price");
    expect(scan.claritySummary.equipmentContinuity).toContain("remaining useful life");
    expect(scan.riskChecks.find((risk) => risk.label === "Equipment continuity")?.explanation).toContain("liens or loans");
    expect(scan.financials.equipmentReplacementNeeds.value).toContain("outstanding loan");

    expect(scan.missingInformation).toContain("Customer concentration and top-customer revenue mix are not disclosed.");
    expect(scan.missingInformation).toContain("Equipment loan payoff amount, lien release, and closing treatment are not disclosed.");
    expect(scan.missingInformation).toContain(
      "Equipment condition, age, remaining useful life, maintenance records, and replacement exposure are not disclosed."
    );
    expect(scan.missingInformation).toContain("Supplier dependence, vendor terms, and single-source exposure are not disclosed.");
    expect(scan.missingInformation).toContain(
      "Financial verification documents, add-backs, working capital needs, and quality of earnings are not supplied."
    );
    expect(scan.missingInformation).toContain("Seller transition timeline, post-close role, and training terms are not fully disclosed.");

    expect(scan.sellerClaims).toContain("FF&E valued at $700,000 is included in the asking price.");
    expect(scan.sellerClaims).toContain("One piece of equipment has an outstanding loan.");
    expect(new Set(scan.sellerClaims).size).toBe(scan.sellerClaims.length);
    expect(scan.sellerClaims.some((claim) => claim.includes("Annual revenue:") && claim.includes("SDE:") && claim.includes("EBITDA:"))).toBe(false);
    expect(scan.analysisMode).toBe("rule_based");
    expect(scan.model).toBeNull();
  });

  it("extracts BizBuySell 2517190 transaction pricing without double-counting included assets", () => {
    const scan = buildLocalPreviewScan({
      listingUrl: bizBuySell2517190Url,
      listingText: bizBuySell2517190Fixture
    });
    const intro =
      "This Central North Carolina manufacturer makes industrial equipment accessories for a specialized niche that has found its market.";

    expect(scan.businessDetails.listingTitle.value).toBe("A Niche That Found Its Market - Manufacturer With Real Estate");
    expect(scan.businessDetails.adNumber.value).toBe("2517190");
    expect(scan.overview.location.value).toBe("Central North Carolina");
    expect(scan.overview.industry.value).toBe("Specialty manufacturing / industrial equipment accessories");
    expect(scan.overview.services.value).toBe("Industrial equipment accessories");
    expect(scan.businessDetails.growthOpportunities.value).toContain("online sales");
    expect(scan.businessDetails.growthOpportunities.value).toContain("unused manufacturing capacity");
    expect(scan.businessDetails.fullDescription.value).not.toMatch(/Business Description/);
    expect(scan.businessDetails.fullDescription.value).not.toMatch(/PRICE INCLUDES BUSINESS & REAL ESTATE/i);
    expect(scan.businessDetails.fullDescription.value).not.toMatch(/The transaction includes the business/i);
    expect(scan.businessDetails.fullDescription.value?.split(intro)).toHaveLength(2);
    expect(scan.businessDetails.brokerInformation.value).toBe("Carolina Business Advisors");
    expect(scan.financials.askingPrice.amount).toBe(1240000);
    expect(scan.financials.businessAskingPrice.amount).toBe(565000);
    expect(scan.financials.realEstate.value.amount).toBe(675000);
    expect(scan.financials.sde.amount).toBe(227261);
    expect(scan.financials.advertisedCashFlow.amount).toBe(227261);
    expect(scan.financials.advertisedCashFlow.sellerTerminology).toBe("Cash Flow (SDE)");
    expect(scan.financials.ebitda.amount).toBeNull();
    expect(scan.financials.annualRevenue.amount).toBe(775132);
    expect(scan.financials.realEstate.includedStatus).toBe("included");
    expect(scan.financials.inventory.value.amount).toBeNull();
    expect(scan.financials.inventory.includedStatus).toBe("included");
    expect(scan.financials.ffe.value.amount).toBeNull();
    expect(scan.financials.ffe.includedStatus).toBe("included");
    expect(scan.financials.knownAdditionalAcquisitionCosts.amount).toBeNull();
    expect(scan.ratios.businessAskingPriceToSde).toBe(2.49);
    expect(scan.ratios.askingPriceToSde).toBe(5.46);
    expect(scan.ratios.sdeToRevenue).toBe(0.2932);
    expect(scan.businessDetails.additionalDetails.some((detail) => /^(business|business description)$/i.test(detail.label))).toBe(false);
  });

  it("normalizes Cash Flow (SDE) into final SDE when AI output omits SDE", () => {
    const scan = normalizeAiScan(
      {
        financials: {
          advertisedCashFlow: {
            amount: 227261,
            raw: "Cash Flow (SDE): $227,261",
            source: "seller_claim",
            sellerTerminology: "Cash Flow (SDE)",
            excerpts: ["Cash Flow (SDE): $227,261"]
          }
        }
      },
      {
        listingUrl: bizBuySell2517190Url,
        listingText: bizBuySell2517190Fixture
      },
      "test-model"
    );

    expect(scan.financials.sde.amount).toBe(227261);
    expect(scan.financials.advertisedCashFlow.amount).toBe(227261);
    expect(scan.ratios.businessAskingPriceToSde).toBe(2.49);
    expect(scan.ratios.askingPriceToSde).toBe(5.46);
    expect(scan.ratios.sdeToRevenue).toBe(0.2932);
  });

  it("does not map generic cash flow to SDE without explicit SDE terminology", () => {
    const scan = buildLocalPreviewScan({
      listingText: `
Generic Service Company
Business Description
Steady service company with seller-reported cash flow but no earnings label.
Asking Price:
$500,000
Cash Flow:
$125,000
Gross Revenue:
$800,000
Real Estate:
Optional real estate available separately for $300,000.
`
    });

    expect(scan.financials.advertisedCashFlow.amount).toBe(125000);
    expect(scan.financials.advertisedCashFlow.sellerTerminology).toBe("Cash Flow");
    expect(scan.financials.sde.amount).toBeNull();
    expect(scan.ratios.askingPriceToSde).toBeNull();
    expect(scan.financials.realEstate.includedStatus).toBe("not_included");
  });
});
