import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudPayload, conflictMessage, DraftAutosaver, isFounderAccount, MAX_CLOUD_PAYLOAD_BYTES, recordPayload } from "../src/cloudPersistence";
import type { CloudRepository, CloudStatus } from "../src/cloudPersistence";
import { syntheticLibrary } from "./syntheticSavedLibrary";
import { usesCloudWorkspace } from "../src/workspaceMode";

function setup() {
  const repository = { saveDraft: vi.fn(async (_draft: unknown, revision: number) => revision + 1) } as unknown as CloudRepository;
  const statuses: CloudStatus[] = [];
  let online = true;
  const autosaver = new DraftAutosaver(repository, 0, status => statuses.push(status), () => online);
  const draft = { recordId: null, recordRevision: null, state: syntheticLibrary(1)[0].state };
  return { repository, autosaver, statuses, draft, offline: () => { online = false; }, online: () => { online = true; } };
}
afterEach(() => vi.useRealTimers());
describe("memory-only cloud draft autosaving", () => {
  it("keeps acquisitions locked during first-account setup and authorizes only the exact founder UID", () => {
    expect(isFounderAccount(undefined, undefined)).toBe(false);
    expect(isFounderAccount("synthetic-user", undefined)).toBe(false);
    expect(isFounderAccount("FOUNDER_UID_NOT_CONFIGURED", "FOUNDER_UID_NOT_CONFIGURED")).toBe(false);
    expect(isFounderAccount("other-user", "synthetic-founder")).toBe(false);
    expect(isFounderAccount("synthetic-founder", "synthetic-founder")).toBe(true);
  });
  it("keeps the original default route local until migration is approved", () => {
    expect(usesCloudWorkspace("/", "development")).toBe(false);
    expect(usesCloudWorkspace("/", "production")).toBe(false);
  });
  it("does not route cloud paths or trailing slashes into browser-local persistence", () => {
    for (const path of ["/cloud", "/cloud/", "/cloud/anything"]) expect(usesCloudWorkspace(path, "development")).toBe(true);
  });
  it("never falls back to local persistence on the isolated cloud-mode server", () => {
    for (const mode of ["cloud", "cloud-emulator"]) for (const path of ["/", "/cloud", "/other"]) expect(usesCloudWorkspace(path, mode)).toBe(true);
  });
  it("does not report Saved before server acknowledgement", async () => {
    const t = setup();
    let acknowledge!: (value: number) => void;
    vi.mocked(t.repository.saveDraft).mockReturnValue(new Promise(resolve => { acknowledge = resolve; }));
    t.autosaver.queue(t.draft);
    const write = t.autosaver.flush();
    expect(t.statuses).toEqual(["Saving", "Saving"]);
    expect(t.autosaver.unsaved).toBe(true);
    acknowledge(1); await write;
    expect(t.statuses.at(-1)).toBe("Saved"); expect(t.autosaver.unsaved).toBe(false);
    t.autosaver.stop();
  });
  it("holds edits offline without sending writes and flushes on explicit retry", async () => {
    const t = setup(); t.offline(); t.autosaver.queue(t.draft); await t.autosaver.flush();
    expect(t.repository.saveDraft).not.toHaveBeenCalled(); expect(t.statuses.at(-1)).toBe("Offline");
    expect(t.autosaver.unsaved).toBe(true);
    t.online(); await t.autosaver.flush(); expect(t.statuses.at(-1)).toBe("Saved"); t.autosaver.stop();
  });
  it("retains failed edits, does not retry repeatedly, and retries only when requested", async () => {
    const t = setup(); vi.mocked(t.repository.saveDraft).mockRejectedValueOnce(new Error("Synthetic network failure"));
    t.autosaver.queue(t.draft); await t.autosaver.flush();
    expect(t.statuses.at(-1)).toBe("Error"); expect(t.autosaver.unsaved).toBe(true);
    expect(t.repository.saveDraft).toHaveBeenCalledTimes(1);
    await t.autosaver.flush(); expect(t.statuses.at(-1)).toBe("Saved"); t.autosaver.stop();
  });
  it("latches revision conflicts instead of rebasing over another session", async () => {
    const t = setup(); vi.mocked(t.repository.saveDraft).mockRejectedValue(new Error(conflictMessage));
    t.autosaver.queue(t.draft); await t.autosaver.flush(); t.autosaver.queue(t.draft); await t.autosaver.flush();
    expect(t.repository.saveDraft).toHaveBeenCalledTimes(1); expect(t.statuses.at(-1)).toBe("Error");
    expect(t.autosaver.unsaved).toBe(true); t.autosaver.stop();
  });
  it("coalesces rapid edits and preserves edits arriving during a write", async () => {
    const t = setup(); let acknowledge!: (value: number) => void;
    vi.mocked(t.repository.saveDraft).mockReturnValueOnce(new Promise(resolve => { acknowledge = resolve; }));
    t.autosaver.queue(t.draft); const write = t.autosaver.flush();
    const changed = structuredClone(t.draft); changed.state.form.businessName = "Newer unsaved synthetic edit";
    t.autosaver.queue(changed); acknowledge(1); await write;
    expect(t.repository.saveDraft).toHaveBeenLastCalledWith(changed, 1);
    expect(t.statuses.at(-1)).toBe("Saved"); t.autosaver.stop();
  });
  it("debounces workspace saves and stops timers when a session closes", async () => {
    vi.useFakeTimers(); const t = setup(); t.autosaver.queue(t.draft); t.autosaver.queue(t.draft);
    await vi.advanceTimersByTimeAsync(1199); expect(t.repository.saveDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(t.repository.saveDraft).toHaveBeenCalledTimes(1);
    t.autosaver.queue(t.draft); t.autosaver.stop(); await vi.advanceTimersByTimeAsync(2000);
    expect(t.repository.saveDraft).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized UTF-8 payloads without truncation", () => {
    expect(() => cloudPayload("x".repeat(MAX_CLOUD_PAYLOAD_BYTES))).toThrow("exceeds");
    expect(() => cloudPayload("é".repeat(MAX_CLOUD_PAYLOAD_BYTES / 2))).toThrow("exceeds");
    const record = syntheticLibrary(1)[0]; expect(JSON.parse(recordPayload(record))).toEqual(record);
  });
});
