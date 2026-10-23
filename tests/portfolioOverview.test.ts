import { describe, expect, it } from "vitest";
import { portfolioOverview, savedAskingPrice } from "../src/portfolioOverview";
import { syntheticLibrary } from "./syntheticSavedLibrary";

describe("read-only portfolio indicators", () => {
  it("uses unique saved opportunities and disclosed asking prices without mutating records", () => {
    const records = syntheticLibrary(3);
    records[0].state.scan.financials.askingPrice.amount = 100_000;
    records[1].state.scan.financials.askingPrice.amount = 250_000;
    records[1].state.scan.financials.askingPrice.source = "user_correction";
    records[2].state.scan.financials.askingPrice.amount = null;
    const before = JSON.stringify(records);
    expect(portfolioOverview(records)).toEqual({ opportunities: 3, duplicates: 0, disclosed: 2, askingValue: 350_000 });
    expect(JSON.stringify(records)).toBe(before);
  });
  it("counts repeated IDs and scans once, using the latest saved version", () => {
    const records = syntheticLibrary(3);
    records[1].id = records[0].id;
    records[2].state.scan.id = records[1].state.scan.id;
    // Each duplicate chain has the same saved identity; latest value wins.
    records[2].id = records[0].id;
    records[2].state.scan.financials.askingPrice.amount = 200_000;
    expect(portfolioOverview(records)).toEqual({ opportunities: 1, duplicates: 2, disclosed: 1, askingValue: 200_000 });
  });
  it("uses existing same-listing identity rules even across record IDs", () => {
    const records = syntheticLibrary(2);
    records[0].state.scan.listingUrl = "https://example.com/opportunity/123/?ref=old";
    records[1].state.scan.listingUrl = "https://example.com/opportunity/123#overview";
    records[0].state.scan.financials.askingPrice.amount = 123;
    records[1].state.scan.financials.askingPrice.amount = 456;
    expect(portfolioOverview(records)).toEqual({ opportunities: 1, duplicates: 1, disclosed: 1, askingValue: 456 });
  });
  it("does not replace missing latest asking values with older disclosures", () => {
    const records = syntheticLibrary(2);
    records[1].id = records[0].id;
    records[1].state.scan.financials.askingPrice.amount = null;
    expect(portfolioOverview(records)).toEqual({ opportunities: 1, duplicates: 1, disclosed: 0, askingValue: null });
  });
  it("counts linked duplicate identities once without hiding any saved record", () => {
    const records = syntheticLibrary(3);
    records[0].id = records[1].id;
    records[0].state.scan.listingUrl = "https://example.com/listing/a";
    records[2].state.scan.listingUrl = "https://example.com/listing/a";
    const before = JSON.stringify(records);
    expect(portfolioOverview(records).opportunities).toBe(1);
    expect(portfolioOverview(records).duplicates).toBe(2);
    expect(JSON.stringify(records)).toBe(before);
  });
  it("does not invent asking value for an empty library", () => {
    expect(portfolioOverview([])).toEqual({ opportunities: 0, duplicates: 0, disclosed: 0, askingValue: null });
  });
  it.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])("excludes unavailable or invalid asking amounts (%s)", amount => {
    const record = syntheticLibrary(1)[0];
    record.state.scan.financials.askingPrice.amount = amount;
    expect(savedAskingPrice(record)).toBeNull();
  });
  it.each(["not_disclosed", "calculated"] as const)("excludes unsupported asking provenance (%s)", source => {
    const record = syntheticLibrary(1)[0];
    record.state.scan.financials.askingPrice.source = source;
    expect(savedAskingPrice(record)).toBeNull();
  });
  it("omits an aggregate that exceeds the safe numeric range", () => {
    const records = syntheticLibrary(2);
    for (const record of records) record.state.scan.financials.askingPrice.amount = Number.MAX_SAFE_INTEGER;
    expect(portfolioOverview(records).askingValue).toBeNull();
  });
});
