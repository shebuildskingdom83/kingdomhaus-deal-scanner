import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, disableNetwork, doc, enableNetwork, getDoc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { FirestoreAcquisitionRepository } from "../src/firestoreAcquisitionRepository";
import { conflictMessage, recordPayload } from "../src/cloudPersistence";
import { syntheticLibrary } from "./syntheticSavedLibrary";
import { buildSavedAcquisitionsCsv } from "../src/csv";
import { parseBackup, serializeBackup } from "../src/storage";
import { savedAcquisitionView } from "../src/savedAcquisitionView";
import { deleteApp, initializeApp } from "firebase/app";
import { GoogleAuthProvider, inMemoryPersistence, initializeAuth, connectAuthEmulator, signInWithCredential, signOut } from "firebase/auth";
import { buildReportLines } from "../src/pdf";
import { calculateAcquisitionCashFlow, createCashFlowAssumptions } from "../src/acquisitionCashFlow";
import { buildLocalPreviewScan } from "../src/validation";
import { formFromScan, makeRecord } from "../src/storage";
import { syntheticManufacturingFixture, syntheticManufacturingUrl } from "./fixtures";
import { syntheticFounderRules } from "../scripts/founderRules";
import { migrationFixtures } from "./cloudMigrationFixtures";

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080") throw new Error("Cloud tests require the local emulator; live Firebase is never permitted.");
const uid = "synthetic-founder";
let environment: RulesTestEnvironment;
let repository: FirestoreAcquisitionRepository;
let db: Firestore;
const rules = syntheticFounderRules();
const sample = () => syntheticLibrary(1)[0];
const envelope = () => ({ schemaVersion: 1, ownerUid: uid, id: sample().id, revision: 1,
  payload: recordPayload(sample()), updatedAt: serverTimestamp() });

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-kingdomhaus", firestore: { host: "127.0.0.1", port: 8080, rules } });
});
beforeEach(async () => {
  await environment.clearFirestore();
  db = environment.authenticatedContext(uid).firestore() as unknown as Firestore;
  repository = new FirestoreAcquisitionRepository(db, uid);
});
afterAll(async () => { await environment?.cleanup(); });

