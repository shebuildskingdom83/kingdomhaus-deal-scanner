import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { syntheticMigrationRules } from "../scripts/migrationRules";
import { FirestoreAcquisitionRepository } from "../src/firestoreAcquisitionRepository";
import { migrateAcquisitions } from "../src/cloudMigration";
import { migrationFixtures } from "./cloudMigrationFixtures";
import { buildReportLines } from "../src/pdf";
import { buildSavedAcquisitionsCsv } from "../src/csv";
import { parseBackup, serializeBackup } from "../src/storage";

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") {
  throw new Error("Migration tests require loopback demo emulators. Live Firebase is not permitted.");
}
const uid = "synthetic-founder";
let environment: RulesTestEnvironment, db: Firestore, repository: FirestoreAcquisitionRepository;
const ref = (id: string) => doc(db, "users", uid, "acquisitions", id);
beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-kingdomhaus", firestore: { host: "127.0.0.1", port: 8080,
    rules: syntheticMigrationRules() } });
});
beforeEach(async () => {
  await environment.clearFirestore();
  db = environment.authenticatedContext(uid).firestore() as unknown as Firestore;
  repository = new FirestoreAcquisitionRepository(db, uid);
});
afterAll(async () => { await environment?.cleanup(); });

describe("proposed migration policy and create-only repository - synthetic emulator only", () => {
  it("reviews all selected source claims without writing and rejects an orphan claim before copying anything", async () => {
    const records = migrationFixtures();
    expect(await repository.reviewMigrationSelection(records)).toEqual({ selectedCount: 4, existingCount: 0 });
    expect(await repository.list()).toEqual([]);
    expect((await getDocs(collection(db, "users", uid, "sourceKeys"))).empty).toBe(true);
    await repository.createRecordForMigration(records[3]); await deleteDoc(ref(records[3].id));
    await expect(repository.reviewMigrationSelection(records)).rejects.toThrow();
    expect(await repository.list()).toEqual([]);
  });
  it("accepts identical migrated records during read-only review but never overwrites a conflict", async () => {
    const records = migrationFixtures(); await migrateAcquisitions(repository, records);
    expect(await repository.reviewMigrationSelection(records)).toEqual({ selectedCount: 4, existingCount: 4 });
    const different = structuredClone(records); different[0].state.cashFlow.debtService = "999";
    await expect(repository.reviewMigrationSelection(different)).rejects.toThrow();
    expect(await repository.get(records[0].id)).toEqual(records[0]);
  });
  it("blocks a nonempty cloud draft during selection review without changing it", async () => {
    const records = migrationFixtures(), draft = { recordId: null, recordRevision: null, state: records[0].state };
    await repository.createDraftForMigration(draft);
    await expect(repository.reviewMigrationSelection(records)).rejects.toThrow("draft");
    expect(await repository.loadDraft()).toEqual({ revision: 1, value: draft });
    expect(await repository.list()).toEqual([]);
  });
  it("copies four complete historical records with cloud revision 1 and immutable offsets", async () => {
    const records = migrationFixtures(), before = structuredClone(records);
    const result = await migrateAcquisitions(repository, records);
    expect(result.records.map(item => item.historicalRevision)).toEqual([1, 4, 9, 23]);
    for (const record of records) {
      expect(await repository.getForMigration(record.id)).toEqual(record);
      const data = (await getDoc(ref(record.id))).data()!;
      expect(data.revision).toBe(1); expect(data.migrationRevisionOffset ?? 0).toBe(record.revision - 1);
      expect(JSON.parse(data.payload)).toEqual(record);
    }
    expect(records).toEqual(before);
    expect((await getDocs(collection(db, "users", uid, "sourceKeys"))).size).toBe(4);
  });
  it("retries without duplicating, overwriting or incrementing migrated envelopes", async () => {
    const records = migrationFixtures(); await migrateAcquisitions(repository, records);
    const before = (await getDocs(collection(db, "users", uid, "acquisitions"))).docs.map(item => item.data());
    const result = await migrateAcquisitions(repository, records);
    expect(result.records.every(item => item.result === "already-identical")).toBe(true);
    expect((await getDocs(collection(db, "users", uid, "acquisitions"))).docs.map(item => item.data())).toEqual(before);
    expect(await repository.list()).toHaveLength(4);
  });
  it("preserves future ordinary update, rename and delete revision checks after historical migration", async () => {
    const record = migrationFixtures()[2]; await migrateAcquisitions(repository, [record]);
    const updated = { ...record, name: "Fictional confirmed rename", revision: 10 };
    await expect(repository.save(updated, 8)).rejects.toThrow();
    await repository.save(updated, 9);
    expect(await repository.get(record.id)).toEqual(updated);
    expect((await getDoc(ref(record.id))).data()).toMatchObject({ revision: 2, migrationRevisionOffset: 8 });
    await expect(repository.remove(record.id, 9)).rejects.toThrow();
    await repository.remove(record.id, 10);
    expect(await repository.list()).toEqual([]);
    expect((await getDocs(collection(db, "users", uid, "sourceKeys"))).empty).toBe(true);
  });
  it("stops on an existing conflicting ID or source listing without touching existing data", async () => {
    const records = migrationFixtures(); await migrateAcquisitions(repository, [records[2]]);
    const conflict = structuredClone(records); conflict[2].state.cashFlow.debtService = "999";
    await expect(migrateAcquisitions(repository, conflict)).rejects.toMatchObject({ completedIds: [] });
    const duplicate = { ...records[2], id: "other-synthetic-identity" };
    await expect(migrateAcquisitions(repository, [duplicate])).rejects.toMatchObject({ completedIds: [] });
    expect(await repository.list()).toEqual([records[2]]);
  });
  it("makes competing create-only transfers atomic without source-key orphans", async () => {
    const record = migrationFixtures()[1], duplicate = { ...record, id: "competing-synthetic-id" };
    const results = await Promise.allSettled([repository.createRecordForMigration(record), repository.createRecordForMigration(duplicate)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await repository.list()).toHaveLength(1);
    expect((await getDocs(collection(db, "users", uid, "sourceKeys"))).size).toBe(1);
  });
  it("rejects an existing source claim without its record rather than silently repairing it", async () => {
    const record = migrationFixtures()[1]; await repository.createRecordForMigration(record);
    await deleteDoc(ref(record.id));
    await expect(repository.createRecordForMigration(record)).rejects.toThrow("without its acquisition");
    expect(await repository.list()).toHaveLength(0);
  });
  it("safely resumes an interrupted transfer without changing the original local snapshots", async () => {
    const records = migrationFixtures(), before = structuredClone(records);
    let reads = 0;
    const interrupted = {
      list: () => repository.list(), loadDraft: () => repository.loadDraft(),
      createDraftForMigration: repository.createDraftForMigration.bind(repository),
      createRecordForMigration: repository.createRecordForMigration.bind(repository),
      getForMigration: async (id: string) => { if (++reads === 2) throw new Error("Synthetic connection interruption"); return repository.getForMigration(id); }
    };
    await expect(migrateAcquisitions(interrupted, records)).rejects.toMatchObject({ completedIds: [records[0].id] });
    expect(await repository.list()).toHaveLength(2);
    const retry = await migrateAcquisitions(repository, records);
    expect(retry.records.map(item => item.result)).toEqual(["already-identical", "already-identical", "created", "created"]);
    expect(records).toEqual(before);
  });
  it("halts before the next acquisition if complete financial or evidence readback differs", async () => {
    const records = migrationFixtures();
    const target = {
      list: () => repository.list(), loadDraft: () => repository.loadDraft(),
      createDraftForMigration: repository.createDraftForMigration.bind(repository),
      createRecordForMigration: repository.createRecordForMigration.bind(repository),
      getForMigration: async (id: string) => { const record = await repository.getForMigration(id); record.state.scan.financials.sde.excerpts = ["Synthetic mismatch"]; return record; }
    };
    await expect(migrateAcquisitions(target, records)).rejects.toMatchObject({ completedIds: [] });
    expect(await repository.list()).toEqual([records[0]]);
  });
  it("recovers a create-only migrated draft without resetting its linked historical revision", async () => {
    const records = migrationFixtures(), draft = { recordId: records[3].id, recordRevision: 23, state: structuredClone(records[3].state) };
    draft.state.cashFlow.debtService = "17000";
    await migrateAcquisitions(repository, records, { draft });
    const fresh = new FirestoreAcquisitionRepository(environment.authenticatedContext(uid).firestore() as unknown as Firestore, uid);
    expect((await fresh.loadDraft()).value).toEqual(draft);
    expect(await fresh.get(records[3].id)).toEqual(records[3]);
    expect((await migrateAcquisitions(fresh, records, { draft })).draft).toBe("already-identical");
  });
  it("clears draft content using a null tombstone, preventing stale-session resurrection without admin cleanup", async () => {
    const records = migrationFixtures(), draft = { recordId: records[1].id, recordRevision: 4, state: records[1].state };
    await migrateAcquisitions(repository, records, { draft });
    expect(await repository.saveDraft(null, 1)).toBe(2);
    expect(await repository.loadDraft()).toEqual({ revision: 2, value: null });
    await expect(repository.saveDraft(draft, 1)).rejects.toThrow();
    await expect(repository.saveDraft(draft, 0)).rejects.toThrow();
    await expect(repository.createDraftForMigration(draft)).rejects.toThrow("draft conflict");
    await assertFails(deleteDoc(doc(db, "users", uid, "workspace", "current")));
    expect(await repository.list()).toHaveLength(4);
  });
  it("rejects offset tampering, malformed offsets, extra fields and workspace migration offsets", async () => {
    const record = migrationFixtures()[2]; await repository.createRecordForMigration(record);
    const data = (await getDoc(ref(record.id))).data()!;
    for (const offset of [-1, 1.5, "8", 1_000_000_000_000, 9]) {
      await assertFails(setDoc(ref(record.id), { ...data, revision: 2, migrationRevisionOffset: offset, updatedAt: serverTimestamp() }));
    }
    for (const offset of [-1, 1.5, "8", 1_000_000_000_000]) {
      await assertFails(setDoc(ref("malformed-offset"), { ...data, id: "malformed-offset", revision: 1, migrationRevisionOffset: offset, updatedAt: serverTimestamp() }));
    }
    const { migrationRevisionOffset: _offset, ...without } = data;
    await assertFails(setDoc(ref(record.id), { ...without, revision: 2, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(ref(record.id), { ...data, revision: 3, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(ref(record.id), { ...data, revision: 2, extra: true, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "users", uid, "workspace", "current"), { ...data, id: "current", revision: 1, updatedAt: serverTimestamp() }));
  });
  it("keeps source-key schema, ownership, referential and immutability protections unchanged", async () => {
    const record = migrationFixtures()[1]; await repository.createRecordForMigration(record);
    const source = doc(db, "users", uid, "sourceKeys", "c".repeat(64));
    for (const data of [{ ownerUid: uid, recordId: "missing-record" }, { ownerUid: "other-synthetic", recordId: record.id },
      { ownerUid: uid, recordId: record.id, extra: true }]) await assertFails(setDoc(source, data));
    await setDoc(source, { ownerUid: uid, recordId: record.id });
    await assertFails(setDoc(source, { ownerUid: uid, recordId: record.id }));
    await assertFails(setDoc(doc(db, "users", uid, "sourceKeys", "invalid-key"), { ownerUid: uid, recordId: record.id }));
  });
  it("denies unsigned and unrelated accounts on all migration paths and transactions", async () => {
    const record = migrationFixtures()[1]; await repository.createRecordForMigration(record);
    await repository.createDraftForMigration({ recordId: record.id, recordRevision: 4, state: record.state });
    const data = (await getDoc(ref(record.id))).data()!;
    for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext("unauthorized-synthetic")]) {
      const other = context.firestore() as unknown as Firestore, unauthorized = new FirestoreAcquisitionRepository(other, uid);
      await expect(unauthorized.createRecordForMigration(record)).rejects.toThrow();
      for (const group of ["acquisitions", "workspace", "sourceKeys"]) await assertFails(getDocs(collection(other, "users", uid, group)));
      await assertFails(setDoc(doc(other, "users", uid, "acquisitions", record.id), { ...data, revision: 2, updatedAt: serverTimestamp() }));
      await assertFails(deleteDoc(doc(other, "users", uid, "workspace", "current")));
      await assertFails(setDoc(doc(other, "users", "unauthorized-synthetic", "acquisitions", record.id), { ...data, ownerUid: "unauthorized-synthetic", updatedAt: serverTimestamp() }));
    }
    await assertFails(getDocs(collection(db, "users", "unauthorized-synthetic", "acquisitions")));
  });
  it("preserves photographs, classifications, corrections, assumptions, JSON, CSV and PDF content exactly", async () => {
    const records = migrationFixtures(); await migrateAcquisitions(repository, records);
    for (const original of records) {
      const restored = await repository.get(original.id);
      expect(restored).toEqual(original);
      expect(parseBackup(serializeBackup(restored)).state).toEqual(original.state);
      expect(buildSavedAcquisitionsCsv([restored])).toEqual(buildSavedAcquisitionsCsv([original]));
      expect(buildReportLines(restored.state.scan, restored.state.cashFlow)).toEqual(buildReportLines(original.state.scan, original.state.cashFlow));
      expect(restored.state.scan.retrieval?.photographs).toHaveLength(1);
      expect(restored.state.scan.financials.sde.source).toBe("user_correction");
    }
  });
});
