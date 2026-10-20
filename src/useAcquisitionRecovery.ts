import { useEffect, useState } from "react";
import type { AcquisitionForm, AcquisitionRecord, AcquisitionState } from "./acquisitionRecord";
import { createCashFlowAssumptions } from "./acquisitionCashFlow";
import { AcquisitionRepository, downloadBackup, makeRecord, matchingRecord, parseBackup, storageKey } from "./storage";
import { retainedScan } from "./recordValidation";
import { buildSavedAcquisitionsCsv, downloadCsv } from "./csv";

const messageOf = (error: unknown) => error instanceof Error ? error.message : "Saved work could not be updated.";
const snapshot = (work: AcquisitionState) => JSON.stringify({ ...work, scan: work.scan ? retainedScan(work.scan) : null });

export function useAcquisitionRecovery(initialForm: AcquisitionForm) {
  const [repository] = useState(() => new AcquisitionRepository());
  const [initial] = useState(() => {
    try { return { library: repository.load(), error: "" }; }
    catch (error) { return { library: null, error: messageOf(error) }; }
  });
  const blank = (): AcquisitionState => ({ scan: null, form: { ...initialForm }, cashFlow: createCashFlowAssumptions() });
  const [work, setWork] = useState<AcquisitionState>(() => initial.library?.draft?.state ?? blank());
  const [records, setRecords] = useState(initial.library?.records ?? []);
  const [active, setActive] = useState<AcquisitionRecord | null>(() => initial.library?.records.find(r => r.id === initial.library?.draft?.recordId) ?? null);
  const [generation, setGeneration] = useState(0);
  const [storageError, setStorageError] = useState(initial.error);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState(initial.library?.notice ?? (initial.library?.draft ? "Previous work restored." : ""));
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [confirmation, setConfirmation] = useState<{ message: string; accept: () => void } | null>(null);
  const confirm = (message: string, accept: () => void) => setConfirmation({ message, accept });
  const hasWork = Boolean(work.scan || Object.values(work.form).some(Boolean));
  const dirty = hasWork && (!active || snapshot(work) !== snapshot(active.state));

  useEffect(() => {
    if (!initial.library) return;
    try {
      repository.recover(hasWork ? { recordId: active?.id ?? null, recordRevision: active?.revision ?? null, state: work } : null);
      setStorageError("");
    } catch (error) { setStorageError(messageOf(error)); }
  }, [repository, work, active, hasWork, initial.library]);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setStorageError("Saved work changed in another tab. Export your open work, then reload before saving.");
    };
    const leaving = (event: BeforeUnloadEvent) => {
      if (hasWork && (dirty || storageError)) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("storage", changed);
    window.addEventListener("beforeunload", leaving);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener("beforeunload", leaving); };
  }, [dirty, storageError, hasWork]);

  const attempt = (action: () => void) => {
    setActionError("");
    setNotice("");
    try { action(); } catch (error) { setActionError(messageOf(error)); }
  };
  function save() {
    attempt(() => {
      const candidate = makeRecord(work);
      const previous = active ?? matchingRecord(records, candidate);
      const persist = () => attempt(() => {
        const record = makeRecord(work, previous?.name, previous);
        const library = repository.save(record, previous?.revision ?? null, Boolean(previous));
        setRecords(library.records); setActive(record); setNotice("Acquisition saved.");
      });
      if (previous) confirm('Replace the saved version of "' + previous.name + '" with this analysis and its assumptions?', persist);
      else persist();
    });
  }
  function open(record: AcquisitionRecord) {
    attempt(() => {
      const restore = () => {
        setWork(structuredClone(record.state)); setActive(record); setGeneration(n => n + 1);
        setNotice("Previous work restored.");
      };
      if (dirty || storageError) confirm("Replace your open work with this saved acquisition? Export any changes you want to keep first.", restore);
      else restore();
    });
  }
  function newScan() {
    attempt(() => {
      const reset = () => { setWork(blank()); setActive(null); setGeneration(n => n + 1); setNotice(""); };
      if (dirty || storageError) confirm("Start a new scan and discard your open changes? Save or export first to keep them.", reset);
      else reset();
    });
  }
  function rename(record: AcquisitionRecord, name: string) {
    attempt(() => {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 120) throw new Error("Enter a name between 1 and 120 characters.");
      confirm('Rename "' + record.name + '" to "' + trimmed + '"?', () => attempt(() => {
        const renamed = { ...record, name: trimmed, updatedAt: new Date().toISOString(), revision: record.revision + 1 };
        setRecords(repository.save(renamed, record.revision, true).records);
        if (active?.id === record.id) setActive(renamed);
        setNotice("Acquisition renamed.");
      }));
    });
  }
  function remove(record: AcquisitionRecord) {
    attempt(() => {
      confirm('Delete "' + record.name + '" from saved scans? This cannot be undone. Export a backup first if needed.', () => attempt(() => {
        setRecords(repository.delete(record.id, record.revision, true).records);
        if (active?.id === record.id) setActive(null);
        setNotice("Acquisition deleted. Open work kept.");
      }));
    });
  }
  function importText(text: string) {
    attempt(() => {
      const incoming = parseBackup(text);
      const previous = matchingRecord(records, incoming);
      const openImported = !hasWork || (!dirty && active?.id === previous?.id);
      const restore = () => attempt(() => {
        const record: AcquisitionRecord = { ...incoming, id: previous?.id ?? incoming.id, createdAt: previous?.createdAt ?? incoming.createdAt,
          updatedAt: new Date().toISOString(), revision: (previous?.revision ?? 0) + 1 };
        setRecords(repository.save(record, previous?.revision ?? null, Boolean(previous)).records);
        if (openImported) {
          setWork(structuredClone(record.state)); setActive(record); setGeneration(n => n + 1);
        }
        setNotice(openImported ? "Backup imported and opened." : "Backup imported. Open it from Saved scans to view the imported version. Your open work was kept.");
      });
      if (previous) confirm('This acquisition already exists as "' + previous.name + '". Replace its saved analysis with this backup? ' + (openImported ? "The imported version will open." : "Your open work will not change."), restore);
      else restore();
    });
  }
  function exportCurrent() { attempt(() => { downloadBackup(makeRecord(work, active?.name, active ?? undefined)); setNotice("Backup exported."); }); }
  function exportRecord(record: AcquisitionRecord) { attempt(() => { downloadBackup(record); setNotice("Backup exported."); }); }
  function exportSavedCsv() { attempt(() => { downloadCsv(buildSavedAcquisitionsCsv(records), "kingdomhaus-saved-acquisitions.csv"); setNotice("CSV exported."); }); }
  function exportStoredRecovery() { attempt(() => repository.exportStoredRecovery()); }
  return { work, setWork, records, active, generation, dirty, hasWork, storageError, actionError, notice,
    save, open, newScan, rename, remove, importText, exportCurrent, exportRecord, exportSavedCsv, exportStoredRecovery, reportError: (message: string) => { setNotice(""); setActionError(message); },
    confirmation, cancelConfirmation: () => setConfirmation(null),
    acceptConfirmation: () => { const request = confirmation; setConfirmation(null); if (request) attempt(request.accept); } };
}
