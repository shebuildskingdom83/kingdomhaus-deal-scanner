import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fixture from "./syntheticWeldingFixture.json";
import { buildLocalPreviewScan } from "../src/validation";
import { ResultsScreen } from "../src/App";
import { formFromScan, makeRecord, parseBackup, serializeBackup } from "../src/storage";
import { createCashFlowAssumptions } from "../src/acquisitionCashFlow";
import { buildCurrentAcquisitionCsv, buildSavedAcquisitionsCsv, downloadCsv, encodeCsv } from "../src/csv";
import { buildReportLines } from "../src/pdf";
import { resultsDisclaimer, retrievalFailure } from "../src/reporting";
import { retrieveListing } from "../src/urlRetrieval";

const scanFixture = () => buildLocalPreviewScan(fixture);
const assumptions = () => ({ ...createCashFlowAssumptions(),
  normalizationAdjustment:"0", debtService:"15000", managementCosts:"25000",
  capexReserve:"5000", workingCapitalReserve:"3000", currentReviewed:true,
  normalizationNotes:"Advertised cash flow is not SDE; verify owner compensation.",
  payrollSavings:"1000", operatingSavings:"2000", improvementCosts:"500",
  improvementsReviewed:true, implementationCosts:"3000"
});

describe("synthetic fabrication listing evidence, not live retrieval", () => {
  it("retains supplied financials without upgrading generic cash flow to SDE or EBITDA", () => {
    const scan = scanFixture();
    expect(scan.financials.askingPrice.amount).toBe(749000);
    expect(scan.financials.annualRevenue.amount).toBe(300000);
    expect(scan.financials.advertisedCashFlow.amount).toBe(220000);
    expect(scan.financials.advertisedCashFlow.sellerTerminology).toBe("Cash Flow");
    expect(scan.financials.sde.amount).toBeNull();
    expect(scan.financials.ebitda.amount).toBeNull();
    expect(scan.financials.businessAskingPrice.amount).toBeNull();
    expect(scan.ratios.businessAskingPriceToSde).toBeNull();
    expect(scan.listingText).toBe(fixture.listingText);
  });
  it("reconciles narrative inclusion with numeric asset fields and leaves undisclosed inventory inclusion unknown", () => {
    const f = scanFixture().financials;
    expect(f.realEstate.value.amount).toBe(450000); expect(f.realEstate.includedStatus).toBe("included");
    expect(f.ffe.value.amount).toBe(80000); expect(f.ffe.includedStatus).toBe("included");
    expect(f.inventory.value.amount).toBe(5000); expect(f.inventory.includedStatus).toBe("unknown");
    expect(f.realEstate.notes.excerpts.length).toBeGreaterThan(0);
    expect(f.ffe.notes.excerpts.length).toBeGreaterThan(0);
    expect(f.knownAdditionalAcquisitionCosts.amount).toBeNull();
  });
  it("surfaces owner-held CWI credentials and replacement diligence without assigning compensation", () => {
    const scan = scanFixture();
    expect(scan.overview.ownerInvolvement.value).toContain("Certified Welding Inspector");
    expect(scan.riskChecks.find(r => r.label === "Licensing and credentials")?.explanation).toContain("transferability");
    expect(scan.claritySummary.sellerDependence).toContain("CWI");
    expect(createCashFlowAssumptions().managementCosts).toBe("");
  });
  it("maps only an explicitly identified SDE label to seller-reported SDE", () => {
    const scan = buildLocalPreviewScan({ ...fixture, listingText:fixture.listingText.replace("Cash Flow: $220000","Cash Flow (SDE): $220000") });
    expect(scan.financials.sde.amount).toBe(220000);
    expect(scan.financials.sde.source).toBe("seller_claim");
    expect(scan.ratios.askingPriceToSde).toBe(3.4);
    expect(scan.ratios.businessAskingPriceToSde).toBeNull();
  });
  it("does not override explicit excluded or optional assets with broader narrative inclusion", () => {
    const scan = buildLocalPreviewScan({ ...fixture, corrections:{ ffe:"$80,000 not included",realEstate:"$450,000 optional, not included" } });
    expect(scan.financials.ffe.includedStatus).toBe("not_included");
    expect(scan.financials.realEstate.includedStatus).toBe("not_included");
    expect(scan.financials.knownAdditionalAcquisitionCosts.amount).toBe(80000);
  });
  it("retains narrative-only asset values without borrowing inclusion from a different asset", () => {
    const scan = buildLocalPreviewScan({ listingText:"Standalone workshop.\nEquipment valued at $80,000.\nReal estate is included in the asking price.\nAsking Price: $749,000.\nInventory valued at $5,000." });
    expect(scan.financials.ffe.value.amount).toBe(80000);
    expect(scan.financials.ffe.includedStatus).toBe("unknown");
    expect(scan.financials.inventory.value.amount).toBe(5000);
    expect(scan.financials.inventory.includedStatus).toBe("unknown");
    expect(scan.financials.realEstate.includedStatus).toBe("included");
  });
  it("renders no invented business-only price or multiple, keeps Notion disabled and adds the disclaimer", () => {
    const scan = scanFixture();
    const html = renderToStaticMarkup(<ResultsScreen scan={scan} form={formFromScan(scan)} message={null} errors={[]}
      isLoading={false} isFetchingUrl={false} onBack={()=>{}} onDownload={()=>{}} onFieldChange={()=>{}} onRefresh={()=>{}} onScanFromUrl={()=>{}} />);
    expect(html).toContain("3.40x");
    expect(html).not.toContain("1.36x");
    expect(html).toContain("Not inferred from combined pricing");
    expect(html).toContain("Certified Welding Inspector");
    expect(html).toContain(resultsDisclaimer);
    expect(html).toContain("Send to Notion — Coming soon");
    expect(html).not.toMatch(/Apify|Puter/);
  });
});

