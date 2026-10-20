import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import paintingRows from "./apify-painting.json";
import concreteRows from "./apify-concrete.json";
import { APIFY_ACTOR_ID, approvedBizBuySellUrl, attachRetrieval, reconcileApifyListing, safeListingImage } from "../src/hybridListing";
import { buildLocalPreviewScan } from "../src/validation";
import { ApifyListingService } from "../server/apify";
import { retrieveListing } from "../src/urlRetrieval";
import { ListingPhotographs } from "../src/ListingPhotographs";
import { ResultsScreen, type FormState } from "../src/App";
import { buildReportLines, downloadScanPdf } from "../src/pdf";
import { buildPuterPrompt } from "../src/puterPoc";
import { equivalentListingLocations, formatScrapedDescription } from "../src/listingPresentation";

const painting = paintingRows[0], concrete = concreteRows[0];
const config = { token: "test-only-secret", maxChargeUsd: "0.25", timeoutSecs: "180" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const requestId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
function scanRecord(record: Record<string, unknown>, corrections: Record<string, string> = {}) {
  const mapped = reconcileApifyListing(record, { listingUrl: String(record.url), listingText: "", corrections });
  return attachRetrieval(buildLocalPreviewScan(mapped.request), { provider: "apify", actorId: APIFY_ACTOR_ID, sourceUrl: String(record.url), retrievedAt: "2026-10-17T20:00:00Z", rawRecord: record, usageUsd: 0.004, maxChargeUsd: 0.25, conflicts: mapped.conflicts, photographs: mapped.photographs });
}

describe("synthetic provider-shaped listing samples (no live retrieval)", () => {
  it("retains Painting financials, county, broker-profile attribution, excluded equipment and original record", () => {
    const scan = scanRecord(painting);
    expect(scan.financials.askingPrice.amount).toBe(137500);
    expect(scan.financials.annualRevenue.amount).toBe(352757);
    expect(scan.financials.advertisedCashFlow.amount).toBe(66392);
    expect(scan.financials.sde.amount).toBeNull();
    expect(scan.financials.ebitda.amount).toBeNull();
    expect(scan.overview.location.value).toBe("Mecklenburg County, NC");
    expect(scan.businessDetails.brokerInformation.value).toBe("Morgan Example — Example Brokerage");
    expect(scan.businessDetails.brokerInformation.source).toBe("url_extract");
    expect(scan.businessDetails.brokerInformation.excerpts).toContain(painting.brokerProfileUrl);
    expect(scan.overview.employeeCount.value).toBe("1 Employee");
    expect(scan.overview.ownerInvolvement.value).toContain("40-hour");
    expect(scan.financials.inventory.includedStatus).toBe("not_included");
    expect(scan.financials.ffe.includedStatus).toBe("not_included");
    expect(scan.retrieval?.rawRecord).toEqual(painting);
    expect(scan.retrieval?.photographs).toHaveLength(1);
    expect(scan.riskChecks.some((risk) => risk.label === "Franchise requirements")).toBe(true);
  });
  it("recovers Concrete description, Weddington, broker, services, contractors and owner role", () => {
    const scan = scanRecord(concrete);
    expect(scan.financials.askingPrice.amount).toBe(425000);
    expect(scan.financials.annualRevenue.amount).toBe(1002483);
    expect(scan.financials.advertisedCashFlow.amount).toBe(158803);
    expect(scan.financials.sde.amount).toBeNull();
    expect(scan.overview.location.value).toBe("Weddington, NC");
    expect(scan.businessDetails.brokerInformation.value).toBe("Taylor Sample");
    expect(scan.businessDetails.fullDescription.value).toContain("fully operational Sample Concrete Franchise");
    expect(scan.businessDetails.fullDescription.value).not.toContain("7-star Google rating");
    expect(scan.overview.services.value).toContain("driveways");
    expect(scan.overview.industry.value).toContain("Concrete");
    expect(scan.overview.employeeCount.value).toContain("5 Contractors");
    expect(scan.overview.ownerInvolvement.value).toMatch(/sales|estimates|scheduling/i);
    expect(scan.businessDetails.growthOpportunities.value).toContain("property managers");
  });
  it("uses explicit SDE evidence, preserves corrections, and supplies the same normalized figures to PDF and AI", () => {
    const explicit = scanRecord({ ...painting, detailsRaw: { ...painting.detailsRaw, "Cash Flow (SDE)": "$66,392" } });
    expect(explicit.financials.sde.amount).toBe(66392);
    const corrected = scanRecord(painting, { sde: "$70,000", askingPrice: "$140,000" });
    expect(corrected.financials.sde.amount).toBe(70000);
    expect(corrected.financials.sde.source).toBe("user_correction");
    expect(corrected.ratios.askingPriceToSde).toBe(2);
    expect(buildReportLines(corrected).join("\n")).toContain("SDE: $70,000");
    expect(buildPuterPrompt(corrected)).toContain("70000");
    expect(buildReportLines(corrected).join("\n")).toContain("Listing retrieved:");
    expect(buildReportLines(corrected).join("\n")).not.toContain("Apify");
  });
  it("flags conflicts, preserves unknowns and rejects disclaimers as broker facts", () => {
    const scan = scanRecord({ ...concrete, fullDescription: "Business Location Location: Weddington, NC\nAsking Price: $400,000\nConcrete services business.", brokerName: "Disclaimer: Information is not guaranteed", brokerProfileUrl: null });
    expect(scan.financials.askingPrice.amount).toBe(400000);
    expect(scan.retrieval?.conflicts.join(" ")).toContain("425000");
    expect(scan.missingInformation.join(" ")).toContain("Requires Verification");
    expect(scan.businessDetails.brokerInformation.value).toBeNull();
    expect(scan.financials.inventory.value.amount).toBeNull();
    expect(scan.financials.inventory.includedStatus).toBe("unknown");
    const missing = scanRecord({ id: "9900103", url: concrete.url, title: "Concrete business", cashFlow: 158803 });
    expect(missing.overview.location.value).toBeNull();
    expect(missing.financials.sde.amount).toBeNull();
    expect(missing.retrieval?.photographs).toEqual([]);
  });
  it("renders approved attributed photographs without accepting arbitrary image destinations", () => {
    const scan = scanRecord(painting);
    const html = renderToStaticMarkup(<ListingPhotographs photographs={scan.retrieval!.photographs} />);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain("Listing photograph 1");
    expect(html).not.toContain("<figcaption>");
    expect(html).not.toContain("Apify");
    for (const url of ["javascript:alert(1)", "http://images.bizbuysell.com/a.jpg", "https://127.0.0.1/a.jpg", "https://evil.example/a.jpg", "https://images.bizbuysell.com/a.jpg?token=secret"]) expect(safeListingImage(url)).toBeNull();
  });
  it.each([{ record: painting, location: "Mecklenburg County, NC", broker: "Morgan Example" }, { record: concrete, location: "Weddington, NC", broker: "Taylor Sample" }])("renders the final normalized dashboard from each export", ({ record, location, broker }) => {
    const scan = scanRecord(record);
    const form: FormState = { businessName: "", listingUrl: record.url, listingText: scan.listingText, askingPrice: "", businessAskingPrice: "", annualRevenue: "", sde: "", ebitda: "", advertisedCashFlow: "", inventory: "", ffe: "", realEstate: "" };
    const html = renderToStaticMarkup(<ResultsScreen scan={scan} form={form} message={null} errors={[]} isLoading={false} isFetchingUrl={false}
      onBack={() => {}} onDownload={() => {}} onFieldChange={() => {}} onRefresh={() => {}} onScanFromUrl={() => {}} />);
    expect(html).toContain(location);
    expect(html).toContain(broker);
    expect(html).toContain("Listing photographs");
    expect(html).toContain('style="white-space:pre-line"');
    if (record.id === concrete.id) expect(html).toContain("Source conflicts");
    else expect(html).not.toContain("Source conflicts");
    expect(html).toContain("Post-Acquisition Cash Flow");
    expect(html).toContain("KingdomHaus Intelligence");
  });
});

describe("location equivalence and seller description formatting", () => {
  it("suppresses the Painting county alias warning with matching provider context", () => {
    const scan = scanRecord(painting);
    expect(scan.overview.location.value).toBe("Mecklenburg County, NC");
    expect(scan.retrieval?.conflicts).toEqual([]);
    expect(scan.riskChecks.some((risk) => risk.label === "Source conflicts")).toBe(false);
    expect(equivalentListingLocations("Mecklenburg County, NC", "Mecklenburg, North Carolina", { city: "Mecklenburg", state: "North Carolina" })).toBe(true);
    expect(equivalentListingLocations("Weddington, North Carolina", "Weddington, NC", {})).toBe(true);
  });
  it.each([
    ["Mecklenburg County, NC", "Union County, North Carolina"],
    ["Weddington, NC", "Charlotte, North Carolina"],
    ["Mecklenburg County, NC", "Mecklenburg, Virginia"],
    ["Mecklenburg County, NC", "City of Mecklenburg, NC"]
  ])("preserves distinct places: %s vs %s", (source, structured) => {
    expect(equivalentListingLocations(source, structured, { city: "Mecklenburg", state: "NC" })).toBe(false);
  });
  it("requires county context and preserves Concrete's actual malformed-location conflict", () => {
    expect(equivalentListingLocations("Mecklenburg County, NC", "Mecklenburg, North Carolina", {})).toBe(false);
    expect(scanRecord(concrete).retrieval?.conflicts).toEqual([expect.stringContaining("Weddington, NC")]);
    const differentCounty = scanRecord({ ...painting, city: "Union County", location: "Union County, North Carolina" });
    expect(differentCounty.retrieval?.conflicts).toEqual([expect.stringContaining("Union County")]);
  });
  it("repairs only whitespace in the original glued Painting description", () => {
    const formatted = formatScrapedDescription(painting.fullDescription);
    expect(formatted).toContain("HIGHLIGHTS\nEstablished 2013\n85% Residential");
    expect(formatted).toContain("Revenue Mix\nOwner-Operated");
    expect(formatted).toContain("Hours/Week\nExclusive Franchise Territory\n\nThis franchise");
    expect(formatted.replace(/\s/g, "")).toBe(painting.fullDescription.replace(/\s/g, ""));
    expect(formatScrapedDescription(formatted)).toBe(formatted);
    expect(formatScrapedDescription("A 4.7-star rating. Revenue $1,002,483. EBITDA: Not Disclosed.")).toContain("4.7-star rating.");
  });
  it("retains readable formatting in the final report and preserves raw source bytes", () => {
    const original = JSON.stringify(painting);
    const scan = scanRecord(painting);
    const description = scan.businessDetails.fullDescription.value!;
    expect(description).toContain("HIGHLIGHTS\nEstablished 2013\n85% Residential");
    expect(description).toContain("Revenue Mix\nOwner-Operated");
    expect(description).toContain("Territory\n\nThis franchise");
    expect(scan.overview.description.value).toBe(description);
    expect(scan.retrieval?.rawRecord.fullDescription).toBe(painting.fullDescription);
    expect(JSON.stringify(painting)).toBe(original);
    expect(description).not.toMatch(/HIGHLIGHTSEstablished|201385%|MixOwner/);
  });
  it.each([{ row: painting, asking: 137500, revenue: 352757, cashFlow: 66392, broker: "Morgan Example — Example Brokerage" }, { row: concrete, asking: 425000, revenue: 1002483, cashFlow: 158803, broker: "Taylor Sample" }])("keeps export financials and broker facts unchanged", ({ row, asking, revenue, cashFlow, broker }) => {
    const scan = scanRecord(row);
    expect(scan.financials.askingPrice.amount).toBe(asking);
    expect(scan.financials.annualRevenue.amount).toBe(revenue);
    expect(scan.financials.advertisedCashFlow.amount).toBe(cashFlow);
    expect(scan.financials.sde.amount).toBeNull();
    expect(scan.financials.ebitda.amount).toBeNull();
    expect(scan.businessDetails.brokerInformation.value).toBe(broker);
  });
  it("writes the formatted lines into the downloadable PDF without making network requests", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("External requests are forbidden in this regression"));
    const scan = scanRecord(painting);
    const blobs: Blob[] = [];
    vi.stubGlobal("document", { createElement: () => ({ href: "", download: "", click: vi.fn() }) });
    vi.stubGlobal("URL", { createObjectURL: (blob: Blob) => { blobs.push(blob); return "blob:test"; }, revokeObjectURL: vi.fn() });
    try {
      const lines = buildReportLines(scan);
      expect(lines).toContain("HIGHLIGHTS");
      expect(lines).toContain("Established 2013");
      expect(lines).toContain("85% Residential / 15% Commercial Revenue Mix");
      downloadScanPdf(scan);
      const pdf = await blobs[0].text();
      expect(pdf).toContain("(HIGHLIGHTS) Tj");
      expect(pdf).toContain("(Established 2013) Tj");
      expect(pdf).toContain("(85% Residential / 15% Commercial Revenue Mix) Tj");
      expect(pdf).toContain("Broker: Morgan Example");
      expect(pdf).not.toContain("HIGHLIGHTSEstablished");
      expect(network).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); network.mockRestore(); }
  });
});

