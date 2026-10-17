export type FactSource = "seller_claim" | "user_correction" | "ai_inference" | "url_extract" | "rule_based" | "calculated" | "not_disclosed";

export type MoneyField = {
  amount: number | null;
  raw: string | null;
  source: Extract<FactSource, "seller_claim" | "user_correction" | "url_extract" | "rule_based" | "calculated" | "not_disclosed">;
  excerpts: string[];
};

export type TextFact = {
  value: string | null;
  source: Exclude<FactSource, "calculated">;
  excerpts: string[];
};

export type InclusionStatus = "included" | "not_included" | "unknown";

export type AssetDetail = {
  value: MoneyField;
  includedStatus: InclusionStatus;
  notes: TextFact;
};

export type RealEstateDetail = AssetDetail & {
  ownership: TextFact;
  buildingSize: TextFact;
};

export type AdditionalListingDetail = {
  label: string;
  value: string;
  excerpts: string[];
};

export type BusinessDetails = {
  listingTitle: TextFact;
  source: TextFact;
  url: TextFact;
  adNumber: TextFact;
  fullDescription: TextFact;
  facilities: TextFact;
  competition: TextFact;
  growthOpportunities: TextFact;
  financing: TextFact;
  sellerSupportTraining: TextFact;
  reasonForSelling: TextFact;
  brokerInformation: TextFact;
  additionalDetails: AdditionalListingDetail[];
};

export type BusinessOverview = {
  businessName: TextFact;
  industry: TextFact;
  location: TextFact;
  yearEstablished: TextFact;
  yearsOperating: TextFact;
  description: TextFact;
  services: TextFact;
  employeeCount: TextFact;
  ownerInvolvement: TextFact;
  reasonForSale: TextFact;
  revenueModel: TextFact;
  customerSegments?: TextFact;
  includedAssets: TextFact;
};

export type FinancialSnapshot = {
  askingPrice: MoneyField;
  businessAskingPrice: MoneyField;
  annualRevenue: MoneyField;
  sde: MoneyField;
  ebitda: MoneyField;
  advertisedCashFlow: MoneyField & {
    sellerTerminology: string | null;
  };
  inventory: AssetDetail;
  ffe: AssetDetail;
  realEstate: RealEstateDetail;
  knownAdditionalAcquisitionCosts: MoneyField;
  equipmentReplacementNeeds: TextFact;
  immediateCapitalNeeds: TextFact;
};

export type RatioSnapshot = {
  askingPriceToSde: number | null;
  businessAskingPriceToSde: number | null;
  askingPriceToEbitda: number | null;
  sdeToRevenue: number | null;
};

export type ClaritySummary = {
  strategicFit: string;
  attractiveCharacteristics: string;
  sellerDependence: string;
  equipmentContinuity: string;
  financialQuestions: string;
  majorRisks: string;
  buying: string;
  attractive: string;
  kingdomHausFit: string;
  threats: string;
  unansweredQuestions: string;
  verifyBeforeProceeding: string;
};

export type RiskCheck = {
  label: string;
  status: "clear" | "watch" | "unknown";
  explanation: string;
  excerpts: string[];
  requiresVerification?: boolean;
  verificationItems?: string[];
};

export type PreliminaryDecision = {
  recommendation: "Keep Reading" | "Investigate" | "Pass";
  explanation: string;
};

export type DealScan = {
  id: string;
  createdAt: string;
  listingUrl: string | null;
  listingText: string;
  correctedFields: Record<string, string>;
  businessDetails: BusinessDetails;
  overview: BusinessOverview;
  financials: FinancialSnapshot;
  ratios: RatioSnapshot;
  claritySummary: ClaritySummary;
  riskChecks: RiskCheck[];
  missingInformation: string[];
  sellerClaims: string[];
  aiInferences: string[];
  calculations: string[];
  decision: PreliminaryDecision;
  analysisMode: "ai" | "rule_based" | "local_preview";
  model: string | null;
  retrieval?: ListingRetrieval;
};

export type ListingPhotograph = { url: string; sourceUrl: string; attribution: string };
export type ListingRetrieval = {
  provider: "apify";
  actorId: string;
  retrievedAt: string;
  sourceUrl: string;
  usageUsd: number | null;
  maxChargeUsd: number;
  rawRecord: Record<string, unknown>;
  conflicts: string[];
  photographs: ListingPhotograph[];
};

export type RetrievalProgress = {
  ok: true;
  status: "running";
  jobId: string;
  message: string;
  usageUsd: number | null;
  maxChargeUsd: number;
};

export type ScanRequest = {
  businessName?: string;
  listingUrl?: string;
  listingText: string;
  corrections?: Record<string, string>;
  retrievalId?: string;
};

export type ScanResponse =
  | { ok: true; scan: DealScan }
  | { ok: false; error: string; details?: string[] };

export type UrlFetchResponse =
  | {
      ok: true;
      listingText: string;
      title: string | null;
      source: string;
      finalUrl: string;
      message: string;
      retrievalId?: string;
      usageUsd?: number | null;
      maxChargeUsd?: number;
    }
  | RetrievalProgress
  | { ok: false; error: string; details?: string[] };

export const riskLabels = [
  "Owner dependence",
  "Customer concentration",
  "Licensing and credentials",
  "Equipment continuity",
  "Supplier dependence",
  "Key-person risk",
  "Earnings quality",
  "Near-term capital expenditure"
] as const;
