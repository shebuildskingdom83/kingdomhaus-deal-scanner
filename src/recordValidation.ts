import type { AcquisitionRecord, AcquisitionState, KhdaAnalysis, RecoveryDraft } from "./acquisitionRecord";
import type { DealScan } from "./types";
import { createCashFlowAssumptions } from "./acquisitionCashFlow";
import { approvedBizBuySellUrl, safeListingImage } from "./hybridListing";
import { safeBusinessWebsite } from "./safeExternalUrl";
import { retainedPhotographs } from "./listingMedia";
import { hydrateStreetAddress } from "./listingAddress";
import { approvedWebsiteProjectPhoto, websiteProjectsBelongToScan } from "./websiteProjectMedia";
import type { WebsiteProjectPhotograph } from "./types";

export const MAX_BACKUP_BYTES = 2_000_000;
type Rule = (value: unknown) => void;
const fail = (): never => { throw new Error("This acquisition file is malformed or uses an unsupported schema. Nothing was replaced."); };
const text: Rule = value => { if (typeof value !== "string" || value.length > 120_000) fail(); };
const short: Rule = value => { text(value); if ((value as string).length > 4000) fail(); };
const number: Rule = value => { if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e12) fail(); };
const boolean: Rule = value => { if (typeof value !== "boolean") fail(); };
const nullable = (rule: Rule): Rule => value => { if (value !== null) rule(value); };
const optional = (rule: Rule): Rule => value => { if (value !== undefined) rule(value); };
const choice = (...values: unknown[]): Rule => value => { if (!values.includes(value)) fail(); };
const list = (rule: Rule, max = 1000): Rule => value => {
  if (!Array.isArray(value) || value.length > max) fail();
  (value as unknown[]).forEach(rule);
};
const strings = list(text);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
const shape = (rules: Record<string, Rule>): Rule => value => {
  const item = object(value);
  if (Object.keys(item).some(key => !Object.hasOwn(rules, key))) fail();
  for (const [key, rule] of Object.entries(rules)) {
    try { rule(item[key]); }
    catch (error) { throw new Error("Invalid acquisition field: " + key + ". " + (error instanceof Error ? error.message : "Unsupported value.")); }
  }
};
const id: Rule = value => { if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) fail(); };
const date: Rule = value => { if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) fail(); };
const revision: Rule = value => { number(value); if (!Number.isSafeInteger(value) || (value as number) < 1) fail(); };
const name: Rule = value => { short(value); if (!(value as string).trim() || (value as string).length > 120) fail(); };
const factSources = ["seller_claim", "user_correction", "ai_inference", "url_extract", "rule_based", "not_disclosed"];
const money = shape({ amount: nullable(number), raw: nullable(text), source: choice(...factSources.filter(s => s !== "ai_inference"), "calculated"), excerpts: strings });
const fact = shape({ value: nullable(text), source: choice(...factSources), excerpts: strings });
const websiteFact: Rule = value => { fact(value); const url = object(value).value; if (url !== null && !safeBusinessWebsite(url)) fail(); };
const photograph = shape({
  url: value => { short(value); if (!safeListingImage(value)) fail(); },
  sourceUrl: value => { short(value); if (!safeBusinessWebsite(value)) fail(); approvedBizBuySellUrl(value as string); },
  attribution: short, creditRequired: optional(boolean), alt: optional(short), caption: optional(short)
});
const assetRules = { value: money, includedStatus: choice("included", "not_included", "unknown"), notes: fact };
const websiteProjectPhotoShape = shape({ url: short, sourceUrl: short, sourceType: choice("seller_website"), attribution: short, alt: optional(short), caption: optional(short) });
const websiteProjectPhoto: Rule = value => {
  websiteProjectPhotoShape(value);
  if (!approvedWebsiteProjectPhoto(value as WebsiteProjectPhotograph)) fail();
};
const textFields = (keys: string[]) => Object.fromEntries(keys.map(key => [key, fact]));
const correctionMap: Rule = value => { const map = object(value); if (Object.keys(map).length > 100) fail(); Object.values(map).forEach(short); };
const scanRule = shape({
  websiteProjectPhotographs: optional(list(websiteProjectPhoto, 10)),
  id, createdAt: date, listingUrl: nullable(short), listingText: text, correctedFields: correctionMap,
  businessDetails: shape({
    streetAddress: optional(fact),
    businessWebsite: optional(websiteFact),
    ...textFields(["listingTitle", "source", "url", "adNumber", "fullDescription", "facilities", "competition", "growthOpportunities", "financing", "sellerSupportTraining", "reasonForSelling", "brokerInformation"]),
    additionalDetails: list(shape({ label: short, value: text, excerpts: strings }))
  }),
  overview: shape({
    ...textFields(["businessName", "industry", "location", "yearEstablished", "yearsOperating", "description", "services", "employeeCount", "ownerInvolvement", "reasonForSale", "revenueModel", "includedAssets"]),
    customerSegments: optional(fact)
  }),
  financials: shape({
    ...Object.fromEntries(["askingPrice", "businessAskingPrice", "annualRevenue", "sde", "ebitda", "knownAdditionalAcquisitionCosts"].map(k => [k, money])),
    advertisedCashFlow: shape({ amount: nullable(number), raw: nullable(text), source: choice(...factSources.filter(s => s !== "ai_inference"), "calculated"), excerpts: strings, sellerTerminology: nullable(text) }),
    inventory: shape(assetRules), ffe: shape(assetRules),
    realEstate: shape({ ...assetRules, ownership: fact, buildingSize: fact }),
    equipmentReplacementNeeds: fact, immediateCapitalNeeds: fact
  }),
  ratios: shape(Object.fromEntries(["askingPriceToSde", "businessAskingPriceToSde", "askingPriceToEbitda", "sdeToRevenue"].map(k => [k, nullable(number)]))),
  claritySummary: shape(Object.fromEntries(["strategicFit", "attractiveCharacteristics", "sellerDependence", "equipmentContinuity", "financialQuestions", "majorRisks", "buying", "attractive", "kingdomHausFit", "threats", "unansweredQuestions", "verifyBeforeProceeding"].map(k => [k, text]))),
  riskChecks: list(shape({ label: short, status: choice("clear", "watch", "unknown"), explanation: text, excerpts: strings, requiresVerification: optional(boolean), verificationItems: optional(strings) })),
  missingInformation: strings, sellerClaims: strings, aiInferences: strings, calculations: strings,
  decision: shape({ recommendation: choice("Keep Reading", "Investigate", "Pass"), explanation: text }),
  analysisMode: choice("ai", "rule_based", "local_preview"), model: nullable(short),
  retrieval: optional(shape({
    provider: choice("apify"), actorId: short, retrievedAt: date, sourceUrl: short, usageUsd: nullable(number),
    maxChargeUsd: number, rawRecord: shape({}), conflicts: strings, photographs: list(photograph, 20)
  }))
});
const formRule = shape({
  streetAddress: optional(short),
  businessWebsite: optional(short),
  ...Object.fromEntries(["businessName", "listingUrl", "askingPrice", "businessAskingPrice", "annualRevenue", "sde", "ebitda", "advertisedCashFlow", "inventory", "ffe", "realEstate"].map(k => [k, short])),
  listingText: text
});
const cashRule = shape({
  ...Object.fromEntries(Object.keys(createCashFlowAssumptions()).filter(k => !["startingMetric", "startingAmount", "currentReviewed", "improvementsReviewed", "savingsBasis"].includes(k)).map(k => [k, short])),
  startingMetric: choice(null, "sde", "ebitda", "advertisedCashFlow", "custom"),
  startingAmount: nullable(short), currentReviewed: boolean, improvementsReviewed: boolean, savingsBasis: choice("proposed", "verified")
});
const founderDecisionRule = shape({
  decision: choice(null, "Continue Reviewing", "Pursue", "Hold", "Pass"),
  rationale: short,
  nextDiligenceAction: short
});
const khdaSummaryText: Rule = value => { short(value); if (!(value as string).trim() || (value as string).length > 2000) fail(); };
const khdaAnalysisRule = shape({
  summary: shape(Object.fromEntries(["strategicFit", "attractiveCharacteristics", "sellerDependence", "equipmentContinuity", "financialQuestions", "majorRisks"].map(key => [key, khdaSummaryText]))),
  completedAt: date,
  model: value => { short(value); if (!(value as string).trim() || (value as string).length > 120) fail(); },
  sourceScanId: id
});
export function validKhdaAnalysis(value: unknown): value is KhdaAnalysis {
  try { khdaAnalysisRule(value); return true; } catch { return false; }
}
const stateRule = shape({ scan: nullable(scanRule), form: formRule, cashFlow: cashRule, founderDecision: optional(founderDecisionRule), khdaAnalysis: optional(khdaAnalysisRule) });
const recordRule = shape({
  schemaVersion: choice(1), id, name, createdAt: date, updatedAt: date, revision,
  origin: choice("local", "imported", "legacy"), state: stateRule
});
const draftRule = shape({ recordId: nullable(id), recordRevision: nullable(revision), state: stateRule });