describe("bounded server-side Apify retrieval", () => {
  it("starts one run, deduplicates submissions, polls, and retrieves only that run's dataset", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ data: { id: "run123", status: "RUNNING" } }))
      .mockResolvedValueOnce(json({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset123", usageTotalUsd: 0.004 } }))
      .mockResolvedValueOnce(json([painting]));
    const service = new ApifyListingService(config, fetcher);
    const input = { url: painting.url, paidScanConfirmed: true, requestId };
    const [first, duplicate] = await Promise.all([service.start(input), service.start(input)]);
    expect(first).toEqual(duplicate);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [address, options] = fetcher.mock.calls[0];
    expect(String(address)).toContain(`/actors/${APIFY_ACTOR_ID}/runs?`);
    expect(String(address)).toContain("maxTotalChargeUsd=0.25");
    expect(String(address)).toContain("restartOnError=false");
    expect(String(address)).not.toContain(config.token);
    expect(options?.headers).toMatchObject({ Authorization: `Bearer ${config.token}` });
    expect(JSON.parse(String(options?.body))).toMatchObject({ urls: [painting.url], fetchDetails: true, maxListings: 1, maxPages: 1, incrementalMode: false });
    if (!first.ok || !("status" in first)) throw new Error("Expected progress");
    const result = await service.status(first.jobId);
    expect(result.ok && "listingText" in result).toBe(true);
    expect(JSON.stringify(result)).not.toContain(config.token);
    expect(fetcher.mock.calls[2][0]).toContain("/datasets/dataset123/items?");
    const hybrid = service.reconcile(first.jobId, { listingUrl: painting.url, listingText: "", corrections: { askingPrice: "$130,000" } });
    expect(buildLocalPreviewScan(hybrid.request).financials.askingPrice.amount).toBe(130000);
    await service.start(input);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("requires confirmation, a valid listing URL and valid spending limits before any chargeable call", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const service = new ApifyListingService(config, fetcher);
    for (const url of ["https://www.bizbuysell.com/businesses-for-sale/", "https://bizbuysell.com.evil.example/business-opportunity/a/1234567/", "http://www.bizbuysell.com/business-opportunity/a/1234567/"]) {
      expect((await service.start({ url, paidScanConfirmed: true, requestId })).ok).toBe(false);
      expect(() => approvedBizBuySellUrl(url)).toThrow();
    }
    expect((await service.start({ url: painting.url, requestId })).ok).toBe(false);
    expect(new ApifyListingService({ ...config, maxChargeUsd: "NaN" }, fetcher).settings().enabled).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 402, 429, 500])("does not retry an Apify HTTP %s start failure", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ error: { message: "sensitive provider detail" } }, status));
    const service = new ApifyListingService(config, fetcher);
    const input = { url: painting.url, paidScanConfirmed: true, requestId };
    const result = await service.start(input);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("sensitive provider detail");
    await service.start(input);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not create a duplicate run after a status-network failure or an uncertain start", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ data: { id: "run123" } })).mockRejectedValueOnce(new Error("offline"));
    const service = new ApifyListingService(config, fetcher);
    const start = await service.start({ url: painting.url, paidScanConfirmed: true, requestId });
    if (!start.ok || !("status" in start)) throw new Error("Expected progress");
    expect((await service.status(start.jobId)).ok).toBe(false);
    expect((await service.start({ url: painting.url, paidScanConfirmed: true, requestId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" })).ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(["FAILED", "TIMED-OUT", "ABORTED"])("reports terminal %s and available usage without another start", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ data: { id: "run123" } })).mockResolvedValueOnce(json({ data: { status, usageTotalUsd: 0.003 } }));
    const service = new ApifyListingService(config, fetcher);
    const start = await service.start({ url: painting.url, paidScanConfirmed: true, requestId });
    if (!start.ok || !("status" in start)) throw new Error("Expected progress");
    const result = await service.status(start.jobId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("$0.0030");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([{ rows: [] }, { rows: [concrete] }, { rows: [painting, concrete] }, { rows: [{ ...concrete, url: painting.url }] }])("rejects empty, wrong, or multiple dataset rows", async ({ rows }) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ data: { id: "run123" } }))
      .mockResolvedValueOnce(json({ data: { status: "SUCCEEDED", defaultDatasetId: "dataset123" } })).mockResolvedValueOnce(json(rows));
    const service = new ApifyListingService(config, fetcher);
    const start = await service.start({ url: painting.url, paidScanConfirmed: true, requestId });
    if (!start.ok || !("status" in start)) throw new Error("Expected progress");
    expect((await service.status(start.jobId)).ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe("existing URL action with manual fallback", () => {
  it("does not start a paid run when confirmation is declined", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ enabled: true, maxChargeUsd: 0.25 }));
    expect(await retrieveListing(painting.url, { fetcher, confirm: () => false, progress: () => {} })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps progress read-only and returns the retrieved text and original source URL", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ enabled: true, maxChargeUsd: 0.25 }))
      .mockResolvedValueOnce(json({ ok: true, status: "running", jobId: requestId, usageUsd: null, maxChargeUsd: 0.25, message: "Running" }))
      .mockResolvedValueOnce(json({ ok: true, listingText: "Listing source text", finalUrl: painting.url, title: null, source: "BizBuySell", message: "Done" }));
    const progress = vi.fn();
    const result = await retrieveListing(painting.url, { fetcher, confirm: () => true, progress, wait: async () => {} });
    expect(result?.finalUrl).toBe(painting.url);
    expect(fetcher.mock.calls[2][1]?.method).toBeUndefined();
    expect(progress).toHaveBeenCalledWith("Retrieving listing information...");
    expect(JSON.stringify(progress.mock.calls)).not.toMatch(/Apify|Spending limit|usage|\$/i);
  });
  it("preserves friendly public-URL failures and allows the existing manual scan", async () => {
    const message = "This website doesn't allow automatic retrieval. Copy the listing details and paste them below to continue.";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: false, error: message }));
    await expect(retrieveListing("https://example.com/listing", { fetcher, confirm: () => true, progress: () => {} })).rejects.toThrow(message);
    const scan = buildLocalPreviewScan({ listingUrl: painting.url, listingText: "Painting business\nAsking Price: $137,500\nCash Flow (SDE): $66,392" });
    expect(scan.listingUrl).toBe(painting.url);
    expect(scan.financials.sde.amount).toBe(66392);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
