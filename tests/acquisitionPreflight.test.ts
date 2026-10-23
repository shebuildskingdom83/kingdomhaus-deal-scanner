import { describe, expect, it, vi } from "vitest";
import { inspectAcquisitionStorage, PREFLIGHT_STORAGE_KEY, readAcquisitionPreflight } from "../src/acquisitionPreflight";
import { migrationFixtures } from "./cloudMigrationFixtures";
import { createCashFlowAssumptions } from "../src/acquisitionCashFlow";
import type { AcquisitionRecord } from "../src/acquisitionRecord";

const library = () => ({ schemaVersion: 2, records: migrationFixtures() as AcquisitionRecord[], draft: null as unknown });
const inspect = (input = library()) => inspectAcquisitionStorage(JSON.stringify(input));

describe("read-only acquisition preflight, synthetic records only", () => {
  it("accepts four complete historical records without changing any content", () => {
    const value = library(), original = JSON.stringify(value);
    const result = inspect(value);
    expect(result.status).toBe("Compatible"); expect(result.recordCount).toBe(4);
    expect(result.records.every(row => row.status === "Compatible" && row.bytes > 0 && row.bytes <= 900000)).toBe(true);
    expect(result.records.map(row => row.counts.listingPhotographs)).toEqual([1, 1, 1, 1]);
    expect(result.records.every(row => row.counts.currentOperationsFieldsPresent === row.counts.currentOperationsFieldsExpected &&
      row.counts.improvementsFieldsPresent === row.counts.improvementsFieldsExpected && row.counts.corrections > 0 && row.counts.financialEvidenceExcerpts > 0)).toBe(true);
    expect(result.cloudConflictStatus).toBe("Not checked: no cloud access");
    expect(JSON.stringify(value)).toBe(original);
  });
  it("reads only the exact library key twice and never calls any write API", () => {
    const raw = JSON.stringify(library());
    const store = { getItem: vi.fn(() => raw), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    expect(readAcquisitionPreflight(store).storageUnchanged).toBe(true);
    expect(store.getItem.mock.calls).toEqual([[PREFLIGHT_STORAGE_KEY], [PREFLIGHT_STORAGE_KEY]]);
    expect(store.setItem).not.toHaveBeenCalled(); expect(store.removeItem).not.toHaveBeenCalled(); expect(store.clear).not.toHaveBeenCalled();
  });
  it("reports only names, statuses, byte sizes, counts and fixed blockers, never stored contents", () => {
    const value = library();
    value.records[0].state.scan.listingText = "PRIVATE_SYNTHETIC_NARRATIVE";
    value.records[0].state.scan.financials.sde.raw = "PRIVATE_SYNTHETIC_CURRENCY";
    value.records[0].state.scan.correctedFields.businessName = "PRIVATE_SYNTHETIC_CORRECTION";
    const text = JSON.stringify(inspect(value));
    for (const secret of ["PRIVATE_SYNTHETIC", value.records[0].id, value.records[0].state.scan.listingUrl!, value.records[0].state.scan.retrieval!.photographs[0].url]) expect(text).not.toContain(secret);
    expect(text).toContain(value.records[0].name);
  });
  it("stops for duplicate IDs and canonical listing source keys", () => {
    const value = library(); value.records[1].id = value.records[0].id;
    value.records[1].state.scan.listingUrl = value.records[0].state.scan.listingUrl + "/?tracking=synthetic";
    const report = inspect(value);
    expect(report.status).toBe("Blocked");
    for (const row of report.records.slice(0, 2)) {
      expect(row.blockers).toContain("Duplicate acquisition ID in local selection.");
      expect(row.blockers).toContain("Duplicate canonical source key in local selection.");
    }
  });
  it.each([0, -1, 1.5, 1_000_000_000_001])("rejects invalid historical revision %s", revision => {
    const value = library(); value.records[0].revision = revision;
    expect(inspect(value).records[0].status).toBe("Blocked");
  });
  it("blocks silent address hydration without repairing the original", () => {
    const value = library(); delete value.records[0].state.scan.businessDetails.streetAddress;
    const original = JSON.stringify(value);
    expect(inspect(value).records[0].blockers).toContain("Validation would normalize, hydrate, or remove data. Separate review is required.");
    expect(JSON.stringify(value)).toBe(original);
  });
  it("blocks oversized records without truncating them", () => {
    const value = library(); value.records[0].state.scan.businessDetails.additionalDetails = Array.from({ length: 11 }, () => ({ label: "Synthetic capacity check", value: "x".repeat(85000), excerpts: [] }));
    const report = inspect(value);
    expect(report.records[0].bytes).toBeGreaterThan(900000);
    expect(report.records[0].blockers).toContain("Record exceeds the supported cloud payload limit; no truncation is permitted.");
    expect(value.records[0].state.scan.businessDetails.additionalDetails).toHaveLength(11);
  });
  it("keeps blank scenario inputs blank and distinguishes them from missing structure", () => {
    const value = library(); value.records[0].state.cashFlow = createCashFlowAssumptions();
    expect(inspect(value).records[0].status).toBe("Compatible");
    expect(inspect(value).records[0].counts.currentOperationsInputsEntered).toBe(0);
    delete (value.records[0].state.cashFlow as unknown as Record<string, unknown>).debtService;
    expect(inspect(value).records[0].status).toBe("Blocked");
  });
  it("inspects a linked recovery draft separately without disclosing or changing it", () => {
    const value = library(), record = value.records[2];
    value.draft = { recordId: record.id, recordRevision: record.revision, state: structuredClone(record.state) };
    const before = JSON.stringify(value), result = inspect(value);
    expect(result.draft.present).toBe(true); expect(result.draft.status).toBe("Compatible");
    expect(JSON.stringify(result.draft)).not.toContain(record.id); expect(JSON.stringify(value)).toBe(before);
    (value.draft as { recordRevision: number }).recordRevision++;
    expect(inspect(value).draft.status).toBe("Blocked");
  });
  it("handles an unfinished unlinked draft without inventing an analysis", () => {
    const value = library(); value.draft = { recordId: null, recordRevision: null, state: { ...value.records[0].state, scan: null } };
    expect(inspect(value).draft.status).toBe("Compatible"); expect(inspect(value).draft.counts.financialFields).toBe(0);
  });
  it("blocks unsafe photographs rather than replacing or fetching them", () => {
    const value = library(); value.records[0].state.scan.retrieval!.photographs[0].url = "https://unrelated.example/PRIVATE_SYNTHETIC_IMAGE.jpg";
    const result = inspect(value); expect(result.records[0].status).toBe("Blocked"); expect(JSON.stringify(result)).not.toContain("PRIVATE_SYNTHETIC_IMAGE");
  });
  it("fails closed for changed storage, unavailable storage, malformed and legacy libraries", () => {
    const raw = JSON.stringify(library()); let calls = 0;
    const report = readAcquisitionPreflight({ getItem: () => ++calls === 1 ? raw : null });
    expect(report.status).toBe("Blocked"); expect(report.storageUnchanged).toBe(false);
    expect(readAcquisitionPreflight({ getItem: () => { throw new Error("PRIVATE_SYNTHETIC_ERROR"); } }).status).toBe("Blocked");
    for (const input of [null, "{}", "[]", "not json", '{"__proto__":{}}']) expect(inspectAcquisitionStorage(input).status).toBe("Blocked");
    expect(JSON.stringify(inspectAcquisitionStorage("not json"))).not.toContain("not json");
  });
});
