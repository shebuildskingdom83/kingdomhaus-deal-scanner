import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import painting from "./apify-painting.json";
import concrete from "./apify-concrete.json";
import welding from "./syntheticWeldingFixture.json";
import { buildLocalPreviewScan, normalizeAiScan, validateScanRequest } from "../src/validation";
import { attachRetrieval, reconcileApifyListing, APIFY_ACTOR_ID } from "../src/hybridListing";
import { AcquisitionRepository, formFromScan, makeRecord, parseBackup, serializeBackup, storageKey } from "../src/storage";
import { createCashFlowAssumptions } from "../src/acquisitionCashFlow";
import { ListingPhotographs } from "../src/ListingPhotographs";
import { preserveListingMedia } from "../src/listingMedia";
import { safeBusinessWebsite } from "../src/safeExternalUrl";
import { ResultsScreen } from "../src/App";
import { buildCurrentAcquisitionCsv } from "../src/csv";
import { buildReportLines } from "../src/pdf";

const website="https://example.com/synthetic-fabrication/";
function analysis(row:Record<string,unknown>) {
  const mapped=reconcileApifyListing(row,{listingUrl:String(row.url),listingText:""});
  return attachRetrieval(buildLocalPreviewScan(mapped.request),{provider:"apify",actorId:APIFY_ACTOR_ID,
    retrievedAt:"2026-10-19T12:00:00.000Z",sourceUrl:String(row.url),usageUsd:null,maxChargeUsd:0.25,
    rawRecord:row,conflicts:mapped.conflicts,photographs:mapped.photographs});
}
function state(scan=analysis(painting[0])) { return {scan,form:formFromScan(scan),cashFlow:createCashFlowAssumptions()}; }
function memory() { const data=new Map<string,string>(); return {data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}}; }

describe("photo retention and backward-compatible media recovery",()=>{
  it.each([painting[0],concrete[0]])("retains original photo references across save, refresh, open, update and backup roundtrip",row=>{
    const scan=analysis(row); const images=scan.retrieval!.photographs;
    expect(images.length).toBeGreaterThan(0);
    const store=memory(); const repo=new AcquisitionRepository(()=>store); repo.load();
    const first=makeRecord(state(scan)); repo.save(first,null);
    const restarted=new AcquisitionRepository(()=>store);
    const reopened=restarted.load().records[0];
    expect(reopened.state.scan.retrieval?.photographs).toEqual(images);
    expect(reopened.state.scan.retrieval?.rawRecord).toEqual({});
    const updated=makeRecord(reopened.state,reopened.name,reopened);
    restarted.save(updated,reopened.revision,true);
    expect(parseBackup(serializeBackup(updated)).state.scan.retrieval?.photographs).toEqual(images);
    expect(reopened.state.scan.financials).toEqual(scan.financials);
  });
  it("recovers valid references from older raw metadata without re-extracting finances or retaining raw personal fields",()=>{
    const scan=analysis(painting[0]); const record=makeRecord(state(scan));
    record.state.scan.retrieval!.photographs=[];
    record.state.scan.retrieval!.rawRecord={...painting[0],privateContact:"not retained"};
    const incoming=parseBackup(JSON.stringify({format:"kingdomhaus-acquisition",schemaVersion:1,exportedAt:record.updatedAt,record}));
    expect(incoming.state.scan.retrieval!.photographs.map(photo=>({url:photo.url,sourceUrl:photo.sourceUrl}))).toEqual(scan.retrieval!.photographs.map(photo=>({url:photo.url,sourceUrl:photo.sourceUrl})));
    expect(incoming.state.scan.financials).toEqual(record.state.scan.financials);
    expect(incoming.state.scan.retrieval!.rawRecord).toEqual({});
    expect(serializeBackup(incoming)).not.toContain("privateContact");
  });
  it("does not borrow raw photo references from a different listing",()=>{
    const record=makeRecord(state());
    record.state.scan.retrieval!.photographs=[];
    record.state.scan.retrieval!.rawRecord=concrete[0];
    expect(parseBackup(serializeBackup(record)).state.scan.retrieval!.photographs).toEqual([]);
  });
  it("preserves images and custom credit during same-listing corrections, not when switching businesses",()=>{
    const before=analysis(painting[0]);
    before.retrieval!.photographs[0].creditRequired=true;
    before.retrieval!.photographs[0].attribution="Required photographer credit";
    const after=preserveListingMedia(buildLocalPreviewScan({listingText:before.listingText,listingUrl:before.listingUrl!,corrections:{sde:"$70,000"}}),before);
    expect(after.financials.sde.amount).toBe(70000);
    expect(after.retrieval!.photographs[0].attribution).toBe("Required photographer credit");
    expect(after.retrieval!.photographs[0].creditRequired).toBe(true);
    expect(preserveListingMedia(buildLocalPreviewScan(welding),before).retrieval).toBeUndefined();
  });
  it("rejects unsafe imported image references without changing existing storage",()=>{
    const store=memory(); const repo=new AcquisitionRepository(()=>store);repo.load();
    const record=makeRecord(state());repo.save(record,null);const before=store.data.get(storageKey);
    for(const url of ["javascript:alert(1)","https://attacker.example/photo.jpg",painting[0].imageUrl+"?token=secret"]){
      const bad=structuredClone(record);bad.state.scan.retrieval!.photographs[0].url=url;
      expect(()=>parseBackup(JSON.stringify({format:"kingdomhaus-acquisition",schemaVersion:1,exportedAt:bad.updatedAt,record:bad}))).toThrow();
    }
    expect(store.data.get(storageKey)).toBe(before);
  });
  it("hides generic source captions, retains required credit and exposes horizontal controls",()=>{
    const first=analysis(painting[0]).retrieval!.photographs[0];
    const second=analysis(concrete[0]).retrieval!.photographs[0];
    const html=renderToStaticMarkup(<ListingPhotographs photographs={[first,second]}/>);
    expect(html).toContain("Next listing photographs");
    expect(html).toContain("Previous listing photographs");
    expect(html).not.toContain("<figcaption>");
    expect(renderToStaticMarkup(<ListingPhotographs photographs={[{...first,attribution:"Required credit",creditRequired:true}]}/>)).toContain("Required credit");
  });
});

