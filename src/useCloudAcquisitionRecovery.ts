import { useEffect, useRef, useState } from "react";
import type { AcquisitionForm, AcquisitionRecord, AcquisitionState } from "./acquisitionRecord";
import { createCashFlowAssumptions } from "./acquisitionCashFlow";
import { DraftAutosaver } from "./cloudPersistence";
import type { CloudRepository, CloudStatus } from "./cloudPersistence";
import { downloadBackup, makeRecord, matchingRecord, parseBackup } from "./storage";
import { buildSavedAcquisitionsCsv, downloadCsv } from "./csv";
import type { RecoveryControls } from "./useAcquisitionRecovery";
import { completedRecoveryMessage, RECOVERY_FEEDBACK_DURATION_MS } from "./recoveryFeedback";
import { WorkspaceChangedError, type WorkspaceSession } from "./workspaceSession";

const messageOf = (error: unknown) => error instanceof Error ? error.message : "Cloud operation failed. Your open work remains in memory.";

export function useCloudAcquisitionRecovery(repository: CloudRepository, initialForm: AcquisitionForm, session?: WorkspaceSession): RecoveryControls {
  const blank = (): AcquisitionState => ({ scan: null, form: { ...initialForm }, cashFlow: createCashFlowAssumptions() });
  const [work, setWork] = useState(blank);
  const [records, setRecords] = useState<AcquisitionRecord[]>([]);
  const [active, setActive] = useState<AcquisitionRecord | null>(null);
  const [generation, setGeneration] = useState(0);
  const [storageError, setStorageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<CloudStatus>("Saving");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [confirmation, setConfirmation] = useState<{ message: string; accept: () => void } | null>(null);
  const autosaver = useRef<DraftAutosaver | null>(null);
  const mounted = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const operation = useRef(false);
  const workRef = useRef(work);
  workRef.current = work;
  const operationStart = useRef(work);
  const lastQueued = useRef<string | null>(null);
  const check = () => { session?.assert(); if (!mounted.current) throw new WorkspaceChangedError(); };
  const hasWork = Boolean(work.scan || Object.values(work.form).some(Boolean));
  const dirty = hasWork && (!active || JSON.stringify(work) !== JSON.stringify(active.state));
  const confirm = (message: string, accept: () => void) => setConfirmation({ message, accept });

  useEffect(() => {
    if (!completedRecoveryMessage(notice, true)) return;
    if (notice === "Acquisition saved.") {
      if (dirty || storageError || actionError) { setNotice(""); return; }
      if (busy || status !== "Saved") return;
    }
    const timer = window.setTimeout(() => setNotice(""), RECOVERY_FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [notice, dirty, storageError, actionError, busy, status]);

  useEffect(() => {
    let live = true;
    mounted.current = true;
    setReady(false); setStorageError(""); setStatus(navigator.onLine ? "Saving" : "Offline");
    void (async () => {
      try {
        session?.assert();
        const library = await repository.list();
        if (!live) return; session?.assert();
        const draft = await repository.loadDraft();
        if (!live) return; session?.assert();
        const restoredActive = library.find(record => record.id === draft.value?.recordId && record.revision === draft.value?.recordRevision) ?? null;
        const restoredWork = draft.value?.state ?? blank();
        lastQueued.current = JSON.stringify(draft.value ? { recordId: restoredActive?.id ?? null, recordRevision: restoredActive?.revision ?? null, state: restoredWork } : null);
        setRecords(library); setWork(restoredWork);
        setActive(restoredActive);
        if (draft.value?.recordId && !library.some(record => record.id === draft.value?.recordId && record.revision === draft.value?.recordRevision)) {
          setNotice("Cloud draft restored separately from the changed saved record. Confirm any replacement before saving.");
        }
        autosaver.current = new DraftAutosaver(repository, draft.revision, (next, message) => {
          if (live) { setStatus(next); setStorageError(message); }
        });
        setReady(true); setStatus("Saved");
      } catch (error) { if (live) { setStorageError(messageOf(error)); setStatus(navigator.onLine ? "Error" : "Offline"); } }
    })();
    const stop = () => { live = false; mounted.current = false; autosaver.current?.stop(); autosaver.current = null; };
    session?.signal.addEventListener("abort", stop, { once: true });
    return () => { stop(); session?.signal.removeEventListener("abort", stop); };
  }, [repository, retry, session]);

  useEffect(() => {
    if (!ready) return;
    // Automatic persistence is workspace-only. The repository never dereferences
    // recordId to write an acquisition; save() below is the confirmed record path.
    const value = hasWork ? { recordId: activeRef.current?.id ?? null, recordRevision: activeRef.current?.revision ?? null, state: work } : null;
    const signature = JSON.stringify(value);
    if (signature === lastQueued.current) return;
    lastQueued.current = signature;
    autosaver.current?.queue(value);
  }, [work, active?.id, active?.revision, hasWork, ready]);

  useEffect(() => {
    const online = () => { if (ready) void autosaver.current?.flush(); };
    const offline = () => { setStatus("Offline"); setStorageError("Edits are held in memory only while offline and can be lost if this tab closes."); };
    const leaving = (event: BeforeUnloadEvent) => {
      if (autosaver.current?.unsaved || busy || (hasWork && !ready)) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("online", online); window.addEventListener("offline", offline); window.addEventListener("beforeunload", leaving);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); window.removeEventListener("beforeunload", leaving); };
  }, [hasWork, ready, busy]);

  async function attempt(action: () => Promise<void>) {
    if (operation.current) return;
    operationStart.current = workRef.current;
    operation.current = true; setBusy(true); setActionError(""); setNotice("");
    try {
      check();
      if (!ready) throw new Error("Wait for cloud recovery to finish before changing acquisitions.");
      if (!navigator.onLine) throw new Error("Offline. Your edits remain in memory; no cloud changes were made.");
      await autosaver.current?.flush();
      check();
      if (autosaver.current?.unsaved) throw new Error("Your cloud draft has not been saved. Resolve the save error before changing records.");
      await action();
    } catch (error) { if (mounted.current) { setActionError(messageOf(error)); setStatus(navigator.onLine ? "Error" : "Offline"); } }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  const guardEdits = () => {
    check();
    if (workRef.current !== operationStart.current) throw new Error("Your open work changed while this operation was loading. It was not replaced. Try again when ready.");
  };
  const replaceWork = (record: AcquisitionRecord) => { guardEdits(); setWork(structuredClone(record.state)); setActive(record); setGeneration(value => value + 1); };
  const upsert = (record: AcquisitionRecord) => { check(); setRecords(current => [record, ...current.filter(item => item.id !== record.id)]); };
  function save() {
    try {
      const candidate = makeRecord(work);
      const previous = active ?? matchingRecord(records, candidate);
      const persist = () => { void attempt(async () => {
        const record = makeRecord(work, previous?.name, previous);
        await repository.save(record, previous?.revision ?? null);
        upsert(record); setActive(record); setNotice("Acquisition saved.");
      }); };
      if (previous) confirm('Replace the saved version of "' + previous.name + '" with this analysis and its assumptions?', persist);
      else persist();
    } catch (error) { setActionError(messageOf(error)); }
  }
  function open(record: AcquisitionRecord) {
    const restore = () => { void attempt(async () => { replaceWork(await repository.get(record.id)); }); };
    if (dirty) confirm("Replace your open work with this acquisition? Save or export changes you want to keep first.", restore); else restore();
  }
  function newScan() {
    const reset = () => { void attempt(async () => { guardEdits(); setWork(blank()); setActive(null); setGeneration(value => value + 1); }); };
    if (dirty) confirm("Start a new scan and replace the current cloud draft? Save or export first to keep it.", reset); else reset();
  }
  function rename(record: AcquisitionRecord, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120) { setActionError("Enter a name between 1 and 120 characters."); return; }
    confirm('Rename "' + record.name + '" to "' + trimmed + '"?', () => { void attempt(async () => {
      const renamed = { ...record, name: trimmed, updatedAt: new Date().toISOString(), revision: record.revision + 1 };
      await repository.save(renamed, record.revision); upsert(renamed);
      if (active?.id === record.id) setActive(renamed);
      setNotice("Acquisition renamed.");
    }); });
  }
  function remove(record: AcquisitionRecord) {
    confirm('Delete "' + record.name + '"? This cannot be undone. Export a backup first if needed.', () => { void attempt(async () => {
      await repository.remove(record.id, record.revision);
      check();
      setRecords(current => current.filter(item => item.id !== record.id));
      if (active?.id === record.id) setActive(null);
      setNotice("Acquisition deleted. Open work kept.");
    }); });
  }
  function importText(text: string) {
    try {
      const incoming = parseBackup(text);
      const previous = matchingRecord(records, incoming);
      const restore = () => { void attempt(async () => {
        const record = { ...incoming, id: previous?.id ?? incoming.id, createdAt: previous?.createdAt ?? incoming.createdAt,
          updatedAt: new Date().toISOString(), revision: (previous?.revision ?? 0) + 1 };
        await repository.save(record, previous?.revision ?? null); upsert(record);
        if (!hasWork || (!dirty && active?.id === previous?.id)) replaceWork(record);
        setNotice("Backup imported. Your existing open edits were preserved.");
      }); };
      if (previous) confirm('Replace "' + previous.name + '" with the imported backup?', restore); else restore();
    } catch (error) { setActionError(messageOf(error)); }
  }
  function exportAction(action: () => void) { try { check(); action(); } catch (error) { if (mounted.current) setActionError(messageOf(error)); } }
  const updateWork: typeof setWork = update => {
    try { check(); setWork(current => session && !session.active ? current : typeof update === "function" ? update(current) : update); }
    catch { /* An old account's component cannot update a replacement workspace. */ }
  };
  return { work, setWork: updateWork, session, records, active, generation, dirty, hasWork, storageError, actionError, notice,
    save, open, newScan, rename, remove, importText,
    exportCurrent: () => exportAction(() => downloadBackup(makeRecord(work, active?.name, active ?? undefined))),
    exportRecord: record => exportAction(() => downloadBackup(record)),
    exportSavedCsv: () => exportAction(() => downloadCsv(buildSavedAcquisitionsCsv(records), "kingdomhaus-saved-acquisitions.csv")),
    exportStoredRecovery: () => setActionError("Cloud mode never reads browser-local recovery data."),
    reportError: setActionError, confirmation, cancelConfirmation: () => setConfirmation(null),
    acceptConfirmation: () => { const request = confirmation; setConfirmation(null); request?.accept(); },
    cloud: { status, ready, busy, retry: () => { if (!ready) setRetry(value => value + 1); else void autosaver.current?.flush(); } }
  };
}
