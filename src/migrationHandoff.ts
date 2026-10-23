import type { AcquisitionRecord } from "./acquisitionRecord";
import { inspectAcquisitionStorage, PREFLIGHT_STORAGE_KEY } from "./acquisitionPreflight";
import { migrationRecord, migrateAcquisitions } from "./cloudMigration";
import type { MigrationRepository } from "./cloudMigration";
import { parseJson } from "./recordValidation";
import { migrationStorageProjection } from "./migrationStorageProjection";

export const SOURCE_ORIGIN = "http://localhost:5173";
export const RECEIVER_ORIGIN = "http://localhost:5176";
export const HANDOFF_CHANNEL = "kingdomhaus-create-only-v1";
export const HANDOFF_LIFETIME_MS = 10 * 60 * 1000;
export const validChallenge = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function newChallenge() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function boundMessage(event: { origin: string; source: unknown; data: unknown }, origin: string, peer: unknown, challenge?: string) {
  const data = event.data as Record<string, unknown> | null;
  return Boolean(peer && event.source === peer && event.origin === origin && data && typeof data === "object" && !Array.isArray(data) &&
    data.channel === HANDOFF_CHANNEL && (challenge === undefined || data.challenge === challenge));
}
export function readHandoffSnapshot(store: Pick<Storage, "getItem">) {
  const baseline = migrationStorageProjection(store.getItem(PREFLIGHT_STORAGE_KEY));
  const report = inspectAcquisitionStorage(baseline);
  if (report.status !== "Compatible" || report.recordCount !== 4) throw new Error("Source selection requires separate review.");
  const records = (parseJson(baseline, 4_000_000) as { records: AcquisitionRecord[] }).records.map(migrationRecord);
  if (!handoffSourceUnchanged(store, baseline)) throw new Error("Source changed.");
  return { baseline, records };
}
export function handoffSourceUnchanged(store: Pick<Storage, "getItem">, baseline: string) {
  try { return migrationStorageProjection(store.getItem(PREFLIGHT_STORAGE_KEY)) === baseline; }
  catch { return false; }
}
export type HandoffRepository = MigrationRepository & {
  reviewMigrationSelection(records: readonly AcquisitionRecord[]): Promise<{ existingCount: number; selectedCount: number }>;
};
export class MigrationHandoffSession {
  private records: AcquisitionRecord[] | null = null;
  private expires: number;
  private running = false;
  private controller = new AbortController();
  constructor(private peer: unknown, private challenge: string, private now = () => Date.now()) {
    if (!peer || !validChallenge(challenge)) throw new Error("Invalid handoff binding.");
    this.expires = now() + HANDOFF_LIFETIME_MS;
  }
  private active() {
    if (this.controller.signal.aborted || this.now() >= this.expires) throw new Error("Handoff expired or cancelled.");
  }
  accept(event: { origin: string; source: unknown; data: unknown }) {
    this.active();
    if (this.records || !boundMessage(event, SOURCE_ORIGIN, this.peer, this.challenge)) throw new Error("Unexpected handoff message.");
    const packet = event.data as Record<string, unknown>;
    if (packet.type !== "records" || Object.keys(packet).some(key => !["channel", "challenge", "type", "records"].includes(key))) throw new Error("Invalid handoff shape.");
    // Validate only the selected records; no source draft enters this packet.
    const raw = JSON.stringify({ schemaVersion: 2, records: packet.records, draft: null });
    if (inspectAcquisitionStorage(raw).status !== "Compatible") throw new Error("Handoff validation failed.");
    this.records = (parseJson(raw, 4_000_000) as { records: AcquisitionRecord[] }).records.map(migrationRecord);
    return this.summary();
  }
  summary() {
    this.active();
    return (this.records ?? []).map(record => ({ name: record.name, bytes: new TextEncoder().encode(JSON.stringify(record)).byteLength, status: "Validated unchanged" }));
  }
  async review(repository: HandoffRepository) {
    this.active();
    if (!this.records || this.running) throw new Error("No reviewable handoff.");
    return repository.reviewMigrationSelection(this.records.map(record => structuredClone(record)));
  }
  async execute(repository: HandoffRepository, options: { confirmed: boolean; authorized: () => boolean; sourceUnchanged: () => Promise<boolean> }) {
    this.active();
    if (!options.confirmed || !this.records || this.running) throw new Error("Explicit confirmation required.");
    this.running = true;
    const guard = async () => {
      this.active();
      if (!options.authorized() || !await options.sourceUnchanged()) throw new Error("Source or founder session changed.");
      this.active();
      if (!options.authorized()) throw new Error("Founder session changed.");
      if ((await repository.loadDraft()).value !== null) throw new Error("Cloud draft changed; separate review required.");
      this.active();
      if (!options.authorized()) throw new Error("Founder session changed.");
    };
    try {
      await guard();
      await repository.reviewMigrationSelection(this.records);
      const guarded: MigrationRepository = {
        list: async () => { await guard(); return repository.list(); },
        getForMigration: id => repository.getForMigration(id),
        createRecordForMigration: async record => { await guard(); return repository.createRecordForMigration(record); },
        loadDraft: () => repository.loadDraft(),
        createDraftForMigration: async () => { throw new Error("Draft transfer is not selected."); }
      };
      const result = await migrateAcquisitions(guarded, this.records, { signal: this.controller.signal });
      await guard();
      // Never return IDs, evidence, or payloads to the source page or its logs.
      return { verifiedCount: result.records.length, createdCount: result.records.filter(row => row.result === "created").length,
        identicalRetryCount: result.records.filter(row => row.result === "already-identical").length };
    } finally { this.running = false; }
  }
  cancel() { this.controller.abort(); this.records = null; }
}
