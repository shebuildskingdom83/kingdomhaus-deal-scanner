import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiligenceDetails, ResultsScreen, type FormState } from "../src/App";
import type { RiskCheck } from "../src/types";
import { buildLocalPreviewScan } from "../src/validation";
import { syntheticManufacturingFixture } from "./fixtures";

describe("compact diligence presentation", () => {
  it("counts active rows, starts collapsed, and stably prioritizes without mutating findings", () => {
    const rows: RiskCheck[] = [
      { label: "Clear finding", status: "clear", explanation: "Retained clear detail", excerpts: [] },
      { label: "Unknown finding", status: "unknown", explanation: "Retained unknown detail", excerpts: [] },
      { label: "Watch finding", status: "watch", explanation: "Retained watch detail", excerpts: [] },
      { label: "Franchise finding", status: "unknown", explanation: "Retained franchise detail", excerpts: [], requiresVerification: true, verificationItems: ["Review transfer terms", "Check renewal conditions"] }
    ];
    const before = JSON.stringify(rows);
    const html = renderToStaticMarkup(<DiligenceDetails rows={rows} />);
    expect(html).toContain('<details class="diligence-details"><summary>View diligence details');
    expect(html).toContain('<dt>Total checks</dt><dd>4</dd>');
    expect(html).toContain('<dt>Watch</dt><dd>1</dd>');
    expect(html).toContain('<dt>Unknown / missing information</dt><dd>2</dd>');
    expect(html.indexOf('Watch finding')).toBeLessThan(html.indexOf('Unknown finding'));
    expect(html.indexOf('Unknown finding')).toBeLessThan(html.indexOf('Franchise finding'));
    expect(html.indexOf('Franchise finding')).toBeLessThan(html.indexOf('Clear finding'));
    for (const row of rows) expect(html).toContain(row.explanation);
    expect(html).toContain('Review transfer terms');
    expect(html).toContain('Check renewal conditions');
    expect(html).toContain('Requires Verification');
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("derives zero counts and different acquisition totals without example defaults", () => {
    const empty = renderToStaticMarkup(<DiligenceDetails rows={[]} />);
    expect(empty).toContain('<dt>Total checks</dt><dd>0</dd>');
    expect(empty).toContain('<dt>Watch</dt><dd>0</dd>');
    expect(empty).toContain('<dt>Unknown / missing information</dt><dd>0</dd>');
    const html = renderToStaticMarkup(<DiligenceDetails rows={[
      { label: "One", status: "watch", explanation: "First" },
      { label: "Two", status: "watch", explanation: "Second" }
    ]} />);
    expect(html).toContain('<dt>Total checks</dt><dd>2</dd>');
    expect(html).toContain('<dt>Watch</dt><dd>2</dd>');
    expect(html).toContain('<dt>Unknown / missing information</dt><dd>0</dd>');
  });

  it("renders KHDA above the unchanged opt-in button and counts the final report rows", () => {
    const scan = buildLocalPreviewScan({ listingText: syntheticManufacturingFixture });
    const before = JSON.stringify(scan);
    const form: FormState = { businessName: "", listingUrl: "", listingText: syntheticManufacturingFixture,
      askingPrice: "", businessAskingPrice: "", annualRevenue: "", sde: "", ebitda: "", advertisedCashFlow: "", inventory: "", ffe: "", realEstate: "" };
    const html = renderToStaticMarkup(<ResultsScreen scan={scan} form={form} message={null} errors={[]}
      isLoading={false} isFetchingUrl={false} onBack={() => undefined} onDownload={() => undefined}
      onFieldChange={() => undefined} onRefresh={() => undefined} onScanFromUrl={() => undefined} />);
    expect(html).toContain('KingdomHaus Deal Analyzer');
    expect(html).toContain('Export Deal CSV');
    expect(html).toContain('A deeper look at the opportunity.');
    expect(html).toContain('The Deal Analyzer helps connect disclosed financial information, ownership responsibilities, operating dependencies, and diligence questions behind a listing. It provides an additional analytical perspective beyond the initial rule-based screen.');
    expect(html.indexOf('class="khda-introduction"')).toBeLessThan(html.indexOf('class="primary-action intelligence-action"'));
    expect(html).toContain('KingdomHaus Intelligence™ — Analyze Deal');
    const details = html.match(/<details class="diligence-details">([\s\S]*?)<\/details>/)![1];
    const total = Number(html.match(/<dt>Total checks<\/dt><dd>(\d+)<\/dd>/)![1]);
    const watch = Number(html.match(/<dt>Watch<\/dt><dd>(\d+)<\/dd>/)![1]);
    const unknown = Number(html.match(/<dt>Unknown \/ missing information<\/dt><dd>(\d+)<\/dd>/)![1]);
    expect(total).toBe((details.match(/class="risk-row"/g) ?? []).length);
    expect(watch).toBe((details.match(/class="risk-status watch"/g) ?? []).length);
    expect(unknown).toBe((details.match(/class="risk-status unknown"/g) ?? []).length);
    expect(html).toContain('$227,261');
    expect(html).toContain('29.32%');
    expect(JSON.stringify(scan)).toBe(before);
  });
});
