import type { DealScan } from "./types";
import type { AcquisitionRecord, AcquisitionState, RecoveryDraft } from "./acquisitionRecord";
import { createCashFlowAssumptions } from "./acquisitionCashFlow";
import { MAX_BACKUP_BYTES, parseJson, retainedState, validateDraft, validateRecord } from "./recordValidation";
import { resolvedStreetAddress } from "./listingAddress";

export const storageKey = "kingdomhaus-deal-scans:v1";
export const MAX_RECORDS = 100;
type Store = Pick<Storage, "getItem" | "setItem">;
type Library = { schemaVersion: 2; records: AcquisitionRecord[]; draft: RecoveryDraft | null };
export type LibraryLoad = Library & { notice: string | null };
const empty = (): Library => ({ schemaVersion: 2, records: [], draft: null });
const storageError = () => new Error("Browser storage is unavailable or full. Your open work is unchanged. Export a JSON backup before leaving.");

export function formFromScan(scan: DealScan) {
  const streetAddress = resolvedStreetAddress(scan).value;
  const fields = ["businessName", "askingPrice", "businessAskingPrice", "annualRevenue", "sde", "ebitda", "advertisedCashFlow", "inventory", "ffe", "realEstate"] as const;
  return { ...Object.fromEntries(fields.map(key => [key, scan.correctedFields[key] ?? ""])), ...Object.fromEntries(["businessWebsite", "streetAddress"].filter(key => Object.hasOwn(scan.correctedFields, key)).map(key => [key, scan.correctedFields[key]])), ...(streetAddress ? { streetAddress } : {}), listingUrl: scan.listingUrl ?? "", listingText: scan.listingText } as AcquisitionState["form"];
}
export function makeRecord(state: AcquisitionState, name?: string, previous?: AcquisitionRecord): AcquisitionRecord {
  const clean = retainedState(state);
  if (!clean.scan) throw new Error("Complete an analysis before saving.");
  const now = new Date().toISOString();
  return validateRecord({
    schemaVersion: 1, id: previous?.id ?? clean.scan.id,
    name: (name ?? previous?.name ?? clean.scan.businessDetails.listingTitle.value ?? clean.scan.overview.businessName.value ?? "Acquisition").trim().slice(0, 120),
    createdAt: previous?.createdAt ?? now, updatedAt: now, revision: (previous?.revision ?? 0) + 1,
    origin: previous?.origin ?? "local", state: clean
  });
}
function readLibrary(raw: string | null): LibraryLoad {
  if (raw === null) return { ...empty(), notice: null };
  const data = parseJson(raw, 4_000_000);
  if (Array.isArray(data)) {
    if (data.length > MAX_RECORDS) throw new Error("Legacy storage exceeds the record limit. It was not changed.");
    const records = data.map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw storageError();
      const old = item as DealScan;
      if (!old.financials || !old.ratios || !old.claritySummary) throw storageError();
      const unknownFact = () => ({ value: null, source: "not_disclosed" as const, excerpts: [] });
      const unknownMoney = () => ({ amount: null, raw: null, source: "not_disclosed" as const, excerpts: [] });
      const unknownAsset = () => ({ value: unknownMoney(), includedStatus: "unknown" as const, notes: unknownFact() });
      const legacyDetails = Object.fromEntries(["listingTitle", "source", "url", "adNumber", "fullDescription", "facilities", "competition", "growthOpportunities", "financing", "sellerSupportTraining", "reasonForSelling", "brokerInformation"].map(key => [key, unknownFact()]));
      // Older scans predate transaction-split and expanded clarity fields. Missing
      // information remains unknown; do not re-extract or reinterpret old evidence.
      const scan: DealScan = {
        ...old,
        businessDetails: old.businessDetails ?? Object.assign(legacyDetails, { fullDescription: old.overview.description, reasonForSelling: old.overview.reasonForSale, additionalDetails: [] }),
        financials: Object.assign({
          businessAskingPrice: unknownMoney(), inventory: unknownAsset(), ffe: unknownAsset(),
          realEstate: { ...unknownAsset(), ownership: unknownFact(), buildingSize: unknownFact() },
          knownAdditionalAcquisitionCosts: unknownMoney()
        }, old.financials, { advertisedCashFlow: Object.assign({ sellerTerminology: null }, old.financials.advertisedCashFlow) }),
        ratios: Object.assign({ businessAskingPriceToSde: null }, old.ratios),
        claritySummary: Object.assign({
          strategicFit: "Not available in the earlier saved record.", attractiveCharacteristics: "Not available in the earlier saved record.",
          sellerDependence: "Not available in the earlier saved record.", equipmentContinuity: "Not available in the earlier saved record.",
          financialQuestions: "Not available in the earlier saved record.", majorRisks: "Not available in the earlier saved record.",
        }, old.claritySummary)
      };
      const record = makeRecord({ scan, form: formFromScan(scan), cashFlow: createCashFlowAssumptions() });
      return { ...record, createdAt: scan.createdAt, updatedAt: scan.createdAt, origin: "legacy" as const };
    });
    if (new Set(records.map(r => r.id)).size !== records.length) throw new Error("Legacy storage has duplicate records. It was not changed.");
    return { schemaVersion: 2, records, draft: null, notice: "Earlier saved scans were recovered. Cash-flow assumptions were not available in that format." };
  }
  if (!data || typeof data !== "object" || Object.keys(data).some(k => !["schemaVersion", "records", "draft"].includes(k))) throw storageError();
  const value = data as Library;
  if (value.schemaVersion !== 2 || !Array.isArray(value.records) || value.records.length > MAX_RECORDS) throw new Error("Saved storage uses an unsupported format. It was not changed.");
  const records = value.records.map(validateRecord);
  if (new Set(records.map(r => r.id)).size !== records.length) throw new Error("Saved storage has duplicate records. It was not changed.");
  return { schemaVersion: 2, records, draft: value.draft === null ? null : validateDraft(value.draft), notice: null };
}

