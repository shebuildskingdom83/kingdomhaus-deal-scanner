import { describe, expect, it, vi } from "vitest";
import { WorkspaceSession } from "../src/workspaceSession";
const sdk = vi.hoisted(() => ({ read: vi.fn(), commit: vi.fn(), write: vi.fn() }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...path: string[]) => path.join("/"), collection: vi.fn(), serverTimestamp: vi.fn(),
  getDocFromServer: sdk.read, getDocsFromServer: sdk.read,
  runTransaction: async (_db: unknown, action: (transaction: unknown) => Promise<unknown>) => {
    const value = await action({ get: sdk.read, set: sdk.write, delete: sdk.write }); sdk.commit(); return value;
  }
}));
import { FirestoreAcquisitionRepository } from "../src/firestoreAcquisitionRepository";
import type { Firestore } from "firebase/firestore";
describe("repository pre-commit account guards", () => {
  it("stops an autosave transaction before commit when the account changes while reading its revision", async () => {
    sdk.commit.mockClear(); sdk.write.mockClear();
    let active = true; const session = new WorkspaceSession("synthetic-A", false, () => active);
    let finish!: (value: unknown) => void; sdk.read.mockImplementationOnce(() => new Promise(done => { finish = done; }));
    const repository = new FirestoreAcquisitionRepository({} as Firestore, session.uid, () => true, () => session.assert());
    const pending = repository.saveDraft(null, 0); const rejected = expect(pending).rejects.toThrow(/account or workspace changed/);
    active = false; session.close(); finish({ data: () => undefined }); await rejected;
    expect(sdk.commit).not.toHaveBeenCalled();
  });
  it("discards a delayed record read and never changes its fixed owner path", async () => {
    let active = true; const session = new WorkspaceSession("synthetic-A", false, () => active);
    let finish!: (value: unknown) => void; sdk.read.mockImplementationOnce(() => new Promise(done => { finish = done; }));
    const repository = new FirestoreAcquisitionRepository({} as Firestore, session.uid, () => true, () => session.assert());
    const pending = repository.get("synthetic-record"); const rejected = expect(pending).rejects.toThrow(/account or workspace changed/);
    active = false; finish({ exists: () => true, data: () => ({}) }); await rejected;
    expect(sdk.read).toHaveBeenLastCalledWith("users/synthetic-A/acquisitions/synthetic-record");
  });
});
