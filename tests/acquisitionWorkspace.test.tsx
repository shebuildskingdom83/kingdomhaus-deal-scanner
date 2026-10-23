// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcquisitionWorkspace } from "../src/AcquisitionWorkspace";
import { initialForm } from "../src/App";
import { useCloudAcquisitionRecovery } from "../src/useCloudAcquisitionRecovery";
import type { CloudDraft, CloudRepository } from "../src/cloudPersistence";
import type { RecoveryControls } from "../src/useAcquisitionRecovery";
import { syntheticLibrary } from "./syntheticSavedLibrary";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function fixture(count = 2, recovered = true, aiAssistedScan = false) {
  const records = syntheticLibrary(count);
  for (const record of records) {
    if (aiAssistedScan) { record.state.scan.analysisMode = "ai"; record.state.scan.model = "synthetic-extraction-model"; }
    record.state.cashFlow.debtService = "12345";
    record.state.cashFlow.payrollSavings = "2345";
    record.state.scan.retrieval = {
      provider: "apify", actorId: "synthetic-only", retrievedAt: record.createdAt,
      sourceUrl: "https://example.test/listing", usageUsd: null, maxChargeUsd: 0,
      rawRecord: {}, conflicts: ["Synthetic evidence requires review"],
      photographs: [{ url: "https://example.test/photo.jpg", sourceUrl: "https://example.test/listing", attribution: "Synthetic fixture" }]
    };
  }
  let draft: CloudDraft = { revision: 7, value: recovered && count ? {
    recordId: records[0].id, recordRevision: records[0].revision,
    state: { ...structuredClone(records[0].state), form: { ...records[0].state.form, businessName: "Synthetic recovered edits" } }
  } : null };
  const originalRecords = structuredClone(records);
  const originalDraft = structuredClone(draft);
  const repo: CloudRepository = {
    list: vi.fn(async () => structuredClone(records)),
    get: vi.fn(async id => structuredClone(records.find(record => record.id === id)!)),
    save: vi.fn(async () => {}), remove: vi.fn(async () => {}),
    loadDraft: vi.fn(async () => structuredClone(draft)),
    saveDraft: vi.fn(async (value, revision) => { draft = { value: structuredClone(value), revision: revision + 1 }; return draft.revision; })
  };
  let controls: RecoveryControls;
  function Harness() {
    controls = useCloudAcquisitionRecovery(repo, initialForm);
    return controls.cloud?.ready ? <AcquisitionWorkspace recovery={controls} /> : <p>Loading synthetic workspace</p>;
  }
  render(<Harness />);
  return { repo, records, originalRecords, originalDraft, draft: () => draft, controls: () => controls };
}
const home = () => screen.getByRole("heading", { name: "Acquisition Portfolio" });
const open = () => fireEvent.click(screen.getAllByRole("button", { name: /^View Analysis/ })[0]);
const confirm = () => fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
async function loaded() { await screen.findByRole("heading", { name: "Acquisition Portfolio" }); }

