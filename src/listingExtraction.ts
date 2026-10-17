import { calculateKnownAdditionalCosts, isOptionalRealEstate, parseMoney } from "./financial";
import type {
  AssetDetail,
  BusinessDetails,
  BusinessOverview,
  ClaritySummary,
  FinancialSnapshot,
  InclusionStatus,
  MoneyField,
  PreliminaryDecision,
  RealEstateDetail,
  RiskCheck,
  TextFact
} from "./types";
import { riskLabels } from "./types";

type ExtractedListing = {
  overview: BusinessOverview;
  financials: FinancialSnapshot;
  businessDetails: BusinessDetails;
  claritySummary: ClaritySummary;
  riskChecks: RiskCheck[];
  sellerClaims: string[];
  missingInformation: string[];
  calculations: string[];
  decision: PreliminaryDecision;
};

type TransactionBreakdown = {
  businessRaw: string;
  realEstateRaw: string;
  totalRaw: string;
};

const knownLabels = [
  "Asking Price",
  "Total Asking Price",
  "Business Asking Price",
  "Business Price",
  "Business Component",
  "Business Description",
  "Annual Revenue",
  "Cash Flow (SDE)",
  "Cash Flow",
  "Gross Revenue",
  "Annual Revenue",
  "Revenue",
  "SDE",
  "EBITDA",
  "Established",
  "Employees",
  "Inventory",
  "FF&E",
  "FFE",
  "Furniture, Fixtures, & Equipment",
  "Real Estate",
  "Building SF",
  "Facilities",
  "Competition",
  "Growth & Expansion",
  "Financing",
  "Support & Training",
  "Reason for Selling",
  "Business Location",
  "Location",
  "Industry",
  "Broker",
  "Broker Name",
  "Broker Company",
  "Business Listed By",
  "Listed By",
  "Disclaimer",
  "Franchise",
  "Owner Involvement",
  "Services",
  "Business Model",
  "Customer Segments",
  "Phone Number",
  "Contact Form",
  "Ref",
  "Ad#",
  "Ad Number"
];