// Keep persistence behind an adapter for a future authenticated repository.
export class AcquisitionRepository {
  private raw: string | null | undefined;
  constructor(private getStore: () => Store = () => window.localStorage) {}
  exportStoredRecovery() {
    let raw: string | null;
    try { raw = this.getStore().getItem(storageKey); } catch { throw storageError(); }
    if (raw === null) throw new Error("There is no stored recovery data in this browser.");
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "kingdomhaus-stored-recovery.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  load(): LibraryLoad {
    let raw: string | null;
    try { raw = this.getStore().getItem(storageKey); } catch { throw storageError(); }
    const data = readLibrary(raw);
    this.raw = raw;
    return data;
  }
  private write(update: (data: LibraryLoad) => Library): LibraryLoad {
    let current: string | null;
    try { current = this.getStore().getItem(storageKey); } catch { throw storageError(); }
    if (this.raw === undefined) throw new Error("Saved storage could not be loaded. Export your open work before leaving.");
    if (current !== this.raw) throw new Error("Saved work changed in another tab. Export your open work, then reload before saving.");
    const next = update(readLibrary(current));
    if (next.records.length > MAX_RECORDS) throw new Error(`Saved scans are full (${MAX_RECORDS} records). Export and delete an older record first.`);
    const encoded = JSON.stringify(next);
    if (new TextEncoder().encode(encoded).byteLength > 4_000_000) throw storageError();
    readLibrary(encoded);
    try { this.getStore().setItem(storageKey, encoded); } catch { throw storageError(); }
    this.raw = encoded;
    return { ...next, notice: null };
  }
  save(record: AcquisitionRecord, expectedRevision: number | null, overwriteConfirmed = false): LibraryLoad {
    record = validateRecord(record); serializeBackup(record);
    return this.write(data => {
      const existing = data.records.find(r => r.id === record.id);
      if (existing && (!overwriteConfirmed || expectedRevision !== existing.revision)) throw new Error("Confirm replacement of the latest saved record before updating.");
      if (!existing && expectedRevision !== null) throw new Error("The saved record no longer exists. Reload before saving.");
      return { schemaVersion: 2, records: [record, ...data.records.filter(r => r.id !== record.id)], draft: data.draft };
    });
  }
  delete(id: string, expectedRevision: number, confirmed: boolean): LibraryLoad {
    return this.write(data => {
      const existing = data.records.find(r => r.id === id);
      if (!confirmed || !existing || existing.revision !== expectedRevision) throw new Error("Confirm deletion of the latest saved record.");
      return { schemaVersion: 2, records: data.records.filter(r => r.id !== id), draft: data.draft?.recordId === id ? null : data.draft };
    });
  }
  recover(draft: RecoveryDraft | null): LibraryLoad {
    const clean = draft ? { ...draft, state: retainedState(draft.state) } : null;
    if (clean) validateDraft(clean);
    return this.write(data => ({ schemaVersion: 2, records: data.records, draft: clean }));
  }
}

export function serializeBackup(record: AcquisitionRecord): string {
  const text = JSON.stringify({ format: "kingdomhaus-acquisition", schemaVersion: 1, exportedAt: new Date().toISOString(), record: validateRecord(record) }, null, 2);
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error("This acquisition exceeds the JSON backup size limit.");
  return text;
}
export function parseBackup(text: string): AcquisitionRecord {
  const value = parseJson(text) as Record<string, unknown>;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some(k => !["format", "schemaVersion", "exportedAt", "record"].includes(k)) ||
    value.format !== "kingdomhaus-acquisition" || value.schemaVersion !== 1 ||
    typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt))) {
    throw new Error("This is not a supported KingdomHaus acquisition backup. Nothing was replaced.");
  }
  return { ...validateRecord(value.record), origin: "imported" };
}
export function matchingRecord(records: AcquisitionRecord[], incoming: AcquisitionRecord): AcquisitionRecord | undefined {
  const key = (url: string | null) => {
    try { const parsed = new URL(url ?? ""); return parsed.protocol === "https:" ? parsed.origin.toLowerCase() + parsed.pathname.replace(/\/+$/, "") : null; } catch { return null; }
  };
  const url = key(incoming.state.scan.listingUrl);
  return records.find(r => r.id === incoming.id || r.state.scan.id === incoming.state.scan.id) ??
    (url ? records.find(r => key(r.state.scan.listingUrl) === url) : undefined);
}
export function downloadBackup(record: AcquisitionRecord) {
  const url = URL.createObjectURL(new Blob([serializeBackup(record)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = "kingdomhaus-acquisition-" + record.id + ".json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
