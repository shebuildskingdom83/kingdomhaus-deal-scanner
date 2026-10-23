import type { AcquisitionRecord, RecoveryDraft } from "./acquisitionRecord";
import { migrationDraft, migrationListingIdentity, migrationRecord, sameMigrationContent } from "./cloudMigration";
import { MAX_CLOUD_PAYLOAD_BYTES } from "./cloudPersistence";
import { parseJson, validateDraft, validateRecord } from "./recordValidation";
import { createCashFlowAssumptions, currentCashFlowFields, improvementCashFlowFields } from "./acquisitionCashFlow";

export const PREFLIGHT_STORAGE_KEY = "kingdomhaus-deal-scans:v1";
type Status = "Compatible" | "Blocked";
type Inspection = {
  status: Status; bytes: number; blockers: string[];
  counts: Record<string, number>;
};
export type PreflightReport = {
  status: Status; recordCount: number; cloudPayloadLimitBytes: number;
  records: Array<Inspection & { name: string }>;
  draft: Inspection & { present: boolean | null };
  blockers: string[]; cloudConflictStatus: "Not checked: no cloud access";
  storageUnchanged: boolean;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown) => Array.isArray(value) ? value.length : 0;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const safeName = (value: unknown) => typeof value === "string" && value.trim() && value.length <= 120 ? value : "Unnamed acquisition";

function inspect(value: unknown, draft: boolean): Inspection {
  const result: Inspection = { status: "Blocked", bytes: bytes(value), blockers: [], counts: {} };
  if (result.bytes > MAX_CLOUD_PAYLOAD_BYTES) result.blockers.push("Record exceeds the supported cloud payload limit; no truncation is permitted.");
  try {
    const validated = draft ? validateDraft(structuredClone(value)) : validateRecord(structuredClone(value));
    if (!sameMigrationContent(value, validated)) result.blockers.push("Validation would normalize, hydrate, or remove data. Separate review is required.");
    if (!result.blockers.length) {
      if (draft) migrationDraft(value as RecoveryDraft); else migrationRecord(value as AcquisitionRecord);
    }
    const { scan, cashFlow } = validated.state;
    const money = scan ? [scan.financials.askingPrice, scan.financials.businessAskingPrice, scan.financials.annualRevenue,
      scan.financials.sde, scan.financials.ebitda, scan.financials.advertisedCashFlow,
      scan.financials.inventory.value, scan.financials.ffe.value, scan.financials.realEstate.value] : [];
    const originalScan = object(object(object(value).state).scan);
    const projections = ["financials", "correctedFields", "businessDetails", "overview", "retrieval", "websiteProjectPhotographs", "riskChecks", "claritySummary"];
    if (scan && projections.some(key => !sameMigrationContent(originalScan[key], object(scan)[key]))) {
      result.blockers.push("Financial, source, media, or diligence content would change during validation.");
    }
    const currentKeys = [...currentCashFlowFields.map(field => field.key), "startingMetric", "startingAmount", "normalizationNotes", "currentReviewed"];
    const improvementKeys = [...improvementCashFlowFields.map(field => field.key), "implementationCosts", "improvementsReviewed", "savingsBasis"];
    const originalCash = object(object(object(value).state).cashFlow);
    if (Object.keys(createCashFlowAssumptions()).some(key => !Object.hasOwn(originalCash, key)) || !sameMigrationContent(originalCash, cashFlow)) {
      result.blockers.push("Cash-flow scenario structure is incomplete or would change during validation.");
    }
    result.counts = {
      financialFields: money.length, financialFieldsDisclosed: money.filter(field => field.amount !== null).length,
      financialEvidenceExcerpts: money.reduce((total, field) => total + field.excerpts.length, 0),
      corrections: scan ? Object.keys(scan.correctedFields).length : 0,
      listingReferences: scan ? [scan.listingUrl, scan.businessDetails.url.value, scan.retrieval?.sourceUrl].filter(Boolean).length : 0,
      businessWebsites: scan?.businessDetails.businessWebsite?.value ? 1 : 0,
      listingPhotographs: count(scan?.retrieval?.photographs), websiteProjectPhotographs: count(scan?.websiteProjectPhotographs),
      descriptionFields: scan ? [scan.listingText, scan.businessDetails.fullDescription.value, scan.overview.description.value].filter(Boolean).length : 0,
      diligenceFindings: count(scan?.riskChecks),
      currentOperationsFieldsPresent: currentKeys.filter(key => Object.hasOwn(originalCash, key)).length,
      currentOperationsFieldsExpected: currentKeys.length,
      improvementsFieldsPresent: improvementKeys.filter(key => Object.hasOwn(originalCash, key)).length,
      improvementsFieldsExpected: improvementKeys.length,
      currentOperationsInputsEntered: currentCashFlowFields.filter(field => cashFlow[field.key].trim() !== "").length,
      improvementsInputsEntered: [...improvementCashFlowFields.map(field => field.key), "implementationCosts" as const].filter(key => cashFlow[key].trim() !== "").length
    };
  } catch {
    // Validator errors can contain source-derived field names; never include them in reports.
    result.blockers.push("Schema, identity, revision, source protection, or migration validation failed. Separate review is required.");
  }
  result.status = result.blockers.length ? "Blocked" : "Compatible";
  return result;
}

