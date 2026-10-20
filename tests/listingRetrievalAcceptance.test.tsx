import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import painting from "./apify-painting.json";
import concrete from "./apify-concrete.json";
import { ApifyListingService } from "../server/apify";
import { retrieveListing } from "../src/urlRetrieval";
import { attachRetrieval } from "../src/hybridListing";
import { buildLocalPreviewScan } from "../src/validation";
import { ResultsScreen } from "../src/App";
import { AcquisitionRepository, formFromScan, makeRecord, parseBackup, serializeBackup } from "../src/storage";
import { createCashFlowAssumptions } from "../src/acquisitionCashFlow";
import { buildCurrentAcquisitionCsv, buildSavedAcquisitionsCsv } from "../src/csv";
import { buildReportLines, downloadScanPdf } from "../src/pdf";
import type { DealScan } from "../src/types";

const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const render = (scan: DealScan) => renderToStaticMarkup(<ResultsScreen scan={scan} form={formFromScan(scan)} message={null} errors={[]}
  isLoading={false} isFetchingUrl={false} onBack={() => {}} onDownload={() => {}} onFieldChange={() => {}} onRefresh={() => {}} onScanFromUrl={() => {}} />);
const visibleText = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

async function retrieveFixture(row: Record<string, unknown>, corrections?: Record<string, string>) {
  const provider = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(json({ data: { id: "acceptanceRun", status: "RUNNING" } }))
    .mockResolvedValueOnce(json({ data: { status: "SUCCEEDED", defaultDatasetId: "acceptanceDataset" } }))
    .mockResolvedValueOnce(json([row]));
  const service = new ApifyListingService({ token: "fixture-only", maxChargeUsd: "0.25", timeoutSecs: "180" }, provider);
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    if (url === "/api/retrieval-config") return json(service.settings());
    if (url === "/api/fetch-listing") return json(await service.start(JSON.parse(String(init?.body))));
    if (String(url).startsWith("/api/listing-retrieval/")) return json(await service.status(String(url).split("/").pop()!));
    throw new Error("Unexpected fixture endpoint");
  });
  const result = await retrieveListing(String(row.url), { fetcher: transport, confirm: () => true, progress: () => {}, wait: async () => {} });
  expect(result?.retrievalId).toBeTruthy();
  const mapped = service.reconcile(result!.retrievalId!, { listingUrl: result!.finalUrl, listingText: result!.listingText, corrections });
  expect(provider).toHaveBeenCalledTimes(3);
  return attachRetrieval(buildLocalPreviewScan(mapped.request), mapped.retrieval);
}

function durableRoundtrip(scan: DealScan) {
  const data = new Map<string, string>();
  const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const repository = new AcquisitionRepository(() => store); repository.load();
  const state = { scan, form: formFromScan(scan), cashFlow: { ...createCashFlowAssumptions(), debtService: "15000", managementCosts: "25000" } };
  const record = makeRecord(state); repository.save(record, null);
  repository.recover({ recordId: record.id, recordRevision: record.revision, state: record.state });
  const refreshed = new AcquisitionRepository(() => store).load();
  expect(refreshed.draft?.state).toEqual(record.state);
  expect(refreshed.records[0].state).toEqual(record.state);
  const imported = parseBackup(serializeBackup(refreshed.records[0]));
  expect(imported.state).toEqual(record.state);
  expect(parseBackup(serializeBackup(imported)).state).toEqual(record.state);
  return imported;
}