describe("CSV reporting and PDF organization", () => {
  it("quotes commas, quotes and embedded newlines, protects formulas, and retains numeric negatives", () => {
    const csv = encodeCsv([{ name:'Example, "quoted"\nsecond line', formula:' \t=HYPERLINK("bad")', other:"@SUM(1)", negative:-3392, missing:null }]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Example, ""quoted""\nsecond line"');
    expect(csv).toContain('"\' \t=HYPERLINK(""bad"")"');
    expect(csv).toContain('"\'@SUM(1)"');
    expect(csv).toContain('"-3392"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });
  it("exports normalized classifications, source labels, missing values and distinct scenario results without mutating them", () => {
    const scan = scanFixture(); const inputs = assumptions();
    const before = JSON.stringify({scan,inputs});
    const csv = buildCurrentAcquisitionCsv(scan,inputs);
    expect(csv).toContain('"220000"'); expect(csv).toContain('"450000"');
    expect(csv).toContain('"172000"'); expect(csv).toContain('"174500"');
    expect(csv).toContain('"Cash Flow"'); expect(csv).toContain('"not_disclosed"');
    expect(csv).not.toContain('"299000"');
    expect(csv).not.toMatch(/apify|puter|actorId|maxCharge|apiToken/i);
    expect(JSON.stringify({scan,inputs})).toBe(before);
  });
  it("uses saved names/dates and the same consistent summary columns for every record", () => {
    const scan = scanFixture(); const state={ scan,form:formFromScan(scan),cashFlow:assumptions() };
    const record=makeRecord(state,'Welding, "review"');
    const restored=parseBackup(serializeBackup(record));
    const csv=buildSavedAcquisitionsCsv([restored,{...restored,id:"other",name:"=malicious"}]);
    expect(csv).toContain('"Welding, ""review"""');
    expect(csv).toContain('"\'=malicious"');
    expect(csv).toContain(record.createdAt);
    expect(csv).toContain("Preliminary recommendation (not approval)");
  });
  it("downloads a spreadsheet-compatible UTF-8 CSV blob without network requests", async () => {
    let blob:Blob|null=null; const click=vi.fn();
    vi.stubGlobal("document",{createElement:()=>({click})});
    vi.stubGlobal("URL",{createObjectURL:(value:Blob)=>{blob=value;return "blob:test";},revokeObjectURL:vi.fn()});
    vi.useFakeTimers();
    try { downloadCsv(buildCurrentAcquisitionCsv(scanFixture()),"test.csv"); expect(click).toHaveBeenCalledOnce(); expect(blob!.type).toContain("text/csv"); expect(await blob!.text()).toContain("220000"); vi.runAllTimers(); }
    finally {vi.useRealTimers();vi.unstubAllGlobals();}
  });
  it("orders the PDF, preserves original evidence once in the appendix and excludes technical billing metadata", () => {
    const scan=scanFixture();
    scan.retrieval={provider:"apify",actorId:"PRIVATE_ACTOR",retrievedAt:scan.createdAt,sourceUrl:fixture.listingUrl!,
      usageUsd:0.1234,maxChargeUsd:0.25,rawRecord:{token:"SECRET"},conflicts:["Apify source differs; verify"],photographs:[]};
    const lines=buildReportLines(scan,assumptions()); const text=lines.join("\n");
    const sections=["1. Executive Summary","2. Financial Snapshot","3. Business Profile","4. Financial Verification","5. Deal Clarity","6. Supporting Evidence Appendix"];
    const positions=sections.map(heading=>text.indexOf(heading));
    expect(positions.every((position,index)=>position>=0 && (index===0 || position>positions[index-1]))).toBe(true);
    expect(text).toContain("Combined asking price / advertised cash flow: 3.40x");
    expect(text).toContain("Business component price: Not Disclosed");
    expect(text).not.toMatch(/Apify|Puter|PRIVATE_ACTOR|SECRET|0\.1234|spending limit/);
    expect(text.indexOf(fixture.listingUrl!.slice(0,60))).toBeGreaterThan(positions[5]);
    expect(text.match(/Original listing text/g)).toHaveLength(1);
    expect(text.replace(/\n/g," ")).toContain("have not been independently verified");
  });
  it("keeps useful retrieval errors and explicit charge consent without displaying provider billing details", async () => {
    const confirm=vi.fn<(notice: string) => boolean>(()=>false);
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({enabled:true,maxChargeUsd:0.25})));
    expect(await retrieveListing(fixture.listingUrl!,{fetcher,confirm,progress:vi.fn()})).toBeNull();
    expect(confirm.mock.calls[0][0]).toMatch(/chargeable|billed/);
    expect(confirm.mock.calls[0][0]).not.toMatch(/Apify|0.25/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(retrievalFailure("Apify denied access. Actor permissions.")).toContain("denied access");
    expect(retrievalFailure("Apify results could not be read. Reported usage: $0.01.")).not.toMatch(/Apify|\$|usage/);
  });
});
