import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import photos from "./weldingWebsiteProjects.json";
import welding from "./syntheticWeldingFixture.json";
import painting from "./apify-painting.json";
import type { DealScan, WebsiteProjectPhotograph } from "../src/types";
import { approvedWebsiteProjectPhoto, websiteProjectPhotographs } from "../src/websiteProjectMedia";
import { BusinessWebsiteProjectGallery, ListingPhotographs } from "../src/ListingPhotographs";
import { buildLocalPreviewScan } from "../src/validation";
import { AcquisitionRepository, formFromScan, makeRecord, parseBackup, serializeBackup } from "../src/storage";
import { createCashFlowAssumptions } from "../src/acquisitionCashFlow";
import { preserveListingMedia } from "../src/listingMedia";
import { buildReportLines } from "../src/pdf";
import { buildCurrentAcquisitionCsv } from "../src/csv";

const projects = photos as WebsiteProjectPhotograph[];
function scanWithProjects() {
  return { ...buildLocalPreviewScan({ ...welding, listingUrl: "https://www.bizbuysell.com/business-opportunity/allowlist-compatibility-fixture/2558952/", corrections: { businessWebsite: "https://www.dicostanzowelding.com/" } }), websiteProjectPhotographs: projects };
}
function state(scan = scanWithProjects()) { return { scan, form: formFromScan(scan), cashFlow: createCashFlowAssumptions() }; }

describe("authorized one-time seller website project references", () => {
  it("accepts the four minimal public allowlist compatibility references with source metadata", () => {
    expect(projects).toHaveLength(4);
    expect(new Set(projects.map(photo => photo.url)).size).toBe(4);
    expect(projects.every(approvedWebsiteProjectPhoto)).toBe(true);
    for (const photo of projects) {
      expect(photo.sourceType).toBe("seller_website");
      expect(photo.sourceUrl).toBe("https://www.dicostanzowelding.com/projects");
      expect(photo.alt).toBeTruthy();
      expect(photo.caption).toBeTruthy();
    }
  });
  it.each([
    { url: "https://attacker.example.com/project.jpg" },
    { url: "https://static.wixstatic.com/media/unreviewed.jpeg" },
    { url: projects[0].url + "?token=private" },
    { sourceUrl: "https://www.dicostanzowelding.com/projects/other" },
    { sourceUrl: "https://www.dicostanzowelding.com.evil.example/projects" },
    { sourceUrl: "https://www.dicostanzowelding.com@evil.example/projects" },
    { sourceType: "marketplace_listing" },
    { attribution: "Verified acquisition assets" }
  ])("rejects unsafe or mislabeled website provenance %j", change => {
    const photo = { ...projects[0], ...change } as WebsiteProjectPhotograph;
    expect(approvedWebsiteProjectPhoto(photo)).toBe(false);
    const scan = { ...scanWithProjects(), websiteProjectPhotographs: [photo] };
    expect(() => makeRecord(state(scan))).toThrow();
  });
  it("hides visual gallery copy while retaining accessible provenance and unchanged controls", () => {
    const scan = scanWithProjects();
    const html = renderToStaticMarkup(<BusinessWebsiteProjectGallery scan={scan} />);
    expect(html).toContain("Business Website Project Gallery");
    expect(html).toContain('aria-label="Business Website Project Gallery"');
    expect(html).not.toContain("<h3>");
    expect(html).not.toContain("website-project-note");
    expect(html).not.toContain("Project source");
    expect(html).not.toContain("<a ");
    expect((html.match(/class="sr-only"/g) ?? []).length).toBe(4);
    expect((html.match(/aria-describedby=/g) ?? []).length).toBe(4);
    for (const photo of projects) {
      expect(html).toContain(photo.url);
      expect(html).toContain(photo.sourceUrl);
      expect(html).toContain(photo.caption);
      expect(html).toContain(photo.alt);
      expect(html).toContain(photo.attribution);
    }
    expect(html).toContain("Source type: seller_website");
    expect(html).toContain("Previous business website project photographs");
    expect(html).toContain("Next business website project photographs");
    expect(renderToStaticMarkup(<ListingPhotographs photographs={projects} />)).toBe("");
  });
  it("retains exact references through save, refresh/reopen, update and JSON export/import without modifying financial reports", () => {
    const scan = scanWithProjects();
    const data = new Map<string, string>();
    const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const repo = new AcquisitionRepository(() => store); repo.load();
    const record = makeRecord(state(scan)); repo.save(record, null);
    const restoredRepo = new AcquisitionRepository(() => store);
    const reopened = restoredRepo.load().records[0];
    expect(reopened.state.scan.websiteProjectPhotographs).toEqual(projects);
    const updated = makeRecord(reopened.state, reopened.name, reopened); restoredRepo.save(updated, reopened.revision, true);
    const imported = parseBackup(serializeBackup(updated));
    expect(imported.state.scan.websiteProjectPhotographs).toEqual(projects);
    expect(imported.state.scan.financials).toEqual(scan.financials);
    const withoutProjects: DealScan = { ...scan }; delete withoutProjects.websiteProjectPhotographs;
    expect(buildReportLines(scan)).toEqual(buildReportLines(withoutProjects));
    expect(buildCurrentAcquisitionCsv(scan)).toEqual(buildCurrentAcquisitionCsv(withoutProjects));
  });
  it("retains media through same-listing corrections and never transfers it to another acquisition", () => {
    const previous = scanWithProjects();
    const request = { listingUrl: previous.listingUrl!, listingText: previous.listingText, corrections: { ...previous.correctedFields } };
    const corrected = preserveListingMedia(buildLocalPreviewScan(request), previous);
    expect(corrected.websiteProjectPhotographs).toEqual(projects);
    const another = buildLocalPreviewScan({ listingUrl: painting[0].url, listingText: "Other acquisition" });
    expect(preserveListingMedia(another, previous).websiteProjectPhotographs).toBeUndefined();
    expect(websiteProjectPhotographs({ ...another, websiteProjectPhotographs: projects })).toEqual([]);
    expect(() => makeRecord(state({ ...another, websiteProjectPhotographs: projects }))).toThrow();
  });
  it("keeps version-one records without seller project data compatible", () => {
    const scan = buildLocalPreviewScan(welding);
    const record = makeRecord({ scan, form: formFromScan(scan), cashFlow: createCashFlowAssumptions() });
    expect(parseBackup(serializeBackup(record)).state.scan.websiteProjectPhotographs).toBeUndefined();
  });
});
