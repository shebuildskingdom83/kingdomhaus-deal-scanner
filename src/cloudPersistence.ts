import { validateDraft, validateRecord } from "./recordValidation";
import type { AcquisitionRecord, RecoveryDraft } from "./acquisitionRecord";

export type CloudStatus = "Saving" | "Saved" | "Offline" | "Error";
export function isFounderAccount(uid: string | undefined, approvedUid: string | undefined): boolean {
  return Boolean(uid && approvedUid && approvedUid !== "FOUNDER_UID_NOT_CONFIGURED" && uid === approvedUid);
}
export type CloudDraft = { revision: number; value: RecoveryDraft | null };
export interface CloudRepository {
  list(): Promise<AcquisitionRecord[]>;
  get(id: string): Promise<AcquisitionRecord>;
  save(record: AcquisitionRecord, expectedRevision: number | null): Promise<void>;
  remove(id: string, expectedRevision: number): Promise<void>;
  loadDraft(): Promise<CloudDraft>;
  saveDraft(draft: RecoveryDraft | null, expectedRevision: number): Promise<number>;
}

// A conservative UTF-8 payload ceiling leaves room for Firestore document overhead.
// JSON preserves the existing schema, including arrays, without Firestore type coercion.
export const MAX_CLOUD_PAYLOAD_BYTES = 900_000;
export function cloudPayload(value: unknown): string {
  const payload = JSON.stringify(value);
  if (new TextEncoder().encode(payload).byteLength > MAX_CLOUD_PAYLOAD_BYTES) {
    throw new Error("This acquisition exceeds the supported cloud document size. Nothing was truncated or saved. Your open work remains in memory.");
  }
  return payload;
}
export function recordPayload(record: AcquisitionRecord): string { return cloudPayload(validateRecord(record)); }
export function draftPayload(draft: RecoveryDraft | null): string { return cloudPayload(draft === null ? null : validateDraft(draft)); }
export const conflictMessage = "Cloud work changed in another session. Your edits remain in memory. Reopen the latest saved version or explicitly export your work before resolving the conflict.";

// Serializes draft writes and coalesces edits without dropping edits made during a save.
// Revision conflicts latch: no automatic retry may overwrite another session's work.
export class DraftAutosaver {
  private pending: { value: RecoveryDraft | null; serial: number } | null = null;
  private running = false;
  private flight: Promise<void> | null = null;
  private serial = 0;
  private blocked = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private revision: number;
  constructor(private repository: CloudRepository, revision: number,
    private report: (status: CloudStatus, message: string) => void,
    private online: () => boolean = () => navigator.onLine) { this.revision = revision; }
  get unsaved() { return Boolean(this.pending || this.running); }
  queue(value: RecoveryDraft | null) {
    if (this.stopped) return;
    this.pending = { value: structuredClone(value), serial: ++this.serial };
    if (this.blocked) { this.report("Error", conflictMessage); return; }
    this.report(this.online() ? "Saving" : "Offline", this.online() ? "" : "Unsaved edits are held in memory only and can be lost if this tab closes.");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, 1200);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.flight) { await this.flight; return; }
    if (this.stopped || !this.pending || this.blocked) return;
    this.flight = this.persist();
    try { await this.flight; } finally { this.flight = null; }
  }
  private async persist(): Promise<void> {
    if (this.stopped || !this.pending) return;
    if (!this.online()) { this.report("Offline", "Unsaved edits are held in memory only and can be lost if this tab closes."); return; }
    this.running = true;
    const next = this.pending;
    this.report("Saving", "");
    try {
      this.revision = await this.repository.saveDraft(next.value, this.revision);
      if (this.pending?.serial === next.serial) this.pending = null;
      if (!this.stopped && !this.pending) this.report("Saved", "");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud save failed. Your edits remain in memory.";
      this.blocked = message === conflictMessage;
      if (!this.stopped) this.report(this.online() ? "Error" : "Offline", message);
      return;
    } finally { this.running = false; }
    if (this.pending && !this.stopped) await this.persist();
  }
  stop() { this.stopped = true; this.pending = null; clearTimeout(this.timer); }
}
