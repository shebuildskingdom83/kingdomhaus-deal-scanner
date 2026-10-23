// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCloudAcquisitionRecovery } from "../src/useCloudAcquisitionRecovery";
import type { CloudRepository, CloudDraft } from "../src/cloudPersistence";
import type { AcquisitionForm, RecoveryDraft } from "../src/acquisitionRecord";
import { syntheticLibrary } from "./syntheticSavedLibrary";
import { parseBackup, serializeBackup, storageKey } from "../src/storage";
import { WorkspaceSession } from "../src/workspaceSession";

function memoryCloud(records = syntheticLibrary(1)) {
  const library = new Map(records.map(record => [record.id, structuredClone(record)]));
  let draft: CloudDraft = { revision: 0, value: null };
  const repo: CloudRepository = {
    list: vi.fn(async () => [...library.values()].map(record => structuredClone(record))),
    get: vi.fn(async id => structuredClone(library.get(id)!)),
    save: vi.fn(async (record, expected) => {
      if ((library.get(record.id)?.revision ?? null) !== expected) throw new Error("Conflict");
      library.set(record.id, structuredClone(record));
    }),
    remove: vi.fn(async id => { library.delete(id); }),
    loadDraft: vi.fn(async () => structuredClone(draft)),
    saveDraft: vi.fn(async (value: RecoveryDraft | null, expected: number) => {
      if (draft.revision !== expected) throw new Error("Conflict");
      draft = { revision: expected + 1, value: structuredClone(value) }; return draft.revision;
    })
  };
  return { repo, library, draft: () => draft };
}
const form = Object.fromEntries(Object.keys(syntheticLibrary(1)[0].state.form).map(key => [key, ""])) as AcquisitionForm;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function loaded(repo: CloudRepository) {
  const hook = renderHook(() => useCloudAcquisitionRecovery(repo, form));
  await waitFor(() => expect(hook.result.current.cloud?.ready).toBe(true));
  return hook;
}
async function flush(hook: Awaited<ReturnType<typeof loaded>>) { await act(async () => { hook.result.current.cloud?.retry(); }); }