export function extractListingDetails(input: {
  listingText: string;
  listingUrl?: string;
  businessName?: string;
  corrections?: Record<string, string>;
}): ExtractedListing {
  const text = normalizeWhitespace(input.listingText);
  const sourceName = sourceFromUrl(input.listingUrl);
  const transactionBreakdown = extractTransactionBreakdown(text);
  const title = firstValue(input.businessName, extractTitle(text));
  const descriptionSource = extractSection(text, ["Business Description"], ["Ad#:", "Ad#", "Detailed Information", "Financial Information", "Business Location"]) ?? text;
  const description = cleanDescription(descriptionSource);
  const adNumber = findPattern(text, /\bAd\s*#?\s*:?\s*([0-9]{4,})\b/i);
  const location = extractLocation(text);
  const industry = normalizeIndustry(firstValue(extractLabelValue(text, "Industry"), inferIndustry(text)));
  const established = firstValue(extractLabelValue(text, "Established"), findPattern(text, /\bestablished\s+in\s+((?:19|20)\d{2})\b/i));
  const establishedYear = established?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
  const establishedYears = established && !establishedYear ? established.match(/\b\d{1,3}\b/)?.[0] ?? null : null;
  const yearsOperating = establishedYear
    ? String(new Date().getFullYear() - Number(establishedYear))
    : establishedYears;
  const employees = extractEmployees(text);
  const reason = firstValue(extractLabelValue(text, "Reason for Selling"), inferReasonForSale(text));
  const facilities = firstValue(extractTextBlock(text, "Facilities"), extractLabelValue(text, "Facilities"));
  const competition = firstValue(extractTextBlock(text, "Competition"), extractLabelValue(text, "Competition"));
  const growth = firstValue(extractTextBlock(text, "Growth & Expansion"), extractLabelValue(text, "Growth & Expansion"), inferGrowthOpportunities(text));
  const financing = extractLabelValue(text, "Financing");
  const support = firstValue(extractTextBlock(text, "Support & Training"), inferSellerTransition(text));
  const broker = extractBroker(text);
  const operatingText = [title, description, facilities, competition, extractTextBlock(text, "Franchise")].filter(Boolean).join("\n");
  const askingRaw = firstValue(
    input.corrections?.askingPrice,
    extractLabelBlock(text, "Total Asking Price"),
    extractLabelValue(text, "Total Asking Price"),
    extractTotalAskingPrice(text),
    transactionBreakdown?.totalRaw,
    extractLabelBlock(text, "Asking Price"),
    extractLabelValue(text, "Asking Price")
  );
  const businessAskingRaw = firstValue(
    input.corrections?.businessAskingPrice,
    extractLabelBlock(text, "Business Asking Price"),
    extractLabelBlock(text, "Business Price"),
    extractLabelBlock(text, "Business Component"),
    extractBusinessAskingPrice(text),
    transactionBreakdown?.businessRaw
  );
  const revenueRaw = firstValue(
    input.corrections?.annualRevenue,
    extractLabelBlock(text, "Annual Revenue"),
    extractLabelBlock(text, "Gross Revenue"),
    extractLabelBlock(text, "Revenue"),
    extractLabelValue(text, "Annual Revenue"),
    extractLabelValue(text, "Gross Revenue"),
    extractLabelValue(text, "Revenue")
  );
  const cashFlowSdeRaw = firstValue(extractCashFlowSde(text), extractLabelBlock(text, "Cash Flow (SDE)"), extractLabelValue(text, "Cash Flow (SDE)"));
  const genericCashFlowRaw = firstValue(extractLabelBlock(text, "Cash Flow"), extractLabelValue(text, "Cash Flow"));
  const sdeRaw = firstValue(
    input.corrections?.sde,
    extractLabelBlock(text, "SDE"),
    extractLabelValue(text, "SDE"),
    cashFlowSdeRaw,
    extractExplicitSde(text)
  );
  const ebitdaRaw = firstValue(input.corrections?.ebitda, extractLabelBlock(text, "EBITDA"), extractLabelValue(text, "EBITDA"));
  const advertisedCashFlowRaw = firstValue(input.corrections?.advertisedCashFlow, cashFlowSdeRaw, genericCashFlowRaw, sdeRaw);
  const inventory = assetFromText(text, ["Inventory"], input.corrections?.inventory);
  const ffe = assetFromText(text, ["FF&E", "FFE", "Furniture, Fixtures, & Equipment"], input.corrections?.ffe);
  const realEstate = realEstateFromText(text, input.corrections?.realEstate, transactionBreakdown);

  const financials: FinancialSnapshot = {
    askingPrice: moneyFact(askingRaw, text, sourceForCorrection(input.corrections?.askingPrice)),
    businessAskingPrice: moneyFact(businessAskingRaw, text, sourceForCorrection(input.corrections?.businessAskingPrice)),
    annualRevenue: moneyFact(revenueRaw, text, sourceForCorrection(input.corrections?.annualRevenue)),
    sde: moneyFact(sdeRaw, text, sourceForCorrection(input.corrections?.sde)),
    ebitda: moneyFact(ebitdaRaw, text, sourceForCorrection(input.corrections?.ebitda)),
    advertisedCashFlow: {
      ...moneyFact(advertisedCashFlowRaw, text, sourceForCorrection(input.corrections?.advertisedCashFlow)),
      sellerTerminology: cashFlowSdeRaw ? "Cash Flow (SDE)" : genericCashFlowRaw ? "Cash Flow" : sdeRaw ? "SDE" : null
    },
    inventory,
    ffe,
    realEstate,
    knownAdditionalAcquisitionCosts: {
      amount: calculateKnownAdditionalCosts({ inventory, ffe, realEstate }),
      raw: null,
      source: "calculated",
      excerpts: []
    },
    equipmentReplacementNeeds: textFact(findEquipmentContinuity(text, ffe), text, "rule_based"),
    immediateCapitalNeeds: textFact(findImmediateCapitalNeeds(inventory, realEstate), text)
  };

  const overview: BusinessOverview = {
    businessName: textFact(title, text, input.businessName ? "user_correction" : "rule_based"),
    industry: textFact(industry, text),
    location: textFact(location, text),
    yearEstablished: textFact(establishedYear, text),
    yearsOperating: textFact(yearsOperating && Number.isFinite(Number(yearsOperating)) ? `Approximately ${yearsOperating} years` : null, text),
    description: textFact(description, text),
    services: textFact(firstValue(extractLabelValue(text, "Services"), inferServices(description, operatingText)), text),
    employeeCount: textFact(employees, text),
    ownerInvolvement: textFact(inferOwnerInvolvement(extractTextBlock(text, "Owner Involvement") ?? descriptionSource.split(/\bDisclaimer\s*:/i)[0]), text),
    reasonForSale: textFact(reason, text),
    revenueModel: textFact(inferRevenueModel(operatingText), text),
    customerSegments: extractCustomerSegments(operatingText),
    includedAssets: textFact(includedAssetsSummary(inventory, ffe, realEstate), text)
  };

  const businessDetails: BusinessDetails = {
    listingTitle: textFact(title, text, input.businessName ? "user_correction" : "rule_based"),
    source: textFact(sourceName, text, input.listingUrl ? "url_extract" : "rule_based"),
    url: textFact(input.listingUrl ?? null, text, input.listingUrl ? "url_extract" : "not_disclosed"),
    adNumber: textFact(adNumber, text),
    fullDescription: textFact(description, text),
    facilities: textFact(facilities, text),
    competition: textFact(competition, text),
    growthOpportunities: textFact(growth, text),
    financing: textFact(financing, text),
    sellerSupportTraining: textFact(support, text),
    reasonForSelling: textFact(reason, text),
    brokerInformation: broker,
    additionalDetails: buildAdditionalDetails(text)
  };

  const claritySummary = buildRuleBasedSummary({ overview, financials, businessDetails });
  const franchiseCheck = buildFranchiseCheck(operatingText);
  const riskChecks = [...buildRiskChecks({ overview, financials, businessDetails }), ...(franchiseCheck ? [franchiseCheck] : [])];
  const missingInformation = [
    ...buildMissingInformation({ overview, financials, businessDetails }),
    ...(franchiseCheck?.verificationItems ?? []).map((item) => `Requires Verification: ${item}.`)
  ];
  const decision = buildDecision(riskChecks, financials);

  return {
    overview,
    financials,
    businessDetails,
    claritySummary,
    riskChecks,
    sellerClaims: collectSellerClaims({ overview, financials, businessDetails }),
    missingInformation,
    calculations: [
      "Financial multiples were calculated by application code from disclosed or corrected values.",
      "Known additional acquisition costs count disclosed inventory or FF&E only when marked not included; separately excluded real estate is shown as optional unless required.",
      "FF&E marked included is not added again to the asking price."
    ],
    decision
  };
}

function assetFromText(text: string, labels: string[], override?: string): AssetDetail {
  const raw = firstValue(override, ...labels.map((label) => extractLabelBlock(text, label)), extractAssetStatement(text, labels));
  const source = sourceForCorrection(override);
  return {
    value: moneyFact(raw, text, source),
    includedStatus: inclusionFromText(raw),
    notes: textFact(raw, text, source)
  };
}

function realEstateFromText(text: string, override?: string, transactionBreakdown?: TransactionBreakdown | null): RealEstateDetail {
  const raw = firstValue(override, transactionBreakdown?.realEstateRaw, extractLabelBlock(text, "Real Estate"), extractAssetStatement(text, ["Real Estate"]));
  const source = sourceForCorrection(override);
  return {
    value: moneyFact(raw, text, source),
    includedStatus: inclusionFromText(raw),
    notes: textFact(raw, text, source),
    ownership: textFact(extractOwnership(raw), text),
    buildingSize: textFact(extractLabelValue(text, "Building SF"), text)
  };
}

function buildRuleBasedSummary(input: {
  overview: BusinessOverview;
  financials: FinancialSnapshot;
  businessDetails: BusinessDetails;
}): ClaritySummary {
  const { overview, financials, businessDetails } = input;
  const strategicFit = overview.industry.value
    ? `Rule-based view: this appears to be a ${overview.industry.value} opportunity that should be compared with KingdomHaus operating focus, buyer capabilities, and integration needs.`
    : "Rule-based view: industry fit is unclear until the listing category and services are verified.";
  const attractiveCharacteristics = [
    financials.sde.amount ? "SDE is disclosed" : null,
    !financials.sde.amount && financials.advertisedCashFlow.amount ? "advertised cash flow is disclosed" : null,
    financials.annualRevenue.amount ? "revenue is disclosed" : null,
    businessDetails.growthOpportunities.value ? "growth opportunities are stated" : null,
    businessDetails.sellerSupportTraining.value ? "seller support is described" : null
  ]
    .filter(Boolean)
    .join(", ");
  const excludedCosts = financials.knownAdditionalAcquisitionCosts.amount;
  const financialQuestions = [
    financials.sde.amount
      ? "verify SDE, EBITDA, revenue, tax returns, add-backs, and working capital needs"
      : "verify advertised cash flow, EBITDA, revenue, tax returns, add-backs, and working capital needs",
    financials.inventory.includedStatus === "not_included" ? "inventory is excluded and should be priced separately" : null,
    financials.realEstate.includedStatus === "not_included" && isOptionalRealEstate(financials.realEstate)
      ? "real estate is separately offered and should be treated as optional unless deal terms make it required"
      : null,
    financials.realEstate.includedStatus === "not_included" && !isOptionalRealEstate(financials.realEstate)
      ? "real estate is excluded and should not be counted inside asking price"
      : null,
    excludedCosts ? `known excluded assets total ${formatPlainMoney(excludedCosts)}` : null
  ]
    .filter(Boolean)
    .join("; ");

  return {
    strategicFit,
    attractiveCharacteristics: attractiveCharacteristics
      ? `Rule-based view: ${attractiveCharacteristics}.`
      : "Rule-based view: attractive characteristics need more verification.",
    sellerDependence:
      ownerDependenceSummary(overview.ownerInvolvement),
    equipmentContinuity:
      financials.ffe.includedStatus === "included"
        ? "Rule-based view: FF&E appears included in the asking price. Still verify equipment condition, remaining useful life, liens or loans, maintenance history, and replacement exposure."
        : financials.ffe.includedStatus === "not_included"
          ? "Rule-based view: FF&E is reported as not included. Verify which equipment, if any, must be acquired or replaced and the related costs. No equipment cost is assumed."
          : "Rule-based view: equipment continuity is unclear; verify FF&E inclusion, condition, liens or loans, maintenance history, and replacement needs.",
    financialQuestions: `Rule-based view: ${financialQuestions}.`,
    majorRisks:
      "Rule-based view: major risks include earnings quality, excluded acquisition costs, customer concentration, seller transition, and whether the stated growth opportunities are practical.",
    buying: businessDetails.fullDescription.value ?? "Business description was not disclosed.",
    attractive: attractiveCharacteristics || "Attractive points were not clearly disclosed.",
    kingdomHausFit: strategicFit,
    threats: "Validate excluded assets, seller dependence, equipment continuity, customer concentration, and financial quality before moving forward.",
    unansweredQuestions: financialQuestions,
    verifyBeforeProceeding:
      "Verify tax returns, add-backs, asset inclusion, real estate terms, inventory cost, customer mix, equipment condition, licenses, and seller transition support."
  };
}

function buildRiskChecks(input: {
  overview: BusinessOverview;
  financials: FinancialSnapshot;
  businessDetails: BusinessDetails;
}): RiskCheck[] {
  const { overview, financials, businessDetails } = input;
  return riskLabels.map((label) => {
    if (label === "Equipment continuity") {
      return risk(
        label,
        financials.ffe.includedStatus !== "unknown" ? "watch" : "unknown",
        financials.ffe.includedStatus === "included"
          ? "FF&E appears included in the asking price. Verify condition, remaining useful life, liens or loans, maintenance history, and replacement exposure."
          : financials.ffe.includedStatus === "not_included"
            ? "FF&E is reported as not included. Verify which equipment, if any, is needed after acquisition, its condition, and any purchase or replacement cost."
            : "FF&E inclusion, condition, liens or loans, maintenance history, and replacement exposure are not clear.",
        financials.ffe.notes.excerpts
      );
    }
    if (label === "Earnings quality") {
      return risk(label, financials.sde.amount || financials.ebitda.amount || financials.advertisedCashFlow.amount ? "watch" : "unknown", "Verify SDE, EBITDA, add-backs, tax returns, and whether advertised cash flow matches actual free cash flow.", []);
    }
    if (label === "Near-term capital expenditure") {
      return risk(label, financials.knownAdditionalAcquisitionCosts.amount ? "watch" : "unknown", financials.knownAdditionalAcquisitionCosts.amount
        ? "At least one asset appears excluded from asking price and may require separate capital."
        : "No separate capital cost was calculated, but equipment, inventory, and real estate terms still need verification.", []);
    }
    if (label === "Owner dependence") {
      return risk(label, overview.ownerInvolvement.value ? "watch" : "unknown", ownerDependenceSummary(overview.ownerInvolvement), overview.ownerInvolvement.excerpts);
    }
    if (label === "Customer concentration") {
      return risk(label, businessDetails.competition.value || businessDetails.growthOpportunities.value ? "unknown" : "unknown", "Customer concentration is not established by this rule-based scan; request customer revenue mix.", []);
    }
    if (label === "Licensing and credentials") {
      return risk(label, "unknown", "Licensing and credential requirements are not reliably established from the retained listing text.", []);
    }
    if (label === "Supplier dependence") {
      return risk(label, "unknown", "Supplier dependence is not disclosed; verify vendors, terms, and single-source exposure.", []);
    }
    return risk(label, "unknown", "Key-person dependence beyond the seller is not disclosed.", []);
  });
}

function buildMissingInformation(input: {
  overview: BusinessOverview;
  financials: FinancialSnapshot;
  businessDetails: BusinessDetails;
}): string[] {
  const missing: string[] = [];
  if (!input.financials.ebitda.amount) missing.push("EBITDA is not disclosed.");
  if (!input.businessDetails.brokerInformation.value) missing.push("Broker information is not disclosed.");
  if (!input.overview.ownerInvolvement.value) missing.push("Owner involvement is not clearly disclosed.");
  if (!input.businessDetails.sellerSupportTraining.value) missing.push("Seller support and training are not disclosed.");
  if (!input.businessDetails.financing.value) missing.push("Financing information is not disclosed.");
  missing.push("Customer concentration and top-customer revenue mix are not disclosed.");
  if (hasEquipmentLoanLanguage(input.businessDetails.fullDescription.value ?? input.financials.equipmentReplacementNeeds.value ?? "")) {
    missing.push("Equipment loan payoff amount, lien release, and closing treatment are not disclosed.");
  }
  if (input.financials.ffe.includedStatus === "included" || input.financials.equipmentReplacementNeeds.value) {
    missing.push("Equipment condition, age, remaining useful life, maintenance records, and replacement exposure are not disclosed.");
  }
  missing.push("Supplier dependence, vendor terms, and single-source exposure are not disclosed.");
  missing.push("Financial verification documents, add-backs, working capital needs, and quality of earnings are not supplied.");
  if (!input.businessDetails.sellerSupportTraining.value || !/\b(days?|weeks?|months?|hours?)\b/i.test(input.businessDetails.sellerSupportTraining.value)) {
    missing.push("Seller transition timeline, post-close role, and training terms are not fully disclosed.");
  }
  return uniqueStrings(missing);
}

function buildDecision(risks: RiskCheck[], financials: FinancialSnapshot): PreliminaryDecision {
  const hasKnownCosts = Boolean(financials.knownAdditionalAcquisitionCosts.amount);
  const watchCount = risks.filter((item) => item.status === "watch").length;
  if (hasKnownCosts || watchCount >= 3) {
    return {
      recommendation: "Investigate",
      explanation:
        "The listing has enough disclosed information to keep reviewing, but excluded costs and verification questions need diligence before any acquisition decision."
    };
  }
  return {
    recommendation: "Keep Reading",
    explanation:
      "The scan is preliminary and rule-based. Keep reading only if the missing facts can be verified with source documents and seller conversations."
  };
}

function collectSellerClaims(input: {
  overview: BusinessOverview;
  financials: FinancialSnapshot;
  businessDetails: BusinessDetails;
}): string[] {
  const claims = [
    input.businessDetails.listingTitle.value,
    input.overview.location.value,
    input.businessDetails.fullDescription.value,
    input.businessDetails.facilities.value,
    input.businessDetails.competition.value,
    input.businessDetails.growthOpportunities.value,
    input.businessDetails.financing.value,
    input.businessDetails.sellerSupportTraining.value,
    input.businessDetails.reasonForSelling.value,
    input.businessDetails.brokerInformation.value,
    input.overview.ownerInvolvement.value,
    input.financials.askingPrice.raw,
    input.financials.businessAskingPrice.raw,
    input.financials.annualRevenue.raw,
    input.financials.sde.raw,
    input.financials.ebitda.raw,
    input.financials.advertisedCashFlow.raw,
    input.financials.inventory.value.raw,
    input.financials.ffe.value.raw,
    input.financials.realEstate.value.raw
  ];
  return uniqueStrings(
    claims
      .filter((item): item is string => Boolean(item?.trim()))
      .flatMap((item) => sourceStatements(item))
  ).slice(0, 20);
}

function risk(label: string, status: RiskCheck["status"], explanation: string, excerpts: string[]): RiskCheck {
  return { label, status, explanation, excerpts };
}

function buildAdditionalDetails(text: string) {
  const details = extractLabelPairs(text)
    .filter((item) => !knownLabels.some((label) => label.toLowerCase() === item.label.toLowerCase()))
    .filter((item) => !/^(business|business description)$/i.test(item.label.trim()))
    .slice(0, 20)
    .map((item) => ({ ...item, excerpts: [item.value] }));
  details.push({
    label: "Complete source text",
    value: text,
    excerpts: [text.slice(0, 500)]
  });
  return details;
}

function moneyFact(raw: string | null | undefined, text: string, source: MoneyField["source"] = "seller_claim"): MoneyField {
  const amount = parseMoney(raw);
  return {
    amount,
    raw: raw ?? null,
    source: raw ? source : "not_disclosed",
    excerpts: raw && source !== "user_correction" ? excerptFor(text, raw) : []
  };
}

function textFact(value: string | null | undefined, text: string, source: TextFact["source"] = "seller_claim"): TextFact {
  return {
    value: value ?? null,
    source: value ? source : "not_disclosed",
    excerpts: value ? excerptFor(text, value) : []
  };
}

function inclusionFromText(value: string | null | undefined): InclusionStatus {
  if (!value) return "unknown";
  if (/\bno\s+(?:significant\s+)?(?:equipment|inventory|ff&e|ffe|furniture|fixtures|assets?)(?:\s+or\s+(?:equipment|inventory|ff&e|ffe|furniture|fixtures|assets?))*[^.\n]*\bincluded\b/i.test(value)) return "not_included";
  if (/\b(?:does\s+not|do\s+not|not)\s+include\b/i.test(value)) return "not_included";
  if (/\bincluded\b/i.test(value) && /\b(?:value\s+)?not\s+separately\s+disclosed\b/i.test(value)) return "included";
  if (/\bnot\s+included\b|\bexcluded\b|\bnot\s+part\b|\boffered\s+separately\b|\bsold\s+separately\b|\bavailable\s+separately\b|\bseparate(?:ly)?\s+(?:purchase|transaction|cost|price)\b/i.test(value)) return "not_included";
  if (/\bincludes?\b|\bincluded\b|\bincluded in asking price\b/i.test(value)) return "included";
  return "unknown";
}

function extractOwnership(value: string | null): string | null {
  if (!value) return null;
  if (/\bleased\b/i.test(value)) return "Leased";
  if (/\bowned\b/i.test(value)) return "Owned";
  return null;
}

function includedAssetsSummary(inventory: AssetDetail, ffe: AssetDetail, realEstate: RealEstateDetail): string | null {
  const parts = [
    assetSummary("Inventory", inventory),
    assetSummary("FF&E", ffe),
    assetSummary("Real estate", realEstate)
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("; ") : null;
}

function assetSummary(label: string, asset: AssetDetail): string | null {
  if (asset.includedStatus === "unknown" && !asset.value.raw) return null;
  return `${label}: ${asset.value.raw ?? "value not disclosed"} (${asset.includedStatus.replace("_", " ")})`;
}

function findEquipmentContinuity(text: string, ffe: AssetDetail): string | null {
  const loanStatement = findSentence(text, [/\bequipment\b/i, /\b(loan|lien|payoff|financ)/i]);
  const conditionStatement = findSentence(text, [/\bequipment\b/i, /\b(condition|maintenance|useful life|replacement|lease|leased|owned)\b/i]);
  const includedStatement = ffe.includedStatus === "included" ? "FF&E appears included in the asking price." : null;
  const diligenceStatement =
    "Verify equipment condition, remaining useful life, maintenance history, liens or loans, payoff requirements, and replacement exposure.";
  return [includedStatement, ffe.notes.value, loanStatement, conditionStatement, diligenceStatement].filter(Boolean).join(" ");
}

function findImmediateCapitalNeeds(inventory: AssetDetail, realEstate: RealEstateDetail): string | null {
  const parts: string[] = [];
  if (inventory.includedStatus === "not_included") parts.push(`Inventory excluded: ${inventory.value.raw ?? "value not disclosed"}`);
  if (realEstate.includedStatus === "not_included" && isOptionalRealEstate(realEstate)) {
    parts.push(`Optional real estate available separately: ${realEstate.value.raw ?? "value not disclosed"}`);
  } else if (realEstate.includedStatus === "not_included") {
    parts.push(`Real estate excluded: ${realEstate.value.raw ?? "value not disclosed"}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

function inferOwnerInvolvement(text: string): string | null {
  const statements = text.split("\n").flatMap(splitIntoSentences).filter((sentence) =>
    /\bowner\b/i.test(sentence) &&
    /\b(operated|operates|works?|handles?|responsibilities|sales|scheduling|hours?|workweek|day.to.day)\b/i.test(sentence) &&
    !/\b(could|would|may|potential|new owner|buyer seeking|will provide|training|transition)\b/i.test(sentence)
  );
  const duties = statements.filter((sentence) => /\b(responsibilities|handles?|sales|scheduling|customer communication)\b/i.test(sentence));
  const selected = duties.length > 0 ? duties : statements;
  if (duties.length > 0 && !/\b(hours?|workweek)\b/i.test(duties.join(" "))) {
    const hours = statements.find((sentence) => /\b(hours?|workweek)\b/i.test(sentence));
    if (hours) selected.push(hours);
  }
  return uniqueStrings(selected).join(" ") || null;
}

function ownerDependenceSummary(owner: TextFact): string {
  return owner.value ?
    `Seller reports: ${owner.value} Verify who will cover these responsibilities after acquisition. Enter only incremental replacement costs in Post-Acquisition Cash Flow; no salary or available KingdomHaus staffing is assumed.` :
    "Owner responsibilities and working hours are not disclosed; verify post-close coverage and any incremental replacement costs.";
}

function inferReasonForSale(text: string): string | null {
  if (/\bowner\b[^.\n]*\bretir(?:e|ing|ement)\b/i.test(text) || /\bretir(?:e|ing|ement)\b/i.test(text)) {
    return "Retirement";
  }
  return null;
}

function inferSellerTransition(text: string): string | null {
  return findSentence(text, [/\b(seller|owner)\b/i, /\b(assist|support|train|transition)\b/i]);
}

function inferRevenueModel(text: string): string | null {
  if (/\bpainting\b/i.test(text)) {
    return `${/\bmobile\b/i.test(text) ? "Mobile painting services" : "Painting services"}${franchiseEvidence(text) ? " franchise" : ""}`;
  }
  if (/\bretail\b/i.test(text)) return "Retail or customer sales";
  if (/\bmanufactur|printing|packaging|service\b/i.test(text)) return "Product and service revenue";
  return null;
}

function inferServices(description: string | null, context = description ?? ""): string | null {
  if (!description) return null;
  const cleanedDescription = description.replace(/^\s*(Business Description|Detailed Information)\s*:?\s*/i, "").trim();
  if (/\bpainting\b/i.test(context)) {
    const segments = /\bresidential\b/i.test(context) && /\bcommercial\b/i.test(context) ? "Residential and commercial " : "";
    return `${segments}${segments ? "painting" : "Painting"}${franchiseEvidence(context) ? " franchise" : ""} services`;
  }
  if (/\bindustrial equipment accessories\b/i.test(cleanedDescription)) {
    return "Industrial equipment accessories";
  }
  if (/\bmanufactur(?:er|ing|es)?\b/i.test(cleanedDescription) && /\b(accessor(?:y|ies)|equipment|industrial)\b/i.test(cleanedDescription)) {
    return "Specialty manufactured equipment accessories";
  }
  const sentence =
    findSentence(cleanedDescription, [/\b(painting|paint|franchise|residential|commercial|printing|packaging|service|manufactur|equipment|accessor(?:y|ies))\b/i]) ??
    cleanedDescription.split(/[.!?]\s+/)[0];
  return sentence && sentence.length <= 220 ? sentence : null;
}

function inferIndustry(text: string): string | null {
  if (/\bmanufactur(?:er|ing|es)?\b/i.test(text) && /\b(industrial equipment accessories|equipment accessories|industrial equipment|accessor(?:y|ies))\b/i.test(text)) {
    return "Specialty manufacturing / industrial equipment accessories";
  }
  if (/\bprinting\b|\bpackaging\b/i.test(text)) return "Printing and packaging";
  if (/\bpainting\b|\bpaint\b/i.test(text)) return "Painting services";
  if (/\bhvac\b/i.test(text)) return "HVAC services";
  return null;
}

function normalizeIndustry(value: string | null): string | null {
  if (!value) return null;
  if (
    /\bspecialty\s+manufactur/i.test(value) &&
    /\b(industrial equipment accessories|equipment accessories|industrial equipment|accessor(?:y|ies))\b/i.test(value)
  ) {
    return "Specialty manufacturing / industrial equipment accessories";
  }
  return value;
}

function extractLocation(text: string): string | null {
  return firstValue(
    cleanLocationValue(extractLabelValue(text, "Business Location")),
    cleanLocationValue(extractLabelValue(text, "Location")),
    cleanLocationValue(findPattern(text, /\bBusiness Location\s+Location\s*:?\s*([^\n]{2,120})/i)),
    cleanLocationValue(findPattern(text, /\b(Central\s+North Carolina|Eastern\s+North Carolina|Western\s+North Carolina|North Carolina)\b/i))
  );
}

function extractTitle(text: string): string | null {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const title = lines.find((line) => !/^(Business Description|Detailed Information|Asking Price|Cash Flow|Gross Revenue)$/i.test(line)) ?? null;
  if (!title) return null;
  const candidate = title.length > 160 ? splitIntoSentences(title)[0] ?? title.slice(0, 160).trim() : title;
  if (!isSafeTitle(candidate)) return null;
  return candidate;
}

function extractBroker(text: string): TextFact {
  const name = extractTextBlock(text, "Broker Name");
  const company = extractTextBlock(text, "Broker Company");
  if (validBrokerPart(name) || validBrokerPart(company)) {
    const parts = [name, company].filter(validBrokerPart);
    return { value: parts.join(" \u2014 "), source: "seller_claim", excerpts: parts };
  }
  for (const label of ["Business Listed By", "Listed By", "Broker"]) {
    const block = extractTextBlock(text, label);
    if (!block) continue;
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const parts: string[] = [];
    for (const line of lines) {
      if (!validBrokerPart(line)) break;
      parts.push(line);
      if (parts.length === 2) break;
    }
    if (parts.length === 0) continue;
    if (parts.length === 1 && label !== "Broker") {
      const combined = parts[0].match(/^([A-Z][A-Za-z'-]+\s+[A-Z][A-Za-z'-]+)\s+(.+)$/);
      if (combined && validBrokerPart(combined[2])) {
        return { value: `${combined[1]} \u2014 ${combined[2]}`, source: "seller_claim", excerpts: [parts[0]] };
      }
    }
    return { value: parts.join(" \u2014 "), source: "seller_claim", excerpts: parts };
  }
  return textFact(null, text);
}

function validBrokerPart(value: string | null): value is string {
  return Boolean(value && value.length <= 160 && /^[A-Za-z][A-Za-z0-9 .,&'()/-]*$/.test(value) &&
    !/\b(disclaimer|guarantee|accuracy|completeness|information|prospective|due diligence|terms of use|privacy|not disclosed|not available|n\/a|view my listings|contact form)\b/i.test(value));
}

function extractEmployees(text: string): string | null {
  const labelled = extractTextBlock(text, "Employees")?.split("\n")[0];
  if (labelled && /^\d{1,5}(?:\s+(?:full[- ]time|part[- ]time|total))?(?:\s+employees?|\s+contractors?(?:\s+1099\s+subcontractors?)?)?$/i.test(labelled)) return labelled;
  return findPattern(text, /\b([0-9]{1,5}[ \t]*(?:full[- \t]?time|part[- \t]?time|total)?[ \t]*employees?)\b/i);
}

function extractCustomerSegments(text: string): TextFact {
  const mix = findPattern(text, /\b(\d{1,3}%\s*Residential\s*\/\s*\d{1,3}%\s*Commercial(?:\s+Revenue\s+Mix)?)/i);
  if (mix) return textFact(mix, text);
  const evidence = text.split("\n").flatMap(splitIntoSentences).find((sentence) =>
    /\bresidential\b/i.test(sentence) && /\bcommercial\b/i.test(sentence)
  );
  if (evidence) return { value: "Residential and commercial customers", source: "seller_claim", excerpts: [evidence] };
  return textFact(null, text);
}

function franchiseEvidence(text: string): string | null {
  return text.split("\n").flatMap(splitIntoSentences).find((sentence) =>
    /\bfranchise\b|\bfranchisor\b/i.test(sentence) &&
    !/\b(not\s+(?:a\s+|an\s+)?franchise|non[- ]franchise|franchise[- ]free|not\s+part\s+of\s+a\s+franchise)\b/i.test(sentence)
  ) ?? null;
}

function buildFranchiseCheck(text: string): RiskCheck | null {
  const evidence = franchiseEvidence(text);
  if (!evidence) return null;
  return {
    label: "Franchise requirements",
    status: "unknown",
    requiresVerification: true,
    explanation: "The listing identifies a franchise. Confirm the applicable terms with the franchisor and the franchise agreement; no undisclosed fees, restrictions, or permissions are assumed.",
    verificationItems: [
      "Franchisor approval of ownership transfers",
      "Franchise transfer fees",
      "Royalty and marketing fees",
      "Territory restrictions",
      "Operating requirements",
      "Franchise agreement terms and renewal conditions",
      "Whether shared management across KingdomHaus companies is permitted"
    ],
    excerpts: [evidence]
  };
}

function extractTotalAskingPrice(text: string): string | null {
  return findPattern(text, /\b(?:total|combined)\s+asking\s+price\s*:?\s*(\$[0-9][0-9,]*(?:\.\d+)?)/i);
}

function extractBusinessAskingPrice(text: string): string | null {
  return firstValue(
    findPattern(text, /\bBusiness\s*:\s*(\$[0-9][0-9,]*(?:\.\d+)?)/i),
    findPattern(text, /\bbusiness\s+(?:component|portion|price|asking price)\s*:?\s*(\$[0-9][0-9,]*(?:\.\d+)?)/i),
    findPattern(text, /\bbusiness\s+(?:is\s+)?(?:priced|offered)\s+at\s+(\$[0-9][0-9,]*(?:\.\d+)?)/i),
    findPattern(text, /(\$[0-9][0-9,]*(?:\.\d+)?)\s+(?:for\s+)?(?:the\s+)?business\s+(?:component|portion|price)/i)
  );
}

function extractTransactionBreakdown(text: string): TransactionBreakdown | null {
  const match = text.match(
    /\bPRICE\s+INCLUDES\s+BUSINESS\s*&\s*REAL\s+ESTATE!?\s*Business\s*:\s*(\$[0-9][0-9,]*(?:\.\d+)?)\s*&\s*Real\s+Estate\s*:\s*(\$[0-9][0-9,]*(?:\.\d+)?)/i
  );
  if (!match) return null;
  const businessAmount = parseMoney(match[1]);
  const realEstateAmount = parseMoney(match[2]);
  if (businessAmount === null || realEstateAmount === null) return null;
  const total = businessAmount + realEstateAmount;
  return {
    businessRaw: `${match[1]} business component`,
    realEstateRaw: `${match[2]} included real estate component`,
    totalRaw: `${formatPlainMoney(total)} total asking price`
  };
}

function extractExplicitSde(text: string): string | null {
  return firstValue(
    findPattern(text, /\bSDE\b[^$\n.]{0,90}(\$[0-9][0-9,]*(?:\.\d+)?)/i),
    findPattern(text, /(\$[0-9][0-9,]*(?:\.\d+)?)\s*(?:in\s+)?\bSDE\b/i)
  );
}

function extractCashFlowSde(text: string): string | null {
  return firstValue(
    findPattern(text, /\bCash\s+Flow\s*\(\s*SDE\s*\)\s*:?\s*(\$[0-9][0-9,]*(?:\.\d+)?)/i),
    findPattern(text, /\bCash\s+Flow\s*\(\s*SDE\s*\)\s*\n\s*(\$[0-9][0-9,]*(?:\.\d+)?)/i)
  );
}

function inferGrowthOpportunities(text: string): string | null {
  const sentences = splitIntoSentences(text).filter((sentence) =>
    /\b(marketing|online sales|new channels?|unused manufacturing capacity|capacity|e-?commerce|internet)\b/i.test(sentence)
  );
  return uniqueStrings(sentences).slice(0, 4).join(" ") || null;
}

function extractLabelValue(text: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const nextValue = (index: number) => lines[index + 1] && !isListingHeading(lines[index + 1])
    ? cleanInlineValue(lines[index + 1], label) : null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const colonInline = line.match(new RegExp(`^${escaped}\\s*:\\s*(.*)$`, "i"));
    if (colonInline) return cleanInlineValue(colonInline[1], label) || nextValue(index);
    const spaceInline = line.match(new RegExp(`^${escaped}\\s+(.+)$`, "i"));
    if (spaceInline?.[1]) return cleanInlineValue(spaceInline[1], label);
    if (new RegExp(`^${escaped}\\s*$`, "i").test(line)) return nextValue(index);
  }
  const inline = text.match(new RegExp(`\\b${escaped}\\s*:\\s*([^\\n]{1,300})`, "i"));
  return cleanInlineValue(inline?.[1], label);
}

function extractTextBlock(text: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const header = new RegExp(`^${escaped}(?:\\s*:\\s*(.*)|\\s*)$`, "i");
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(header);
    if (!match) continue;
    const values = match[1]?.trim() ? [match[1].trim()] : [];
    for (let next = index + 1; next < lines.length; next += 1) {
      if (isListingHeading(lines[next]) || /^\*\s*\*/.test(lines[next])) break;
      values.push(lines[next]);
    }
    return values.join("\n") || null;
  }
  return null;
}

function isListingHeading(line: string): boolean {
  return knownLabels.some((label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped}(?:\\s*:|\\s*$)`, "i").test(line);
  }) || /^(?:View My Listings|Detailed Information|Financial Benchmarks|Demographic Information|Listing Statistics)\b/i.test(line);
}

function extractLabelBlock(text: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const colonInline = line.match(new RegExp(`^${escaped}\\s*:\\s*(.*)$`, "i"));
    const spaceInline = line.match(new RegExp(`^${escaped}\\s+(.+)$`, "i"));
    const exactLabel = new RegExp(`^${escaped}\\s*$`, "i").test(line);
    if (!colonInline && !spaceInline && !exactLabel) {
      continue;
    }
    const firstValue = cleanInlineValue(colonInline?.[1] ?? spaceInline?.[1] ?? "", label) ?? "";
    const block: string[] = firstValue.trim() ? [firstValue.trim()] : [];
    for (let nextIndex = index + 1; nextIndex < lines.length && block.length < 5; nextIndex += 1) {
      const next = lines[nextIndex];
      if (knownLabels.some((knownLabel) => new RegExp(`^${knownLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:?`, "i").test(next))) {
        break;
      }
      block.push(next);
    }
    return block.filter(Boolean).join(" ");
  }
  return null;
}

