import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { syntheticPilotRules } from "../scripts/pilotRules";
import { FirestoreAcquisitionRepository } from "../src/firestoreAcquisitionRepository";
import { syntheticLibrary } from "./syntheticSavedLibrary";
import { migrationFixtures } from "./cloudMigrationFixtures";
import { WorkspaceSession } from "../src/workspaceSession";

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8180") throw new Error("Pilot tests require the isolated loopback Firestore emulator; live data is forbidden.");
const founder = "synthetic-founder", pilotA = "synthetic-pilot-A", pilotB = "synthetic-pilot-B";
const admitted = [founder, pilotA, pilotB];
let environment: RulesTestEnvironment;
const database = (uid: string, claim: unknown = true) => environment.authenticatedContext(uid,
  uid === founder ? {} : { kingdomhausPilot: claim }).firestore() as unknown as Firestore;
const repository = (uid: string) => new FirestoreAcquisitionRepository(database(uid), uid);
const reference = (db: Firestore, uid: string, id: string) => doc(db, "users", uid, "acquisitions", id);
const envelope = (uid: string, id = "synthetic-record") => ({ schemaVersion: 1, ownerUid: uid, id, revision: 1,
  payload: "{}", updatedAt: serverTimestamp() });
beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-kingdomhaus-pilot", firestore: {
    host: "127.0.0.1", port: 8180, rules: syntheticPilotRules()
  } });
});
beforeEach(async () => { await environment.clearFirestore(); });
afterAll(async () => { await environment?.cleanup(); });

