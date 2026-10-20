import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import welding from "./syntheticWeldingFixture.json";
import painting from "./apify-painting.json";
import { embeddedMapAddressFromHtml, explicitMapAddressFromUrl, explicitStreetAddress, preserveStreetAddressEvidence, structuredListingAddress } from "../src/listingAddress";
import { buildLocalPreviewScan, normalizeAiScan } from "../src/validation";
import { attachRetrieval, reconcileApifyListing } from "../src/hybridListing";
import { AcquisitionRepository, formFromScan, makeRecord, parseBackup, serializeBackup } from "../src/storage";
import { createCashFlowAssumptions } from "../src/acquisitionCashFlow";
import { ResultsScreen } from "../src/App";
import { buildCurrentAcquisitionCsv } from "../src/csv";
import { buildReportLines } from "../src/pdf";

const address = "8420 Fictional Cedar Way, Example City, SC 29000";
const website = "https://example.com/synthetic-fabrication/";
const listing = welding.listingUrl;
const mapUrl = "https://www.google.com/maps?q=" + encodeURIComponent(address) + "&output=embed";
const iframe = `<iframe title="Business location" src="${mapUrl}"></iframe>`;
function scan() { return buildLocalPreviewScan({ ...welding, listingText: welding.listingText + "\nEmbedded Map Address: " + address, corrections: { businessWebsite: website } }); }

