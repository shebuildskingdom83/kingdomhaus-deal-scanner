import { collection, doc, getDocFromServer, getDocsFromServer, runTransaction, serverTimestamp } from "firebase/firestore";
import type { Firestore, DocumentData, Transaction } from "firebase/firestore";
import type { AcquisitionRecord, RecoveryDraft } from "./acquisitionRecord";
import { parseJson, validateDraft, validateRecord } from "./recordValidation";
import { conflictMessage, draftPayload, MAX_CLOUD_PAYLOAD_BYTES, recordPayload } from "./cloudPersistence";
import type { CloudDraft, CloudRepository } from "./cloudPersistence";
import { migrationDraft, migrationListingIdentity, migrationRecord, sameMigrationContent } from "./cloudMigration";
import type { MigrationResult } from "./cloudMigration";

function revisionOffset(data: DocumentData | undefined): number {
  const offset = data?.migrationRevisionOffset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 999_999_999_999) throw new Error("Invalid cloud migration revision metadata.");
  return offset;
}

function revisionCheck(current: DocumentData | undefined, expected: number | null) {
  if ((current ? current.revision + revisionOffset(current) : null) !== expected) throw new Error(conflictMessage);
}
function decodeRecord(data: DocumentData, id: string): AcquisitionRecord {
  const record = validateRecord(parseJson(data.payload, MAX_CLOUD_PAYLOAD_BYTES));
  if (record.id !== id || record.revision !== data.revision + revisionOffset(data)) throw new Error("Cloud record metadata is inconsistent. Nothing was replaced.");
  return record;
}
async function sourceKey(record: AcquisitionRecord): Promise<string | null> {
  const canonical = migrationListingIdentity(record);
  if (!canonical) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export class FirestoreAcquisitionRepository implements CloudRepository {
  constructor(private db: Firestore, private uid: string,
    private online: () => boolean = () => typeof navigator === "undefined" || navigator.onLine !== false,
    private checkAccount: () => void = () => {}) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error("Invalid authorized account.");
  }
  private requireOnline() {
    this.checkAccount();
    if (!this.online()) throw new Error("Offline. Cloud changes were not sent. Your edits remain in memory and can be lost if the tab closes.");
  }
  private transaction<T>(action: (transaction: Transaction) => Promise<T>) {
    this.requireOnline();
    return runTransaction(this.db, async transaction => {
      this.requireOnline();
      const result = await action(transaction);
      this.requireOnline(); // Also guards transaction retries and the final pre-commit boundary.
      return result;
    }).then(value => { this.checkAccount(); return value; });
  }
  private record(id: string) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid acquisition identity.");
    return doc(this.db, "users", this.uid, "acquisitions", id);
  }
  private source(key: string) { return doc(this.db, "users", this.uid, "sourceKeys", key); }
  async list() {
    this.requireOnline();
    const result = await getDocsFromServer(collection(this.db, "users", this.uid, "acquisitions"));
    this.checkAccount();
    return result.docs.map(item => decodeRecord(item.data(), item.id));
  }
  async get(id: string) {
    this.requireOnline();
    const result = await getDocFromServer(this.record(id));
    this.checkAccount();
    if (!result.exists()) throw new Error("The saved acquisition no longer exists.");
    return decodeRecord(result.data(), id);
  }
  async save(input: AcquisitionRecord, expected: number | null) {
    this.requireOnline();
    const record = validateRecord(input);
    const payload = recordPayload(record);
    if (record.revision !== (expected ?? 0) + 1) throw new Error("Invalid cloud record revision.");
    const ref = this.record(record.id);
    const key = await sourceKey(record);
    await this.transaction(async transaction => {
      const previous = await transaction.get(ref);
      revisionCheck(previous.data(), expected);
      const previousKey = previous.exists() ? await sourceKey(decodeRecord(previous.data(), record.id)) : null;
      if (key) {
        const claimed = await transaction.get(this.source(key));
        if (claimed.exists() && claimed.data().recordId !== record.id) throw new Error("An acquisition with this source listing already exists. Reload Saved scans before importing or saving again.");
        if (!claimed.exists()) transaction.set(this.source(key), { ownerUid: this.uid, recordId: record.id });
      }
      if (previousKey && previousKey !== key) transaction.delete(this.source(previousKey));
      const offset = revisionOffset(previous.data());
      transaction.set(ref, { schemaVersion: 1, ownerUid: this.uid, id: record.id, revision: record.revision - offset,
        ...(previous.data()?.migrationRevisionOffset !== undefined ? { migrationRevisionOffset: offset } : {}),
        payload, updatedAt: serverTimestamp() });
    });
  }
  async getForMigration(id: string): Promise<AcquisitionRecord> {
    this.requireOnline();
    const result = await getDocFromServer(this.record(id));
    this.checkAccount();
    if (!result.exists()) throw new Error("The migration copy does not exist.");
    const data = result.data();
    decodeRecord(data, id);
    return migrationRecord(parseJson(data.payload, MAX_CLOUD_PAYLOAD_BYTES) as AcquisitionRecord);
  }
  async reviewMigrationSelection(input: readonly AcquisitionRecord[]) {
    this.requireOnline();
    const selected = input.map(migrationRecord), existing = await this.list();
    if ((await this.loadDraft()).value !== null) throw new Error("Existing cloud draft requires separate review.");
    for (const record of existing) {
      const sameId = selected.find(item => item.id === record.id);
      if (sameId && !sameMigrationContent(sameId, record)) throw new Error("Migration record conflict.");
      if (selected.some(item => item.id !== record.id && migrationListingIdentity(item) === migrationListingIdentity(record))) throw new Error("Migration listing conflict.");
    }
    for (const record of selected) {
      const key = await sourceKey(record);
      if (!key) throw new Error("Missing canonical migration source.");
      const [copy, claim] = await Promise.all([getDocFromServer(this.record(record.id)), getDocFromServer(this.source(key))]);
      this.checkAccount();
      if (claim.exists() && (claim.data().ownerUid !== this.uid || claim.data().recordId !== record.id || !copy.exists())) throw new Error("Migration source claim conflict.");
      if (copy.exists() && (!claim.exists() || !sameMigrationContent(parseJson(copy.data().payload, MAX_CLOUD_PAYLOAD_BYTES), record))) throw new Error("Migration copy differs.");
    }
    this.checkAccount();
    return { existingCount: existing.length, selectedCount: selected.length };
  }
  async createRecordForMigration(input: AcquisitionRecord): Promise<MigrationResult> {
    this.requireOnline();
    const record = migrationRecord(input), ref = this.record(record.id);
    const payload = cloudMigrationPayload(record), key = await sourceKey(record);
    return this.transaction(async transaction => {
      const previous = await transaction.get(ref);
      const claimed = key ? await transaction.get(this.source(key)) : null;
      if (claimed?.exists() && claimed.data().recordId !== record.id) throw new Error("Migration source listing conflict.");
      if (previous.exists()) {
        decodeRecord(previous.data(), record.id);
        const raw = parseJson(previous.data().payload, MAX_CLOUD_PAYLOAD_BYTES);
        if (!sameMigrationContent(raw, record) || (key && !claimed?.exists())) throw new Error("Migration copy or source claim differs. Nothing was overwritten.");
        return "already-identical";
      }
      if (claimed?.exists()) throw new Error("Migration source claim exists without its acquisition.");
      if (key) transaction.set(this.source(key), { ownerUid: this.uid, recordId: record.id });
      transaction.set(ref, { schemaVersion: 1, ownerUid: this.uid, id: record.id, revision: 1,
        ...(record.revision > 1 ? { migrationRevisionOffset: record.revision - 1 } : {}), payload, updatedAt: serverTimestamp() });
      return "created";
    });
  }
  async createDraftForMigration(input: RecoveryDraft): Promise<MigrationResult> {
    this.requireOnline();
    const draft = migrationDraft(input), payload = cloudMigrationPayload(draft);
    const ref = doc(this.db, "users", this.uid, "workspace", "current");
    return this.transaction(async transaction => {
      const previous = await transaction.get(ref);
      if (previous.exists()) {
        if (!Number.isSafeInteger(previous.data().revision) || previous.data().revision < 1 ||
          !sameMigrationContent(parseJson(previous.data().payload, MAX_CLOUD_PAYLOAD_BYTES), draft)) throw new Error("Migration draft conflict. Nothing was overwritten.");
        return "already-identical";
      }
      transaction.set(ref, { schemaVersion: 1, ownerUid: this.uid, id: "current", revision: 1, payload, updatedAt: serverTimestamp() });
      return "created";
    });
  }
  async remove(id: string, expected: number) {
    this.requireOnline();
    const ref = this.record(id);
    await this.transaction(async transaction => {
      const previous = await transaction.get(ref);
      revisionCheck(previous.data(), expected);
      const key = await sourceKey(decodeRecord(previous.data()!, id));
      if (key) transaction.delete(this.source(key));
      transaction.delete(ref);
    });
  }
  async loadDraft(): Promise<CloudDraft> {
    this.requireOnline();
    const result = await getDocFromServer(doc(this.db, "users", this.uid, "workspace", "current"));
    this.checkAccount();
    if (!result.exists()) return { revision: 0, value: null };
    const data = result.data();
    if (!Number.isSafeInteger(data.revision) || data.revision < 1) throw new Error("Cloud draft revision is invalid.");
    const value = parseJson(data.payload, MAX_CLOUD_PAYLOAD_BYTES);
    return { revision: data.revision, value: value === null ? null : validateDraft(value) };
  }
  async saveDraft(draft: RecoveryDraft | null, expected: number) {
    this.requireOnline();
    // recordId is recovery metadata only. Draft autosave writes this workspace
    // document exclusively; named acquisitions are changed only by save().
    const payload = draftPayload(draft);
    const ref = doc(this.db, "users", this.uid, "workspace", "current");
    await this.transaction(async transaction => {
      const previous = await transaction.get(ref);
      revisionCheck(previous.data(), expected === 0 ? null : expected);
      transaction.set(ref, { schemaVersion: 1, ownerUid: this.uid, id: "current", revision: expected + 1,
        payload, updatedAt: serverTimestamp() });
    });
    return expected + 1;
  }
}

// Strict migration snapshots have already passed validation without normalization.
const cloudMigrationPayload = (value: AcquisitionRecord | RecoveryDraft) => JSON.stringify(value);
