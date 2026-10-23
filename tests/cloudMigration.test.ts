import { describe, expect, it, vi } from "vitest";
import { migrateAcquisitions, migrationDraft, migrationRecord, MigrationStoppedError, sameMigrationContent } from "../src/cloudMigration";
import type { MigrationRepository } from "../src/cloudMigration";
import type { AcquisitionRecord, RecoveryDraft } from "../src/acquisitionRecord";
import { migrationFixtures } from "./cloudMigrationFixtures";

function setup() {
  const copies = new Map<string, AcquisitionRecord>();
  let draft: RecoveryDraft | null = null;
  const repository: MigrationRepository = {
    list: vi.fn(async () => [...copies.values()].map(record => structuredClone(record))),
    getForMigration: vi.fn(async id => structuredClone(copies.get(id)!)),
    createRecordForMigration: vi.fn(async record => {
      const previous = copies.get(record.id);
      if (previous && !sameMigrationContent(previous, record)) throw new Error("Conflict");
      if (!previous) copies.set(record.id, structuredClone(record));
      return previous ? "already-identical" : "created";
    }),
    loadDraft: vi.fn(async () => ({ revision: draft ? 1 : 0, value: structuredClone(draft) })),
    createDraftForMigration: vi.fn(async value => {
      if (draft && !sameMigrationContent(draft, value)) throw new Error("Conflict");
      const previous = draft; draft = structuredClone(value); return previous ? "already-identical" : "created";
    })
  };
  return { repository, copies };
}
describe("explicit in-memory create-only migration preparation", () => {
  it("preserves four complete records, IDs, historical revisions and timestamps without modifying originals", async () => {
    const t = setup(), records = migrationFixtures(), before = structuredClone(records);
    const result = await migrateAcquisitions(t.repository, records);
    expect(result.records.map(item => item.historicalRevision)).toEqual([1, 4, 9, 23]);
    expect([...t.copies.values()]).toEqual(before); expect(records).toEqual(before);
  });
  it("retries identical copies without duplicates or overwritten history", async () => {
    const t = setup(), records = migrationFixtures();
    await migrateAcquisitions(t.repository, records);
    expect((await migrateAcquisitions(t.repository, records)).records.every(item => item.result === "already-identical")).toBe(true);
    expect(t.copies.size).toBe(4);
  });
  it("preflights every record and rejects duplicate IDs, source URLs and cloud conflicts before writing", async () => {
    const records = migrationFixtures();
    for (const invalid of [[records[0], records[0]], [records[0], { ...records[1], state: records[0].state }]]) {
      const t = setup(); await expect(migrateAcquisitions(t.repository, invalid)).rejects.toBeInstanceOf(MigrationStoppedError);
      expect(t.repository.createRecordForMigration).not.toHaveBeenCalled();
    }
    for (const duplicate of [{ ...records[0], name: "Conflicting edit" }, { ...records[0], id: "different-cloud-identity" }]) {
      const t = setup(); t.copies.set(duplicate.id, duplicate);
      await expect(migrateAcquisitions(t.repository, records)).rejects.toBeInstanceOf(MigrationStoppedError);
      expect(t.repository.createRecordForMigration).not.toHaveBeenCalled();
    }
  });
  it("stops immediately on complete readback mismatch, with no next record or draft write", async () => {
    const t = setup(), records = migrationFixtures();
    vi.mocked(t.repository.getForMigration).mockResolvedValueOnce({ ...records[0], updatedAt: "2026-09-01T00:00:00.000Z" });
    await expect(migrateAcquisitions(t.repository, records, { draft: { recordId: null, recordRevision: null, state: records[0].state } })).rejects.toMatchObject({ completedIds: [] });
    expect(t.repository.createRecordForMigration).toHaveBeenCalledTimes(1);
    expect(t.repository.createDraftForMigration).not.toHaveBeenCalled();
  });
  it("safely retries after an interrupted or ambiguously acknowledged transfer", async () => {
    const t = setup(), records = migrationFixtures();
    vi.mocked(t.repository.createRecordForMigration).mockImplementationOnce(async record => { t.copies.set(record.id, structuredClone(record)); throw new Error("Connection lost after commit"); });
    await expect(migrateAcquisitions(t.repository, records)).rejects.toMatchObject({ completedIds: [] });
    vi.mocked(t.repository.createRecordForMigration).mockImplementation(async record => {
      const exists = t.copies.has(record.id); if (!exists) t.copies.set(record.id, structuredClone(record)); return exists ? "already-identical" : "created";
    });
    expect((await migrateAcquisitions(t.repository, records)).records[0].result).toBe("already-identical");
    expect(t.copies.size).toBe(4);
  });
  it("supports explicit cancellation and rollback by retaining local originals, not deleting either repository", async () => {
    const t = setup(), records = migrationFixtures(), original = structuredClone(records), controller = new AbortController();
    vi.mocked(t.repository.getForMigration).mockImplementation(async id => { controller.abort(); return t.copies.get(id)!; });
    await expect(migrateAcquisitions(t.repository, records, { signal: controller.signal })).rejects.toMatchObject({ completedIds: [records[0].id] });
    expect(records).toEqual(original); expect(t.copies.size).toBe(1);
    const aborted = setup(); await expect(migrateAcquisitions(aborted.repository, records, { signal: controller.signal })).rejects.toBeInstanceOf(MigrationStoppedError);
    expect(aborted.repository.list).not.toHaveBeenCalled();
  });
  it("migrates a draft only when explicitly selected and preserves its historical record reference", async () => {
    const t = setup(), records = migrationFixtures();
    const draft = { recordId: records[2].id, recordRevision: records[2].revision, state: structuredClone(records[2].state) };
    draft.state.cashFlow.debtService = "16000";
    const result = await migrateAcquisitions(t.repository, records, { draft });
    expect(result.draft).toBe("created"); expect((await t.repository.loadDraft()).value).toEqual(draft);
    expect((await migrateAcquisitions(t.repository, records, { draft })).draft).toBe("already-identical");
    expect(t.copies.get(records[2].id)).toEqual(records[2]);
  });
  it("rejects an orphan/stale draft or existing different cloud draft before copying records", async () => {
    const records = migrationFixtures();
    for (const revision of [99, 1]) {
      const t = setup(), draft = { recordId: records[0].id, recordRevision: revision, state: records[0].state };
      if (revision === 1) await t.repository.createDraftForMigration({ ...draft, recordId: null, recordRevision: null });
      await expect(migrateAcquisitions(t.repository, records, { draft })).rejects.toBeInstanceOf(MigrationStoppedError);
      expect(t.repository.createRecordForMigration).not.toHaveBeenCalled();
    }
  });
  it("rejects normalization, unsupported schemas and over-limit records rather than losing information", () => {
    const r = migrationFixtures()[0];
    const legacy = structuredClone(r); delete legacy.state.scan.businessDetails.streetAddress;
    expect(() => migrationRecord(legacy)).toThrow("unchanged");
    expect(() => migrationRecord({ ...r, schemaVersion: 99 } as unknown as AcquisitionRecord)).toThrow();
    const large = structuredClone(r); large.state.scan.sellerClaims = Array(12).fill("x".repeat(90000));
    expect(() => migrationRecord(large)).toThrow("exceeds");
    expect(() => migrationDraft({ recordId: null, recordRevision: 1, state: r.state })).toThrow();
  });
  it("stops on draft readback mismatch and reports the failed phase without copying or logging record contents", async () => {
    const t = setup(), records = migrationFixtures();
    vi.mocked(t.repository.loadDraft).mockResolvedValueOnce({ revision: 0, value: null }).mockResolvedValueOnce({ revision: 1, value: null });
    await expect(migrateAcquisitions(t.repository, records, { draft: { recordId: null, recordRevision: null, state: records[0].state } }))
      .rejects.toMatchObject({ phase: "full-draft-readback", completedIds: records.map(record => record.id) });
  });
  it("does not access browser storage, download backups or navigate during transfer or rollback", async () => {
    const original = JSON.stringify({ schemaVersion: 2, records: migrationFixtures(), draft: null });
    const storage = { getItem: vi.fn(() => original), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    const download = vi.fn();
    vi.stubGlobal("localStorage", storage); vi.stubGlobal("document", { createElement: download });
    try {
      const t = setup(); await migrateAcquisitions(t.repository, migrationFixtures());
      expect(storage.getItem).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled(); expect(storage.clear).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
