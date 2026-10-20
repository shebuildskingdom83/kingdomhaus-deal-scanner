import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AcquisitionRepository, makeRecord, parseBackup, serializeBackup, formFromScan } from "../src/storage";
import { hydrateStreetAddress, resolvedStreetAddress } from "../src/listingAddress";
import { validateDraft } from "../src/recordValidation";
import { ResultsScreen } from "../src/App";
import { buildCurrentAcquisitionCsv } from "../src/csv";
import { buildReportLines } from "../src/pdf";

const text = readFileSync(new URL("./importedStreetAddressFixture.json", import.meta.url), "utf8");
const original = JSON.parse(text);
const address = original.record.state.scan.correctedFields.streetAddress;
const fresh = () => parseBackup(text);
const render = (scan: ReturnType<typeof fresh>["state"]["scan"]) => renderToStaticMarkup(<ResultsScreen scan={scan} form={formFromScan(scan)} message={null} errors={[]} isLoading={false} isFetchingUrl={false} onBack={() => {}} onDownload={() => {}} onFieldChange={() => {}} onRefresh={() => {}} onScanFromUrl={() => {}} />);

describe("synthetic exported acquisition street-address hydration", () => {
  it("uses the fixed synthetic JSON bytes and displays the imported address without modifying its evidence", () => {
    expect(createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex")).toBe("6a4859f2e5d86f75713af724580f075f7a19b467b36b5bed058fdcf983a9e7a8");
    const record = fresh();
    expect(record.state.scan.businessDetails.streetAddress).toEqual(original.record.state.scan.businessDetails.streetAddress);
    expect(record.state.scan.businessDetails.streetAddress?.source).toBe("user_correction");
    expect(render(record.state.scan)).toContain(address);
    expect(record.state.scan.financials).toEqual(original.record.state.scan.financials);
    expect(record.state.scan.websiteProjectPhotographs).toEqual(original.record.state.scan.websiteProjectPhotographs);
  });
  it.each(["missing", "null", "empty", "different"])("correction wins over a %s structured/legacy field", kind => {
    const record = fresh();
    const old = record.state.scan.businessDetails.streetAddress!;
    if (kind === "missing") delete record.state.scan.businessDetails.streetAddress;
    else record.state.scan.businessDetails.streetAddress = { ...old, value: kind === "different" ? "42 Test Rd, Raleigh, NC 27601" : kind === "empty" ? "" : null, source: "not_disclosed" };
    record.state.form.streetAddress = "";
    const incoming = parseBackup(JSON.stringify({ ...original, record }));
    expect(incoming.state.scan.businessDetails.streetAddress?.value).toBe(address);
    expect(render(incoming.state.scan)).toContain(address);
    expect(incoming.state.scan.businessDetails.streetAddress?.source).toBe("user_correction");
    if (kind !== "missing") for (const excerpt of old.excerpts) expect(incoming.state.scan.businessDetails.streetAddress?.excerpts).toContain(excerpt);
    expect(incoming.state.form.streetAddress).toBe(""); // Pending form work is not silently rewritten.
  });
  it.each(["", "   ", "Not disclosed", "javascript:alert(1)"])("uses structured evidence when correction is invalid: %s", value => {
    const scan = fresh().state.scan;
    scan.correctedFields.streetAddress = value;
    expect(resolvedStreetAddress(scan)).toEqual(original.record.state.scan.businessDetails.streetAddress);
  });
  it("handles another business address generically and preserves earlier excerpts when a correction differs", () => {
    const scan = fresh().state.scan;
    scan.correctedFields.streetAddress = "42 Test Rd, Raleigh, NC 27601";
    const normalized = hydrateStreetAddress(scan);
    expect(normalized.businessDetails.streetAddress?.value).toBe("42 Test Rd, Raleigh, NC 27601");
    expect(scan.businessDetails.streetAddress?.value).toBe(address);
    for (const excerpt of scan.businessDetails.streetAddress!.excerpts) expect(normalized.businessDetails.streetAddress!.excerpts).toContain(excerpt);
    expect(normalized.financials).toBe(scan.financials);
    expect(normalized.websiteProjectPhotographs).toBe(scan.websiteProjectPhotographs);
  });
  it("uses only explicit listing-map evidence after both retained address paths are unavailable", () => {
    const scan = fresh().state.scan;
    delete scan.correctedFields.streetAddress;
    delete scan.businessDetails.streetAddress;
    expect(resolvedStreetAddress(scan).value).toBeNull();
    const withMap = { ...scan, listingText: scan.listingText + "\nEmbedded Map Address: 42 Test Rd, Raleigh, NC 27601" };
    expect(resolvedStreetAddress(withMap)).toMatchObject({ value: "42 Test Rd, Raleigh, NC 27601", source: "url_extract" });
    expect(resolvedStreetAddress({ ...scan, listingText: scan.listingText + "\nEmbedded Map Address: Raleigh, NC" }).value).toBeNull();
  });
  it("normalizes records and recovery drafts across save, restart, reopen, update and repeated backup imports", () => {
    const record = fresh();
    delete record.state.scan.businessDetails.streetAddress;
    const data = new Map<string, string>();
    const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const repository = new AcquisitionRepository(() => store); repository.load(); repository.save(record, null);
    const restarted = new AcquisitionRepository(() => store);
    const reopened = restarted.load().records[0];
    expect(reopened.state.scan.businessDetails.streetAddress?.value).toBe(address);
    const updated = makeRecord(reopened.state, reopened.name, reopened); restarted.save(updated, reopened.revision, true);
    const restored = parseBackup(serializeBackup(updated));
    expect(parseBackup(serializeBackup(restored)).state.scan.businessDetails.streetAddress?.value).toBe(address);
    const draft = validateDraft({ recordId: record.id, recordRevision: record.revision, state: record.state });
    expect(draft.state.scan?.businessDetails.streetAddress?.value).toBe(address);
    expect(restored.state.scan.listingUrl).toBe(original.record.state.scan.listingUrl);
    expect(restored.state.scan.businessDetails.businessWebsite).toEqual(original.record.state.scan.businessDetails.businessWebsite);
    expect(restored.state.scan.websiteProjectPhotographs).toEqual(original.record.state.scan.websiteProjectPhotographs);
  });
  it("uses the same precedence in dashboard, correction defaults, CSV and PDF even before storage", () => {
    const scan = fresh().state.scan;
    scan.businessDetails.streetAddress = { value: null, source: "not_disclosed", excerpts: [] };
    expect(render(scan)).toContain(address);
    expect(formFromScan(scan).streetAddress).toBe(address);
    expect(buildCurrentAcquisitionCsv(scan)).toContain(address);
    expect(buildReportLines(scan).join("\n").replace(/\s/g, "")).toContain(address.replace(/\s/g, ""));
    expect(scan.businessDetails.streetAddress.value).toBeNull();
  });
  it("accepts old records without any address path and never converts missing data to a guessed location", () => {
    const record = fresh(); delete record.state.scan.businessDetails.streetAddress; delete record.state.scan.correctedFields.streetAddress; delete record.state.form.streetAddress;
    const restored = parseBackup(serializeBackup(record));
    expect(resolvedStreetAddress(restored.state.scan).value).toBeNull();
    expect(render(restored.state.scan)).toContain("Not disclosed in listing");
  });
});