// Unknown keys are rejected, rather than merged into runtime objects or configuration.
export function parseJson(text: string, limit = MAX_BACKUP_BYTES): unknown {
  if (new TextEncoder().encode(text).byteLength > limit) throw new Error("This acquisition file is too large. Nothing was replaced.");
  try {
    return JSON.parse(text, (key, value) => {
      if (["__proto__", "prototype", "constructor"].includes(key)) fail();
      return value;
    });
  } catch { return fail(); }
}
export function validateState(value: unknown): AcquisitionState {
  stateRule(value);
  const state = value as AcquisitionState;
  if (state.scan?.websiteProjectPhotographs?.length && !websiteProjectsBelongToScan(state.scan)) fail();
  if (!state.scan) return state;
  const scan = hydrateStreetAddress(state.scan);
  return scan === state.scan ? state : { ...state, scan };
}
export function validateRecord(value: unknown): AcquisitionRecord {
  value = recoverLegacyMedia(value);
  recordRule(value);
  const record = value as AcquisitionRecord;
  const state = validateState(record.state);
  if (!record.state.scan || Date.parse(record.updatedAt) < Date.parse(record.createdAt)) fail();
  return state === record.state ? record : { ...record, state: state as AcquisitionRecord["state"] };
}
export function validateDraft(value: unknown): RecoveryDraft {
  value = recoverLegacyMedia(value);
  draftRule(value);
  const draft = value as RecoveryDraft;
  const state = validateState(draft.state);
  if ((draft.recordId === null) !== (draft.recordRevision === null)) fail();
  return state === draft.state ? draft : { ...draft, state };
}
export function retainedScan(scan: DealScan): DealScan {
  return { ...hydrateStreetAddress(scan), ...(scan.retrieval ? { retrieval: { ...scan.retrieval, rawRecord: {}, photographs: retainedPhotographs(scan) } } : {}) };
}

// Recover legacy photo references without re-extracting financial or correction data.
function recoverLegacyMedia(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as { state?: AcquisitionState };
  const scan = record.state?.scan;
  if (!scan?.retrieval) return value;
  const retrieval = scan.retrieval;
  if (!retrieval.rawRecord || typeof retrieval.rawRecord !== "object" || Array.isArray(retrieval.rawRecord) ||
    !Array.isArray(retrieval.photographs)) return value;
  list(photograph, 20)(retrieval.photographs);
  return { ...record, state: { ...record.state, scan: retainedScan(scan) } };
}
export function retainedState(state: AcquisitionState): AcquisitionState {
  const clean = { ...state, scan: state.scan ? retainedScan(state.scan) : null };
  return validateState(parseJson(JSON.stringify(clean)));
}
