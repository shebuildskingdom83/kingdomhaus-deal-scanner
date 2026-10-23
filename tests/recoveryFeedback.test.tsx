// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcquisitionRecovery } from "../src/AcquisitionRecovery";
import { initialForm } from "../src/App";
import { conflictMessage } from "../src/cloudPersistence";
import type { CloudRepository } from "../src/cloudPersistence";
import type { RecoveryControls } from "../src/useAcquisitionRecovery";
import { useCloudAcquisitionRecovery } from "../src/useCloudAcquisitionRecovery";
import { useAcquisitionRecovery } from "../src/useAcquisitionRecovery";
import { storageKey } from "../src/storage";
import { syntheticLibrary } from "./syntheticSavedLibrary";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); window.localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function fixture(presentation: "scanner" | "workspace" = "scanner", changedRevision = false, newAcquisition = false) {
  const record = syntheticLibrary(1)[0];
  const repo: CloudRepository = {
    list: vi.fn(async () => newAcquisition ? [] : [structuredClone(record)]), get: vi.fn(async () => structuredClone(record)),
    save: vi.fn(async () => {}), remove: vi.fn(async () => {}),
    loadDraft: vi.fn(async () => ({ revision: 1, value: { recordId: newAcquisition ? null : record.id,
      recordRevision: newAcquisition ? null : changedRevision ? record.revision + 1 : record.revision, state: structuredClone(record.state) } })),
    saveDraft: vi.fn(async (_value, revision) => revision + 1)
  };
  let recovery!: RecoveryControls;
  function Harness() {
    recovery = useCloudAcquisitionRecovery(repo, initialForm);
    return recovery.cloud?.ready ? <AcquisitionRecovery recovery={recovery} presentation={presentation} /> : null;
  }
  render(<Harness />);
  await waitFor(() => expect(recovery.cloud?.ready).toBe(true));
  return { repo, record, controls: () => recovery };
}
function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
}