describe("Acquisition Workspace with a synthetic cloud repository", () => {
  it("does not mistake persisted AI-assisted scan provenance for completed KHDA runs", async () => {
    const t = fixture(1, false, true); await loaded();
    const metric = screen.getByText("KHDA Analyses").closest(".portfolio-metric")!;
    expect(within(metric as HTMLElement).getByText("Not tracked")).toBeTruthy();
    expect(t.records).toEqual(t.originalRecords); expect(t.repo.save).not.toHaveBeenCalled(); expect(t.repo.saveDraft).not.toHaveBeenCalled();
  });
  it.each([0, 3])("shows an honest KHDA fallback alongside unchanged portfolio totals (saved=%s)", async count => {
    const t = fixture(count, false); await loaded();
    const overview = screen.getByRole("region", { name: "Portfolio overview" });
    const metrics = overview.querySelectorAll(".portfolio-metric");
    expect(metrics).toHaveLength(3);
    expect(metrics[0].querySelector("dd")!.textContent).toBe(String(count));
    expect(metrics[1].querySelector("dd")!.textContent).toBe(count ? "$369,000" : "Not Disclosed");
    expect(metrics[2].querySelector("dt")!.textContent).toBe("KHDA Analyses");
    expect(metrics[2].querySelector("dd")!.textContent).toBe("Not tracked");
    expect(metrics[2].textContent).toContain("Completed AI analyses");
    expect(t.records).toEqual(t.originalRecords); expect(t.repo.save).not.toHaveBeenCalled(); expect(t.repo.saveDraft).not.toHaveBeenCalled();
  });
  it("lands on home with explicit analysis actions and preserves the recovered draft without writes", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const cloud = fixture(); await loaded();
    await waitFor(() => expect(document.activeElement).toBe(home()));
    expect(home().getAttribute("tabindex")).toBe("-1");
    expect(focus).toHaveBeenCalledWith({ preventScroll: true, focusVisible: false });
    expect(screen.getAllByRole("button", { name: /^View Analysis/ })).toHaveLength(2);
    const overview = screen.getByRole("region", { name: "Portfolio overview" });
    expect(within(overview).getByText("2")).toBeTruthy();
    expect(within(overview).getAllByRole("term")).toHaveLength(3);
    expect(within(overview).getByText("$246,000")).toBeTruthy();
    expect(screen.queryByText("Active Analysis")).toBeNull();
    expect(screen.queryByText("Ready to continue")).toBeNull();
    expect(screen.queryByText("Pick up your analysis where you left off.")).toBeNull();
    expect(screen.queryByText(/saved records$/)).toBeNull();
    expect(screen.queryByText(/Review your saved analyses/)).toBeNull();
    const continuation = screen.getByRole("region", { name: "Continue Where You Left Off" });
    expect(within(continuation).getByText(cloud.originalDraft.value!.state.form.businessName)).toBeTruthy();
    expect(within(continuation).getByRole("button", { name: "Continue Analysis" })).toBeTruthy();
    expect(within(overview).getByText("2 of 2 opportunities with disclosed asking prices")).toBeTruthy();
    expect(within(overview).getByText(/not a portfolio valuation/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Return to Workspace" })).toBeNull();
    expect(cloud.controls().work).toEqual(cloud.originalDraft.value!.state);
    await act(async () => { cloud.controls().cloud?.retry(); });
    expect(cloud.repo.get).not.toHaveBeenCalled();
    expect(cloud.repo.saveDraft).not.toHaveBeenCalled();
    expect(cloud.repo.save).not.toHaveBeenCalled();
    expect(cloud.repo.remove).not.toHaveBeenCalled();
    expect(cloud.draft()).toEqual(cloud.originalDraft);
    expect(cloud.records).toEqual(cloud.originalRecords);
  });
  it("resumes and returns home without replacing edits, IDs, revisions, evidence or scenarios", async () => {
    const cloud = fixture(); await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Continue Analysis" }));
    fireEvent.click(screen.getByRole("button", { name: "Return to Workspace" }));
    expect(home()).toBeTruthy();
    expect(document.activeElement).toBe(home());
    expect(cloud.controls().work).toEqual(cloud.originalDraft.value!.state);
    expect(cloud.controls().active).toEqual(cloud.originalRecords[0]);
    expect(cloud.repo.saveDraft).not.toHaveBeenCalled();
    expect(cloud.records).toEqual(cloud.originalRecords);
  });
  it("keeps home and the draft on cancellation, then opens only after a successful confirmed read", async () => {
    const cloud = fixture(); await loaded(); open();
    expect(home()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cloud.repo.get).not.toHaveBeenCalled();
    expect(cloud.controls().work).toEqual(cloud.originalDraft.value!.state);
    open(); confirm();
    await screen.findByRole("button", { name: "Return to Workspace" });
    expect(cloud.repo.get).toHaveBeenCalledWith(cloud.records[1].id);
    expect(cloud.controls().work).toEqual(cloud.records[1].state);
    expect(cloud.controls().active?.id).toBe(cloud.records[1].id);
    expect(cloud.records).toEqual(cloud.originalRecords);
    expect(cloud.repo.save).not.toHaveBeenCalled();
  });
  it("keeps the home and recovered work when an analysis cannot be read", async () => {
    const cloud = fixture(); await loaded();
    vi.mocked(cloud.repo.get).mockRejectedValueOnce(new Error("Synthetic read failure"));
    open(); confirm();
    await screen.findByText("Synthetic read failure");
    expect(home()).toBeTruthy();
    expect(cloud.controls().work).toEqual(cloud.originalDraft.value!.state);
    expect(cloud.records).toEqual(cloud.originalRecords);
  });
  it("protects the current draft before a new scan and leaves named records untouched", async () => {
    const cloud = fixture(); await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Analyze an Opportunity" }));
    expect(home()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cloud.draft()).toEqual(cloud.originalDraft);
    fireEvent.click(screen.getByRole("button", { name: "Analyze an Opportunity" })); confirm();
    await screen.findByRole("heading", { name: "Listing Intake" });
    expect(cloud.controls().work.scan).toBeNull();
    expect(cloud.controls().work.form).toEqual(initialForm);
    expect(cloud.records).toEqual(cloud.originalRecords);
    expect(cloud.repo.save).not.toHaveBeenCalled();
    expect(cloud.repo.remove).not.toHaveBeenCalled();
  });
  it("provides an empty library and starts intake explicitly", async () => {
    const cloud = fixture(0, false); await loaded();
    expect(screen.getByRole("heading", { name: "Build your acquisition portfolio" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue Analysis" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^View Analysis/ })).toBeNull();
    const overview = screen.getByRole("region", { name: "Portfolio overview" });
    expect(within(overview).getAllByRole("term")).toHaveLength(3);
    expect(within(overview).getByText("Portfolio Asking Value")).toBeTruthy();
    expect(within(overview).getByText("Not Disclosed")).toBeTruthy();
    expect(screen.queryByText("No active analysis")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Analyze an Opportunity" }));
    await screen.findByRole("heading", { name: "Listing Intake" });
    fireEvent.click(screen.getByRole("button", { name: "Return to Workspace" }));
    expect(home()).toBeTruthy();
    await waitFor(() => expect(cloud.controls().cloud?.busy).toBe(false));
    expect(cloud.repo.saveDraft).not.toHaveBeenCalled();
  });
  it("keeps paginated search and secondary management actions accessible without writing on cancellation", async () => {
    const cloud = fixture(12, false); await loaded();
    expect(screen.getAllByRole("button", { name: /^View Analysis/ })).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getAllByRole("button", { name: /^View Analysis/ })).toHaveLength(2);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Metal Works 02" } });
    expect(screen.getAllByRole("button", { name: /^View Analysis/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Rename Example Metal Works 02" }));
    expect(screen.getByRole("textbox", { name: "New acquisition name" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Example Metal Works 02" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cloud.repo.save).not.toHaveBeenCalled();
    expect(cloud.repo.remove).not.toHaveBeenCalled();
    expect(cloud.repo.saveDraft).not.toHaveBeenCalled();
    expect(cloud.records).toEqual(cloud.originalRecords);
  });
});
