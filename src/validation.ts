import { calculateRatios, parseMoney } from "./financial";
import { extractListingDetails } from "./listingExtraction";
import { safeBusinessWebsite } from "./safeExternalUrl";
import type {
  AssetDetail,
  BusinessDetails,
  BusinessOverview,
  ClaritySummary,
  DealScan,
  FinancialSnapshot,
  InclusionStatus,
  MoneyField,
  PreliminaryDecision,
  RealEstateDetail,
  RiskCheck,
  ScanRequest,
  TextFact
} from "./types";
import { riskLabels } from "./types";

const maxListingLength = 50_000;

const emptyTextFact = (): TextFact => ({
  value: null,
  source: "not_disclosed",
  excerpts: []
});

const emptyMoneyField = (): MoneyField => ({
  amount: null,
  raw: null,
  source: "not_disclosed",
  excerpts: []
});

const emptyAssetDetail = (): AssetDetail => ({
  value: emptyMoneyField(),
  includedStatus: "unknown",
  notes: emptyTextFact()
});

const emptyRealEstateDetail = (): RealEstateDetail => ({
  ...emptyAssetDetail(),
  ownership: emptyTextFact(),
  buildingSize: emptyTextFact()
});

export function validateScanRequest(input: unknown): { ok: true; value: ScanRequest } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["Request body is required."] };
  }

  const candidate = input as Record<string, unknown>;
  const listingText = typeof candidate.listingText === "string" ? candidate.listingText.trim() : "";
  if (listingText.length < 30) {
    errors.push("Paste at least 30 characters from the business listing.");
  }
  if (listingText.length > maxListingLength) {
    errors.push(`Listing text must be ${maxListingLength.toLocaleString()} characters or less.`);
  }

  const businessName = typeof candidate.businessName === "string" ? candidate.businessName.trim().slice(0, 160) : undefined;
  const listingUrl = typeof candidate.listingUrl === "string" ? candidate.listingUrl.trim().slice(0, 500) : undefined;
  const corrections =
    candidate.corrections && typeof candidate.corrections === "object" && !Array.isArray(candidate.corrections)
      ? Object.fromEntries(
          Object.entries(candidate.corrections as Record<string, unknown>)
            .filter((entry): entry is [string, string] => entry[0].length <= 80 && typeof entry[1] === "string")
            .map(([key, value]) => [key, value.trim().slice(0, 500)])
        )
      : undefined;

  if (corrections?.businessWebsite && !safeBusinessWebsite(corrections.businessWebsite)) {
    errors.push("Enter a public HTTPS Business Website URL.");
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      businessName,
      listingUrl,
      listingText,
      corrections,
      retrievalId: typeof candidate.retrievalId === "string" && /^[a-f0-9-]{36}$/i.test(candidate.retrievalId) ? candidate.retrievalId : undefined
    }
  };
}

export function normalizeAiScan(payload: unknown, request: ScanRequest, model: string | null): DealScan {
  const source = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const extracted = extractListingDetails(request);
  const overview = mergeOverview(normalizeOverview(source.overview), extracted.overview);
  const financials = normalizeSellerLabeledSde(mergeFinancials(normalizeFinancials(source.financials), extracted.financials));
  const ratios = calculateRatios({
    askingPrice: financials.askingPrice.amount,
    businessAskingPrice: financials.businessAskingPrice.amount,
    annualRevenue: financials.annualRevenue.amount,
    sde: financials.sde.amount,
    ebitda: financials.ebitda.amount
  });

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    listingUrl: request.listingUrl || null,
    listingText: request.listingText,
    correctedFields: request.corrections ?? {},
    businessDetails: normalizeBusinessDetails(source.businessDetails, extracted.businessDetails),
    overview,
    financials,
    ratios,
    claritySummary: normalizeClaritySummary(source.claritySummary),
    riskChecks: [
      ...normalizeRiskChecks(source.riskChecks).map((item) => item.label === "Owner dependence" && extracted.overview.ownerInvolvement.value
        ? extracted.riskChecks.find((risk) => risk.label === item.label)! : item),
      ...extracted.riskChecks.filter((item) => item.requiresVerification)
    ],
    missingInformation: [...new Set([
      ...normalizeStringList(source.missingInformation),
      ...extracted.missingInformation.filter((item) => item.startsWith("Requires Verification:"))
    ])],
    sellerClaims: normalizeStringList(source.sellerClaims),
    aiInferences: normalizeStringList(source.aiInferences),
    calculations: [
      "Asking price / SDE, asking price / EBITDA, and SDE / revenue were calculated by application code from disclosed values.",
      ...normalizeStringList(source.calculations)
    ],
    decision: normalizeDecision(source.decision),
    analysisMode: "ai",
    model
  };
}