describe("reviewed pilot candidate — synthetic Firestore only", () => {
  it("rejects closed account-bound repositories and preserves the original owner's data after switching", async () => {
    const dbA = database(pilotA), dbB = database(pilotB);
    let current = pilotA;
    const session = new WorkspaceSession(pilotA, false, () => current === pilotA);
    const a = new FirestoreAcquisitionRepository(dbA, pilotA, () => true, () => session.assert());
    const record = syntheticLibrary(1)[0]; await a.save(record, null);
    current = pilotB; session.close();
    await expect(a.list()).rejects.toThrow(/account or workspace changed/);
    await expect(a.save({ ...record, revision: record.revision + 1 }, record.revision)).rejects.toThrow(/account or workspace changed/);
    await expect(a.saveDraft(null, 0)).rejects.toThrow(/account or workspace changed/);
    await expect(a.remove(record.id, record.revision)).rejects.toThrow(/account or workspace changed/);
    expect(await new FirestoreAcquisitionRepository(dbB, pilotB).list()).toEqual([]);
    expect(await new FirestoreAcquisitionRepository(dbA, pilotA).get(record.id)).toEqual(record);
  });
  it("prevents an actual Firestore draft transaction committing after pre-commit account cancellation", async () => {
    const db = database(pilotA), session = new WorkspaceSession(pilotA, false, () => true);
    let checks = 0;
    const repo = new FirestoreAcquisitionRepository(db, pilotA, () => true, () => {
      if (++checks === 4) session.close();
      session.assert();
    });
    await expect(repo.saveDraft(null, 0)).rejects.toThrow(/account or workspace changed/);
    expect((await getDoc(doc(db, "users", pilotA, "workspace", "current"))).exists()).toBe(false);
  });
  it("gives founder and both approved pilots separate empty workspaces and own-record CRUD", async () => {
    for (const uid of admitted) {
      const repo = repository(uid), record = syntheticLibrary(1)[0];
      expect(await repo.list()).toEqual([]); expect(await repo.loadDraft()).toEqual({ revision: 0, value: null });
      await repo.save(record, null);
      expect(await repo.get(record.id)).toEqual(record);
      const updated = { ...record, revision: record.revision + 1, name: "Synthetic rename" };
      await repo.save(updated, record.revision);
      expect(await repo.get(record.id)).toEqual(updated);
      await repo.remove(record.id, updated.revision); expect(await repo.list()).toEqual([]);
    }
  });
  it("blocks cross-user document reads, list queries, writes and deletes, including founder-to-pilot access", async () => {
    for (const uid of admitted) await setDoc(reference(database(uid), uid, "synthetic-record"), envelope(uid));
    for (const actor of admitted) for (const owner of admitted.filter(uid => uid !== actor)) {
      const db = database(actor), ref = reference(db, owner, "synthetic-record");
      await assertFails(getDoc(ref)); await assertFails(getDocs(collection(db, "users", owner, "acquisitions")));
      await assertFails(setDoc(ref, { ...envelope(owner), revision: 2 }));
      await assertFails(setDoc(reference(db, owner, "new-record"), envelope(owner, "new-record")));
      await assertFails(deleteDoc(ref));
    }
    for (const uid of admitted) expect((await getDoc(reference(database(uid), uid, "synthetic-record"))).data()?.revision).toBe(1);
  });
  it("denies unsigned, unapproved and truthy-but-not-boolean claims on all workspace paths", async () => {
    const contexts = [environment.unauthenticatedContext(), environment.authenticatedContext("synthetic-unapproved"),
      environment.authenticatedContext("synthetic-string", { kingdomhausPilot: "true" }),
      environment.authenticatedContext("synthetic-false", { kingdomhausPilot: false })];
    for (const context of contexts) {
      const db = context.firestore() as unknown as Firestore;
      const uid = "synthetic-unapproved";
      for (const ref of [reference(db, uid, "synthetic-record"), doc(db, "users", uid, "workspace", "current"), doc(db, "users", uid, "sourceKeys", "a".repeat(64))]) {
        await assertFails(getDoc(ref)); await assertFails(setDoc(ref, envelope(uid))); await assertFails(deleteDoc(ref));
      }
    }
  });
  it("rejects forged owner metadata, mismatched IDs, invalid schemas, timestamps and revisions", async () => {
    const db = database(pilotA), ref = reference(db, pilotA, "synthetic-record");
    for (const change of [{ ownerUid: founder }, { id: "different" }, { schemaVersion: 2 }, { revision: 2 },
      { revision: 1.5 }, { payload: {} }, { payload: "x".repeat(900001) }, { updatedAt: new Date(0) }, { extra: true }]) {
      await assertFails(setDoc(ref, { ...envelope(pilotA), ...change }));
    }
    await setDoc(ref, envelope(pilotA));
    await assertFails(setDoc(ref, { ...envelope(pilotA), revision: 2, ownerUid: pilotB }));
    await assertFails(setDoc(ref, { ...envelope(pilotA), revision: 3 }));
    expect((await getDoc(ref)).data()?.ownerUid).toBe(pilotA);
  });
  it("preserves four synthetic founder historical records and immutable offset compatibility", async () => {
    const records = migrationFixtures(), repo = repository(founder), db = database(founder);
    for (const record of records) await repo.createRecordForMigration(record);
    for (const record of records) expect(await repo.get(record.id)).toEqual(record);
    const record = records[2], ref = reference(db, founder, record.id), data = (await getDoc(ref)).data()!;
    for (const offset of [-1, 1.5, "8", 1_000_000_000_000, data.migrationRevisionOffset + 1])
      await assertFails(setDoc(ref, { ...data, revision: 2, migrationRevisionOffset: offset, updatedAt: serverTimestamp() }));
    const { migrationRevisionOffset: _offset, ...without } = data;
    await assertFails(setDoc(ref, { ...without, revision: 2, updatedAt: serverTimestamp() }));
    const updated = { ...record, revision: record.revision + 1 };
    await repo.save(updated, record.revision); expect(await repo.get(record.id)).toEqual(updated);
    for (const other of records.filter(item => item.id !== record.id)) expect(await repo.get(other.id)).toEqual(other);
    expect(await repo.list()).toHaveLength(4);
  });
  it("prevents pilots creating migration metadata or adding it to ordinary acquisitions", async () => {
    const db = database(pilotA), ref = reference(db, pilotA, "synthetic-record");
    for (const offset of [0, 8, -1, 1.5, "8", 1_000_000_000_000])
      await assertFails(setDoc(ref, { ...envelope(pilotA), migrationRevisionOffset: offset }));
    await setDoc(ref, envelope(pilotA));
    await assertFails(setDoc(ref, { ...envelope(pilotA), revision: 2, migrationRevisionOffset: 0 }));
  });
  it("isolates drafts and enforces sequential revisions, ownership and no draft migration metadata", async () => {
    const a = repository(pilotA), b = repository(pilotB), record = syntheticLibrary(1)[0];
    const draft = { recordId: null, recordRevision: null, state: record.state };
    await a.saveDraft(draft, 0); expect((await b.loadDraft()).value).toBeNull();
    const db = database(pilotA), ref = doc(db, "users", pilotA, "workspace", "current");
    const data = (await getDoc(ref)).data()!;
    for (const change of [{ ownerUid: pilotB }, { id: "other" }, { migrationRevisionOffset: 0 }, { revision: 3 }, { extra: true }])
      await assertFails(setDoc(ref, { ...data, revision: 2, updatedAt: serverTimestamp(), ...change }));
    await assertFails(getDoc(doc(database(pilotB), "users", pilotA, "workspace", "current")));
    await assertFails(deleteDoc(ref));
    expect(await a.saveDraft(null, 1)).toBe(2); expect(await a.loadDraft()).toEqual({ revision: 2, value: null });
    await expect(a.saveDraft(draft, 1)).rejects.toThrow();
  });
  it("keeps duplicate-source claims scoped, referentially checked and immutable", async () => {
    const key = "a".repeat(64);
    for (const uid of admitted) {
      const db = database(uid), claim = doc(db, "users", uid, "sourceKeys", key);
      await assertFails(setDoc(claim, { ownerUid: uid, recordId: "missing" }));
      await setDoc(reference(db, uid, "synthetic-record"), envelope(uid));
      await assertFails(setDoc(claim, { ownerUid: pilotB === uid ? pilotA : pilotB, recordId: "synthetic-record" }));
      await setDoc(claim, { ownerUid: uid, recordId: "synthetic-record" });
      await assertFails(setDoc(claim, { ownerUid: uid, recordId: "synthetic-record" }));
      await assertFails(getDoc(doc(database(uid === pilotA ? pilotB : pilotA), "users", uid, "sourceKeys", key)));
      await assertFails(deleteDoc(doc(database(uid === pilotA ? pilotB : pilotA), "users", uid, "sourceKeys", key)));
    }
  });
  it("keeps all unrelated documents, collections and nested paths denied", async () => {
    const db = database(pilotA);
    for (const path of [["users", pilotA], ["users", pilotA, "workspace", "other"], ["users", pilotA, "acquisitions", "synthetic-record", "nested", "item"], ["admin", "config"]]) {
      const ref = doc(db, path[0], ...path.slice(1));
      await assertFails(getDoc(ref)); await assertFails(setDoc(ref, { ownerUid: pilotA })); await assertFails(deleteDoc(ref));
    }
  });
});
