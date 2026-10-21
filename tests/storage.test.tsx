import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildLocalPreviewScan } from "../src/validation";
import { syntheticManufacturingFixture, syntheticManufacturingUrl } from "./fixtures";
import { createCashFlowAssumptions, calculateAcquisitionCashFlow } from "../src/acquisitionCashFlow";
import { AcquisitionRepository, downloadBackup, formFromScan, makeRecord, matchingRecord, parseBackup, serializeBackup, storageKey, MAX_RECORDS } from "../src/storage";
import { retainedState } from "../src/recordValidation";
import { ResultsScreen } from "../src/App";
import { downloadScanPdf } from "../src/pdf";
import type { AcquisitionRecord } from "../src/acquisitionRecord";
import { AcquisitionRecovery } from "../src/AcquisitionRecovery";
import type { useAcquisitionRecovery } from "../src/useAcquisitionRecovery";

function memory() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}
function sample() {
  const scan = buildLocalPreviewScan({ listingUrl: syntheticManufacturingUrl, listingText: syntheticManufacturingFixture, corrections: { sde: "$227,261", businessAskingPrice: "$565,000" } });
  return {
    scan, form: { ...formFromScan(scan), sde: "$227,261", businessAskingPrice: "$565,000" },
    cashFlow: { ...createCashFlowAssumptions(), startingMetric: "sde" as const, startingAmount: null,
      normalizationAdjustment: "0", debtService: "15000", managementCosts: "25000", capexReserve: "5000", workingCapitalReserve: "3000",
      currentReviewed: true, payrollSavings: "1000", operatingSavings: "2000", improvementCosts: "500",
      improvementsReviewed: true, savingsBasis: "proposed" as const, implementationCosts: "3000" }
  };
}
function setup() {
  const store = memory(); const repo = new AcquisitionRepository(() => store); repo.load();
  return { store, repo, record: makeRecord(sample()) };
}