describe("business website and synchronized financial exports",()=>{
  it.each(["javascript:alert(1)","data:text/html,bad","http://example.com","https://localhost./","https://127.0.0.1/","https://user:password@example.com/","https://example.com/?token=private"])("rejects unsafe website %s",url=>{
    expect(safeBusinessWebsite(url)).toBeNull();
    expect(validateScanRequest({...welding,corrections:{businessWebsite:url}}).ok).toBe(false);
  });
  it("accepts older records without the optional website and preserves a supplied website through updates and recovery",()=>{
    const old=makeRecord(state(buildLocalPreviewScan(welding)));
    delete old.state.scan.businessDetails.businessWebsite;
    expect(parseBackup(serializeBackup(old)).state.scan.businessDetails.businessWebsite).toBeUndefined();
    const scan=buildLocalPreviewScan({...welding,corrections:{businessWebsite:website}});
    const record=makeRecord(state(scan));
    const restored=parseBackup(serializeBackup(record));
    expect(restored.state.scan.businessDetails.businessWebsite).toMatchObject({value:website,source:"user_correction"});
    expect(restored.state.form.businessWebsite).toBe(website);
    expect(buildCurrentAcquisitionCsv(restored.state.scan)).toContain(website);
    expect(buildReportLines(restored.state.scan).join("\n")).toContain(website);
  });
  it("extracts only an explicitly supplied website, permits clearing, and rejects AI-invented websites",()=>{
    expect(buildLocalPreviewScan(welding).businessDetails.businessWebsite?.value).toBeNull();
    const listingText=welding.listingText+"\nBusiness Website: "+website;
    expect(buildLocalPreviewScan({...welding,listingText}).businessDetails.businessWebsite?.value).toBe(website);
    expect(buildLocalPreviewScan({...welding,listingText,corrections:{businessWebsite:""}}).businessDetails.businessWebsite?.value).toBeNull();
    expect(normalizeAiScan({businessDetails:{businessWebsite:{value:"https://invented.example.com/"}}},welding,"mock").businessDetails.businessWebsite?.value).toBeNull();
  });
  it("renders safe Visit Website separately from the listing URL and retains corrected inclusion across all export snapshots",()=>{
    const scan=buildLocalPreviewScan({...welding,corrections:{businessWebsite:website}});
    const record=parseBackup(serializeBackup(makeRecord(state(scan))));
    const restored=record.state.scan;
    const html=renderToStaticMarkup(<ResultsScreen scan={restored} form={record.state.form} message={null} errors={[]} isLoading={false} isFetchingUrl={false}
      onBack={()=>{}} onDownload={()=>{}} onFieldChange={()=>{}} onRefresh={()=>{}} onScanFromUrl={()=>{}}/>);
    expect(html).toContain('href="'+website+'" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("Visit Website");
    expect(restored.financials.realEstate.includedStatus).toBe("included");
    expect(restored.financials.ffe.includedStatus).toBe("included");
    expect(restored.financials.inventory.includedStatus).toBe("unknown");
    expect(restored.financials.askingPrice.amount).toBe(749000);
    expect(restored.financials.advertisedCashFlow.amount).toBe(220000);
    expect(restored.financials.sde.amount).toBeNull();
    const lines=buildReportLines(restored).join("\n");
    expect(lines).toContain("Real estate: $450,000 (included)");
    expect(lines).toContain("FF&E: $80,000 (included)");
    expect(lines).toContain("Inventory: $5,000 (unknown)");
    expect(buildCurrentAcquisitionCsv(restored)).toContain('"included"');
    expect(restored.listingUrl).toBe(welding.listingUrl);
  });
});