function extractSection(text: string, starts: string[], ends: string[]): string | null {
  const startIndex = starts.map((label) => text.toLowerCase().indexOf(label.toLowerCase())).find((index) => index >= 0);
  if (startIndex === undefined || startIndex < 0) return null;
  const afterStart = text.slice(startIndex + starts[0].length).trim();
  const endIndexes = ends.map((label) => afterStart.toLowerCase().indexOf(label.toLowerCase())).filter((index) => index > 0);
  const endIndex = endIndexes.length > 0 ? Math.min(...endIndexes) : afterStart.length;
  return afterStart.slice(0, endIndex).trim() || null;
}

function cleanDescription(value: string): string {
  let cleaned = value.split(/\bDisclaimer\s*:/i)[0]
    .replace(/^\s*(Business Description|Detailed Information|Business)\s*:?\s*/i, "")
    .replace(/\b(Business Description|Detailed Information)\b\s*:?\s*/gi, "")
    .replace(/\bPRICE\s+INCLUDES\s+BUSINESS\s*&\s*REAL\s+ESTATE!?\s*Business\s*:\s*\$[0-9][0-9,]*(?:\.\d+)?\s*&\s*Real\s+Estate\s*:\s*\$[0-9][0-9,]*(?:\.\d+)?\.?/gi, "")
    .replace(/\b(?:The\s+)?transaction\s+includes\s+the\s+business,\s*furniture,\s*fixtures,\s*and\s*equipment,\s*inventory,\s*and\s*the\s+owned\s+real\s+estate\.?/gi, "")
    .replace(/\bInventory\s+and\s+FF&E\s+are\s+included\s+in\s+the\s+transaction,\s+with\s+individual\s+values\s+not\s+separately\s+disclosed\.?/gi, "")
    .replace(/\bCash\s+Flow\s*\(\s*SDE\s*\)\s*:?\s*\$[0-9][0-9,]*(?:\.\d+)?/gi, "")
    .replace(/\bGross\s+Revenue\s*:?\s*\$[0-9][0-9,]*(?:\.\d+)?/gi, "")
    .replace(/\bEBITDA\s*:?\s*(?:N\/A|Not\s+Disclosed|\$[0-9][0-9,]*(?:\.\d+)?)/gi, "")
    .trim();
  const sentences = splitIntoSentences(cleaned);
  cleaned = uniqueSentencesByFingerprint(sentences).join(" ") || cleaned;
  return cleaned;
}