describe("versioned browser acquisition repository", () => {
  it("keeps backup actions and privacy inside closed Saved scans and Manage Backups disclosures", () => {
    const noop = () => {};
    const recovery = { work: sample(), records: [], active: null, dirty: false, hasWork: true,
      storageError: "", actionError: "", notice: "", confirmation: null,
      save: noop, exportCurrent: noop, exportRecord: noop, exportStoredRecovery: noop,
      importText: noop, reportError: noop, rename: noop, remove: noop, open: noop,
      acceptConfirmation: noop, cancelConfirmation: noop } as unknown as ReturnType<typeof useAcquisitionRecovery>;
    const html = renderToStaticMarkup(<AcquisitionRecovery recovery={recovery} />);
    const saved = html.indexOf('<details class="saved-acquisitions">');
    const backups = html.indexOf('<details class="backup-management">');
    expect(saved).toBeGreaterThan(0);
    expect(backups).toBeGreaterThan(saved);
    expect(html.indexOf("Export Backup")).toBeGreaterThan(backups);
    expect(html.indexOf("Import Backup")).toBeGreaterThan(backups);
    expect(html.indexOf("Stored in this browser only. Keep backup files secure.")).toBeGreaterThan(backups);
    expect(html).toContain("Browser-local storage is not encrypted.");
    expect(html).toContain("Privacy and recovery");
    expect(html).not.toContain("<details open");
    expect(html).toMatch(/type="file"[^>]*hidden=""/);
    expect(html).toContain("Save acquisition");
  });
  it("saves complete evidence, corrections, review states and both scenario assumptions across repository restart", () => {
    const { store, repo, record } = setup();
    repo.save(record, null);
    const loaded = new AcquisitionRepository(() => store).load().records[0];
    expect(loaded).toEqual(record);
    expect(loaded.state.scan.financials.sde).toMatchObject({ amount: 227261, source: "user_correction" });
    expect(loaded.state.scan.financials.ebitda.amount).toBeNull();
    expect(loaded.state.scan.financials.inventory.includedStatus).toBe("included");
    expect(loaded.state.scan.ratios.businessAskingPriceToSde).toBeCloseTo(2.486, 2);
    expect(calculateAcquisitionCashFlow(loaded.state.scan.financials, loaded.state.cashFlow)).toEqual(calculateAcquisitionCashFlow(record.state.scan.financials, record.state.cashFlow));
  });
  it("recovers unsaved report edits and unapplied form values without overwriting the saved record", () => {
    const { store, repo, record } = setup(); repo.save(record, null);
    const work = { ...record.state, form: { ...record.state.form, sde: "300000" }, cashFlow: { ...record.state.cashFlow, managementCosts: "40000" } };
    repo.recover({ recordId: record.id, recordRevision: record.revision, state: work });
    const loaded = new AcquisitionRepository(() => store).load();
    expect(loaded.draft?.state.form.sde).toBe("300000");
    expect(loaded.draft?.state.cashFlow.managementCosts).toBe("40000");
    expect(loaded.records[0].state.form.sde).toBe("$227,261");
    expect(loaded.draft?.state.scan?.financials.sde.amount).toBe(227261);
  });
  it("requires confirmation and the latest revision for update, rename and deletion", () => {
    const { repo, record } = setup(); repo.save(record, null);
    const changed = makeRecord({ ...record.state, cashFlow: { ...record.state.cashFlow, managementCosts: "40000" } }, "Renamed", record);
    expect(() => repo.save(changed, record.revision)).toThrow(/Confirm/);
    expect(() => repo.save(changed, 99, true)).toThrow(/latest/);
    repo.save(changed, record.revision, true);
    expect(repo.load().records).toHaveLength(1);
    expect(repo.load().records[0].name).toBe("Renamed");
    expect(() => repo.delete(changed.id, changed.revision, false)).toThrow(/Confirm/);
    expect(repo.delete(changed.id, changed.revision, true).records).toEqual([]);
  });
  it("retains bytes on quota failure instead of dropping older records", () => {
    const { store, repo, record } = setup(); repo.save(record, null);
    const before = store.data.get(storageKey);
    store.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
    expect(() => repo.recover({ recordId: record.id, recordRevision: record.revision, state: record.state })).toThrow(/unavailable or full/);
    expect(store.data.get(storageKey)).toBe(before);
  });
  it("handles storage access denial and preserves malformed or future-version storage untouched", () => {
    expect(() => new AcquisitionRepository(() => { throw new Error("denied"); }).load()).toThrow(/unavailable/);
    for (const raw of ["{broken", '{"schemaVersion":99,"records":[],"draft":null}']) {
      const store = memory(); store.setItem(storageKey, raw); const repo = new AcquisitionRepository(() => store);
      expect(() => repo.load()).toThrow();
      expect(() => repo.recover(null)).toThrow();
      expect(store.data.get(storageKey)).toBe(raw);
    }
  });
  it("rejects cross-tab stale writes without deleting another tab's changes", () => {
    const { store, repo, record } = setup(); const other = new AcquisitionRepository(() => store); other.load();
    repo.save(record, null);
    expect(() => other.recover(null)).toThrow(/another tab/);
    expect(new AcquisitionRepository(() => store).load().records[0]).toEqual(record);
  });
  it("never silently evicts records when the library reaches its record limit", () => {
    const { repo, record, store } = setup();
    store.setItem(storageKey, JSON.stringify({ schemaVersion: 2, draft: null,
      records: Array.from({ length: MAX_RECORDS }, (_, i) => ({ ...record, id: "record-" + i })) }));
    repo.load();
    expect(() => repo.save({ ...record, id: "record-overflow" }, null)).toThrow(new RegExp(`${MAX_RECORDS} records`));
    expect(repo.load().records).toHaveLength(MAX_RECORDS);
  });
  it("migrates valid legacy scan arrays without inventing financial inputs; rejects malformed legacy data", () => {
    const { store, record } = setup();
    store.setItem(storageKey, JSON.stringify([record.state.scan]));
    const raw = store.data.get(storageKey);
    const repo = new AcquisitionRepository(() => store); const migrated = repo.load();
    expect(migrated.records[0].origin).toBe("legacy");
    expect(migrated.records[0].state.scan).toEqual(record.state.scan);
    expect(migrated.records[0].state.cashFlow.managementCosts).toBe("");
    expect(migrated.notice).toContain("not available");
    expect(store.data.get(storageKey)).toBe(raw);
    store.setItem(storageKey, '[{"id":"broken"}]');
    expect(() => new AcquisitionRepository(() => store).load()).toThrow();
    expect(store.data.get(storageKey)).toBe('[{"id":"broken"}]');
  });
});

