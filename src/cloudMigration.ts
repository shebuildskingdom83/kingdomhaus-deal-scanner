import type { AcquisitionRecord, RecoveryDraft } from "./acquisitionRecord";
import { cloudPayload } from "./cloudPersistence";
import { parseJson, validateDraft, validateRecord } from "./recordValidation";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  return JSON.stringify(value);
}
export const sameMigrationContent = (a: unknown, b: unknown) => canonical(a) === canonical(b);

// Migration must stop if ordinary validation would repair, strip or hydrate data.
// Such a change needs a separate founder review, never an implicit migration repair.
export function migrationRecord(input: AcquisitionRecord): AcquisitionRecord {
  const snapshot = parseJson(JSON.stringify(input));
  const validated = validateRecord(structuredClone(snapshot));
  if (!sameMigrationContent(snapshot, validated)) throw new Error("Migration requires an unchanged validated record. Review normalization differences before transferring.");
  cloudPayload(validated);
  return validated;
}
export function migrationDraft(input: RecoveryDraft): RecoveryDraft {
  const snapshot = parseJson(JSON.stringify(input));
  const validated = validateDraft(structuredClone(snapshot));
  if (!sameMigrationContent(snapshot, validated)) throw new Error("Migration requires an unchanged validated draft. Review normalization differences before transferring.");
  cloudPayload(validated);
  return validated;
}
export function migrationListingIdentity(record: AcquisitionRecord): string | null {
  try {
    const url = new URL(record.state.scan.listingUrl ?? "");
    return url.protocol === "https:" && !url.username && !url.password
      ? url.origin.toLowerCase() + url.pathname.replace(/\/+$/, "") : null;
  } catch { return null; }
}
export type MigrationResult = "created" | "already-identical";
export interface MigrationRepository {
  list(): Promise<AcquisitionRecord[]>;
  getForMigration(id: string): Promise<AcquisitionRecord>;
  createRecordForMigration(record: AcquisitionRecord): Promise<MigrationResult>;
  loadDraft(): Promise<{ revision: number; value: RecoveryDraft | null }>;
  createDraftForMigration(draft: RecoveryDraft): Promise<MigrationResult>;
}
export class MigrationStoppedError extends Error {
  constructor(public readonly completedIds: readonly string[], public readonly phase: string, public readonly failedId?: string) {
    super("Migration stopped. Keep the original local workspace unchanged. Reconcile the failed record before retrying; completed copies were not rolled back or overwritten.");
  }
}

// No storage reader, download, startup hook, live configuration or automatic retry.
// Only a separately approved caller may supply in-memory snapshots to this API.
export async function migrateAcquisitions(repository: MigrationRepository, input: readonly AcquisitionRecord[],
  options: { draft?: RecoveryDraft; signal?: AbortSignal } = {}) {
  const completedIds: string[] = [];
  let phase = "preflight", failedId: string | undefined;
  try {
    const stopped = () => { if (options.signal?.aborted) throw new Error("Migration interrupted."); };
    stopped();
    if (!input.length) throw new Error("No records selected.");
    const records = input.map(migrationRecord);
    const draft = options.draft === undefined ? undefined : migrationDraft(options.draft);
    const ids = new Set<string>(), sources = new Map<string, string>();
    for (const record of records) {
      if (ids.has(record.id)) throw new Error("Duplicate acquisition identity.");
      ids.add(record.id);
      const source = migrationListingIdentity(record);
      if (source && sources.has(source)) throw new Error("Duplicate source listing.");
      if (source) sources.set(source, record.id);
    }
    if (draft?.recordId && !records.some(record => record.id === draft.recordId && record.revision === draft.recordRevision)) {
      throw new Error("Draft references an unselected or different historical revision.");
    }
    const existing = await repository.list();
    for (const record of existing) {
      const selected = records.find(item => item.id === record.id);
      if (selected && !sameMigrationContent(selected, record)) throw new Error("Existing cloud record differs.");
      const source = migrationListingIdentity(record);
      if (source && sources.has(source) && sources.get(source) !== record.id) throw new Error("Cloud source listing already has a different identity.");
    }
    if (draft) {
      const current = await repository.loadDraft();
      if (current.revision && !sameMigrationContent(current.value, draft)) throw new Error("Cloud draft already exists.");
    }
    const results: Array<{ id: string; historicalRevision: number; result: MigrationResult }> = [];
    for (const record of records) {
      stopped();
      failedId = record.id; phase = "create-only-record";
      const result = await repository.createRecordForMigration(record);
      phase = "full-record-readback";
      const readback = await repository.getForMigration(record.id);
      if (!sameMigrationContent(record, readback)) throw new Error("Complete cloud readback differs.");
      completedIds.push(record.id);
      results.push({ id: record.id, historicalRevision: record.revision, result });
    }
    stopped();
    failedId = undefined;
    let draftResult: MigrationResult | undefined;
    if (draft) {
      phase = "create-only-draft";
      draftResult = await repository.createDraftForMigration(draft);
      phase = "full-draft-readback";
      if (!sameMigrationContent((await repository.loadDraft()).value, draft)) throw new Error("Complete draft readback differs.");
    }
    return { records: results, draft: draftResult };
  } catch { throw new MigrationStoppedError([...completedIds], phase, failedId); }
}