describe("listing retrieval acceptance - fixture transport, no live provider or image requests", () => {
  it.each([
    { row: painting[0], location: "Mecklenburg County, NC", industry: "Painting", asking: 137500, revenue: 352757, cash: 66392, broker: "Morgan Example" },
    { row: concrete[0], location: "Weddington, NC", industry: "Concrete", asking: 425000, revenue: 1002483, cash: 158803, broker: "Taylor Sample" }
  ])("retrieves, renders and preserves supported fields from retained listing $row.id", async ({ row, location, industry, asking, revenue, cash, broker }) => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Live requests forbidden"));
    try {
      const scan = await retrieveFixture(row);
      // Capture: source values, classifications and references, not substituted images.
      expect(scan.overview.businessName.value).toBe(row.title);
      expect(scan.overview.industry.value).toContain(industry);
      expect(scan.overview.location.value).toBe(location);
      expect(scan.businessDetails.fullDescription.value).toBeTruthy();
      expect(scan.businessDetails.facilities.value).toBe(row.facilities);
      expect(scan.businessDetails.growthOpportunities.value).toBe(row.growthExpansion);
      expect(scan.overview.employeeCount.value).toBe(row.employees);
      expect(scan.businessDetails.reasonForSelling.value).toBe(row.reasonForSelling);
      expect(scan.businessDetails.sellerSupportTraining.value).toBe(row.supportTraining);
      expect(scan.businessDetails.brokerInformation.value).toContain(broker);
      expect(scan.financials.askingPrice.amount).toBe(asking);
      expect(scan.financials.annualRevenue.amount).toBe(revenue);
      expect(scan.financials.advertisedCashFlow).toMatchObject({ amount: cash, source: "seller_claim" });
      expect(scan.financials.sde.amount).toBeNull();
      expect(scan.financials.ebitda.amount).toBeNull();
      expect(scan.financials.inventory.value.amount).toBeNull();
      expect(scan.financials.ffe.value.amount).toBeNull();
      expect(scan.listingUrl).toBe(row.url);
      expect(scan.retrieval?.photographs?.map(photo => photo.url)).toEqual(row.images);
      expect(scan.retrieval?.photographs?.every(photo => photo.sourceUrl === row.url)).toBe(true);
      expect(scan.websiteProjectPhotographs ?? []).toEqual([]);
      expect(scan.businessDetails.businessWebsite?.value).toBeNull();
      // Display is checked against the actual React report, before any save.
      const html = render(scan), text = visibleText(html);
      for (const value of [row.title, location, row.employees, row.reasonForSelling, broker, row.facilities]) expect(text).toContain(value);
      expect(html).toContain(row.imageUrl);
      expect(html).toContain('aria-label="Listing photographs"');
      expect(text).toContain("Not Disclosed");
      const restored = durableRoundtrip(scan);
      expect(restored.state.scan.financials).toEqual(scan.financials);
      expect(restored.state.scan.businessDetails).toEqual(scan.businessDetails);
      expect(restored.state.scan.retrieval?.photographs).toEqual(scan.retrieval?.photographs);
      expect(render(restored.state.scan)).toContain(row.imageUrl);
      // Storage deliberately drops arbitrary provider payloads, retaining normalized evidence.
      expect(restored.state.scan.retrieval?.rawRecord).toEqual({});
      const pdf = buildReportLines(restored.state.scan).join("\n").replace(/\s+/g, " ");
      expect(pdf).toContain(location);
      expect(pdf).toContain(broker);
      expect(pdf.replace(/\s/g, "")).toContain(row.url);
      expect(pdf).toContain(asking.toLocaleString("en-US"));
      for (const csv of [buildCurrentAcquisitionCsv(restored.state.scan), buildSavedAcquisitionsCsv([restored])]) {
        expect(csv).toContain(row.url); expect(csv).toContain('"' + asking + '"'); expect(csv).toContain('"' + cash + '"');
        expect(csv).toContain('"SDE (seller-reported or corrected, unverified) (USD)"');
      }
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it("preserves a supported seller-website evidence label, explicit SDE and complete image metadata through the same workflow", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Live requests forbidden"));
    try {
      // Mock-only additions; not claims about the actual Painting business.
      const row = { ...painting[0], fullDescription: painting[0].fullDescription + "\nBusiness Website: https://example.com/fixture-business/",
        detailsRaw: { ...painting[0].detailsRaw, "Cash Flow (SDE)": "$66,392" },
        images: [{ url: painting[0].imageUrl, alt: "Fixture listing photograph", caption: "Mock provider caption", attribution: "Mock listing credit", creditRequired: true }] };
      const scan = await retrieveFixture(row);
      expect(scan.businessDetails.businessWebsite).toMatchObject({ value: "https://example.com/fixture-business/", source: "seller_claim" });
      expect(scan.financials.sde).toMatchObject({ amount: 66392, source: "seller_claim" });
      expect(scan.financials.advertisedCashFlow.amount).toBe(66392);
      expect(scan.financials.ebitda.amount).toBeNull();
      expect(scan.retrieval?.photographs?.[0]).toMatchObject({ ...row.images[0], sourceUrl: row.url });
      expect(render(scan)).toContain('href="https://example.com/fixture-business/"');
      const restored = durableRoundtrip(scan);
      expect(restored.state.scan.retrieval?.photographs).toEqual(scan.retrieval?.photographs);
      expect(buildCurrentAcquisitionCsv(restored.state.scan)).toContain("https://example.com/fixture-business/");
      expect(buildReportLines(restored.state.scan).join("\n")).toContain("https://example.com/fixture-business/");
      const blobs: Blob[] = [];
      const create = vi.spyOn(URL, "createObjectURL").mockImplementation(blob => { blobs.push(blob as Blob); return "blob:fixture"; });
      const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      vi.stubGlobal("document", { createElement: () => ({ click: vi.fn(), href: "", download: "" }) });
      try {
        downloadScanPdf(restored.state.scan);
        expect(await blobs[0].text()).toContain("$66,392");
      } finally { create.mockRestore(); revoke.mockRestore(); vi.unstubAllGlobals(); }
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it("does not fabricate missing details or photographs in a sparse provider response", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Live requests forbidden"));
    try {
      const scan = await retrieveFixture({ id: painting[0].id, url: painting[0].url, title: "Mock sparse listing", cashFlow: 12000 });
      expect(scan.financials.advertisedCashFlow.amount).toBe(12000);
      for (const field of [scan.financials.sde, scan.financials.ebitda, scan.financials.annualRevenue]) expect(field.amount).toBeNull();
      expect(scan.overview.location.value).toBeNull();
      expect(scan.businessDetails.facilities.value).toBeNull();
      expect(scan.businessDetails.businessWebsite?.value).toBeNull();
      expect(scan.retrieval?.photographs).toEqual([]);
      expect(render(scan)).not.toContain('aria-label="Listing photographs"');
      expect(durableRoundtrip(scan).state.scan.retrieval?.photographs).toEqual([]);
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it("captures a standalone provider website in the report, durable recovery and PDF/CSV exports", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Live requests forbidden"));
    try {
      const scan = await retrieveFixture({ ...painting[0], businessWebsite: "https://example.com/structured-only/" });
      expect(scan.retrieval?.rawRecord.businessWebsite).toBe("https://example.com/structured-only/");
      expect(scan.businessDetails.businessWebsite).toMatchObject({ value: "https://example.com/structured-only/", source: "seller_claim" });
      expect(scan.businessDetails.businessWebsite?.excerpts.join(" ")).toContain("Business Website: https://example.com/structured-only/");
      const html = render(scan);
      expect(html).toContain('href="https://example.com/structured-only/"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      const restored = durableRoundtrip(scan);
      expect(restored.state.scan.businessDetails.businessWebsite).toEqual(scan.businessDetails.businessWebsite);
      expect(restored.state.scan.retrieval?.rawRecord).toEqual({});
      expect(buildReportLines(restored.state.scan).join("\n")).toContain("https://example.com/structured-only/");
      expect(buildCurrentAcquisitionCsv(restored.state.scan)).toContain("https://example.com/structured-only/");
      expect(buildSavedAcquisitionsCsv([restored])).toContain("https://example.com/structured-only/");
      const baseline = await retrieveFixture(painting[0]);
      expect(scan.retrieval?.photographs).toEqual(baseline.retrieval?.photographs);
      for (const key of Object.keys(baseline.overview) as (keyof typeof baseline.overview)[]) {
        expect(scan.overview[key]?.value).toEqual(baseline.overview[key]?.value);
        expect(scan.overview[key]?.source).toBe(baseline.overview[key]?.source);
      }
      expect(scan.ratios).toEqual(baseline.ratios);
      expect(scan.businessDetails.fullDescription).toEqual(baseline.businessDetails.fullDescription);
      for (const key of ["askingPrice", "annualRevenue", "sde", "ebitda", "advertisedCashFlow"] as const) {
        expect(scan.financials[key].amount).toBe(baseline.financials[key].amount);
        expect(scan.financials[key].source).toBe(baseline.financials[key].source);
      }
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it.each([undefined, "", "javascript:alert(1)", "http://example.com/", "https://user:password@example.com/", "https://127.0.0.1/", "https://example.com/?token=private"])("never invents or renders an unavailable/unsafe provider website: %s", async businessWebsite => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Live requests forbidden"));
    try {
      const scan = await retrieveFixture({ ...painting[0], businessWebsite });
      expect(scan.businessDetails.businessWebsite?.value).toBeNull();
      expect(render(scan)).not.toContain("Visit Website");
      expect(durableRoundtrip(scan).state.scan.businessDetails.businessWebsite?.value).toBeNull();
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it.each(["https://example.com/founder-correction/", ""])("preserves the explicit user website correction or clear: %s", async businessWebsite => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Live requests forbidden"));
    try {
      const scan = await retrieveFixture({ ...painting[0], businessWebsite: "https://example.com/provider/" }, { businessWebsite });
      expect(scan.businessDetails.businessWebsite?.value).toBe(businessWebsite || null);
      expect(scan.correctedFields.businessWebsite).toBe(businessWebsite);
      if (businessWebsite) expect(scan.businessDetails.businessWebsite?.source).toBe("user_correction");
      expect(durableRoundtrip(scan).state.scan.businessDetails.businessWebsite).toEqual(scan.businessDetails.businessWebsite);
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it("retains source-text website precedence and surfaces a provider disagreement", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Live requests forbidden"));
    try {
      const scan = await retrieveFixture({ ...painting[0], businessWebsite: "https://example.com/provider/",
        fullDescription: painting[0].fullDescription + "\nBusiness Website: https://example.com/source-text/" });
      expect(scan.businessDetails.businessWebsite?.value).toBe("https://example.com/source-text/");
      expect(scan.retrieval?.conflicts).toContainEqual(expect.stringContaining("Business Website: source text"));
      expect(scan.retrieval?.rawRecord.businessWebsite).toBe("https://example.com/provider/");
      const restored = durableRoundtrip(scan);
      expect(restored.state.scan.retrieval?.conflicts).toEqual(scan.retrieval?.conflicts);
      expect(restored.state.scan.businessDetails.businessWebsite).toEqual(scan.businessDetails.businessWebsite);
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
});