describe("cloud recovery UI state with synthetic records", () => {
  it("cancels queued account-bound autosaves and stale exports immediately on session close", async () => {
    const cloud = memoryCloud([]), session = new WorkspaceSession("synthetic-A", false, () => true);
    const hook = renderHook(() => useCloudAcquisitionRecovery(cloud.repo, form, session));
    await waitFor(() => expect(hook.result.current.cloud?.ready).toBe(true));
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click");
    vi.useFakeTimers();
    act(() => hook.result.current.setWork(current => ({ ...current, form: { ...current.form, businessName: "Synthetic A private draft" } })));
    act(() => session.close());
    await act(async () => { await vi.runAllTimersAsync(); });
    act(() => hook.result.current.exportSavedCsv());
    expect(cloud.repo.saveDraft).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
    expect(cloud.draft()).toEqual({ revision: 0, value: null });
  });
  it("does not follow an in-flight autosave with another account's queued edits after cancellation", async () => {
    const cloud = memoryCloud([]), session = new WorkspaceSession("synthetic-A", false, () => true);
    const hook = renderHook(() => useCloudAcquisitionRecovery(cloud.repo, form, session));
    await waitFor(() => expect(hook.result.current.cloud?.ready).toBe(true));
    let finish!: (revision: number) => void;
    vi.mocked(cloud.repo.saveDraft).mockImplementationOnce(() => new Promise(done => { finish = done; }));
    vi.useFakeTimers();
    act(() => hook.result.current.setWork(current => ({ ...current, form: { ...current.form, businessName: "First synthetic draft" } })));
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    act(() => hook.result.current.setWork(current => ({ ...current, form: { ...current.form, businessName: "Second queued synthetic draft" } })));
    act(() => session.close());
    await act(async () => { finish(1); await vi.runAllTimersAsync(); });
    expect(cloud.repo.saveDraft).toHaveBeenCalledTimes(1);
  });
  it("retains the native page-leave guard used by KingdomHaus Home until queued edits are saved", async () => {
    const cloud = memoryCloud(); const hook = await loaded(cloud.repo);
    act(() => hook.result.current.setWork(structuredClone(syntheticLibrary(1)[0].state)));
    const pending = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(pending);
    expect(pending.defaultPrevented).toBe(true);
    await flush(hook);
    const saved = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
  });
  it("does not read, write or clear the original browser-local workspace or download files", async () => {
    localStorage.setItem(storageKey, "synthetic original workspace sentinel");
    const read = vi.spyOn(Storage.prototype, "getItem"); const write = vi.spyOn(Storage.prototype, "setItem");
    const remove = vi.spyOn(Storage.prototype, "removeItem"); const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const cloud = memoryCloud(); const hook = await loaded(cloud.repo); await flush(hook);
    expect(cloud.repo.saveDraft).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
    hook.unmount(); expect(localStorage.getItem(storageKey)).toBe("synthetic original workspace sentinel");
  });
  it("autosaves unfinished work and both scenario states and restores on remount", async () => {
    const cloud = memoryCloud(); const hook = await loaded(cloud.repo);
    const work = structuredClone(syntheticLibrary(1)[0].state);
    work.cashFlow.debtService = "12345"; work.cashFlow.payrollSavings = "2345"; work.form.businessName = "Unfinished synthetic correction";
    act(() => hook.result.current.setWork(work)); await flush(hook);
    expect(cloud.draft().value?.state).toEqual(work); hook.unmount();
    const restored = await loaded(cloud.repo); expect(restored.result.current.work).toEqual(work);
  });
  it("opens a saved record and requires confirmation before updating or deleting it", async () => {
    const cloud = memoryCloud(); const record = [...cloud.library.values()][0]; const hook = await loaded(cloud.repo);
    act(() => hook.result.current.open(record));
    if (hook.result.current.confirmation) act(() => hook.result.current.acceptConfirmation());
    await waitFor(() => expect(hook.result.current.active?.id).toBe(record.id));
    act(() => hook.result.current.setWork(current => ({ ...current, form: { ...current.form, businessName: "Pending correction" } })));
    await flush(hook); expect(cloud.library.get(record.id)).toEqual(record);
    act(() => hook.result.current.save()); expect(hook.result.current.confirmation).not.toBeNull(); expect(cloud.repo.save).not.toHaveBeenCalled();
    act(() => hook.result.current.acceptConfirmation()); await waitFor(() => expect(hook.result.current.active?.revision).toBe(2));
    expect(cloud.library.get(record.id)?.state.form.businessName).toBe("Pending correction");
    act(() => hook.result.current.remove(hook.result.current.active!)); expect(cloud.library.size).toBe(1);
    act(() => hook.result.current.acceptConfirmation()); await waitFor(() => expect(cloud.library.size).toBe(0));
  });
  it("imports complete JSON and confirms repeated imports instead of creating duplicates", async () => {
    const cloud = memoryCloud([]); const hook = await loaded(cloud.repo); const record = syntheticLibrary(1)[0]; const backup = serializeBackup(record);
    act(() => hook.result.current.importText(backup)); await waitFor(() => expect(hook.result.current.records).toHaveLength(1));
    expect(hook.result.current.work).toEqual(parseBackup(backup).state);
    act(() => hook.result.current.importText(backup)); expect(hook.result.current.confirmation).not.toBeNull();
    act(() => hook.result.current.acceptConfirmation()); await waitFor(() => expect(hook.result.current.records[0].revision).toBe(2));
    expect(cloud.library.size).toBe(1);
  });
  it("renames only after confirmation and preserves unsaved form corrections", async () => {
    const cloud = memoryCloud(); const hook = await loaded(cloud.repo); const record = [...cloud.library.values()][0];
    act(() => hook.result.current.rename(record, "Fictional renamed acquisition")); expect(cloud.repo.save).not.toHaveBeenCalled();
    act(() => hook.result.current.acceptConfirmation()); await waitFor(() => expect(hook.result.current.records[0].name).toBe("Fictional renamed acquisition"));
  });
  it("reports recovery failures without loading local data or accepting writes", async () => {
    const cloud = memoryCloud(); vi.mocked(cloud.repo.list).mockRejectedValue(new Error("Synthetic unavailable server"));
    const hook = renderHook(() => useCloudAcquisitionRecovery(cloud.repo, form));
    await waitFor(() => expect(hook.result.current.cloud?.status).toBe("Error"));
    expect(hook.result.current.cloud?.ready).toBe(false); expect(hook.result.current.storageError).toContain("unavailable");
    expect(cloud.repo.saveDraft).not.toHaveBeenCalled();
  });
  it("preserves edits typed while an asynchronous reopen is in flight", async () => {
    const cloud = memoryCloud(); const record = [...cloud.library.values()][0]; const hook = await loaded(cloud.repo);
    let finish!: (value: typeof record) => void;
    vi.mocked(cloud.repo.get).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    act(() => hook.result.current.open(record));
    await waitFor(() => expect(cloud.repo.get).toHaveBeenCalled());
    act(() => hook.result.current.setWork(current => ({ ...current, form: { ...current.form, businessName: "Newer edit stays" } })));
    await act(async () => { finish(record); });
    expect(hook.result.current.work.form.businessName).toBe("Newer edit stays");
    expect(hook.result.current.actionError).toContain("was not replaced");
  });
});
