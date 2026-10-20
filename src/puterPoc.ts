import type { DealScan } from "./types";

export const PUTER_POC_MODEL = "openai/gpt-5-nano";

export type PuterDealClaritySummary = {
  strategicFit: string;
  attractiveCharacteristics: string;
  sellerDependence: string;
  equipmentContinuity: string;
  financialQuestions: string;
  majorRisks: string;
};

export type PuterPocResult = {
  summary: PuterDealClaritySummary;
  model: string;
  rawText: string;
};

export class PuterResponseFormatError extends Error {
  rawText: string;
  responseKind: string;

  constructor(message: string, rawText: string, responseKind = "unknown") {
    super(message);
    this.name = "PuterResponseFormatError";
    this.rawText = rawText;
    this.responseKind = responseKind;
  }
}

type PuterApi = {
  auth?: {
    isSignedIn?: () => boolean | Promise<boolean>;
    signIn?: () => Promise<unknown>;
  };
  ai?: {
    chat?: (prompt: string, options: Record<string, unknown>) => Promise<unknown>;
  };
};

declare global {
  interface Window {
    puter?: PuterApi;
  }
}

const PUTER_SCRIPT_ID = "puter-js-sdk";
const PUTER_SCRIPT_SRC = "https://js.puter.com/v2/";

export async function runPuterDealClarityPoc(scan: DealScan): Promise<PuterPocResult> {
  await loadPuterScript();

  const puter = window.puter;
  if (!puter?.ai?.chat) {
    throw new Error("Puter.js loaded, but the AI chat API is not available.");
  }

  const isSignedIn = await puter.auth?.isSignedIn?.();
  if (!isSignedIn) {
    if (!puter.auth?.signIn) {
      throw new Error("Puter sign-in is required, but the sign-in API is not available.");
    }
    await puter.auth.signIn();
  }

  const response = await puter.ai.chat(buildPuterPrompt(scan), {
    model: PUTER_POC_MODEL,
    normalize: true,
    stream: false,
    max_tokens: 900,
    reasoning_effort: "none",
    verbosity: "low",
    outputFormat: {
      type: "json_schema",
      name: "deal_clarity_summary",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: [
          "strategicFit",
          "attractiveCharacteristics",
          "sellerDependence",
          "equipmentContinuity",
          "financialQuestions",
          "majorRisks"
        ],
        properties: {
          strategicFit: { type: "string" },
          attractiveCharacteristics: { type: "string" },
          sellerDependence: { type: "string" },
          equipmentContinuity: { type: "string" },
          financialQuestions: { type: "string" },
          majorRisks: { type: "string" }
        }
      }
    }
  });

  const extracted = extractPuterTextDetails(response);
  if (!extracted.text.trim()) {
    throw new PuterResponseFormatError(
      "Puter returned no text content. This can happen after a sign-in interruption, a tool-only response, or an empty model response.",
      extracted.raw,
      extracted.responseKind
    );
  }

  const rawText = extracted.text;
  return {
    summary: parsePuterSummaryFromText(rawText, extracted.responseKind),
    model: PUTER_POC_MODEL,
    rawText
  };
}

export function parsePuterSummaryFromText(text: string, responseKind = "text"): PuterDealClaritySummary {
  const parsed = parseSummaryJson(text, responseKind);
  const source =
    parsed && typeof parsed === "object" && "summary" in parsed && typeof parsed.summary === "object" && parsed.summary
      ? (parsed.summary as Partial<Record<keyof PuterDealClaritySummary, unknown>>)
      : (parsed as Partial<Record<keyof PuterDealClaritySummary, unknown>>);
  const fields: Array<keyof PuterDealClaritySummary> = [
    "strategicFit",
    "attractiveCharacteristics",
    "sellerDependence",
    "equipmentContinuity",
    "financialQuestions",
    "majorRisks"
  ];

  const summary = Object.fromEntries(
    fields.map((field) => {
      const value = source[field];
      return [field, typeof value === "string" && value.trim() ? value.trim() : "Not addressed by the analysis response."];
    })
  ) as PuterDealClaritySummary;

  return summary;
}

export function extractPuterText(response: unknown): string {
  return extractPuterTextDetails(response).text;
}

