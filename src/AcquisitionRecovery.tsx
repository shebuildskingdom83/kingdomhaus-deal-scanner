import { useEffect, useRef, useState } from "react";
import Save from "lucide-react/dist/esm/icons/save";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import Download from "lucide-react/dist/esm/icons/download";
import Upload from "lucide-react/dist/esm/icons/upload";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Search from "lucide-react/dist/esm/icons/search";
import X from "lucide-react/dist/esm/icons/x";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import type { useAcquisitionRecovery } from "./useAcquisitionRecovery";
import { MAX_BACKUP_BYTES } from "./recordValidation";
import { savedAcquisitionView } from "./savedAcquisitionView";

export function AcquisitionRecovery({ recovery, busy = false }: { recovery: ReturnType<typeof useAcquisitionRecovery>; busy?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [importing, setImporting] = useState(false);
  const [backupSource, setBackupSource] = useState("current");
  const [searchQuery, setSearchQuery] = useState("");
  const [requestedPage, setRequestedPage] = useState(1);
  const searchInput = useRef<HTMLInputElement>(null);
  const view = savedAcquisitionView(recovery.records, searchQuery, requestedPage);
  useEffect(() => { setRequestedPage(view.page); }, [view.page]);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (recovery.confirmation && !dialog.current?.open) dialog.current?.showModal();
    if (!recovery.confirmation && dialog.current?.open) dialog.current.close();
  }, [recovery.confirmation]);
  const disabled = busy || importing;
  return <section className="acquisition-recovery" aria-label="Acquisition saving and recovery">
    <dialog ref={dialog} className="recovery-dialog" role="alertdialog" aria-labelledby="recovery-dialog-title" aria-describedby="recovery-dialog-description"
      onCancel={event => { event.preventDefault(); recovery.cancelConfirmation(); }}>
      <h2 id="recovery-dialog-title">Confirm acquisition change</h2>
      <p id="recovery-dialog-description">{recovery.confirmation?.message}</p>
      <div className="recovery-actions">
        <button type="button" autoFocus onClick={recovery.cancelConfirmation}>Cancel</button>
        <button type="button" onClick={recovery.acceptConfirmation}>Confirm change</button>
      </div>
    </dialog>
    <div className="recovery-actions">
      {recovery.work.scan ? <>
        <button type="button" className="primary-action" onClick={recovery.save} disabled={disabled}>
          <Save aria-hidden="true" />{recovery.active ? "Update saved scan" : "Save acquisition"}
        </button>
      </> : null}
      <input ref={input} type="file" accept=".json,application/json" hidden aria-label="Import acquisition JSON backup" disabled={disabled}
        onChange={async event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          setImporting(true);
          try {
            if (file.size > MAX_BACKUP_BYTES) throw new Error("Choose a JSON backup smaller than 2 MB.");
            if (!file.name.toLowerCase().endsWith(".json")) throw new Error("Choose a KingdomHaus JSON backup.");
            recovery.importText(await file.text());
          } catch (error) { recovery.reportError(error instanceof Error ? error.message : "The backup could not be read."); }
          finally { setImporting(false); }
        }} />
      <span className="recovery-state">{recovery.dirty ? "Changes not saved to a record" : recovery.active ? recovery.active.name : "Browser-local workspace"}</span>
    </div>
    <details className="saved-acquisitions">
      <summary><FolderOpen aria-hidden="true" />Saved scans <span>({recovery.records.length})</span></summary>
      <div className="saved-acquisition-search">
        <Search aria-hidden="true" />
        <input ref={searchInput} type="search" aria-label="Search saved acquisitions by business name" placeholder="Search acquisitions..."
          value={searchQuery} onChange={event => { setSearchQuery(event.target.value); setRequestedPage(1); }} />
        {searchQuery ? <button type="button" aria-label="Clear acquisition search" title="Clear search"
          onClick={() => { setSearchQuery(""); setRequestedPage(1); searchInput.current?.focus(); }}><X aria-hidden="true" /></button> : null}
      </div>
      <button type="button" onClick={recovery.exportSavedCsv} disabled={disabled || !recovery.records.length}><Download aria-hidden="true" />Export saved scans CSV</button>
      {view.totalPages > 1 ? <p className="saved-acquisition-range" role="status">Showing {view.start}&ndash;{view.end} of {view.total}</p> : null}
      {!recovery.records.length ? <p className="section-note">No acquisitions saved in this browser yet.</p> :
        !view.total ? <p className="section-note">No acquisitions match your search.</p> :
        <ul className="saved-acquisition-list">{view.records.map(record => <li key={record.id}>
          <div className="saved-acquisition-title"><strong>{record.name}</strong><small>Updated {new Date(record.updatedAt).toLocaleDateString()} · {record.origin === "imported" ? "Imported backup" : "Local record"}</small></div>
          {renaming === record.id ? <form className="rename-acquisition" onSubmit={e => { e.preventDefault(); recovery.rename(record, name); setRenaming(null); }}>
            <label><span className="sr-only">New acquisition name</span><input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={120} required /></label>
            <button type="submit" disabled={disabled}>Confirm name</button><button type="button" onClick={() => setRenaming(null)}>Cancel</button>
          </form> : <div className="saved-acquisition-actions">
            <button type="button" onClick={() => recovery.open(record)} disabled={disabled}><FolderOpen aria-hidden="true" />Open<span className="sr-only"> {record.name}</span></button>
            <button type="button" title="Rename acquisition" aria-label={"Rename " + record.name} onClick={() => { setRenaming(record.id); setName(record.name); }} disabled={disabled}><Pencil aria-hidden="true" /></button>
            <button type="button" title="Delete saved acquisition" aria-label={"Delete " + record.name} onClick={() => recovery.remove(record)} disabled={disabled}><Trash2 aria-hidden="true" /></button>
          </div>}
        </li>)}</ul>}
      {view.totalPages > 1 ? <nav className="saved-acquisition-pagination" aria-label="Saved acquisitions pages">
        <button type="button" disabled={view.page === 1} onClick={() => setRequestedPage(view.page - 1)}><ChevronLeft aria-hidden="true" />Previous</button>
        <span>Page {view.page} of {view.totalPages}</span>
        <button type="button" disabled={view.page === view.totalPages} onClick={() => setRequestedPage(view.page + 1)}>Next<ChevronRight aria-hidden="true" /></button>
      </nav> : null}
      <details className="backup-management">
        <summary>Manage Backups</summary>
        <div className="backup-controls">
          <label><span>Acquisition to export</span>
            <select value={backupSource} onChange={event => setBackupSource(event.target.value)}>
              <option value="current">Current analysis{recovery.dirty ? " (unsaved changes)" : ""}</option>
              {recovery.records.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}
            </select>
          </label>
          <div className="recovery-actions">
            <button type="button" disabled={disabled || (backupSource === "current" ? !recovery.work.scan : !recovery.records.some(record => record.id === backupSource))}
              onClick={() => { const record = recovery.records.find(record => record.id === backupSource); if (backupSource === "current") recovery.exportCurrent(); else if (record) recovery.exportRecord(record); }}><Download aria-hidden="true" />Export Backup</button>
            <button type="button" onClick={() => input.current?.click()} disabled={disabled}><Upload aria-hidden="true" />{importing ? "Importing" : "Import Backup"}</button>
            {recovery.storageError ? <button type="button" onClick={recovery.exportStoredRecovery}><Download aria-hidden="true" />Export stored recovery data</button> : null}
          </div>
          <p className="recovery-privacy">Stored in this browser only. Keep backup files secure.</p>
          <details className="storage-help"><summary>Privacy and recovery</summary><p>Browser-local storage is not encrypted. Records are not synchronized between computers, and browser data can be cleared or lost. JSON backups may contain confidential acquisition information. Keep them secure. JSON is the complete recovery format; CSV is a summary only. Imported source claims and review flags are not independently verified.</p></details>
        </div>
      </details>
    </details>
    {recovery.storageError ? <p className="recovery-error" role="alert">{recovery.storageError}</p> : null}
    {recovery.actionError ? <p className="recovery-error" role="alert">{recovery.actionError}</p> : null}
    {recovery.notice ? <p className="recovery-notice" role="status">{recovery.notice}</p> : null}
  </section>;
}