describe("context-aware recovery feedback with an in-memory synthetic repository", () => {
  it.each(["scanner", "workspace"] as const)("shows record status without mistaking draft recovery for a record write (%s)", async presentation => {
    const cloud = await fixture(presentation);
    expect(screen.getByText("Saved")).toBeTruthy();
    if (presentation === "scanner") expect(screen.getByRole("button", { name: "Save Changes" })).toBeTruthy();
    act(() => cloud.controls().open(cloud.record));
    await waitFor(() => expect(cloud.controls().generation).toBe(1));
    expect(screen.queryByText("Cloud acquisition reopened.")).toBeNull();
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(cloud.repo.save).not.toHaveBeenCalled();
    expect(cloud.repo.saveDraft).not.toHaveBeenCalled();
  });
  it("keeps Founder Decision edits unsaved after draft protection, then marks only an acknowledged record save complete", async () => {
    const cloud = await fixture();
    act(() => cloud.controls().setWork(current => ({ ...current, founderDecision: { decision: "Hold", rationale: "Synthetic rationale", nextDiligenceAction: "Request records" } })));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    await act(async () => { await cloud.controls().cloud?.retry(); });
    expect(screen.queryByText(/Recovery draft protected/)).toBeNull();
    expect(document.querySelector(".acquisition-recovery")?.getAttribute("data-draft-status")).toBe("Saved");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(cloud.repo.save).not.toHaveBeenCalled();
    let finish!: () => void;
    vi.mocked(cloud.repo.save).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    save();
    await waitFor(() => expect(cloud.repo.save).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Saving...")).toBeTruthy();
    expect(cloud.controls().active?.revision).toBe(1);
    await act(async () => { finish(); });
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.getByText("Saved").getAttribute("role")).toBe("status");
    expect(cloud.controls().active?.revision).toBe(2);
    expect(cloud.controls().active?.state.founderDecision).toEqual(cloud.controls().work.founderDecision);
    act(() => cloud.controls().setWork(current => ({ ...current, founderDecision: { ...current.founderDecision!, nextDiligenceAction: "A newer request" } })));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });
  it("labels a new acquisition and marks it saved only after its record write", async () => {
    const cloud = await fixture("scanner", false, true);
    let finish!: () => void;
    vi.mocked(cloud.repo.save).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    expect(screen.getByRole("button", { name: "Save Acquisition" })).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save Acquisition" }));
    await waitFor(() => expect(cloud.repo.save).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Saving...")).toBeTruthy();
    expect(screen.queryByText("Saved")).toBeNull();
    expect(cloud.repo.save).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }), null);
    await act(async () => { finish(); });
    expect(screen.getByText("Saved")).toBeTruthy();
  });
  it("uses the same record status for browser-local saving and later edits", async () => {
    const record = syntheticLibrary(1)[0];
    window.localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 2, records: [record], draft: { recordId: record.id, recordRevision: record.revision, state: record.state } }));
    let recovery!: ReturnType<typeof useAcquisitionRecovery>;
    function Harness() {
      recovery = useAcquisitionRecovery(initialForm);
      return <AcquisitionRecovery recovery={recovery} />;
    }
    render(<Harness />);
    expect(screen.getByText("Saved")).toBeTruthy();
    act(() => recovery.setWork(current => ({ ...current, founderDecision: { decision: "Pursue", rationale: "Synthetic review", nextDiligenceAction: "Request documents" } })));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    save();
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(recovery.active?.state.founderDecision?.decision).toBe("Pursue");
    act(() => recovery.setWork(current => ({ ...current, founderDecision: { ...current.founderDecision!, rationale: "Recheck evidence" } })));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });
  it("keeps a failed recovery draft separate from acquisition-save status", async () => {
    const cloud = await fixture();
    vi.mocked(cloud.repo.saveDraft).mockRejectedValueOnce(new Error("Synthetic draft failure"));
    act(() => cloud.controls().setWork(current => ({ ...current, founderDecision: { decision: "Hold", rationale: "", nextDiligenceAction: "" } })));
    await act(async () => { await cloud.controls().cloud?.retry(); });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(screen.getByText("Unable to protect recovery draft.")).toBeTruthy();
    expect(screen.queryByText("Unable to save")).toBeNull();
    expect(cloud.repo.save).not.toHaveBeenCalled();
  });
  it.each(["Synthetic server write failed", conflictMessage])("keeps failed writes and conflicts visible: %s", async failure => {
    const cloud = await fixture();
    act(() => cloud.controls().setWork(current => ({ ...current, form: { ...current.form, businessName: "Synthetic unsaved changes" } })));
    vi.mocked(cloud.repo.save).mockRejectedValueOnce(new Error(failure));
    save();
    await screen.findByText(failure);
    expect(screen.getByText(failure).getAttribute("role")).toBe("alert");
    expect(screen.getByText("Unable to save")).toBeTruthy();
    vi.useFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByText(failure)).toBeTruthy();
    expect(screen.queryByText("Saved")).toBeNull();
    expect(cloud.controls().active?.revision).toBe(1);
    expect(cloud.controls().dirty).toBe(true);
  });
  it("does not call newly typed edits saved when an older save completes", async () => {
    const cloud = await fixture();
    let finish!: () => void;
    vi.mocked(cloud.repo.save).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    save(); await waitFor(() => expect(cloud.repo.save).toHaveBeenCalled());
    act(() => cloud.controls().setWork(current => ({ ...current, form: { ...current.form, businessName: "Newer synthetic edits" } })));
    await act(async () => { finish(); });
    await act(async () => { cloud.controls().cloud?.retry(); });
    expect(screen.queryByText("Saved")).toBeNull();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(cloud.controls().work.form.businessName).toBe("Newer synthetic edits");
  });
  it("does not dismiss the draft-versus-record recovery warning", async () => {
    await fixture("workspace", true);
    const warning = "Cloud draft restored separately from the changed saved record. Confirm any replacement before saving.";
    expect(screen.getByText(warning)).toBeTruthy();
    vi.useFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByText(warning)).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });
});