describe("separate marketplace source and exact street address", () => {
  it("renders both safe destinations and the explicit address as separate Business Profile fields", () => {
    const report = scan();
    const html = renderToStaticMarkup(<ResultsScreen scan={report} form={formFromScan(report)} message={null} errors={[]} isLoading={false} isFetchingUrl={false} onBack={() => {}} onDownload={() => {}} onFieldChange={() => {}} onRefresh={() => {}} onScanFromUrl={() => {}} />);
    expect(html).toContain("Source Listing");
    expect(html).toContain("View Original Listing");
    expect(html).toContain(`href="${listing}" target="_blank" rel="noopener noreferrer"`);
    expect(html).toContain(`href="${website}" target="_blank" rel="noopener noreferrer"`);
    expect(html).toContain(address);
    expect(report.businessDetails.streetAddress).toMatchObject({ value: address, source: "url_extract", excerpts: ["Embedded Map Address: " + address, listing] });
    const bad = { ...report, listingUrl: "javascript:alert(1)" };
    expect(renderToStaticMarkup(<ResultsScreen scan={bad} form={formFromScan(bad)} message={null} errors={[]} isLoading={false} isFetchingUrl={false} onBack={() => {}} onDownload={() => {}} onFieldChange={() => {}} onRefresh={() => {}} onScanFromUrl={() => {}} />)).not.toContain('href="javascript:');
  });
  it("retains the submitted marketplace URL through reconciliation and prevents AI source substitution", () => {
    const submitted = listing.replace("www.bizbuysell", "bizbuysell") + "?source=founder";
    const mapped = reconcileApifyListing({ ...painting[0], url: undefined }, { listingUrl: submitted, listingText: "" });
    const report = buildLocalPreviewScan(mapped.request);
    expect(report.listingUrl).toBe(submitted);
    expect(report.businessDetails.url.value).toBe(submitted);
    expect(normalizeAiScan({ businessDetails: { url: { value: website }, streetAddress: { value: "123 Invented Street, Nowhere, NC 12345" } } }, { ...welding, corrections: { businessWebsite: website } }, "fixture").businessDetails.url.value).toBe(listing);
    expect(normalizeAiScan({ businessDetails: { streetAddress: { value: address } } }, welding, "fixture").businessDetails.streetAddress?.value).toBeNull();
  });
  it("captures explicit map addresses without fetching an iframe or resolving a coordinate", () => {
    expect(explicitStreetAddress(address)).toBe(address);
    expect(explicitMapAddressFromUrl(mapUrl)).toBe(address);
    expect(embeddedMapAddressFromHtml(iframe)).toBe(address);
    const retainedMap = "https://maps.google.com/maps?q=8420+Fictional+Cedar+Way%2c+Example City%2c+Example+County%2c+South+Carolina%2c+United+States&output=embed&z=10&iwloc=near";
    expect(explicitMapAddressFromUrl(retainedMap)).toBe("8420 Fictional Cedar Way, Example City, SC");
    expect(explicitMapAddressFromUrl(retainedMap)).not.toContain("29000");
    expect(structuredListingAddress({ embeddedMap: { streetAddress: "8420 Fictional Cedar Way", addressLocality: "Example City", addressRegion: "SC", postalCode: "29000" } })).toEqual({ address, embeddedMap: true });
    expect(structuredListingAddress({ embeddedMap: { src: mapUrl } })).toEqual({ address, embeddedMap: true });
    const mapped = reconcileApifyListing({ ...painting[0], embeddedMap: { formattedAddress: address } }, { listingUrl: painting[0].url, listingText: "" });
    const report = buildLocalPreviewScan(mapped.request);
    expect(report.businessDetails.streetAddress?.value).toBe(address);
    expect(report.businessDetails.streetAddress?.source).toBe("url_extract");
    expect(mapped.request.listingText).toContain("Embedded Map Address: " + address);
  });
  it.each(["Example City, SC", "Mecklenburg County, NC", "34.45,-82.65", "Synthetic Fabrication Workshop", "8420 Fictional Cedar Way", "Approximate location: Example City, SC"])("does not infer a street address from %s", area => {
    expect(explicitStreetAddress(area)).toBeNull();
    expect(explicitMapAddressFromUrl("https://www.google.com/maps?q=" + encodeURIComponent(area))).toBeNull();
    expect(structuredListingAddress({ mapAddress: area, latitude: 34.45, longitude: -82.65, brokerAddress: address })).toBeNull();
  });
  it("rejects unrelated map hosts and broker maps", () => {
    expect(explicitMapAddressFromUrl(mapUrl.replace("www.google.com", "www.google.com.evil.example"))).toBeNull();
    expect(embeddedMapAddressFromHtml(iframe.replace("Business location", "Broker location"))).toBeNull();
    expect(buildLocalPreviewScan({ ...welding, listingText: welding.listingText + "\nLocation: Example City, SC" }).businessDetails.streetAddress?.value).toBeNull();
  });
  it("retains address evidence and separate links across corrections, storage restart and JSON recovery", () => {
    const before = scan();
    before.businessDetails.streetAddress!.excerpts.push("Founder supplied the marketplace embedded-map observation; consistent with seller website; not independently verified.");
    const data = new Map<string, string>();
    const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const repo = new AcquisitionRepository(() => store); repo.load();
    const state = { scan: before, form: formFromScan(before), cashFlow: createCashFlowAssumptions() };
    const record = makeRecord(state); repo.save(record, null);
    const reopened = new AcquisitionRepository(() => store).load().records[0];
    const restored = parseBackup(serializeBackup(reopened));
    expect(restored.state.scan.businessDetails.streetAddress).toEqual(before.businessDetails.streetAddress);
    expect(restored.state.scan.listingUrl).toBe(listing);
    expect(restored.state.scan.businessDetails.businessWebsite?.value).toBe(website);
    const next = buildLocalPreviewScan({ ...welding, corrections: { businessWebsite: website, streetAddress: address } });
    expect(preserveStreetAddressEvidence(next, before).businessDetails.streetAddress).toEqual(before.businessDetails.streetAddress);
    const csv = buildCurrentAcquisitionCsv(restored.state.scan);
    const pdf = buildReportLines(restored.state.scan).join("\n");
    for (const value of [listing, website, address]) { expect(csv).toContain(value); expect(pdf.replace(/\s/g, "")).toContain(value.replace(/\s/g, "")); }
    expect(restored.state.scan.financials).toEqual(before.financials);
  });
  it("keeps old records compatible and clears address only on an explicit correction", () => {
    const old = scan(); delete old.businessDetails.streetAddress;
    expect(parseBackup(serializeBackup(makeRecord({ scan: old, form: formFromScan(old), cashFlow: createCashFlowAssumptions() }))).state.scan.businessDetails.streetAddress?.value).toBe(address);
    expect(buildLocalPreviewScan({ ...welding, corrections: { streetAddress: "" } }).businessDetails.streetAddress?.value).toBeNull();
  });
});