export function buildLocalPreviewScan(request: ScanRequest): DealScan {
  const extracted = extractListingDetails(request);
  const financials = normalizeSellerLabeledSde(extracted.financials);

  const ratios = calculateRatios({
    askingPrice: financials.askingPrice.amount,
    businessAskingPrice: financials.businessAskingPrice.amount,
    annualRevenue: financials.annualRevenue.amount,
    sde: financials.sde.amount,
    ebitda: financials.ebitda.amount
  });

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    listingUrl: request.listingUrl || null,
    listingText: request.listingText,
    correctedFields: request.corrections ?? {},
    businessDetails: extracted.businessDetails,
    overview: extracted.overview,
    financials,
    ratios,
    claritySummary: extracted.claritySummary,
    riskChecks: extracted.riskChecks,
    missingInformation: extracted.missingInformation,
    sellerClaims: extracted.sellerClaims,
    aiInferences: [],
    calculations: extracted.calculations,
    decision: extracted.decision,
    analysisMode: "rule_based",
    model: null
  };
}

function mergeOverview(primary: BusinessOverview, fallback: BusinessOverview): BusinessOverview {
  const listingFacts = new Set(["industry", "services", "employeeCount", "ownerInvolvement", "revenueModel", "customerSegments"]);
  return Object.fromEntries(
    Object.entries(primary).map(([key, value]) => [key,
      listingFacts.has(key) ? fallback[key as keyof BusinessOverview] : value.value ? value : fallback[key as keyof BusinessOverview]])
  ) as BusinessOverview;
}

function mergeFinancials(primary: FinancialSnapshot, fallback: FinancialSnapshot): FinancialSnapshot {
  return {
    askingPrice: primary.askingPrice.amount ? primary.askingPrice : fallback.askingPrice,
    businessAskingPrice: primary.businessAskingPrice.amount ? primary.businessAskingPrice : fallback.businessAskingPrice,
    annualRevenue: primary.annualRevenue.amount ? primary.annualRevenue : fallback.annualRevenue,
    sde: primary.sde.amount ? primary.sde : fallback.sde,
    ebitda: primary.ebitda.amount ? primary.ebitda : fallback.ebitda,
    advertisedCashFlow: primary.advertisedCashFlow.amount ? primary.advertisedCashFlow : fallback.advertisedCashFlow,
    inventory: primary.inventory.value.amount || primary.inventory.includedStatus !== "unknown" ? primary.inventory : fallback.inventory,
    ffe: primary.ffe.value.amount || primary.ffe.includedStatus !== "unknown" ? primary.ffe : fallback.ffe,
    realEstate:
      primary.realEstate.value.amount || primary.realEstate.includedStatus !== "unknown" ? primary.realEstate : fallback.realEstate,
    knownAdditionalAcquisitionCosts: primary.knownAdditionalAcquisitionCosts.amount
      ? primary.knownAdditionalAcquisitionCosts
      : fallback.knownAdditionalAcquisitionCosts,
    equipmentReplacementNeeds: primary.equipmentReplacementNeeds.value
      ? primary.equipmentReplacementNeeds
      : fallback.equipmentReplacementNeeds,
    immediateCapitalNeeds: primary.immediateCapitalNeeds.value ? primary.immediateCapitalNeeds : fallback.immediateCapitalNeeds
  };
}

function normalizeSellerLabeledSde(financials: FinancialSnapshot): FinancialSnapshot {
  const advertised = financials.advertisedCashFlow;
  const explicitlyLabeledSde = /^(?:Cash\s+Flow\s*\(\s*SDE\s*\)|SDE)$/i.test(advertised.sellerTerminology?.trim() ?? "") ||
    /^\s*(?:Cash\s+Flow\s*\(\s*SDE\s*\)|SDE)\s*:?\s*\$/i.test(advertised.raw ?? "");

  if (financials.sde.amount !== null || advertised.amount === null || !explicitlyLabeledSde) {
    return financials;
  }

  return {
    ...financials,
    sde: {
      amount: advertised.amount,
      raw: advertised.raw,
      source: advertised.source,
      excerpts: advertised.excerpts
    }
  };
}

