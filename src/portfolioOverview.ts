import type { AcquisitionRecord } from "./acquisitionRecord";
import { matchingRecord } from "./storage";
import { validKhdaAnalysis } from "./recordValidation";

/** Read-only presentation of saved asking prices, including saved corrections. */
export function savedAskingPrice(record: AcquisitionRecord): number | null {
  const field = record.state.scan.financials.askingPrice;
  return field.source !== "not_disclosed" && field.source !== "calculated" &&
    field.amount !== null && Number.isFinite(field.amount) && field.amount > 0 ? field.amount : null;
}

export function portfolioOverview(records: readonly AcquisitionRecord[]) {
  // Use the existing saved-record identity rules. The latest saved version of a
  // listing wins; none of the original records are changed, merged or removed.
  let groups: AcquisitionRecord[][] = [];
  for (const record of [...records].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))) {
    const matches = groups.filter(group => matchingRecord(group, record));
    groups = groups.filter(group => !matches.includes(group));
    groups.push([record, ...matches.flat()]);
  }
  const unique = groups.map(group => [...group].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]);
  const prices = unique.map(savedAskingPrice).filter((value): value is number => value !== null);
  const total = prices.reduce((sum, value) => sum + value, 0);
  return {
    opportunities: unique.length,
    duplicates: records.length - unique.length,
    khdaAnalyses: groups.filter(group => group.some(record => validKhdaAnalysis(record.state.khdaAnalysis))).length,
    disclosed: prices.length,
    askingValue: prices.length && Number.isFinite(total) && total <= Number.MAX_SAFE_INTEGER ? total : null
  };
}