describe("synthetic Firebase cloud persistence", () => {
  it("keeps historical-revision migration blocked by the unchanged deployed policy until separate rule approval", async () => {
    await expect(repository.createRecordForMigration(migrationFixtures()[1])).rejects.toThrow();
    expect(await repository.list()).toEqual([]);
    expect((await getDocs(collection(db, "users", uid, "sourceKeys"))).empty).toBe(true);
  });
  it("denies unauthenticated access and an unrelated authenticated UID", async () => {
    await repository.save(sample(), null);
    for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext("other-user")]) {
      const ref = doc(context.firestore() as unknown as Firestore, "users", uid, "acquisitions", sample().id);
      await assertFails(getDoc(ref)); await assertFails(setDoc(ref, envelope())); await assertFails(deleteDoc(ref));
    }
  });
  it("denies access to another ownership path and unapproved collections", async () => {
    await assertFails(setDoc(doc(db, "users", "other-user", "acquisitions", sample().id), envelope()));
    await assertFails(setDoc(doc(db, "configuration", "owner"), { ownerUid: uid }));
  });
  it("denies unauthenticated and other-user reads, lists and writes for every protected collection", async () => {
    const key = "a".repeat(64);
    await repository.save(sample(), null);
    await repository.saveDraft({ recordId: null, recordRevision: null, state: sample().state }, 0);
    await setDoc(doc(db, "users", uid, "sourceKeys", key), { ownerUid: uid, recordId: sample().id });
    const paths = [["acquisitions", sample().id], ["workspace", "current"], ["sourceKeys", key]];
    for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext("other-user")]) {
      const unauthorized = context.firestore() as unknown as Firestore;
      for (const [group, id] of paths) {
        const ref = doc(unauthorized, "users", uid, group, id);
        await assertFails(getDoc(ref));
        await assertFails(getDocs(collection(unauthorized, "users", uid, group)));
        await assertFails(setDoc(ref, group === "sourceKeys" ? { ownerUid: uid, recordId: sample().id } : { ...envelope(), id, revision: 2 }));
        await assertFails(deleteDoc(ref));
      }
      await assertFails(setDoc(doc(unauthorized, "users", "other-user", "acquisitions", sample().id), { ...envelope(), ownerUid: "other-user" }));
    }
  });
  it("denies founder cross-owner access, unrecognized documents and nested subcollections", async () => {
    for (const [group, id] of [["acquisitions", sample().id], ["workspace", "current"], ["sourceKeys", "a".repeat(64)]]) {
      await assertFails(getDoc(doc(db, "users", "other-user", group, id)));
      await assertFails(getDocs(collection(db, "users", "other-user", group)));
      await assertFails(setDoc(doc(db, "users", "other-user", group, id), envelope()));
    }
    await assertFails(setDoc(doc(db, "users", uid, "workspace", "unexpected"), { ...envelope(), id: "unexpected" }));
    await assertFails(setDoc(doc(db, "users", uid, "acquisitions", sample().id, "nested", "record"), envelope()));
    await assertFails(getDoc(doc(db, "users", uid, "unknown", "record")));
  });
  it("enforces workspace identity, revision, schema and deletion protections", async () => {
    const ref = doc(db, "users", uid, "workspace", "current");
    const value = { ...envelope(), id: "current", payload: "null" };
    for (const invalid of [{ ownerUid: "other-user" }, { id: "unexpected" }, { revision: 2 }, { schemaVersion: 2 }, { extra: true }, { payload: "x".repeat(900001) }]) {
      await assertFails(setDoc(ref, { ...value, ...invalid }));
    }
    await assertSucceeds(setDoc(ref, value));
    await assertFails(setDoc(ref, value));
    await assertSucceeds(setDoc(ref, { ...value, revision: 2 }));
    await assertFails(deleteDoc(ref));
  });
  it("validates source-key ownership, reference, schema and immutability", async () => {
    const ref = doc(db, "users", uid, "sourceKeys", "b".repeat(64));
    const key = { ownerUid: uid, recordId: sample().id };
    await assertFails(setDoc(ref, key));
    await repository.save(sample(), null);
    for (const invalid of [{ ownerUid: "other-user" }, { recordId: "missing-record" }, { recordId: "invalid/path" }, { recordId: "x".repeat(101) }, { extra: true }]) {
      await assertFails(setDoc(ref, { ...key, ...invalid }));
    }
    await assertFails(setDoc(doc(db, "users", uid, "sourceKeys", "invalid-key"), key));
    await assertSucceeds(setDoc(ref, key));
    await assertSucceeds(getDoc(ref));
    await assertFails(setDoc(ref, key));
    await assertSucceeds(deleteDoc(ref));
  });
  it("rejects record identity and owner changes and nonsequential revision numbers", async () => {
    const ref = doc(db, "users", uid, "acquisitions", sample().id);
    await setDoc(ref, envelope());
    for (const invalid of [{ id: "other-record" }, { ownerUid: "other-user" }, { revision: 0 }, { revision: 1.5 }, { revision: 3 }]) {
      await assertFails(setDoc(ref, { ...envelope(), revision: 2, ...invalid }));
    }
  });
  it("enforces owner, schema, revision, timestamp and size rules", async () => {
    const ref = doc(db, "users", uid, "acquisitions", sample().id);
    for (const invalid of [{ ownerUid: "other-user" }, { revision: 2 }, { schemaVersion: 2 },
      { extra: "forbidden" }, { updatedAt: new Date() }, { payload: "x".repeat(900001) }]) {
      await assertFails(setDoc(ref, { ...envelope(), ...invalid }));
    }
    await assertSucceeds(setDoc(ref, envelope()));
    await assertFails(setDoc(ref, envelope()));
    await assertFails(setDoc(ref, { ...envelope(), revision: 3 }));
  });
  it("creates, reopens, updates, renames and deletes with expected revisions", async () => {
    const record = sample(); await repository.save(record, null);
    expect(await repository.get(record.id)).toEqual(record);
    const renamed = { ...record, name: "Fictional Renamed", revision: 2 };
    await repository.save(renamed, 1);
    expect((await repository.list())[0]).toEqual(renamed);
    await expect(repository.remove(record.id, 1)).rejects.toThrow(conflictMessage);
    await repository.remove(record.id, 2);
    expect(await repository.list()).toEqual([]);
  });
  it("rejects duplicate creates and stale simultaneous updates without silent overwrites", async () => {
    const record = sample(); await repository.save(record, null);
    await expect(repository.save(record, null)).rejects.toThrow(conflictMessage);
    const outcomes = await Promise.allSettled([
      repository.save({ ...record, revision: 2, name: "Fictional edit A" }, 1),
      repository.save({ ...record, revision: 2, name: "Fictional edit B" }, 1)
    ]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((await repository.get(record.id)).revision).toBe(2);
  });
  it("autosaves a draft without modifying its named acquisition", async () => {
    const record = sample(); await repository.save(record, null);
    const draft = { recordId: record.id, recordRevision: record.revision, state: structuredClone(record.state) };
    draft.state.form.businessName = "Unconfirmed draft edit";
    expect(await repository.saveDraft(draft, 0)).toBe(1);
    expect((await repository.loadDraft()).value).toEqual(draft);
    expect(await repository.get(record.id)).toEqual(record);
    await expect(repository.saveDraft(null, 0)).rejects.toThrow(conflictMessage);
    expect(await repository.saveDraft(null, 1)).toBe(2);
    expect((await repository.loadDraft()).value).toBeNull();
  });
  it("restores complete records and drafts from a new repository session", async () => {
    const record = sample(); await repository.save(record, null);
    const draft = { recordId: record.id, recordRevision: 1, state: record.state };
    await repository.saveDraft(draft, 0);
    const secondDb = environment.authenticatedContext(uid).firestore() as unknown as Firestore;
    const second = new FirestoreAcquisitionRepository(secondDb, uid);
    expect(await second.get(record.id)).toEqual(record);
    expect((await second.loadDraft()).value).toEqual(draft);
  });
  it("preserves JSON recovery and CSV equivalence", async () => {
    const record = sample(); await repository.save(record, null);
    const restored = await repository.get(record.id);
    expect(parseBackup(serializeBackup(restored)).state).toEqual(record.state);
    expect(buildSavedAcquisitionsCsv([restored])).toEqual(buildSavedAcquisitionsCsv([record]));
  });
  it("preserves financial evidence, corrections, assumptions and PDF report lines", async () => {
    const scan = buildLocalPreviewScan({ listingUrl: syntheticManufacturingUrl, listingText: syntheticManufacturingFixture,
      corrections: { businessWebsite: "https://synthetic-workshop.example/", streetAddress: "123 Fictional Lane, Example, NC 27000", sde: "227261" } });
    const cashFlow = { ...createCashFlowAssumptions(), startingMetric: "sde" as const, debtService: "15000", managementCosts: "25000",
      capexReserve: "5000", workingCapitalReserve: "3000", payrollSavings: "2000", implementationCosts: "3000" };
    const record = makeRecord({ scan, form: formFromScan(scan), cashFlow });
    await repository.save(record, null);
    const restored = await repository.get(record.id);
    expect(restored).toEqual(record);
    expect(buildReportLines(restored.state.scan, restored.state.cashFlow)).toEqual(buildReportLines(scan, cashFlow));
    expect(calculateAcquisitionCashFlow(restored.state.scan.financials, restored.state.cashFlow)).toEqual(calculateAcquisitionCashFlow(scan.financials, cashFlow));
  });
  it("prevents duplicate source listings with different imported identities", async () => {
    const record = sample(); record.state.scan.listingUrl = syntheticManufacturingUrl;
    await repository.save(record, null);
    const duplicate = structuredClone(record); duplicate.id = "different-import-identity"; duplicate.state.scan.id = duplicate.id;
    await expect(repository.save(duplicate, null)).rejects.toThrow("source listing already exists");
    expect(await repository.list()).toHaveLength(1);
    await repository.remove(record.id, 1); await repository.save(duplicate, null);
    expect((await repository.list())[0].id).toBe(duplicate.id);
  });
  it("preserves synthetic approved photograph references and provenance through cloud and JSON", async () => {
    // Fabricated, deliberately nonexistent image references: no network retrieval.
    const sourceUrl = "https://www.bizbuysell.com/business-opportunity/synthetic-cloud-media/9900999/";
    const scan = buildLocalPreviewScan({ listingUrl: sourceUrl, listingText: "Fictional cloud photo test business. Asking Price: $125000. Gross Revenue: $325000." });
    scan.retrieval = { provider: "apify", actorId: "synthetic", sourceUrl, retrievedAt: new Date().toISOString(),
      rawRecord: {}, usageUsd: null, maxChargeUsd: 0.25, conflicts: [], photographs: [{
        url: "https://images.bizbuysell.com/synthetic-cloud/fictional-workshop.jpg", sourceUrl,
        alt: "Synthetic workshop", caption: "Synthetic listing photograph", attribution: "Synthetic source credit"
      }] };
    const record = makeRecord({ scan, form: formFromScan(scan), cashFlow: createCashFlowAssumptions() });
    await repository.save(record, null);
    const restored = parseBackup(serializeBackup(await repository.get(record.id)));
    expect(restored.state).toEqual(record.state);
    expect(restored.state.scan.retrieval?.photographs).toEqual(scan.retrieval.photographs);
    expect(restored.state.scan.retrieval?.photographs.length).toBe(1);
  });
  it("fails offline transactions without queueing an unconfirmed record or draft overwrite", async () => {
    const record = sample(); await repository.save(record, null);
    await repository.saveDraft({ recordId: record.id, recordRevision: 1, state: record.state }, 0);
    const offlineRepository = new FirestoreAcquisitionRepository(db, uid, () => false);
    await disableNetwork(db);
    try {
      await expect(offlineRepository.save({ ...record, name: "Unconfirmed offline edit", revision: 2 }, 1)).rejects.toThrow("Offline");
      await expect(offlineRepository.saveDraft(null, 1)).rejects.toThrow("Offline");
    } finally { await enableNetwork(db); }
    expect(await repository.get(record.id)).toEqual(record);
    expect((await repository.loadDraft()).revision).toBe(1);
  });
  it("signs in and out using a synthetic Google credential against Auth emulator only", async () => {
    if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") throw new Error("Auth emulator required");
    const app = initializeApp({ apiKey: "demo-key", projectId: "demo-kingdomhaus" }, "synthetic-auth-test");
    try {
      const auth = initializeAuth(app, { persistence: inMemoryPersistence });
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      const credential = GoogleAuthProvider.credential(JSON.stringify({ sub: "synthetic-google-test", email: "founder@example.test", email_verified: true }));
      const result = await signInWithCredential(auth, credential);
      expect(result.user.providerData[0].providerId).toBe("google.com");
      expect(auth.currentUser).not.toBeNull(); await signOut(auth); expect(auth.currentUser).toBeNull();
    } finally { await deleteApp(app); }
  });
  it("supports search and 10-per-page pagination across 53 synthetic records", async () => {
    const records = syntheticLibrary();
    for (const record of records) await repository.save(record, null);
    const loaded = await repository.list();
    expect(loaded).toHaveLength(53);
    expect(savedAcquisitionView(loaded, "", 1).records).toHaveLength(10);
    expect(savedAcquisitionView(loaded, "", 6).records).toHaveLength(3);
    expect(savedAcquisitionView(loaded, "METAL wo", 1).total).toBe(26);
    expect(savedAcquisitionView(loaded, "nonexistent", 1).records).toHaveLength(0);
  });
});