function extractLabelPairs(text: string): Array<{ label: string; value: string }> {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const pairs: Array<{ label: string; value: string }> = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index];
    const inline = line.match(/^([A-Za-z0-9 &/#'().-]{2,50})\s*:\s*(.+)$/);
    if (inline) {
      pairs.push({ label: inline[1].trim(), value: inline[2].trim() });
      continue;
    }
    if (/^[A-Za-z0-9 &/#'().-]{2,50}:?$/.test(line) && !knownLabels.includes(line)) {
      const next = lines[index + 1];
      if (next && !/^[A-Za-z0-9 &/#'().-]{2,50}:?$/.test(next)) {
        pairs.push({ label: line.replace(/:$/, ""), value: next });
      }
    }
  }
  return pairs;
}

function findPattern(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function extractAssetStatement(text: string, labels: string[]): string | null {
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (labels.some((label) => /ff&e|ffe|furniture/i.test(label))) {
    escapedLabels.push("furniture\\s*,?\\s*fixtures\\s*,?\\s*(?:and|&)\\s*equipment");
    const noEquipment = findSentence(text, [/\bno\s+(?:significant\s+)?equipment\b/i, /\bincluded\b/i]);
    if (noEquipment) return noEquipment;
  }
  const labelPattern = new RegExp(`\\b(${escapedLabels.join("|")})\\b`, "i");
  return findSentence(text, [labelPattern, /\b(valued?|includes?|included|excluded|not included|asking price|separately|loan|lien)\b/i]);
}

function findSentence(text: string, patterns: RegExp[]): string | null {
  return splitIntoSentences(text).find((sentence) => patterns.every((pattern) => pattern.test(sentence))) ?? null;
}

function splitIntoSentences(text: string): string[] {
  const normalized = normalizeWhitespace(text).replace(/\n+/g, " ");
  const matches = normalized.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [];
  return matches.map((sentence) => sentence.trim()).filter(Boolean);
}

function sourceStatements(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.length <= 240) return [trimmed];
  const sentences = splitIntoSentences(trimmed);
  return sentences.length > 0 ? sentences : [trimmed];
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

function uniqueSentencesByFingerprint(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

function cleanInlineValue(value: string | null | undefined, currentLabel: string): string | null {
  if (!value) return null;
  let cleaned = value.trim();
  for (const label of knownLabels) {
    if (label.toLowerCase() === currentLabel.toLowerCase()) continue;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = cleaned.match(new RegExp(`\\b${escaped}\\b\\s*:`, "i"));
    if (match?.index && match.index > 0) {
      cleaned = cleaned.slice(0, match.index).trim();
    }
  }
  return cleaned || null;
}

function cleanLocationValue(value: string | null | undefined): string | null {
  if (!value) return null;
  let cleaned = cleanInlineValue(value, "Location") ?? value.trim();
  cleaned = cleaned
    .replace(/^(?:business\s+location\s*:?\s*)+/i, "")
    .replace(/^(?:location\s*:?\s*)+/i, "")
    .trim();
  if (!cleaned || cleaned.length > 120) return null;
  if (/\b(business description|detailed information|asking price|cash flow|gross revenue|annual revenue|ebitda|sde|inventory|ff&e|real estate|employees?|building sf|ad\s*#)\b/i.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function sourceForCorrection(value: string | null | undefined): "seller_claim" | "user_correction" {
  return value?.trim() ? "user_correction" : "seller_claim";
}

function isSafeTitle(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || normalized.length > 120) return false;
  const titleForSentenceCheck = normalized.replace(/\b(Co|Corp|Inc|LLC|Ltd)\./gi, "$1");
  if (splitIntoSentences(titleForSentenceCheck).length > 1) return false;
  if (/\b(business description|detailed information|asking price|cash flow|gross revenue|annual revenue|ebitda|sde|inventory|employees?|building sf|ad\s*#)\b/i.test(normalized)) {
    return false;
  }
  return true;
}

function hasEquipmentLoanLanguage(text: string): boolean {
  return /\bequipment\b/i.test(text) && /\b(loan|lien|payoff|financ)/i.test(text);
}

function excerptFor(text: string, value: string): string[] {
  const cleanValue = value.trim();
  const index = text.toLowerCase().indexOf(cleanValue.toLowerCase());
  if (index === -1) return [cleanValue.slice(0, 500)];
  return [text.slice(Math.max(0, index - 80), Math.min(text.length, index + cleanValue.length + 120)).trim()];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sourceFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

function firstValue(...values: Array<string | null | undefined>): string | null {
  return values.find((value): value is string => Boolean(value?.trim()))?.trim() ?? null;
}

function formatPlainMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}