function normalizeOverview(value: unknown): BusinessOverview {
  const object = asObject(value);
  return {
    businessName: normalizeTextFact(object.businessName),
    industry: normalizeTextFact(object.industry),
    location: normalizeTextFact(object.location),
    yearEstablished: normalizeTextFact(object.yearEstablished),
    yearsOperating: normalizeTextFact(object.yearsOperating),
    description: normalizeTextFact(object.description),
    services: normalizeTextFact(object.services),
    employeeCount: normalizeTextFact(object.employeeCount),
    ownerInvolvement: normalizeTextFact(object.ownerInvolvement),
    reasonForSale: normalizeTextFact(object.reasonForSale),
    revenueModel: normalizeTextFact(object.revenueModel),
    customerSegments: normalizeTextFact(object.customerSegments),
    includedAssets: normalizeTextFact(object.includedAssets)
  };
}

function normalizeFinancials(value: unknown): FinancialSnapshot {
  const object = asObject(value);
  const inventory = normalizeAssetDetail(object.inventory);
  const ffe = normalizeAssetDetail(object.ffe);
  const realEstate = normalizeRealEstateDetail(object.realEstate);
  return {
    askingPrice: normalizeMoneyField(object.askingPrice),
    businessAskingPrice: normalizeMoneyField(object.businessAskingPrice),
    annualRevenue: normalizeMoneyField(object.annualRevenue),
    sde: normalizeMoneyField(object.sde),
    ebitda: normalizeMoneyField(object.ebitda),
    advertisedCashFlow: {
      ...normalizeMoneyField(object.advertisedCashFlow),
      sellerTerminology: normalizeString(asObject(object.advertisedCashFlow).sellerTerminology)
    },
    inventory,
    ffe,
    realEstate,
    knownAdditionalAcquisitionCosts: normalizeMoneyField(object.knownAdditionalAcquisitionCosts),
    equipmentReplacementNeeds: normalizeTextFact(object.equipmentReplacementNeeds),
    immediateCapitalNeeds: normalizeTextFact(object.immediateCapitalNeeds)
  };
}

function normalizeBusinessDetails(value: unknown, fallback: BusinessDetails): BusinessDetails {
  const object = asObject(value);
  return {
    listingTitle: normalizeTextFact(object.listingTitle).value ? normalizeTextFact(object.listingTitle) : fallback.listingTitle,
    source: normalizeTextFact(object.source).value ? normalizeTextFact(object.source) : fallback.source,
    url: fallback.url,
    adNumber: normalizeTextFact(object.adNumber).value ? normalizeTextFact(object.adNumber) : fallback.adNumber,
    fullDescription: fallback.fullDescription,
    facilities: normalizeTextFact(object.facilities).value ? normalizeTextFact(object.facilities) : fallback.facilities,
    competition: normalizeTextFact(object.competition).value ? normalizeTextFact(object.competition) : fallback.competition,
    growthOpportunities: normalizeTextFact(object.growthOpportunities).value
      ? normalizeTextFact(object.growthOpportunities)
      : fallback.growthOpportunities,
    financing: normalizeTextFact(object.financing).value ? normalizeTextFact(object.financing) : fallback.financing,
    sellerSupportTraining: normalizeTextFact(object.sellerSupportTraining).value
      ? normalizeTextFact(object.sellerSupportTraining)
      : fallback.sellerSupportTraining,
    reasonForSelling: normalizeTextFact(object.reasonForSelling).value
      ? normalizeTextFact(object.reasonForSelling)
      : fallback.reasonForSelling,
    brokerInformation: fallback.brokerInformation,
    businessWebsite: fallback.businessWebsite,
    streetAddress: fallback.streetAddress,
    additionalDetails: normalizeAdditionalDetails(object.additionalDetails, fallback.additionalDetails)
  };
}

