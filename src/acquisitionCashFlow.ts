import type { FinancialSnapshot, MoneyField } from "./types";

export type StartingMetric = "sde" | "ebitda" | "advertisedCashFlow" | "custom";

export const startingMetricLabels: Record<StartingMetric, string> = {
  sde: "SDE",
  ebitda: "EBITDA",
  advertisedCashFlow: "Advertised cash flow",
  custom: "User cash flow estimate"
};

export const currentCashFlowFields = [
  { key: "normalizationAdjustment", label: "Annual earnings adjustment", hint: "Signed earnings-to-cash adjustment. Exclude costs entered below. Enter 0 if none is needed.", signed: true },
  { key: "debtService", label: "Annual acquisition debt service", hint: "Principal and interest not already deducted from starting cash flow.", signed: false },
  { key: "managementCosts", label: "Additional management or owner replacement costs", hint: "Only replacement pay not already deducted in earnings or the annual adjustment. Do not enter it again as an improvement cost.", signed: false },
  { key: "capexReserve", label: "Annual maintenance capital expenditure reserve", hint: "Additional equipment and maintenance capital needs, excluding amounts already deducted.", signed: false },
  { key: "workingCapitalReserve", label: "Annual incremental working capital reserve", hint: "Additional cash tied up in operations, excluding amounts already deducted.", signed: false }
] as const;

export const improvementCashFlowFields = [
  { key: "payrollSavings", label: "Annual payroll savings", hint: "Recurring savings only; account for replacement responsibilities below.", signed: false },
  { key: "operatingSavings", label: "Other annual operating savings", hint: "Savings beyond the starting amount and payroll savings above.", signed: false },
  { key: "improvementCosts", label: "Additional annual operating costs", hint: "Recurring costs needed for improvements, beyond replacement pay and reserves already deducted in Current Operations.", signed: false }
] as const;

export type CurrentCashFlowKey = typeof currentCashFlowFields[number]["key"];
export type ImprovementCashFlowKey = typeof improvementCashFlowFields[number]["key"];
export type CashFlowAssumptions = Record<CurrentCashFlowKey | ImprovementCashFlowKey, string> & {
  startingMetric: StartingMetric | null;
  // Null follows the listing; an empty string is an intentionally cleared, unknown value.
  startingAmount: string | null;
  normalizationNotes: string;
  currentReviewed: boolean;
  improvementsReviewed: boolean;
  savingsBasis: "proposed" | "verified";
  implementationCosts: string;
};

export function createCashFlowAssumptions(): CashFlowAssumptions {
  return {
    startingMetric: null,
    startingAmount: null,
    normalizationAdjustment: "",
    debtService: "",
    managementCosts: "",
    capexReserve: "",
    workingCapitalReserve: "",
    payrollSavings: "",
    operatingSavings: "",
    improvementCosts: "",
    implementationCosts: "",
    normalizationNotes: "",
    currentReviewed: false,
    improvementsReviewed: false,
    savingsBasis: "proposed"
  };
}

function isIdentified(field: MoneyField): boolean {
  return field.amount !== null && Number.isFinite(field.amount) && Math.abs(field.amount) <= 1e12 &&
    (field.source === "seller_claim" || field.source === "url_extract" || field.source === "user_correction");
}

export function resolveCashFlowStartingPoint(financials: FinancialSnapshot, assumptions: CashFlowAssumptions) {
  const metric = assumptions.startingMetric ??
    (isIdentified(financials.sde) ? "sde" : isIdentified(financials.advertisedCashFlow) ? "advertisedCashFlow" : "custom");
  const field = metric === "custom" ? null : financials[metric];
  const sourceAmount = field && isIdentified(field) ? field.amount : null;
  const input = assumptions.startingAmount ?? (sourceAmount === null ? "" : String(sourceAmount));
  return {
    metric,
    label: startingMetricLabels[metric],
    input,
    amount: parseCashFlowInput(input, true),
    sourceAmount,
    source: assumptions.startingAmount !== null || metric === "custom" ? "user_estimate" : field?.source ?? "not_disclosed"
  };
}

// Strict cents-based inputs keep empty, malformed, and non-finite assumptions out of estimates.
export function parseCashFlowInput(raw: string, signed = false): number | null {
  const text = raw.trim();
  if (!/^-?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount) || Math.abs(amount) > 1e12 || (!signed && amount < 0)) return null;
  return Math.round(amount * 100) / 100;
}

export const cashFlowDisclaimer =
  "Preliminary acquisition cash flow estimate based on available information and user assumptions. Actual results require financial due diligence.";

export function formatCashFlowMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2
  }).format(amount);
}

export function calculateAcquisitionCashFlow(financials: FinancialSnapshot, assumptions: CashFlowAssumptions) {
  const starting = resolveCashFlowStartingPoint(financials, assumptions);
  const currentMissing: string[] = [];
  if (starting.amount === null) currentMissing.push("Starting annual cash flow");
  const currentValues = currentCashFlowFields.map((field) => {
    const value = parseCashFlowInput(assumptions[field.key], field.signed);
    if (value === null) currentMissing.push(field.label);
    return value;
  });
  if (starting.metric !== "sde" && !assumptions.normalizationNotes.trim()) {
    currentMissing.push("Normalization assumptions");
  }
  if (!assumptions.currentReviewed) currentMissing.push("Owner replacement and expense overlap review");

  const [adjustment, debt, management, capex, workingCapital] = currentValues;
  const annual = currentMissing.length > 0 ? null :
    (cents(starting.amount!) + cents(adjustment!) - cents(debt!) - cents(management!) - cents(capex!) - cents(workingCapital!)) / 100;
  const adjustedStarting = starting.amount !== null && adjustment !== null ?
    (cents(starting.amount) + cents(adjustment)) / 100 : null;

  const improvementMissing: string[] = [];
  if (annual === null) improvementMissing.push("Complete Current Operations");
  const improvementValues = improvementCashFlowFields.map((field) => {
    const value = parseCashFlowInput(assumptions[field.key]);
    if (value === null) improvementMissing.push(field.label);
    return value;
  });
  if (!assumptions.improvementsReviewed) improvementMissing.push("Savings and replacement responsibilities review");
  const [payroll, operating, costs] = improvementValues;
  const difference = improvementMissing.length > 0 ? null : (cents(payroll!) + cents(operating!) - cents(costs!)) / 100;
  const improvedAnnual = annual !== null && difference !== null ? (cents(annual) + cents(difference)) / 100 : null;
  const implementationCosts = parseCashFlowInput(assumptions.implementationCosts);

  return {
    starting,
    current: { annual, monthly: monthly(annual), adjustedStarting, missing: currentMissing },
    improvements: {
      annual: improvedAnnual,
      monthly: monthly(improvedAnnual),
      difference,
      implementationCosts,
      firstYear: improvedAnnual !== null && implementationCosts !== null ?
        (cents(improvedAnnual) - cents(implementationCosts)) / 100 : null,
      missing: improvementMissing
    }
  };
}

function cents(amount: number): number { return Math.round(amount * 100); }
function monthly(annual: number | null): number | null {
  return annual === null ? null : Math.round(annual * 100 / 12) / 100;
}