export function inspectAcquisitionStorage(raw: string | null): PreflightReport {
  const report: PreflightReport = { status: "Blocked", recordCount: 0, cloudPayloadLimitBytes: MAX_CLOUD_PAYLOAD_BYTES,
    records: [], draft: { present: null, status: "Blocked", bytes: 0, counts: {}, blockers: [] }, blockers: [],
    cloudConflictStatus: "Not checked: no cloud access", storageUnchanged: true };
  try {
    if (raw === null) throw new Error();
    const library = object(parseJson(raw, 4_000_000));
    if (library.schemaVersion !== 2 || !Array.isArray(library.records) || library.records.length > 100 ||
      !Object.hasOwn(library, "draft") || Object.keys(library).some(key => !["schemaVersion", "records", "draft"].includes(key))) throw new Error();
    report.recordCount = library.records.length;
    if (report.recordCount !== 4) report.blockers.push("Expected exactly four acquisitions. Review the selection before any migration.");
    const ids = new Map<string, number>(), identities = new Map<string, number>();
    for (const input of library.records) {
      const row = { ...inspect(input, false), name: safeName(object(input).name) };
      const id = object(input).id;
      const identity = migrationListingIdentity(input as AcquisitionRecord);
      if (typeof id === "string") ids.set(id, (ids.get(id) ?? 0) + 1);
      if (identity) identities.set(identity, (identities.get(identity) ?? 0) + 1);
      else row.blockers.push("No canonical HTTPS listing identity is available for source-key conflict checking.");
      report.records.push(row);
    }
    library.records.forEach((input, index) => {
      const row = report.records[index], id = object(input).id;
      const identity = migrationListingIdentity(input as AcquisitionRecord);
      if (typeof id === "string" && ids.get(id)! > 1) row.blockers.push("Duplicate acquisition ID in local selection.");
      if (identity && identities.get(identity)! > 1) row.blockers.push("Duplicate canonical source key in local selection.");
      row.status = row.blockers.length ? "Blocked" : "Compatible";
    });
    if (library.draft === null) report.draft = { present: false, status: "Compatible", bytes: 0, counts: {}, blockers: [] };
    else {
      report.draft = { ...inspect(library.draft, true), present: true };
      const draft = object(library.draft);
      if (draft.recordId !== null && !library.records.some(record => object(record).id === draft.recordId && object(record).revision === draft.recordRevision)) {
        report.draft.blockers.push("Recovery draft refers to an absent acquisition or a different historical revision.");
        report.draft.status = "Blocked";
      }
    }
    report.status = report.blockers.length || report.records.some(row => row.status === "Blocked") || report.draft.status === "Blocked" ? "Blocked" : "Compatible";
  } catch { report.blockers.push("Saved library is missing, malformed, legacy, or unsupported. Nothing was changed."); }
  return report;
}

// Only this exact acquisition key may be read. No repository/UI hydration or write API is used.
export function readAcquisitionPreflight(store: Pick<Storage, "getItem">): PreflightReport {
  try {
    const before = store.getItem(PREFLIGHT_STORAGE_KEY);
    const report = inspectAcquisitionStorage(before);
    if (store.getItem(PREFLIGHT_STORAGE_KEY) !== before) {
      report.storageUnchanged = false; report.status = "Blocked";
      report.blockers.push("Storage changed during inspection. Discard this result and repeat after editing stops.");
    }
    return report;
  } catch { return { ...inspectAcquisitionStorage(null), blockers: ["Browser storage could not be read. Nothing was changed."] }; }
}
