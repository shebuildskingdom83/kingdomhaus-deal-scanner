import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import Plus from "lucide-react/dist/esm/icons/plus";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import BriefcaseBusiness from "lucide-react/dist/esm/icons/briefcase-business";
import FileText from "lucide-react/dist/esm/icons/file-text";
import { portfolioOverview } from "./portfolioOverview";
import { formatMoney } from "./financial";
import { AppHeader, ScannerWorkspace } from "./App";
import { AcquisitionRecovery } from "./AcquisitionRecovery";
import type { RecoveryControls } from "./useAcquisitionRecovery";

/** Navigation only: the recovery hook continues to own all acquisition data. */
export function AcquisitionWorkspace({ recovery, headerActions }: { recovery: RecoveryControls; headerActions?: ReactNode }) {
  const [view, setView] = useState<"home" | "analysis">("home");
  const previousGeneration = useRef(recovery.generation);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Open, import and new-scan operations advance generation only on success.
    // Cancelled confirmations and failed reads leave the home visible.
    if (previousGeneration.current !== recovery.generation) {
      previousGeneration.current = recovery.generation;
      setView("analysis");
    }
  }, [recovery.generation]);
  useEffect(() => {
    // Announce the destination without treating automatic route focus as keyboard input.
    // Subsequent keyboard navigation still uses the existing :focus-visible indicators.
    const routeFocus = { preventScroll: true, focusVisible: false };
    if (view === "home") title.current?.focus(routeFocus);
  }, [view]);

  if (view === "analysis") return <ScannerWorkspace recovery={recovery} headerActions={headerActions}
    onReturnToWorkspace={() => setView("home")} />;

  const busy = Boolean(recovery.cloud?.busy);
  const overview = portfolioOverview(recovery.records);
  return <main className="app-shell acquisition-workspace">
    <AppHeader activeView="Scan" actions={headerActions} />
    <section className="workspace-welcome" aria-labelledby="workspace-title">
      <div>
        <p className="eyebrow">Overview</p>
        <h2 id="workspace-title" ref={title} tabIndex={-1}>Acquisition Portfolio</h2>
        <p>Evaluate opportunities. Manage your pipeline. Make informed acquisition decisions.</p>
      </div>
      <button type="button" className="primary-action" disabled={busy} onClick={recovery.newScan}>
        <Plus aria-hidden="true" />Analyze an Opportunity
      </button>
    </section>
    <section className="portfolio-overview" aria-label="Portfolio overview">
      <dl className="portfolio-metrics">
        <div className="portfolio-metric">
          <dt><BriefcaseBusiness aria-hidden="true" />Opportunities</dt>
          <dd>{overview.opportunities.toLocaleString("en-US")}</dd>
          <dd className="portfolio-metric-note">Unique saved opportunities{overview.duplicates ? ` · ${overview.duplicates} duplicate ${overview.duplicates === 1 ? "record" : "records"} counted once` : ""}</dd>
        </div>
        <div className="portfolio-metric portfolio-metric-value">
          <dt>Portfolio Asking Value</dt>
          <dd>{formatMoney(overview.askingValue)}</dd>
          <dd className="portfolio-metric-note">{overview.disclosed} of {overview.opportunities} opportunities with disclosed asking prices</dd>
        </div>
        <div className="portfolio-metric">
          <dt>KHDA Analyses</dt>
          {/* Saved records contain no completed KHDA run ledger; session-only AI results cannot establish a count. */}
          <dd>Not tracked</dd>
          <dd className="portfolio-metric-note">Completed AI analyses</dd>
        </div>
      </dl>
      <p className="portfolio-provenance">{overview.askingValue !== null
        ? "Saved asking prices may include your corrections. These figures are unverified asking values, not a portfolio valuation."
        : "No disclosed asking prices are available in your saved opportunities. Asking value is not shown."}</p>
    </section>
    {recovery.hasWork ? <section className="workspace-resume" aria-labelledby="workspace-resume-title">
      <div className="portfolio-resume-icon"><FileText aria-hidden="true" /></div>
      <div className="portfolio-resume-copy"><h3 id="workspace-resume-title">Continue Where You Left Off</h3>
        <strong>{recovery.work.form.businessName || recovery.active?.name || "Your previous listing"}</strong></div>
      <button type="button" disabled={busy} onClick={() => setView("analysis")}>Continue Analysis<ArrowRight aria-hidden="true" /></button>
    </section> : null}
    {!recovery.records.length ? <section className="workspace-empty" aria-labelledby="workspace-empty-title">
      <FolderOpen aria-hidden="true" />
      <p className="eyebrow">Your next opportunity starts here</p>
      <h3 id="workspace-empty-title">Build your acquisition portfolio</h3>
      <p>Analyze a listing, review the evidence, and save your analysis. Your opportunities will be here when you return.</p>
    </section> : null}
    <AcquisitionRecovery recovery={recovery} presentation="workspace" />
  </main>;
}
