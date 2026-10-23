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
import ArrowUpRight from "lucide-react/dist/esm/icons/arrow-up-right";
import { savedAskingPrice } from "./portfolioOverview";
import { formatMoney } from "./financial";
import type { RecoveryControls } from "./useAcquisitionRecovery";
import { MAX_BACKUP_BYTES } from "./recordValidation";
import { savedAcquisitionView } from "./savedAcquisitionView";
import { completedRecoveryMessage } from "./recoveryFeedback";

export function AcquisitionRecovery({ recovery, busy = false, presentation = "scanner" }: { recovery: RecoveryControls; busy?: boolean; presentation?: "scanner" | "workspace" }) {
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
  const disabled = busy || importing || Boolean(recovery.cloud && (!recovery.cloud.ready || recovery.cloud.busy));
  const portfolio = presentation === "workspace";
  const unsaved = recovery.dirty ? recovery.cloud
    ? portfolio ? "Draft changes are separate from saved opportunities" : "Changes not saved to this acquisition"
    : "Changes not saved to a record" : "";
  const stateMessage = recovery.cloud
    ? recovery.cloud.status === "Saved" ? unsaved : `${recovery.cloud.status}${unsaved ? " · " + unsaved : ""}`
    : unsaved || (recovery.active ? recovery.active.name : "Browser-local workspace");
  const retrySave = recovery.cloud && (recovery.cloud.status === "Error" || recovery.cloud.status === "Offline");
  const showSave = presentation === "scanner" && Boolean(recovery.work.scan);
  const completedMessage = completedRecoveryMessage(recovery.notice, Boolean(recovery.cloud));
  const successVisible = completedMessage && !busy && !recovery.cloud?.busy && !recovery.storageError && !recovery.actionError &&
    (recovery.notice !== "Acquisition saved." || (!recovery.dirty && (!recovery.cloud || recovery.cloud.status === "Saved")));
  const persistentNotice = !completedMessage && !["Cloud acquisition reopened.", "Previous work restored."].includes(recovery.notice) ? recovery.notice : "";
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
    {showSave || stateMessage || retrySave ? <div className={portfolio ? "recovery-actions portfolio-save-state" : "recovery-actions"}>
      {showSave ? <button type="button" className="primary-action" onClick={recovery.save} disabled={disabled}>
        <Save aria-hidden="true" />{recovery.active ? "Update saved scan" : "Save acquisition"}
      </button> : null}
      {stateMessage ? <span className="recovery-state" role="status">{stateMessage}</span> : null}
      {retrySave ? <button type="button" onClick={recovery.cloud?.retry}>Retry cloud save</button> : null}
    </div> : null}
    <details className="saved-acquisitions" open={presentation === "workspace" ? true : undefined}>
      <summary>{portfolio ? <h3>Your Opportunities</h3> : <><FolderOpen aria-hidden="true" />Saved scans <span>({recovery.records.length})</span></>}</summary>
      <div className={portfolio ? "portfolio-toolbar" : undefined}>
      <div className="saved-acquisition-search">
        <Search aria-hidden="true" />
        <input ref={searchInput} type="search" aria-label="Search saved acquisitions by business name" placeholder={portfolio ? "Search opportunities…" : "Search acquisitions..."}
          value={searchQuery} onChange={event => { setSearchQuery(event.target.value); setRequestedPage(1); }} />
        {searchQuery ? <button type="button" aria-label="Clear acquisition search" title="Clear search"
          onClick={() => { setSearchQuery(""); setRequestedPage(1); searchInput.current?.focus(); }}><X aria-hidden="true" /></button> : null}
      </div>
      <button type="button" className={portfolio ? "portfolio-export" : undefined} aria-label={portfolio ? "Export Portfolio as CSV" : undefined} title={portfolio ? "Export portfolio as CSV" : undefined} onClick={recovery.exportSavedCsv} disabled={disabled || !recovery.records.length}><Download aria-hidden="true" />{portfolio ? "Export Portfolio" : "Export Portfolio CSV"}{portfolio ? <span className="portfolio-export-format" aria-hidden="true">CSV</span> : null}</button>
      </div>
      {view.totalPages > 1 ? <p className="saved-acquisition-range" role="status">Showing {view.start}&ndash;{view.end} of {view.total}</p> : null}
      {!recovery.records.length ? <p className="section-note">{recovery.cloud ? "No acquisitions saved to this cloud account yet." : "No acquisitions saved in this browser yet."}</p> :
        !view.total ? <p className="section-note">No acquisitions match your search.</p> :
        <ul className="saved-acquisition-list">{view.records.map(record => <li key={record.id}>
          <div className="saved-acquisition-title"><strong>{record.name}</strong>
            {portfolio && (record.state.scan.overview.industry.value || record.state.scan.overview.location.value) ? <span className="portfolio-opportunity-detail">{[record.state.scan.overview.industry.value, record.state.scan.overview.location.value].filter(Boolean).join(" · ")}</span> : null}
            <small>Updated {new Date(record.updatedAt).toLocaleDateString()} · {record.origin === "imported" ? "Imported backup" : recovery.cloud ? "Cloud record" : "Local record"}</small></div>
          {portfolio ? <div className="portfolio-row-price"><span>Asking price</span><strong>{formatMoney(savedAskingPrice(record))}</strong><small>{savedAskingPrice(record) === null ? "Not available in saved analysis" : "Saved figure · unverified"}</small></div> : null}
          {renaming === record.id ? <form className="rename-acquisition" onSubmit={e => { e.preventDefault(); recovery.rename(record, name); setRenaming(null); }}>
            <label><span className="sr-only">New acquisition name</span><input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={120} required /></label>
            <button type="submit" disabled={disabled}>Confirm name</button><button type="button" onClick={() => setRenaming(null)}>Cancel</button>
          </form> : <div className="saved-acquisition-actions">
            <button type="button" className={portfolio ? "portfolio-view-analysis" : undefined} aria-label={portfolio ? `View Analysis for ${record.name}` : undefined} onClick={() => recovery.open(record)} disabled={disabled}>{portfolio ? null : <FolderOpen aria-hidden="true" />}{portfolio ? "View Analysis" : "Open"}<span className="sr-only"> {record.name}</span>{portfolio ? <ArrowUpRight aria-hidden="true" /> : null}</button>
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
        <summary>{portfolio ? "Portfolio utilities & backups" : "Manage Backups"}</summary>
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
            {recovery.storageError && !recovery.cloud ? <button type="button" onClick={recovery.exportStoredRecovery}><Download aria-hidden="true" />Export stored recovery data</button> : null}
          </div>
          {!portfolio ? <p className="recovery-privacy">{recovery.cloud ? "Cloud records and drafts require a confirmed server save. Keep exported backups secure." : "Stored in this browser only. Keep backup files secure."}</p> : null}
          <details className="storage-help"><summary>Privacy and recovery</summary><p>{portfolio && recovery.cloud
            ? "Cloud records and drafts require server confirmation to be saved. Acquisition data stays in memory rather than persistent browser storage, so offline or failed edits can be lost if the tab closes. Cloud storage is not end-to-end encrypted or an independent backup. JSON backups may contain confidential acquisition information; keep exported backups secure. JSON is the complete recovery format; CSV is a summary only. Imported source claims and review flags are not independently verified."
            : <>{recovery.cloud ? "Cloud mode keeps acquisition data in memory, not persistent browser storage. Offline or failed edits can be lost if the tab closes. Named records change only after a confirmed update. Cloud storage is not end-to-end encrypted or an independent backup. " : "Browser-local storage is not encrypted. Records are not synchronized between computers, and browser data can be cleared or lost. "}JSON backups may contain confidential acquisition information. Keep them secure. JSON is the complete recovery format; CSV is a summary only. Imported source claims and review flags are not independently verified.</>}
          </p></details>
        </div>
      </details>
    </details>
    {recovery.storageError ? <p className="recovery-error" role="alert">{recovery.storageError}</p> : null}
    {recovery.actionError ? <p className="recovery-error" role="alert">{recovery.actionError}</p> : null}
    <div className="recovery-feedback" role="status" aria-live="polite" aria-atomic="true">{successVisible ? <span>{completedMessage}</span> : null}</div>
    {persistentNotice ? <p className="recovery-notice" role="status">{persistentNotice}</p> : null}
  </section>;
}
