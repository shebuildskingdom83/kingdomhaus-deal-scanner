import { describe, expect, it } from "vitest";
import {
  buildPuterPrompt,
  extractPuterText,
  extractPuterTextDetails,
  parsePuterSummaryFromText,
  PuterResponseFormatError
} from "../src/puterPoc";
import { buildLocalPreviewScan } from "../src/validation";
import { bizBuySell2517190Fixture, bizBuySell2517190Url } from "./fixtures";

describe("Puter POC helpers", () => {
  it("parses a fenced structured deal clarity summary", () => {
    const summary = parsePuterSummaryFromText(`
      Here is the summary:
      \`\`\`json
      {
        "strategicFit": "Specialized printing and packaging may fit a services platform.",
        "attractiveCharacteristics": "Long operating history, disclosed cash flow, and included FF&E are attractive.",
        "sellerDependence": "Seller dependence needs diligence because training is offered but owner role is unclear.",
        "equipmentContinuity": "Included FF&E supports continuity, but equipment age should be verified.",
        "financialQuestions": "Confirm SDE, inventory treatment, real estate terms, and quality of earnings.",
        "majorRisks": "Real estate and inventory are excluded, increasing acquisition capital needs."
      }
      \`\`\`
    `);

    expect(summary.financialQuestions).toContain("inventory treatment");
    expect(summary.majorRisks).toContain("excluded");
  });

  it("extracts text from a normalized Puter message response", () => {
    const text = extractPuterText({
      message: {
        content: [
          { type: "text", text: "{\"strategicFit\":\"Test\"" },
          { type: "text", text: "}" }
        ]
      }
    });

    expect(text).toBe("{\"strategicFit\":\"Test\"\n}");
  });

  it("parses a nested summary object without inventing missing fields", () => {
    const summary = parsePuterSummaryFromText(
      JSON.stringify({
        summary: {
          strategicFit: "Known fit statement.",
          attractiveCharacteristics: "Known attractive statement."
        }
      })
    );

    expect(summary.strategicFit).toBe("Known fit statement.");
    expect(summary.attractiveCharacteristics).toBe("Known attractive statement.");
    expect(summary.sellerDependence).toBe("Not addressed by Puter response.");
  });

  it("classifies normalized empty text responses", () => {
    const extracted = extractPuterTextDetails({
      normalized: true,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1" }]
      }
    });

    expect(extracted.text).toBe("");
    expect(extracted.responseKind).toBe("message.content:null+tool_calls");
  });

  it("extracts text from OpenAI responses-style output arrays", () => {
    const text = extractPuterText({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: "{\"strategicFit\":\"From output array\"}"
            }
          ]
        }
      ]
    });

    expect(text).toBe("{\"strategicFit\":\"From output array\"}");
  });

  it("throws a diagnostic error for natural-language responses without JSON", () => {
    expect(() => parsePuterSummaryFromText("Strategic fit looks plausible, but diligence is needed.", "message.content:string")).toThrow(
      PuterResponseFormatError
    );

    try {
      parsePuterSummaryFromText("Strategic fit looks plausible, but diligence is needed.", "message.content:string");
    } catch (error) {
      expect(error).toBeInstanceOf(PuterResponseFormatError);
      expect((error as PuterResponseFormatError).responseKind).toBe("message.content:string");
      expect((error as PuterResponseFormatError).rawText).toContain("Strategic fit");
    }
  });

  it("builds Puter input from corrected normalized listing data", () => {
    const scan = buildLocalPreviewScan({
      listingUrl: bizBuySell2517190Url,
      listingText: bizBuySell2517190Fixture
    });
    const prompt = buildPuterPrompt(scan);
    const payload = JSON.parse(prompt.match(/\{[\s\S]*\}$/)?.[0] ?? "{}") as {
      financials: {
        sde: number | null;
        advertisedCashFlow: number | null;
        inventory: { value: number | null; includedStatus: string };
        ffe: { value: number | null; includedStatus: string };
        realEstate: { value: number | null; includedStatus: string };
      };
      ratios: {
        askingPriceToSde: number | null;
        businessAskingPriceToSde: number | null;
        sdeToRevenue: number | null;
      };
      description: string | null;
    };

    expect(payload.financials.sde).toBe(227261);
    expect(payload.financials.advertisedCashFlow).toBe(227261);
    expect(payload.financials.inventory).toEqual({ value: null, includedStatus: "included" });
    expect(payload.financials.ffe).toEqual({ value: null, includedStatus: "included" });
    expect(payload.financials.realEstate).toMatchObject({ value: 675000, includedStatus: "included" });
    expect(payload.ratios.businessAskingPriceToSde).toBe(2.49);
    expect(payload.ratios.askingPriceToSde).toBe(5.46);
    expect(payload.ratios.sdeToRevenue).toBe(0.2932);
    expect(payload.description).not.toMatch(/PRICE INCLUDES BUSINESS & REAL ESTATE/i);
  });
});
