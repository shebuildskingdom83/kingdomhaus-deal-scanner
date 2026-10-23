// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultsScreen } from "../src/App";
import type { AcquisitionState, KhdaAnalysis } from "../src/acquisitionRecord";
import { createCashFlowAssumptions } from "../src/acquisitionCashFlow";
import { draftPayload, recordPayload } from "../src/cloudPersistence";
import { portfolioOverview } from "../src/portfolioOverview";
import { validateRecord } from "../src/recordValidation";
import { AcquisitionRepository, formFromScan, makeRecord, parseBackup, serializeBackup } from "../src/storage";
import { buildLocalPreviewScan } from "../src/validation";

const provider = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../src/puterPoc", async importOriginal => ({
  ...(await importOriginal<typeof import("../src/puterPoc")>()), runPuterDealClarityPoc: provider.run
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const summary = { strategicFit: "Synthetic strategic fit", attractiveCharacteristics: "Synthetic strengths",
  sellerDependence: "Synthetic seller dependence", equipmentContinuity: "Synthetic equipment",
  financialQuestions: "Synthetic questions", majorRisks: "Synthetic risks" };
const scan = () => buildLocalPreviewScan({ listingText: "Synthetic workshop listing with asking price $200,000 and annual revenue $350,000." });
const state = (): AcquisitionState => { const value = scan(); return { scan: value, form: formFromScan(value), cashFlow: createCashFlowAssumptions() }; };
function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
function report(initial: AcquisitionState) {
  let current = initial;
  function Harness() {
    const [work, setWork] = useState(initial);
    current = work;
    return <ResultsScreen key={work.scan!.id} scan={work.scan!} form={work.form} message={null} errors={[]}
      isLoading={false} isFetchingUrl={false} onBack={() => {}} onDownload={() => {}}
      onFieldChange={() => {}} onRefresh={() => {}} onScanFromUrl={() => {}}
      khdaAnalysis={work.khdaAnalysis} onKhdaAnalysisChange={value => setWork(previous => ({ ...previous, khdaAnalysis: value }))} />;
  }
  render(<Harness />);
  return { current: () => current };
}
function start() {
  fireEvent.click(screen.getByRole("button", { name: /Analyze Deal/ }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm and analyze" }));
}

describe("KHDA result tracking with synthetic acquisitions", () => {
  it("keeps a completed result unsaved until record save, then restores it from the record and JSON backup", async () => {
    provider.run.mockResolvedValueOnce({ summary, model: "synthetic-model", rawText: "raw provider response must not persist" });
    const view = report(state());
    start();
    await screen.findByText(summary.strategicFit);
    const completed = view.current().khdaAnalysis!;
    expect(completed.sourceScanId).toBe(view.current().scan!.id);
    expect(completed.summary).toEqual(summary);
    expect(JSON.stringify(completed)).not.toContain("raw provider response");
    expect(portfolioOverview([]).khdaAnalyses).toBe(0);

    const store = memory(), repository = new AcquisitionRepository(() => store);
    repository.load();
    const record = makeRecord(view.current());
    const draft = { recordId: null, recordRevision: null, state: view.current() };
    repository.recover(draft);
    expect(new AcquisitionRepository(() => store).load().draft?.state.khdaAnalysis).toEqual(completed);
    expect(JSON.parse(draftPayload(draft)).state.khdaAnalysis).toEqual(completed);
    expect(portfolioOverview(repository.load().records).khdaAnalyses).toBe(0);
    repository.save(record, null);
    const reopened = new AcquisitionRepository(() => store).load().records[0];
    expect(reopened.state.khdaAnalysis).toEqual(completed);
    expect(JSON.parse(recordPayload(reopened)).state.khdaAnalysis).toEqual(completed);
    expect(portfolioOverview([reopened]).khdaAnalyses).toBe(1);
    expect(parseBackup(serializeBackup(reopened)).state.khdaAnalysis).toEqual(completed);
    expect(serializeBackup(reopened)).not.toContain("raw provider response");

    const revision = makeRecord({ ...reopened.state, khdaAnalysis: { ...completed, completedAt: "2026-10-23T13:00:00.000Z" } }, undefined, reopened);
    repository.save(revision, reopened.revision, true);
    expect(portfolioOverview(new AcquisitionRepository(() => store).load().records).khdaAnalyses).toBe(1);
    const staleRevision = makeRecord(reopened.state, undefined, reopened);
    expect(() => repository.save(staleRevision, reopened.revision, true)).toThrow();
    expect(portfolioOverview(new AcquisitionRepository(() => store).load().records).khdaAnalyses).toBe(1);
  });

  it("does not attach failed or canceled runs, and labels a result from a replaced scan as earlier work", async () => {
    const initial = state();
    const view = report(initial);
    fireEvent.click(screen.getByRole("button", { name: /Analyze Deal/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(provider.run).not.toHaveBeenCalled();
    provider.run.mockRejectedValueOnce(new Error("Synthetic provider failure"));
    start();
    await screen.findByText("Analysis did not complete");
    expect(view.current().khdaAnalysis).toBeUndefined();
    expect(portfolioOverview([makeRecord(view.current())]).khdaAnalyses).toBe(0);

    const completed: KhdaAnalysis = { summary, completedAt: "2026-10-23T12:00:00.000Z", model: "synthetic-model", sourceScanId: initial.scan!.id };
    cleanup();
    const changed = scan();
    report({ ...initial, scan: changed, khdaAnalysis: completed });
    expect(screen.getByText("Earlier KHDA analysis — source scan changed; not current")).toBeTruthy();
    expect(screen.queryByText("KHDA analysis — preliminary, unverified AI findings")).toBeNull();
    expect(screen.getByText(summary.strategicFit)).toBeTruthy();
  });

  it("accepts historical records without KHDA and rejects malformed or oversized result fields", () => {
    const historical = makeRecord(state());
    expect(validateRecord(historical).state.khdaAnalysis).toBeUndefined();
    expect(portfolioOverview([historical]).khdaAnalyses).toBe(0);
    const completed: KhdaAnalysis = { summary, completedAt: "2026-10-23T12:00:00.000Z", model: "synthetic-model", sourceScanId: historical.state.scan.id };
    expect(validateRecord({ ...historical, state: { ...historical.state, khdaAnalysis: completed } }).state.khdaAnalysis).toEqual(completed);
    for (const invalid of [{ ...completed, summary: { ...summary, majorRisks: "x".repeat(2001) } },
      { ...completed, summary: { ...summary, majorRisks: "" } },
      { ...completed, rawText: "unexpected provider data" }]) {
      expect(() => validateRecord({ ...historical, state: { ...historical.state, khdaAnalysis: invalid } })).toThrow();
    }
  });
});
