import { describe, expect, it } from "vitest";
import { calculateKnownAdditionalCosts, calculateRatios, formatMoney, formatRatio, parseMoney, safeRatio } from "../src/financial";

describe("financial helpers", () => {
  it("parses common seller money formats", () => {
    expect(parseMoney("$750,000")).toBe(750000);
    expect(parseMoney("1.4M")).toBe(1400000);
    expect(parseMoney("220k")).toBe(220000);
    expect(parseMoney("$240,000 SDE")).toBe(240000);
    expect(parseMoney("Not Disclosed")).toBeNull();
    expect(parseMoney("Ad#:2534015")).toBeNull();
    expect(parseMoney("10 employees")).toBeNull();
    expect(parseMoney("40,000 sq ft")).toBeNull();
  });

  it("does not calculate ratios with missing or zero denominators", () => {
    expect(safeRatio(750000, null)).toBeNull();
    expect(safeRatio(750000, 0)).toBeNull();
  });

  it("calculates acquisition screening ratios deterministically", () => {
    expect(
      calculateRatios({
        askingPrice: 750000,
        businessAskingPrice: null,
        annualRevenue: 1400000,
        sde: 220000,
        ebitda: 180000
      })
    ).toEqual({
      askingPriceToSde: 3.41,
      businessAskingPriceToSde: null,
      askingPriceToEbitda: 4.17,
      sdeToRevenue: 0.1571
    });
  });

  it("formats unavailable values as Not Disclosed", () => {
    expect(formatMoney(null)).toBe("Not Disclosed");
    expect(formatRatio(null)).toBe("Not Disclosed");
  });

  it("separates excluded assets without double-counting included FF&E", () => {
    expect(
      calculateKnownAdditionalCosts({
        inventory: {
          value: { amount: 150000, raw: "$150,000 not included", source: "seller_claim", excerpts: [] },
          includedStatus: "not_included",
          notes: { value: "Not included", source: "seller_claim", excerpts: [] }
        },
        ffe: {
          value: { amount: 1000000, raw: "$1,000,000 included", source: "seller_claim", excerpts: [] },
          includedStatus: "included",
          notes: { value: "Included", source: "seller_claim", excerpts: [] }
        },
        realEstate: {
          value: { amount: 2400000, raw: "$2,400,000 not included", source: "seller_claim", excerpts: [] },
          includedStatus: "not_included",
          notes: { value: "Not included", source: "seller_claim", excerpts: [] },
          ownership: { value: "Owned", source: "seller_claim", excerpts: [] },
          buildingSize: { value: "40,000", source: "seller_claim", excerpts: [] }
        }
      })
    ).toBe(150000);
  });

  it("does not treat included real estate as an additional acquisition cost", () => {
    expect(
      calculateKnownAdditionalCosts({
        inventory: {
          value: { amount: null, raw: "Included; value not separately disclosed", source: "seller_claim", excerpts: [] },
          includedStatus: "included",
          notes: { value: "Included", source: "seller_claim", excerpts: [] }
        },
        ffe: {
          value: { amount: null, raw: "Included; value not separately disclosed", source: "seller_claim", excerpts: [] },
          includedStatus: "included",
          notes: { value: "Included", source: "seller_claim", excerpts: [] }
        },
        realEstate: {
          value: { amount: 675000, raw: "$675,000 included in the advertised transaction", source: "seller_claim", excerpts: [] },
          includedStatus: "included",
          notes: { value: "Included in advertised transaction", source: "seller_claim", excerpts: [] },
          ownership: { value: "Owned", source: "seller_claim", excerpts: [] },
          buildingSize: { value: null, source: "not_disclosed", excerpts: [] }
        }
      })
    ).toBeNull();
  });
});