describe("acquisition JSON backups", () => {
  it("migrates older pre-transaction-split records without upgrading evidence or inventing a business price", () => {
    const { store, record } = setup();
    const old: any = structuredClone(record.state.scan);
    delete old.financials.businessAskingPrice; delete old.ratios.businessAskingPriceToSde;
    for (const key of ["strategicFit", "attractiveCharacteristics", "sellerDependence", "equipmentContinuity", "financialQuestions", "majorRisks"]) delete old.claritySummary[key];
    store.setItem(storageKey, JSON.stringify([old]));
    const migrated = new AcquisitionRepository(() => store).load().records[0];
    expect(migrated.state.scan.financials.businessAskingPrice.amount).toBeNull();
    expect(migrated.state.scan.ratios.businessAskingPriceToSde).toBeNull();
    expect(migrated.state.scan.claritySummary.strategicFit).toContain("Not available");
    expect(migrated.state.scan.financials.sde).toEqual(old.financials.sde);
    expect(migrated.state.scan.claritySummary.buying).toBe(old.claritySummary.buying);
    delete old.businessDetails; delete old.financials.inventory; delete old.financials.ffe;
    delete old.financials.realEstate; delete old.financials.knownAdditionalAcquisitionCosts;
    delete old.financials.advertisedCashFlow.sellerTerminology;
    store.setItem(storageKey, JSON.stringify([old]));
    const earliest = new AcquisitionRepository(() => store).load().records[0];
    expect(earliest.state.scan.financials.inventory.includedStatus).toBe("unknown");
    expect(earliest.state.scan.businessDetails.fullDescription).toEqual(old.overview.description);
    expect(earliest.state.scan.financials.sde).toEqual(old.financials.sde);
  });
  it("round-trips a complete analysis and creates one record on repeated imports", () => {
    const { repo, record } = setup(); const imported = parseBackup(serializeBackup(record));
    expect(imported.state).toEqual(record.state); expect(imported.origin).toBe("imported");
    repo.save(imported, null);
    const existing = matchingRecord(repo.load().records, parseBackup(serializeBackup(record)))!;
    expect(existing.id).toBe(record.id);
    expect(() => repo.save(imported, existing.revision)).toThrow(/Confirm/);
    repo.save({ ...imported, revision: existing.revision + 1 }, existing.revision, true);
    expect(repo.load().records).toHaveLength(1);
    expect(matchingRecord(repo.load().records, { ...imported, id: "different-id", state: { ...imported.state, scan: { ...imported.state.scan, id: "other-scan" } } })?.id).toBe(record.id);
  });
  it.each(["", "{broken", "[]", "null", '{"format":"kingdomhaus-acquisition","schemaVersion":99}'])("rejects malformed and unsupported input: %s", input => expect(() => parseBackup(input)).toThrow());
  it("rejects missing fields, incorrect types, forged verification enums, NaN-like money and unexpected secret fields", () => {
    const { record } = setup();
    const cases = [
      (r: any) => { delete r.state.cashFlow.currentReviewed; },
      (r: any) => { r.state.scan.financials.sde.amount = "227261"; },
      (r: any) => { r.state.scan.financials.sde.source = "verified"; },
      (r: any) => { r.state.scan.ratios.sdeToRevenue = 1e100; },
      (r: any) => { r.apiToken = "fake-secret"; },
      (r: any) => { r.state.scan.financials.sde.excerpts = [false]; }
    ];
    for (const change of cases) {
      const r = structuredClone(record); change(r);
      expect(() => parseBackup(JSON.stringify({ format: "kingdomhaus-acquisition", schemaVersion: 1, exportedAt: record.createdAt, record: r }))).toThrow();
    }
    expect(() => parseBackup('{"__proto__":{}}')).toThrow();
    expect(() => parseBackup(" ".repeat(2_000_001))).toThrow(/large/);
  });
  it("minimizes provider retention while preserving original text and normalized provenance", () => {
    const state = sample();
    state.scan.retrieval = { provider: "apify", actorId: "actor", retrievedAt: new Date().toISOString(), sourceUrl: syntheticManufacturingUrl,
      maxChargeUsd: 0.25, usageUsd: null, rawRecord: { brokerEmail: "private", apiToken: "fake" }, conflicts: ["SDE needs evidence"], photographs: [{ url: "https://images.example/image.jpg", sourceUrl: syntheticManufacturingUrl, attribution: "Source" }] };
    const record = makeRecord(state);
    expect(record.state.scan.retrieval?.rawRecord).toEqual({});
    expect(record.state.scan.retrieval?.photographs).toEqual([]);
    expect(record.state.scan.retrieval?.conflicts).toEqual(["SDE needs evidence"]);
    expect(record.state.scan.listingText).toBe(state.scan.listingText);
    expect(serializeBackup(record)).not.toContain("brokerEmail");
    expect(state.scan.retrieval.rawRecord).toHaveProperty("brokerEmail");
  });
  it("does not relabel generic advertised cash flow as SDE", () => {
    const scan = buildLocalPreviewScan({ listingText: "Local service business for sale. Asking Price: $137,500. Cash Flow: $66,392. Gross Revenue: $352,757." });
    const record = makeRecord({ scan, form: formFromScan(scan), cashFlow: createCashFlowAssumptions() });
    expect(parseBackup(serializeBackup(record)).state.scan.financials.sde.amount).toBeNull();
  });
  it("renders recovered corrected financials and cash-flow assumptions through the existing dashboard", () => {
    const record = parseBackup(serializeBackup(makeRecord(sample())));
    const html = renderToStaticMarkup(<ResultsScreen scan={record.state.scan} form={record.state.form}
      cashFlowAssumptions={record.state.cashFlow} message={null} errors={[]} isLoading={false} isFetchingUrl={false}
      onBack={() => {}} onDownload={() => {}} onFieldChange={() => {}} onRefresh={() => {}} onScanFromUrl={() => {}} />);
    expect(html).toContain("$227,261"); expect(html).toContain("2.49x"); expect(html).toContain('value="25000"');
    expect(html).toContain('value="1000"'); expect(html).toContain("29.32%");
  });
  it("creates a downloadable versioned JSON blob without network calls", async () => {
    const { record } = setup(); let blob: Blob | null = null; const click = vi.fn();
    vi.stubGlobal("document", { createElement: () => ({ click }) });
    vi.stubGlobal("URL", { createObjectURL: (value: Blob) => { blob = value; return "blob:test"; }, revokeObjectURL: vi.fn() });
    vi.useFakeTimers();
    try {
      downloadBackup(record); expect(click).toHaveBeenCalledOnce();
      expect(parseBackup(await blob!.text()).state).toEqual(record.state);
      vi.runAllTimers();
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });
  it("passes recovered financials and both scenarios unchanged to the existing PDF generator", async () => {
    const record = parseBackup(serializeBackup(makeRecord(sample())));
    let blob: Blob | null = null;
    vi.stubGlobal("document", { createElement: () => ({ click: vi.fn() }) });
    vi.stubGlobal("URL", { createObjectURL: (value: Blob) => { blob = value; return "blob:test"; }, revokeObjectURL: vi.fn() });
    const before = JSON.stringify(record.state);
    try {
      downloadScanPdf(record.state.scan, record.state.cashFlow);
      const pdf = await blob!.text();
      expect(pdf).toContain("227,261"); expect(pdf).toContain("25,000");
      expect(pdf).toContain("KingdomHaus Improvements"); expect(pdf).toContain("Current Operations");
      expect(pdf).toContain("3,000");
      expect(JSON.stringify(record.state)).toBe(before);
    } finally { vi.unstubAllGlobals(); }
  });
});
