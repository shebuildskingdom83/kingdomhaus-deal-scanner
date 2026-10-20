import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import painting from "./apify-painting.json";
import concrete from "./apify-concrete.json";
import { ApifyListingService } from "../server/apify";
import { retrieveListing } from "../src/urlRetrieval";
import { attachRetrieval, extractListingPhotographs } from "../src/hybridListing";
import { buildLocalPreviewScan } from "../src/validation";
import { ResultsScreen } from "../src/App";
import { AcquisitionRepository, formFromScan, makeRecord, parseBackup, serializeBackup } from "../src/storage";
import { createCashFlowAssumptions } from "../src/acquisitionCashFlow";
import { preserveListingMedia } from "../src/listingMedia";
import { ListingPhotographs } from "../src/ListingPhotographs";

const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const config = { token: "fixture-only-not-a-real-token", maxChargeUsd: "0.25", timeoutSecs: "180" };

describe("required initial URL-scan listing photographs (fixture transport only)", () => {
  it.each([painting[0], concrete[0]])("renders initial URL-scan photographs before any record is saved", async row => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Live requests forbidden"));
    try {
      const provider = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(json({ data: { id: "fixtureRun", status: "RUNNING" } }))
        .mockResolvedValueOnce(json({ data: { status: "SUCCEEDED", defaultDatasetId: "fixtureDataset" } }))
        .mockResolvedValueOnce(json([row]));
      const service = new ApifyListingService(config, provider);
      const transport = vi.fn<typeof fetch>(async (address, init) => {
        if (address === "/api/retrieval-config") return json(service.settings());
        if (address === "/api/fetch-listing") return json(await service.start(JSON.parse(String(init?.body))));
        if (String(address).startsWith("/api/listing-retrieval/")) return json(await service.status(String(address).split("/").pop()!));
        throw new Error("Unexpected fixture endpoint");
      });
      const confirm = vi.fn(() => true);
      const ready = await retrieveListing(row.url, { fetcher: transport, confirm, progress: vi.fn(), wait: async () => {} });
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(ready?.retrievalId).toBeTruthy();
      // The same reconciliation/report construction used by POST /api/scan.
      const hybrid = service.reconcile(ready!.retrievalId!, { listingUrl: ready!.finalUrl, listingText: ready!.listingText });
      const scan = attachRetrieval(buildLocalPreviewScan(hybrid.request), hybrid.retrieval);
      const save = vi.fn();
      const repo = new AcquisitionRepository(() => ({ getItem: () => null, setItem: save }));
      repo.load();
      expect(scan.retrieval!.photographs).toEqual(expect.arrayContaining([expect.objectContaining({ url: row.imageUrl, sourceUrl: row.url })]));
      const html = renderToStaticMarkup(<ResultsScreen scan={scan} form={formFromScan(scan)} message={null} errors={[]}
        isLoading={false} isFetchingUrl={false} onBack={() => {}} onDownload={() => {}}
        onFieldChange={() => {}} onRefresh={() => {}} onScanFromUrl={() => {}} />);
      expect(html).toContain('aria-label="Listing photographs"');
      expect(html).toContain('src="' + row.imageUrl + '"');
      expect(save).not.toHaveBeenCalled();
      expect(provider).toHaveBeenCalledTimes(3);
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it("retains available alt text, captions, credits and provenance through initial extraction and all durable snapshots", () => {
    const row = painting[0];
    const photos = extractListingPhotographs({ ...row, images: [row.imageUrl, { url: row.imageUrl, alt: "Workshop exterior", caption: "Seller-supplied exterior view", attribution: "Listing photographer credit", creditRequired: true }] }, row.url);
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({ alt: "Workshop exterior", caption: "Seller-supplied exterior view", attribution: "Listing photographer credit", creditRequired: true, sourceUrl: row.url });
    const scan = buildLocalPreviewScan({ listingUrl: row.url, listingText: "Fixture business\nAsking Price: $137500" });
    scan.retrieval = { provider: "apify", actorId: "fixture", sourceUrl: row.url, retrievedAt: new Date().toISOString(), rawRecord: {}, usageUsd: null, maxChargeUsd: 0.25, conflicts: [], photographs: photos };
    const data = new Map<string, string>();
    const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const repo = new AcquisitionRepository(() => store); repo.load();
    const record = makeRecord({ scan, form: formFromScan(scan), cashFlow: createCashFlowAssumptions() }); repo.save(record, null);
    const reopened = new AcquisitionRepository(() => store).load().records[0];
    expect(reopened.state.scan.retrieval!.photographs).toEqual(photos);
    const restored = parseBackup(serializeBackup(reopened));
    expect(restored.state.scan.retrieval!.photographs).toEqual(photos);
    const corrected = preserveListingMedia(buildLocalPreviewScan({ listingUrl: row.url, listingText: scan.listingText, corrections: { askingPrice: "$130000" } }), restored.state.scan);
    expect(corrected.retrieval!.photographs).toEqual(photos);
    expect(corrected.financials.askingPrice.amount).toBe(130000);
  });

  it("does not substitute seller-website images or a different marketplace listing's images", () => {
    const row = painting[0];
    expect(extractListingPhotographs({ images: ["https://example.com/synthetic-fabrication/shop.jpg"], imageUrl: "https://example.com/synthetic-fabrication/exterior.jpg" }, row.url)).toEqual([]);
    expect(extractListingPhotographs({ images: [{ url: row.imageUrl, sourceUrl: "https://example.com/synthetic-fabrication/" }] }, row.url)).toEqual([]);
    expect(extractListingPhotographs({ images: [{ url: row.imageUrl, sourceUrl: concrete[0].url }] }, row.url)).toEqual([]);
    expect(extractListingPhotographs(concrete[0], row.url)).toEqual([]);
    const websitePhoto = { url: row.imageUrl, sourceUrl: "https://example.com/synthetic-fabrication/", attribution: "Seller website photograph" };
    expect(renderToStaticMarkup(<ListingPhotographs photographs={[websitePhoto]} />)).toBe("");
    const scan = buildLocalPreviewScan({ listingUrl: row.url, listingText: "Fixture business" });
    scan.retrieval = { provider: "apify", actorId: "fixture", sourceUrl: row.url, retrievedAt: new Date().toISOString(), rawRecord: {}, usageUsd: null, maxChargeUsd: 0.25, conflicts: [], photographs: [websitePhoto] };
    expect(() => makeRecord({ scan, form: formFromScan(scan), cashFlow: createCashFlowAssumptions() })).toThrow();
  });

  it("deduplicates safe references, escapes metadata as text and excludes unsafe URLs", () => {
    const row = painting[0];
    const photos = extractListingPhotographs({ images: [{ src: row.imageUrl, altText: '<img src=x onerror=alert(1)>Shop', caption: "Seller caption" }, row.imageUrl, "javascript:alert(1)", row.imageUrl + "?token=private"] }, row.url);
    expect(photos).toHaveLength(1);
    expect(photos[0].alt).toBe("Shop");
    expect(photos[0].caption).toBe("Seller caption");
    expect(photos[0].sourceUrl).toBe(row.url);
  });
});