function normalizeAdditionalDetails(value: unknown, fallback: BusinessDetails["additionalDetails"]) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value
    .map((item) => asObject(item))
    .map((item) => ({
      label: normalizeString(item.label) ?? "",
      value: normalizeLongString(item.value) ?? "",
      excerpts: normalizeStringList(item.excerpts)
    }))
    .filter((item) => item.label && item.value)
    .slice(0, 30);
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeClaritySummary(value: unknown): ClaritySummary {
  const object = asObject(value);
  return {
    strategicFit: normalizeString(object.strategicFit) ?? normalizeString(object.kingdomHausFit) ?? "Not assessed.",
    attractiveCharacteristics: normalizeString(object.attractiveCharacteristics) ?? normalizeString(object.attractive) ?? "Not assessed.",
    sellerDependence: normalizeString(object.sellerDependence) ?? "Not assessed.",
    equipmentContinuity: normalizeString(object.equipmentContinuity) ?? "Not assessed.",
    financialQuestions: normalizeString(object.financialQuestions) ?? normalizeString(object.unansweredQuestions) ?? "Not assessed.",
    majorRisks: normalizeString(object.majorRisks) ?? normalizeString(object.threats) ?? "Not assessed.",
    buying: normalizeString(object.buying) ?? "Not assessed.",
    attractive: normalizeString(object.attractive) ?? "Not assessed.",
    kingdomHausFit: normalizeString(object.kingdomHausFit) ?? "Not assessed.",
    threats: normalizeString(object.threats) ?? "Not assessed.",
    unansweredQuestions: normalizeString(object.unansweredQuestions) ?? "Not assessed.",
    verifyBeforeProceeding: normalizeString(object.verifyBeforeProceeding) ?? "Not assessed."
  };
}

function normalizeRiskChecks(value: unknown): RiskCheck[] {
  const items = Array.isArray(value) ? value : [];
  return riskLabels.map((label) => {
    const match = items.find((item) => asObject(item).label === label);
    const object = asObject(match);
    const status = object.status === "clear" || object.status === "watch" || object.status === "unknown" ? object.status : "unknown";
    return {
      label,
      status,
      explanation: normalizeString(object.explanation) ?? "Not assessed.",
      excerpts: normalizeStringList(object.excerpts)
    };
  });
}

function normalizeDecision(value: unknown): PreliminaryDecision {
  const object = asObject(value);
  const recommendation =
    object.recommendation === "Investigate" || object.recommendation === "Pass" || object.recommendation === "Keep Reading"
      ? object.recommendation
      : "Keep Reading";
  return {
    recommendation,
    explanation:
      normalizeString(object.explanation) ??
      "This is a preliminary screen only. Verify the disclosed facts before making any acquisition decision."
  };
}

function normalizeTextFact(value: unknown): TextFact {
  const object = asObject(value);
  const source =
    object.source === "seller_claim" ||
    object.source === "user_correction" ||
    object.source === "ai_inference" ||
    object.source === "url_extract" ||
    object.source === "rule_based" ||
    object.source === "not_disclosed"
      ? object.source
      : "not_disclosed";
  return {
    value: normalizeLongString(object.value),
    source,
    excerpts: normalizeStringList(object.excerpts)
  };
}

function normalizeMoneyField(value: unknown): MoneyField {
  const object = asObject(value);
  const raw = normalizeString(object.raw);
  const amount = typeof object.amount === "number" && Number.isFinite(object.amount) && object.amount >= 0 ? object.amount : parseMoney(raw);
  const source =
    object.source === "seller_claim" ||
    object.source === "user_correction" ||
    object.source === "url_extract" ||
    object.source === "rule_based" ||
    object.source === "calculated" ||
    object.source === "not_disclosed"
      ? object.source
      : "not_disclosed";
  return {
    amount,
    raw,
    source,
    excerpts: normalizeStringList(object.excerpts)
  };
}

function normalizeAssetDetail(value: unknown): AssetDetail {
  const object = asObject(value);
  return {
    value: normalizeMoneyField(object.value),
    includedStatus: normalizeInclusionStatus(object.includedStatus),
    notes: normalizeTextFact(object.notes)
  };
}

function normalizeRealEstateDetail(value: unknown): RealEstateDetail {
  const object = asObject(value);
  const asset = normalizeAssetDetail(value);
  return {
    ...asset,
    ownership: normalizeTextFact(object.ownership),
    buildingSize: normalizeTextFact(object.buildingSize)
  };
}

function normalizeInclusionStatus(value: unknown): InclusionStatus {
  return value === "included" || value === "not_included" || value === "unknown" ? value : "unknown";
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 2_000) : null;
}

function normalizeLongString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxListingLength) : null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 12);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function moneyFromCorrection(request: ScanRequest, key: string): MoneyField {
  const raw = request.corrections?.[key] ?? null;
  return {
    amount: parseMoney(raw),
    raw,
    source: raw ? "user_correction" : "not_disclosed",
    excerpts: []
  };
}

function factFromValue(value: string | null, source: TextFact["source"]): TextFact {
  if (!value) {
    return emptyTextFact();
  }
  return {
    value,
    source,
    excerpts: []
  };
}

export const validationInternals = {
  emptyTextFact,
  emptyMoneyField,
  emptyAssetDetail,
  emptyRealEstateDetail
};
