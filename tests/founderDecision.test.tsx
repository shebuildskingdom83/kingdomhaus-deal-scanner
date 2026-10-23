// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { ResultsScreen } from "../src/App";
import { createCashFlowAssumptions } from "../src/acquisitionCashFlow";
import { createFounderDecision, founderDecisionLabel, founderDecisionOf, type FounderDecision } from "../src/founderDecision";
import { buildLocalPreviewScan } from "../src/validation";
import { AcquisitionRepository, formFromScan, makeRecord, parseBackup, serializeBackup } from "../src/storage";
import { buildCurrentAcquisitionCsv, buildSavedAcquisitionsCsv } from "../src/csv";
import { buildReportLines } from "../src/pdf";
import { validateRecord } from "../src/recordValidation";

const scan = () => buildLocalPreviewScan({ listingText: "Synthetic workshop for sale. Asking Price: $200,000. Gross Revenue: $350,000." });
const state = () => { const value = scan(); return { scan: value, form: formFromScan(value), cashFlow: createCashFlowAssumptions() }; };
const decision: FounderDecision = { decision: "Hold", rationale: "Verify seller revenue first.", nextDiligenceAction: "Request tax returns." };
function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

afterEach(cleanup);

describe("Founder Decision in synthetic acquisitions", () => {
  it("shows an unset decision separately from the scanner recommendation and edits all three fields", () => {
    const value = scan();
    function Report() {
      const [founderDecision, setFounderDecision] = useState(createFounderDecision);
      return <ResultsScreen scan={value} form={formFromScan(value)} message={null} errors={[]} isLoading={false} isFetchingUrl={false}
        onBack={() => {}} onDownload={() => {}} onFieldChange={() => {}} onRefresh={() => {}} onScanFromUrl={() => {}}
        founderDecision={founderDecision} onFounderDecisionChange={setFounderDecision} />;
    }
    render(<Report />);
    expect(screen.getByText("Preliminary recommendation")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Acquisition Decision" })).toBeTruthy();
    expect(screen.queryByText("Founder assessment")).toBeNull();
    expect(screen.queryByText("Separate from the preliminary recommendation. Scanner updates will not change your decision.")).toBeNull();
    const fields = document.querySelector(".founder-decision-fields")!;
    expect(fields.querySelectorAll("label")).toHaveLength(3);
    expect(fields.querySelector("label:first-child select")).toBeTruthy();
    expect(fields.querySelector("label:first-child .sr-only")?.textContent).toBe("Decision");
    expect(fields.querySelectorAll("label:not(:first-child) textarea")).toHaveLength(2);
    const indicator = screen.getByRole("img", { name: "Acquisition decision: Undecided" });
    expect(indicator.getAttribute("data-decision")).toBe("Undecided");
    expect(indicator.getAttribute("title")).toBe("Undecided");
    expect(document.querySelector(".founder-decision-status")?.textContent).toBe("");
    expect((screen.getByLabelText("Decision") as HTMLSelectElement).selectedOptions[0].text).toBe("Undecided");
    expect(screen.getByLabelText(/Reason for Decision/).getAttribute("placeholder")).toBe("Optional");
    expect(screen.getByLabelText(/Next Step/).getAttribute("placeholder")).toBe("Optional");
    fireEvent.change(screen.getByLabelText("Decision"), { target: { value: "Hold" } });
    fireEvent.change(screen.getByLabelText(/Reason for Decision/), { target: { value: decision.rationale } });
    fireEvent.change(screen.getByLabelText(/Next Step/), { target: { value: decision.nextDiligenceAction } });
    expect(screen.getByRole("img", { name: "Acquisition decision: Hold" }).getAttribute("data-decision")).toBe("Hold");
    for (const choice of ["Pursue", "Pass", "Continue Reviewing", ""] as const) {
      fireEvent.change(screen.getByLabelText("Decision"), { target: { value: choice } });
      const label = choice === "Continue Reviewing" ? "Reviewing" : choice || "Undecided";
      const dot = screen.getByRole("img", { name: `Acquisition decision: ${label}` });
      expect(dot.getAttribute("data-decision")).toBe(choice || "Undecided");
      expect(dot.getAttribute("title")).toBe(label);
      expect((screen.getByLabelText("Decision") as HTMLSelectElement).selectedOptions[0].text).toBe(label);
    }
    expect((screen.getByLabelText(/Reason for Decision/) as HTMLTextAreaElement).value).toBe(decision.rationale);
    expect(value.decision.recommendation).not.toBe("Hold");
  });

  it("preserves edits through save, reopen, draft recovery, revision updates, and JSON backup", () => {
    const store = memory(); const repository = new AcquisitionRepository(() => store); repository.load();
    const original = makeRecord({ ...state(), founderDecision: decision });
    repository.save(original, null);
    const reopened = new AcquisitionRepository(() => store).load().records[0];
    expect(reopened.state.founderDecision).toEqual(decision);
    const draft = { recordId: reopened.id, recordRevision: reopened.revision, state: { ...reopened.state, founderDecision: { ...decision, decision: "Pursue" as const } } };
    repository.recover(draft);
    expect(new AcquisitionRepository(() => store).load().draft?.state.founderDecision?.decision).toBe("Pursue");
    expect(repository.load().records[0].state.founderDecision?.decision).toBe("Hold");
    const revised = makeRecord(draft.state, undefined, reopened);
    repository.save(revised, reopened.revision, true);
    expect(revised.revision).toBe(reopened.revision + 1);
    expect(parseBackup(serializeBackup(revised)).state.founderDecision).toEqual(draft.state.founderDecision);
    expect(revised.state.scan.decision).toEqual(original.state.scan.decision);
  });

  it("opens historical records and backups as Not Yet Decided without changing revisions", () => {
    const record = makeRecord(state());
    const old = structuredClone(record); delete old.state.founderDecision;
    const restored = validateRecord(old);
    expect(restored.state.founderDecision).toBeUndefined();
    expect(founderDecisionOf(restored.state.founderDecision)).toEqual(createFounderDecision());
    expect(restored.revision).toBe(record.revision);
    const backup = JSON.parse(serializeBackup(record)); delete backup.record.state.founderDecision;
    expect(founderDecisionLabel(parseBackup(JSON.stringify(backup)).state.founderDecision)).toBe("Not Yet Decided");
    expect(buildSavedAcquisitionsCsv([old])).toContain("Not Yet Decided");
  });

  it("includes the decision in current and saved CSV and PDF while protecting spreadsheet cells", () => {
    const record = makeRecord({ ...state(), founderDecision: { ...decision, rationale: "=HYPERLINK(\"unsafe\")" } });
    const current = buildCurrentAcquisitionCsv(record.state.scan, record.state.cashFlow, record.state.founderDecision);
    const saved = buildSavedAcquisitionsCsv([record]);
    const pdf = buildReportLines(record.state.scan, record.state.cashFlow, record.state.founderDecision).join("\n");
    for (const csv of [current, saved]) {
      expect(csv).toContain("Founder Decision"); expect(csv).toContain('"Hold"');
      expect(csv).toContain("Next diligence action"); expect(csv).toContain("Request tax returns.");
      expect(csv).toContain("'=HYPERLINK");
    }
    expect(pdf).toContain("Founder Decision: Hold");
    expect(pdf).toContain("Next diligence action: Request tax returns.");
    expect(pdf.indexOf("Founder Decision: Hold")).toBeLessThan(pdf.indexOf("2. Financial Snapshot"));
  });

  it("rejects malformed decisions and oversized notes during backup validation", () => {
    const record = makeRecord(state());
    for (const bad of [
      { decision: "Approved", rationale: "", nextDiligenceAction: "" },
      { decision: null, rationale: "x".repeat(4001), nextDiligenceAction: "" },
      { ...createFounderDecision(), uid: "other-account" }
    ]) {
      expect(() => validateRecord({ ...record, state: { ...record.state, founderDecision: bad } })).toThrow();
    }
  });
});
