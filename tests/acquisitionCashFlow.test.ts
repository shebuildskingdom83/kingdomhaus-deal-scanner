import { describe, expect, it } from "vitest";
import { calculateAcquisitionCashFlow, createCashFlowAssumptions, formatCashFlowMoney, parseCashFlowInput, resolveCashFlowStartingPoint } from "../src/acquisitionCashFlow";
import type { CashFlowAssumptions } from "../src/acquisitionCashFlow";
import { buildLocalPreviewScan } from "../src/validation";
import { bizBuySell2517190Fixture } from "./fixtures";

export const completeCashFlowAssumptions = (): CashFlowAssumptions => ({
  ...createCashFlowAssumptions(),
  normalizationAdjustment: "0",
  debtService: "120000",
  managementCosts: "60000",
  capexReserve: "12000",
  workingCapitalReserve: "12000",
  currentReviewed: true,
  payrollSavings: "80000",
  operatingSavings: "12000",
  improvementCosts: "30000",
  improvementsReviewed: true,
  implementationCosts: "20000"
});

function financials(corrections: Record<string, string> = { sde: "$240,000" }) {
  return buildLocalPreviewScan({ listingText: bizBuySell2517190Fixture, corrections }).financials;
}

describe("post-acquisition cash flow", () => {
  it("calculates annual and monthly current operations from explicit incremental costs", () => {
    const result = calculateAcquisitionCashFlow(financials(), completeCashFlowAssumptions());
    expect(result.starting.metric).toBe("sde");
    expect(result.current).toEqual({ annual: 36000, monthly: 3000, adjustedStarting: 240000, missing: [] });
  });

  it("keeps improvements separate and deducts one-time costs only in year one", () => {
    const assumptions = completeCashFlowAssumptions();
    const result = calculateAcquisitionCashFlow(financials(), assumptions);
    expect(result.improvements).toMatchObject({ annual: 98000, monthly: 8166.67, difference: 62000, firstYear: 78000, implementationCosts: 20000, missing: [] });
    expect(result.current.annual).toBe(36000);
    const largerSetup = calculateAcquisitionCashFlow(financials(), { ...assumptions, implementationCosts: "120000" });
    expect(largerSetup.improvements.annual).toBe(98000);
    expect(largerSetup.improvements.firstYear).toBe(-22000);
  });

  it("preserves negative annual and monthly cash and negative improvement differences", () => {
    const result = calculateAcquisitionCashFlow(financials(), {
      ...completeCashFlowAssumptions(), debtService: "180000", payrollSavings: "0", operatingSavings: "0"
    });
    expect(result.current.annual).toBe(-24000);
    expect(result.current.monthly).toBe(-2000);
    expect(result.improvements.difference).toBe(-30000);
    expect(result.improvements.annual).toBe(-54000);
    expect(result.improvements.monthly).toBe(-4500);
  });

  it("leaves assumptions unknown by default, including zero costs and one-time costs", () => {
    const assumptions = createCashFlowAssumptions();
    const result = calculateAcquisitionCashFlow(financials(), assumptions);
    expect(result.starting.amount).toBe(240000);
    expect(result.current.annual).toBeNull();
    expect(result.improvements.annual).toBeNull();
    expect(result.improvements.implementationCosts).toBeNull();
    expect(assumptions.debtService).toBe("");
    const explicitZero = {
      ...completeCashFlowAssumptions(), debtService: "0", managementCosts: "0", capexReserve: "0", workingCapitalReserve: "0"
    };
    expect(calculateAcquisitionCashFlow(financials(), explicitZero).current.annual).toBe(240000);
  });

  it("does not turn missing or unattributed source values into cash", () => {
    const missing = buildLocalPreviewScan({ listingText: "Business with no financial figures disclosed by the seller." }).financials;
    expect(calculateAcquisitionCashFlow(missing, completeCashFlowAssumptions()).current.annual).toBeNull();
    const unattributed = { ...missing, sde: { ...missing.sde, amount: 240000 } };
    expect(resolveCashFlowStartingPoint(unattributed, createCashFlowAssumptions()).amount).toBeNull();
  });

  it("uses one metric, never combines SDE, EBITDA, and advertised cash flow", () => {
    const amounts = financials({ sde: "$240,000", ebitda: "$200,000", advertisedCashFlow: "$227,261" });
    const assumptions = completeCashFlowAssumptions();
    expect(calculateAcquisitionCashFlow(amounts, assumptions).starting.amount).toBe(240000);
    const ebitda = { ...assumptions, startingMetric: "ebitda" as const };
    expect(calculateAcquisitionCashFlow(amounts, ebitda).current.annual).toBeNull();
    const bridge = calculateAcquisitionCashFlow(amounts, {
      ...ebitda, normalizationAdjustment: "-10000", normalizationNotes: "Cash tax reserve; other costs entered incrementally."
    });
    expect(bridge.starting.amount).toBe(200000);
    expect(bridge.current.adjustedStarting).toBe(190000);
    expect(bridge.current.annual).toBe(-14000);
  });

  it("does not automatically select EBITDA or call generic advertised cash flow SDE", () => {
    const onlyEbitda = buildLocalPreviewScan({ listingText: "Business with EBITDA: $200,000. Revenue: $800,000." }).financials;
    expect(resolveCashFlowStartingPoint(onlyEbitda, createCashFlowAssumptions()).metric).toBe("custom");
    expect(calculateAcquisitionCashFlow(onlyEbitda, completeCashFlowAssumptions()).current.annual).toBeNull();
    const cashFlow = buildLocalPreviewScan({ listingText: "Established business. Cash Flow: $200,000. Revenue: $800,000." }).financials;
    expect(cashFlow.sde.amount).toBeNull();
    expect(resolveCashFlowStartingPoint(cashFlow, createCashFlowAssumptions()).metric).toBe("advertisedCashFlow");
    expect(calculateAcquisitionCashFlow(cashFlow, completeCashFlowAssumptions()).current.annual).toBeNull();
    expect(calculateAcquisitionCashFlow(cashFlow, { ...completeCashFlowAssumptions(), normalizationNotes: "Seller measure reviewed; costs entered only if not already deducted." }).current.annual).toBe(-4000);
  });

  it("requires owner replacement review and does not deduct purchase price or included assets as annual expenses", () => {
    const amounts = financials();
    const before = JSON.stringify(amounts);
    const assumptions = completeCashFlowAssumptions();
    expect(calculateAcquisitionCashFlow(amounts, { ...assumptions, currentReviewed: false }).current.annual).toBeNull();
    expect(calculateAcquisitionCashFlow(amounts, { ...assumptions, improvementsReviewed: false }).improvements.annual).toBeNull();
    const result = calculateAcquisitionCashFlow(amounts, assumptions);
    const otherAssets = { ...amounts, knownAdditionalAcquisitionCosts: { ...amounts.knownAdditionalAcquisitionCosts, amount: 1000000 } };
    expect(calculateAcquisitionCashFlow(otherAssets, assumptions).current.annual).toBe(result.current.annual);
    expect(JSON.stringify(amounts)).toBe(before);
  });

  it("follows corrected source values while preserving manual estimates and intentionally cleared inputs", () => {
    const assumptions = completeCashFlowAssumptions();
    expect(calculateAcquisitionCashFlow(financials(), assumptions).current.annual).toBe(36000);
    expect(calculateAcquisitionCashFlow(financials({ sde: "$300,000" }), assumptions).current.annual).toBe(96000);
    const edited = { ...assumptions, startingAmount: "250000" };
    expect(calculateAcquisitionCashFlow(financials({ sde: "$300,000" }), edited).current.annual).toBe(46000);
    expect(calculateAcquisitionCashFlow(financials(), { ...assumptions, startingAmount: "" }).current.annual).toBeNull();
  });

  it("allows explicit user cash estimates, including negative starting cash", () => {
    const assumptions: CashFlowAssumptions = { ...completeCashFlowAssumptions(), startingMetric: "custom", startingAmount: "-12000", normalizationNotes: "Buyer estimate after reviewed earnings adjustments." };
    const result = calculateAcquisitionCashFlow(financials(), assumptions);
    expect(result.starting.source).toBe("user_estimate");
    expect(result.current.annual).toBe(-216000);
  });

  it("keeps unknown implementation costs separate from complete recurring estimates", () => {
    const result = calculateAcquisitionCashFlow(financials(), { ...completeCashFlowAssumptions(), implementationCosts: "" });
    expect(result.improvements.annual).toBe(98000);
    expect(result.improvements.firstYear).toBeNull();
    const noSetup = calculateAcquisitionCashFlow(financials(), { ...completeCashFlowAssumptions(), implementationCosts: "0" });
    expect(noSetup.improvements.firstYear).toBe(98000);
  });

  it("rejects malformed or out-of-range inputs and preserves cents deterministically", () => {
    for (const raw of ["", "NaN", "Infinity", "1e6", "12abc", "100.001", "1000000000001", "-1"]) {
      expect(parseCashFlowInput(raw)).toBeNull();
    }
    const result = calculateAcquisitionCashFlow(financials(), { ...completeCashFlowAssumptions(), startingAmount: "204000.30", normalizationAdjustment: "-0.10", debtService: "120000.10" });
    expect(result.current.annual).toBe(0.10);
    expect(result.current.monthly).toBe(0.01);
    expect(formatCashFlowMoney(-0.10)).toBe("-$0.1");
    expect(formatCashFlowMoney(0.01)).toBe("$0.01");
    expect(calculateAcquisitionCashFlow(financials(), { ...completeCashFlowAssumptions(), managementCosts: "-1" }).current.annual).toBeNull();
  });
});