export function extractPuterTextDetails(response: unknown): { text: string; raw: string; responseKind: string } {
  if (typeof response === "string") {
    return { text: response, raw: response, responseKind: "string" };
  }

  if (!response || typeof response !== "object") {
    return { text: "", raw: String(response), responseKind: "empty" };
  }

  const record = response as Record<string, unknown>;
  const message = record.message;
  if (message && typeof message === "object") {
    const content = (message as Record<string, unknown>).content;
    if (typeof content === "string") {
      return { text: content, raw: JSON.stringify(response), responseKind: "message.content:string" };
    }
    if (content === null) {
      const toolCalls = (message as Record<string, unknown>).tool_calls;
      return {
        text: "",
        raw: JSON.stringify(response),
        responseKind: Array.isArray(toolCalls) && toolCalls.length > 0 ? "message.content:null+tool_calls" : "message.content:null"
      };
    }
    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          if (part && typeof part === "object") {
            const text = (part as Record<string, unknown>).text;
            return typeof text === "string" ? text : "";
          }
          return "";
        })
        .join("\n")
        .trim();
      return { text, raw: JSON.stringify(response), responseKind: "message.content:array" };
    }
  }

  const outputText = record.output_text;
  if (typeof outputText === "string") {
    return { text: outputText, raw: JSON.stringify(response), responseKind: "output_text:string" };
  }

  const output = record.output;
  if (Array.isArray(output)) {
    const text = output
      .flatMap((item) => {
        if (!item || typeof item !== "object") {
          return [];
        }
        const content = (item as Record<string, unknown>).content;
        if (!Array.isArray(content)) {
          return [];
        }
        return content.map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }
          const partRecord = part as Record<string, unknown>;
          return typeof partRecord.text === "string" ? partRecord.text : "";
        });
      })
      .join("\n")
      .trim();
    return { text, raw: JSON.stringify(response), responseKind: "output:array" };
  }

  const text = record.text ?? record.content;
  return {
    text: typeof text === "string" ? text : JSON.stringify(response),
    raw: JSON.stringify(response),
    responseKind: typeof text === "string" ? "text:string" : "object"
  };
}

export function buildPuterPrompt(scan: DealScan): string {
  const payload = {
    listingTitle: scan.businessDetails.listingTitle.value,
    businessName: scan.overview.businessName.value,
    source: scan.businessDetails.source.value,
    url: scan.businessDetails.url.value ?? scan.listingUrl,
    adNumber: scan.businessDetails.adNumber.value,
    industry: scan.overview.industry.value,
    location: scan.overview.location.value,
    description: scan.businessDetails.fullDescription.value,
    facilities: scan.businessDetails.facilities.value,
    competition: scan.businessDetails.competition.value,
    growthOpportunities: scan.businessDetails.growthOpportunities.value,
    financing: scan.businessDetails.financing.value,
    sellerSupportTraining: scan.businessDetails.sellerSupportTraining.value,
    reasonForSelling: scan.businessDetails.reasonForSelling.value,
    brokerInformation: scan.businessDetails.brokerInformation.value,
    financials: {
      askingPrice: scan.financials.askingPrice.amount,
      businessAskingPrice: scan.financials.businessAskingPrice.amount,
      grossAnnualRevenue: scan.financials.annualRevenue.amount,
      sde: scan.financials.sde.amount,
      ebitda: scan.financials.ebitda.amount,
      advertisedCashFlow: scan.financials.advertisedCashFlow.amount,
      inventory: {
        value: scan.financials.inventory.value.amount,
        includedStatus: scan.financials.inventory.includedStatus
      },
      ffe: {
        value: scan.financials.ffe.value.amount,
        includedStatus: scan.financials.ffe.includedStatus
      },
      realEstate: {
        value: scan.financials.realEstate.value.amount,
        includedStatus: scan.financials.realEstate.includedStatus,
        ownership: scan.financials.realEstate.ownership.value,
        buildingSize: scan.financials.realEstate.buildingSize.value
      },
      knownAdditionalAcquisitionCosts: scan.financials.knownAdditionalAcquisitionCosts.amount
    },
    ratios: scan.ratios,
    additionalDetails: scan.businessDetails.additionalDetails,
    deterministicCalculations: scan.calculations,
    completeListingText: scan.listingText
  };

  return [
    "You are producing an experimental acquisition screening summary for KingdomHaus.",
    "Use only the supplied listing facts and deterministic calculations.",
    "Do not recalculate financial multiples.",
    "Return only valid JSON with exactly these string keys: strategicFit, attractiveCharacteristics, sellerDependence, equipmentContinuity, financialQuestions, majorRisks.",
    "",
    JSON.stringify(payload)
  ].join("\n");
}

function parseSummaryJson(text: string, responseKind: string): Record<string, unknown> {
  const candidate = extractJsonObject(text, responseKind);
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    throw new PuterResponseFormatError("Puter returned text that looked like JSON but could not be parsed.", text, responseKind);
  }
}

function extractJsonObject(text: string, responseKind: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1]?.trim() ?? trimmed;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new PuterResponseFormatError(
      "Puter returned text, but it did not include the required JSON summary. Try again after this parser update.",
      text,
      responseKind
    );
  }

  return source.slice(start, end + 1);
}

function loadPuterScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Puter.js can only run in the browser."));
  }

  if (window.puter) {
    return Promise.resolve();
  }

  const existing = document.getElementById(PUTER_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Puter.js failed to load.")), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = PUTER_SCRIPT_ID;
    script.src = PUTER_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Puter.js failed to load."));
    document.head.appendChild(script);
  });
}
