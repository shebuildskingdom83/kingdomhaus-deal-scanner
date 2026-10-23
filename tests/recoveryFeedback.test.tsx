// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcquisitionRecovery } from "../src/AcquisitionRecovery";
import { initialForm } from "../src/App";
import { conflictMessage } from "../src/cloudPersistence";
import type { CloudRepository } from "../src/cloudPersistence";
import type { RecoveryControls } from "../src/useAcquisitionRecovery";
import { useCloudAcquisitionRecovery } from "../src/useCloudAcquisitionRecovery";
import { RECOVERY_FEEDBACK_DURATION_MS } from "../src/recoveryFeedback";
import { syntheticLibrary } from "./syntheticSavedLibrary";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function fixture(presentation: "scanner" | "workspace" = "scanner", changedRevision = false) {
  const record = syntheticLibrary(1)[0];
  const repo: CloudRepository = {
    list: vi.fn(async () => [structuredClone(record)]), get: vi.fn(async () => structuredClone(record)),
    save: vi.fn(async () => {}), remove: vi.fn(async () => {}),
    loadDraft: vi.fn(async () => ({ revision: 1, value: { recordId: record.id,
      recordRevision: changedRevision ? record.revision + 1 : record.revision, state: structuredClone(record.state) } })),
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
  fireEvent.click(screen.getByRole("button", { name: "Update saved scan" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
}

describe("context-aware recovery feedback with an in-memory synthetic repository", () => {
  it.each(["scanner", "workspace"] as const)("has no persistent Saved or reopened messages (%s)", async presentation => {
    const cloud = await fixture(presentation);
    expect(screen.queryByText("Saved", { exact: true })).toBeNull();
    expect(document.querySelector(".recovery-state")).toBeNull();
    expect(document.querySelector(".portfolio-save-state")).toBeNull();
    if (presentation === "scanner") expect(screen.getByRole("button", { name: "Update saved scan" })).toBeTruthy();
    act(() => cloud.controls().open(cloud.record));
    await waitFor(() => expect(cloud.controls().generation).toBe(1));
    expect(screen.queryByText("Cloud acquisition reopened.")).toBeNull();
    expect(screen.queryByText("Changes saved.")).toBeNull();
    expect(cloud.repo.save).not.toHaveBeenCalled();
    expect(cloud.repo.saveDraft).not.toHaveBeenCalled();
  });
  it("confirms only an acknowledged server save, then dismisses it without clearing work", async () => {
    const cloud = await fixture();
    const originalWork = structuredClone(cloud.controls().work);
    let finish!: () => void;
    let finishDraft!: () => void;
    vi.mocked(cloud.repo.save).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    vi.mocked(cloud.repo.saveDraft).mockImplementationOnce(() => new Promise<number>(resolve => { finishDraft = () => resolve(2); }));
    save();
    await waitFor(() => expect(cloud.repo.save).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Changes saved.")).toBeNull();
    expect(cloud.controls().active?.revision).toBe(1);
    vi.useFakeTimers();
    await act(async () => { finish(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(cloud.repo.saveDraft).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByText("Changes saved.")).toBeNull();
    await act(async () => { finishDraft(); });
    expect(screen.getByText("Changes saved.")).toBeTruthy();
    expect(screen.getByText("Changes saved.").closest('[role="status"]')?.getAttribute("aria-live")).toBe("polite");
    expect(cloud.controls().active?.revision).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(RECOVERY_FEEDBACK_DURATION_MS); });
    expect(screen.queryByText("Changes saved.")).toBeNull();
    expect(cloud.controls().work).toEqual(originalWork);
    expect(screen.queryByText("Saved", { exact: true })).toBeNull();
  });
  it.each(["Synthetic server write failed", conflictMessage])("keeps failed writes and conflicts visible: %s", async failure => {
    const cloud = await fixture();
    act(() => cloud.controls().setWork(current => ({ ...current, form: { ...current.form, businessName: "Synthetic unsaved changes" } })));
    vi.mocked(cloud.repo.save).mockRejectedValueOnce(new Error(failure));
    save();
    await screen.findByText(failure);
    expect(screen.getByText(failure).getAttribute("role")).toBe("alert");
    expect(screen.getByText(/Changes not saved to this acquisition/)).toBeTruthy();
    vi.useFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByText(failure)).toBeTruthy();
    expect(screen.queryByText("Changes saved.")).toBeNull();
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
    expect(screen.queryByText("Changes saved.")).toBeNull();
    expect(screen.getByText("Changes not saved to this acquisition")).toBeTruthy();
    expect(cloud.controls().work.form.businessName).toBe("Newer synthetic edits");
  });
  it("does not dismiss the draft-versus-record recovery warning", async () => {
    await fixture("workspace", true);
    const warning = "Cloud draft restored separately from the changed saved record. Confirm any replacement before saving.";
    expect(screen.getByText(warning)).toBeTruthy();
    vi.useFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByText(warning)).toBeTruthy();
    expect(screen.getByText("Draft changes are separate from saved opportunities")).toBeTruthy();
  });
});
