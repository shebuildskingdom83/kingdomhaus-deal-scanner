import { authenticatedApi, workspaceApi } from "./authenticatedApi";
import { useWorkspaceOperation } from "./useWorkspaceOperation";
import { WorkspaceChangedError, type WorkspaceSession } from "./workspaceSession";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import AlertCircle from "lucide-react/dist/esm/icons/alert-circle";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import Download from "lucide-react/dist/esm/icons/download";
import LinkIcon from "lucide-react/dist/esm/icons/link";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Search from "lucide-react/dist/esm/icons/search";
import Send from "lucide-react/dist/esm/icons/send";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import { downloadScanPdf } from "./pdf";
import { createCashFlowAssumptions } from "./acquisitionCashFlow";
import { createFounderDecision, founderDecisionChoices, founderDecisionDisplayLabel, founderDecisionOf, type FounderDecision } from "./founderDecision";
import { useAcquisitionRecovery } from "./useAcquisitionRecovery";
import type { RecoveryControls } from "./useAcquisitionRecovery";
import { AcquisitionRecovery } from "./AcquisitionRecovery";
import { businessComponentAmount, claritySellerDependence, diligenceReadout, publicReportText, resultsDisclaimer } from "./reporting";
import { buildCurrentAcquisitionCsv, downloadCsv } from "./csv";
import type { AcquisitionForm, KhdaAnalysis } from "./acquisitionRecord";
import { validKhdaAnalysis } from "./recordValidation";
import type { CashFlowAssumptions } from "./acquisitionCashFlow";
import { PostAcquisitionCashFlow } from "./PostAcquisitionCashFlow";
import { retrieveListing } from "./urlRetrieval";
import { BusinessWebsiteProjectGallery, ListingPhotographs } from "./ListingPhotographs";
import { safeBusinessWebsite } from "./safeExternalUrl";
import { preserveStreetAddressEvidence, resolvedStreetAddress } from "./listingAddress";
import { preserveListingMedia } from "./listingMedia";
import { formatMoney, formatRatio, isOptionalRealEstate, safeRatio } from "./financial";
import { PuterResponseFormatError, runPuterDealClarityPoc } from "./puterPoc";
import type { AssetDetail, DealScan, MoneyField, RealEstateDetail, RiskCheck, ScanResponse, TextFact } from "./types";

export type FormState = AcquisitionForm;

export const initialForm: FormState = {
  businessName: "",
  listingUrl: "",
  listingText: "",
  askingPrice: "",
  businessAskingPrice: "",
  annualRevenue: "",
  sde: "",
  ebitda: "",
  advertisedCashFlow: "",
  inventory: "",
  ffe: "",
  realEstate: ""
};

const correctionFields = [
  ["businessName", "Business name"],
  ["businessWebsite", "Business Website"],
  ["streetAddress", "Street address"],
  ["askingPrice", "Total asking price"],
  ["businessAskingPrice", "Business component price"],
  ["annualRevenue", "Gross Annual Revenue"],
  ["sde", "SDE"],
  ["ebitda", "EBITDA"],
  ["advertisedCashFlow", "Advertised cash flow"],
  ["inventory", "Inventory"],
  ["ffe", "FF&E"],
  ["realEstate", "Real estate"]
] as const;

export function App() {
  const recovery = useAcquisitionRecovery(initialForm);
  return <ScannerWorkspace recovery={recovery} />;
}

export function ScannerWorkspace({ recovery, headerActions, onReturnToWorkspace }: { recovery: RecoveryControls; headerActions?: ReactNode; onReturnToWorkspace?: () => void }) {
  const begin = useWorkspaceOperation(recovery.session, recovery.generation);
  const request = recovery.session ? workspaceApi(recovery.session) : authenticatedApi;
  const { form, scan, cashFlow, founderDecision, khdaAnalysis } = recovery.work;
  const setForm = (value: FormState | ((current: FormState) => FormState)) => recovery.setWork(current => ({
    ...current, form: typeof value === "function" ? value(current.form) : value
  }));
  const setScan = (value: DealScan | null) => recovery.setWork(current => ({ ...current, scan: value }));
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const workspaceActions = <>
    {onReturnToWorkspace ? <button type="button" className="ghost-button cloud-header-action"
      disabled={isLoading || isFetchingUrl || recovery.cloud?.busy} onClick={onReturnToWorkspace}>
      <ArrowLeft aria-hidden="true" />Return to Workspace
    </button> : null}
    {headerActions}
  </>;
  const retrievalId = useRef<string | undefined>(undefined);
  const retrievalBusy = useRef(false);
  const formRevision = useRef(0);
  useEffect(() => {
    if (!message || isLoading || isFetchingUrl) return;
    const timer = window.setTimeout(() => setMessage(null), 8000);
    return () => window.clearTimeout(timer);
  }, [message, isLoading, isFetchingUrl]);
  useEffect(() => {
    retrievalId.current = undefined;
    retrievalBusy.current = false;
    setIsLoading(false); setIsFetchingUrl(false);
    formRevision.current += 1;
  }, [recovery.generation]);

  async function submitScan(overrides?: Partial<FormState>) {
    const nextForm = { ...form, ...overrides };
    setErrors([]);
    setMessage(null);

    if (nextForm.listingText.trim().length < 30) {
      setErrors(["Paste at least 30 characters from the business listing."]);
      return;
    }

    setIsLoading(true);
    let operation: ReturnType<typeof begin> | undefined;
    try {
      operation = begin();
      const response = await request("/api/scan", {
        signal: operation.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: nextForm.businessName,
          listingUrl: nextForm.listingUrl,
          listingText: nextForm.listingText,
          retrievalId: retrievalId.current,
          corrections: buildCorrections(nextForm)
        })
      });
      const payload = (await response.json()) as ScanResponse;
      operation.assert();
      if (!payload.ok) {
        setErrors(payload.details?.length ? payload.details : [payload.error]);
        return;
      }
      setScan(preserveStreetAddressEvidence(preserveListingMedia(payload.scan, scan), scan));
      setMessage("Scan complete.");
    } catch (error) {
      if (error instanceof WorkspaceChangedError || operation?.signal.aborted || (recovery.session && !recovery.session.active)) return;
      setErrors([recovery.session && !recovery.session.founder
        ? "Scanning is unavailable if it requires a paid provider. Paid provider access is reserved for the founder. Your work is unchanged."
        : "Scan failed or API access is unavailable. Your work is unchanged. Check sign-in and the local API setup before trying again."]);
    } finally {
      if (!operation?.signal.aborted && (!recovery.session || recovery.session.active)) setIsLoading(false);
    }
  }

  async function scanFromUrl() {
    if (retrievalBusy.current || isLoading) return;
    setErrors([]);
    setMessage(null);

    if (!form.listingUrl.trim()) {
      setErrors(["Enter a public HTTPS listing URL or paste the listing text."]);
      return;
    }

    retrievalBusy.current = true;
    setIsFetchingUrl(true);
    const revision = formRevision.current;
    let operation: ReturnType<typeof begin> | undefined;
    try {
      operation = begin();
      const payload = await retrieveListing(form.listingUrl, { fetcher: request, signal: operation.signal, assertCurrent: operation.assert,
        confirm: notice => { operation!.assert(); return window.confirm(notice); }, progress: value => { operation!.assert(); setMessage(value); } });
      operation.assert();
      if (!payload) return;
      if (revision !== formRevision.current) {
        setMessage("Listing retrieved. Your edited text was kept.");
        return;
      }
      retrievalId.current = payload.retrievalId;
      const nextForm = {
        ...form,
        businessName: form.businessName || (payload.retrievalId ? "" : payload.title) || "",
        listingUrl: form.listingUrl.trim(),
        listingText: payload.listingText
      };
      setForm(nextForm);
      setMessage(payload.message);
      await submitScan(nextForm);
      operation.assert();
      setMessage(payload.message);
    } catch (error) {
      if (error instanceof WorkspaceChangedError || operation?.signal.aborted || (recovery.session && !recovery.session.active)) return;
      setMessage(null);
      setErrors([error instanceof Error ? error.message : "URL scan failed. Paste the listing text and scan again."]);
    } finally {
      if (!operation?.signal.aborted && (!recovery.session || recovery.session.active)) { retrievalBusy.current = false; setIsFetchingUrl(false); }
    }
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    formRevision.current += 1;
    if (key === "listingText" || key === "listingUrl") retrievalId.current = undefined;
    setForm((current) => ({ ...current, [key]: value }));
  }

  if (scan) {
    return (
      <ResultsScreen
        key={recovery.generation + ":" + scan.id}
        scan={scan}
        form={form}
        message={message}
        errors={errors}
        isLoading={isLoading}
        isFetchingUrl={isFetchingUrl}
        onBack={() => {
          recovery.newScan();
          setMessage(null);
          setErrors([]);
        }}
        onDownload={(assumptions, decision) => { recovery.session?.assert(); downloadScanPdf(scan, assumptions, decision); }}
        onFieldChange={updateForm}
        onRefresh={submitScan}
        onScanFromUrl={scanFromUrl}
        cashFlowAssumptions={cashFlow}
        onCashFlowChange={value => recovery.setWork(current => ({ ...current, cashFlow: value }))}
        founderDecision={founderDecision}
        onFounderDecisionChange={value => { recovery.session?.assert(); recovery.setWork(current => ({ ...current, founderDecision: value })); }}
        khdaAnalysis={khdaAnalysis}
        onKhdaAnalysisChange={value => { recovery.session?.assert(); recovery.setWork(current => ({ ...current, khdaAnalysis: value })); }}
        recoveryControls={<AcquisitionRecovery recovery={recovery} busy={isLoading || isFetchingUrl} />}
        headerActions={workspaceActions}
        session={recovery.session}
      />
    );
  }

  return (
    <main className="app-shell intake-shell">
      <AppHeader activeView="Scan" actions={workspaceActions} />

      <section className="intake-layout" id="listing-intake">
        <div className="intro-panel">
          <p className="eyebrow">Acquisition intelligence</p>
          <h2>Screen business listings with discipline.</h2>
          <p>
            Capture the listing, preserve the evidence, and focus on the diligence questions that matter before deeper
            review.
          </p>
          <div className="notice">
            <span>Preliminary screen only. The scanner supports diligence; it does not approve acquisitions.</span>
          </div>
        </div>

        <form
          className="intake-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitScan();
          }}
        >
          <div className="form-section">
            <h2>Listing Intake</h2>
            <p className="section-note">Start with a public listing URL or paste the full listing text when access is blocked.</p>
          </div>

          <div className="scan-card">
            <label>
              <span>Business name</span>
              <input
                value={form.businessName}
                onChange={(event) => updateForm("businessName", event.target.value)}
                placeholder="Optional"
                autoComplete="organization"
              />
            </label>
            <label>
              <span>Business Website (optional)</span>
              <input type="url" value={form.businessWebsite ?? ""} onChange={event => updateForm("businessWebsite", event.target.value)} placeholder="https://business.example.com/" />
            </label>
          </div>

          <div className="scan-card">
            <label>
              <span>Listing URL</span>
              <input
                value={form.listingUrl}
                onChange={(event) => updateForm("listingUrl", event.target.value)}
                placeholder="https://example.com/listing"
                inputMode="url"
              />
            </label>
            <button className="primary-action secondary" type="button" onClick={scanFromUrl} disabled={isFetchingUrl || isLoading}>
              {isFetchingUrl ? <RefreshCw aria-hidden="true" className="spin" /> : <LinkIcon aria-hidden="true" />}
              {isFetchingUrl ? "Scanning URL" : "Scan from URL"}
            </button>
          </div>

          <div className="scan-card primary-scan-card" id="listing-text">
            <label>
              <span className="sr-only">Listing text</span>
              <textarea
                value={form.listingText}
                onChange={(event) => updateForm("listingText", event.target.value)}
                placeholder="Paste complete business listing here..."
                rows={14}
                required
              />
            </label>
          </div>

          <Feedback message={message} errors={errors} />

          <button className="primary-action" type="submit" disabled={isLoading || isFetchingUrl} aria-busy={isLoading}>
            {isLoading ? <RefreshCw aria-hidden="true" className="spin" /> : <Search aria-hidden="true" />}
            {isLoading ? "Scanning business" : "Scan business"}
          </button>
        </form>
      </section>
      <AcquisitionRecovery recovery={recovery} busy={isLoading || isFetchingUrl} />
    </main>
  );
}

export function ResultsScreen(props: {
  scan: DealScan;
  form: FormState;
  message: string | null;
  errors: string[];
  isLoading: boolean;
  isFetchingUrl: boolean;
  onBack: () => void;
  onDownload: (assumptions?: CashFlowAssumptions, founderDecision?: FounderDecision) => void;
  onFieldChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onRefresh: () => void;
  onScanFromUrl: () => void;
  cashFlowAssumptions?: CashFlowAssumptions;
  onCashFlowChange?: (value: CashFlowAssumptions) => void;
  founderDecision?: FounderDecision;
  onFounderDecisionChange?: (value: FounderDecision) => void;
  khdaAnalysis?: KhdaAnalysis;
  onKhdaAnalysisChange?: (value: KhdaAnalysis) => void;
  recoveryControls?: ReactNode;
  headerActions?: ReactNode;
  session?: WorkspaceSession;
  hideDueDiligence?: boolean;
  publicDemoTab?: "Analysis" | "CIM" | "Due Diligence";
}) {
  const { scan } = props;
  const beginAnalysis = useWorkspaceOperation(props.session, scan.id);
  const puterAllowed = !props.session || props.session.founder;
  const [localAssumptions, setLocalAssumptions] = useState(createCashFlowAssumptions);
  const cashFlowAssumptions = props.cashFlowAssumptions ?? localAssumptions;
  const setCashFlowAssumptions = props.onCashFlowChange ?? setLocalAssumptions;
  const [localFounderDecision, setLocalFounderDecision] = useState(createFounderDecision);
  const founderDecision = founderDecisionOf(props.founderDecision ?? localFounderDecision);
  const setFounderDecision = props.onFounderDecisionChange ?? setLocalFounderDecision;
  const [localKhdaAnalysis, setLocalKhdaAnalysis] = useState<KhdaAnalysis>();
  const khdaAnalysis = props.onKhdaAnalysisChange ? props.khdaAnalysis : localKhdaAnalysis;
  const setKhdaAnalysis = props.onKhdaAnalysisChange ?? setLocalKhdaAnalysis;
  const khdaStale = Boolean(khdaAnalysis && khdaAnalysis.sourceScanId !== scan.id);
  const optionalRealEstate = isOptionalRealEstate(scan.financials.realEstate);
  const optionalRealEstateAmount = optionalRealEstate ? scan.financials.realEstate.value.amount : null;
  const requiredAdditionalCosts = scan.financials.knownAdditionalAcquisitionCosts.amount;
  const businessPriceAmount = businessComponentAmount(scan.financials);
  const sdeLabel = scan.financials.sde.amount === null ? "SDE" : scan.financials.sde.source === "user_correction" ? "SDE (user correction)" : "Seller-reported SDE";
  const acquisitionCapitalWithoutOptionalRealEstate =
    scan.financials.askingPrice.amount === null
      ? null
      : scan.financials.askingPrice.amount + (requiredAdditionalCosts ?? 0);
  const acquisitionCapitalWithOptionalRealEstate =
    acquisitionCapitalWithoutOptionalRealEstate === null
      ? null
      : acquisitionCapitalWithoutOptionalRealEstate + (optionalRealEstateAmount ?? 0);
  const cashFlowMultiple = safeRatio(scan.financials.askingPrice.amount, scan.financials.advertisedCashFlow.amount);
  const businessCashFlowMultiple = safeRatio(businessPriceAmount, scan.financials.advertisedCashFlow.amount);
  const primaryCashFlowRatio =
    scan.ratios.askingPriceToSde !== null
      ? { label: "Combined asking / SDE", value: formatRatio(scan.ratios.askingPriceToSde) }
      : { label: "Combined asking / advertised cash flow", value: formatRatio(cashFlowMultiple) };
  const businessCashFlowRatio =
    scan.ratios.businessAskingPriceToSde !== null
      ? { label: "Business-only asking / SDE", value: formatRatio(scan.ratios.businessAskingPriceToSde) }
      : { label: "Business-only asking / advertised cash flow", value: formatRatio(businessCashFlowMultiple) };
  const [puterPoc, setPuterPoc] = useState<{
    isLoading: boolean;
    error: string | null;
  }>({
    isLoading: false,
    error: null
  });
  const [puterConfirmationOpen, setPuterConfirmationOpen] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  useEffect(() => {
    if (!exportNotice) return;
    const timer = window.setTimeout(() => setExportNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [exportNotice]);
  function exportCurrentCsv() {
    setExportError(null);
    try {
      props.session?.assert();
      downloadCsv(buildCurrentAcquisitionCsv(scan, cashFlowAssumptions, founderDecision), "kingdomhaus-current-acquisition.csv");
      setExportNotice("CSV exported.");
    } catch {
      setExportNotice(null);
      setExportError("CSV export could not complete. Your analysis is unchanged.");
    }
  }

  async function runPuterPoc() {
    if (!puterAllowed) return;
    setPuterConfirmationOpen(false);
    setPuterPoc((current) => ({ ...current, isLoading: true, error: null }));
    let operation: ReturnType<typeof beginAnalysis> | undefined;
    try {
      operation = beginAnalysis();
      const result = await runPuterDealClarityPoc(scan, operation.assert);
      operation.assert();
      const completed: KhdaAnalysis = { summary: result.summary, completedAt: new Date().toISOString(), model: result.model, sourceScanId: scan.id };
      if (!validKhdaAnalysis(completed)) throw new PuterResponseFormatError("The completed analysis exceeded the supported summary format.", "");
      setKhdaAnalysis(completed);
      setPuterPoc({
        isLoading: false,
        error: null
      });
    } catch (error) {
      if (error instanceof WorkspaceChangedError || operation?.signal.aborted || (props.session && !props.session.active)) return;
      setPuterPoc({
        isLoading: false,
        error:
          error instanceof PuterResponseFormatError
            ? "The analysis response was incomplete. No deal facts were changed."
            : "Analysis could not be completed. Check your external AI account sign-in before trying again.",
      });
    }
  }

  return (
    <main className="app-shell results-shell">
      <AppHeader activeView="Report" actions={props.headerActions} />

      <section className="results-header executive-header" id="report-top">
        <div className="executive-copy">
          <button className="ghost-button" type="button" onClick={props.onBack} disabled={props.isLoading || props.isFetchingUrl}>
            <ArrowLeft aria-hidden="true" />
            New scan
          </button>
          <p className="eyebrow">Executive Overview</p>
          <h1>{displayListingTitle(scan)}</h1>
          <div className="result-meta" aria-label="Listing summary">
            <span>{scan.overview.industry.value ?? "Industry not disclosed"}</span>
            <span>{scan.overview.location.value ?? "Market not disclosed"}</span>
            <span>{scan.analysisMode === "ai" ? "OpenAI-assisted" : "Rule-based"}</span>
          </div>
        </div>
        <div className="recommendation-card">
          <span>Preliminary recommendation</span>
          <DecisionBadge decision={scan.decision.recommendation} />
          <p>{scan.decision.explanation}</p>
        </div>
      </section>

      <section className="founder-decision-panel" aria-labelledby="acquisition-decision-heading">
        <div className="founder-decision-intro">
          <h2 id="acquisition-decision-heading">Acquisition Decision</h2>
          <span className="founder-decision-status" data-decision={founderDecision.decision ?? "Undecided"}
            role="img" aria-label={`Acquisition decision: ${founderDecisionDisplayLabel(founderDecision)}`}
            title={founderDecisionDisplayLabel(founderDecision)} />
        </div>
        <div className="founder-decision-fields">
          <label>
            <span className="sr-only">Decision</span>
            <select value={founderDecision.decision ?? ""} onChange={event => setFounderDecision({ ...founderDecision, decision: (event.target.value || null) as FounderDecision["decision"] })}>
              <option value="">Undecided</option>
              {founderDecisionChoices.map(choice => <option key={choice} value={choice}>{founderDecisionDisplayLabel({ ...founderDecision, decision: choice })}</option>)}
            </select>
          </label>
          <label>
            <span>Reason for Decision <small>(optional)</small></span>
            <textarea rows={2} maxLength={4000} placeholder="Optional" value={founderDecision.rationale} onChange={event => setFounderDecision({ ...founderDecision, rationale: event.target.value })} />
          </label>
          <label>
            <span>Next Step <small>(optional)</small></span>
            <textarea rows={2} maxLength={4000} placeholder="Optional" value={founderDecision.nextDiligenceAction} onChange={event => setFounderDecision({ ...founderDecision, nextDiligenceAction: event.target.value })} />
          </label>
        </div>
      </section>

      <CorrectionAccordion
        scan={scan}
        form={props.form}
        isLoading={props.isLoading}
        onFieldChange={props.onFieldChange}
        onApply={props.onRefresh}
      />

      <section className="result-hero financial-kpis" aria-label="Financial snapshot">
        <Metric label="Total asking price" value={formatMoney(scan.financials.askingPrice.amount)} detail="Advertised transaction price" />
        <Metric label="Gross Annual Revenue" value={formatMoney(scan.financials.annualRevenue.amount)} detail="Seller-reported gross revenue" />
        <Metric label={sdeLabel} value={formatMoney(scan.financials.sde.amount)} detail="Not independently verified" />
        <Metric label="EBITDA" value={formatMoney(scan.financials.ebitda.amount)} detail="Reported EBITDA" />
        <Metric label={primaryCashFlowRatio.label} value={primaryCashFlowRatio.value} detail="Preliminary multiple" />
      </section>

      <Feedback message={exportNotice ?? props.message} errors={exportError ? [...props.errors, exportError] : props.errors} />


      <div className="report-toolbar">
        <section className="action-row" aria-label="Result actions">
          <button type="button" onClick={() => props.onDownload(cashFlowAssumptions, founderDecision)}>
            <Download aria-hidden="true" />
            Download PDF
          </button>
          <button type="button" onClick={exportCurrentCsv}>
            <Download aria-hidden="true" />
            Export Deal CSV
          </button>
          <button type="button" disabled aria-disabled="true">
            <Send aria-hidden="true" />
            Send to Notion — Coming soon
          </button>
        </section>
      </div>

      {props.recoveryControls}

      {(!props.publicDemoTab || props.publicDemoTab === "Analysis") ? <>
      <Panel title="Business Profile">
        {scan.retrieval ? <ListingPhotographs photographs={scan.retrieval.photographs} /> : null}
        <BusinessWebsiteProjectGallery scan={scan} />
        <dl className="detail-grid profile-grid">
          <BusinessWebsite fact={scan.businessDetails.businessWebsite} />
          <SourceListing url={scan.listingUrl ?? scan.businessDetails.url.value} />
          {isDistinctText(scan.businessDetails.listingTitle.value, scan.overview.businessName.value) ? (
            <Fact label="Listing title" fact={scan.businessDetails.listingTitle} />
          ) : null}
          <LocationFacts location={scan.overview.location} streetAddress={resolvedStreetAddress(scan)} />
          <Fact label="Industry" fact={scan.overview.industry} />
          <Fact label="Services" fact={scan.overview.services} wide />
          {isDistinctText(scan.overview.revenueModel.value, scan.overview.industry.value) && isDistinctText(scan.overview.revenueModel.value, scan.overview.services.value) ? <Fact label="Business model" fact={scan.overview.revenueModel} /> : null}
          {scan.overview.customerSegments ? <Fact label="Customer segments" fact={scan.overview.customerSegments} /> : null}
          <Fact label="Year established" fact={scan.overview.yearEstablished} />
          <Fact label="Years operating" fact={scan.overview.yearsOperating} />
          <Fact label="Employee count" fact={scan.overview.employeeCount} />
          <Fact label="Reason for sale" fact={scan.overview.reasonForSale} />
          <Fact label="Owner involvement" fact={scan.overview.ownerInvolvement} wide />
          <Fact label="Seller transition and training" fact={scan.businessDetails.sellerSupportTraining} wide />
          <Fact label="Facilities" fact={scan.businessDetails.facilities} wide />
          <Fact label="Growth opportunities" fact={scan.businessDetails.growthOpportunities} wide />
        </dl>
        <details className="business-details">
          <summary>Complete business description</summary>
          <dl><Fact label="Business description" fact={scan.businessDetails.fullDescription} wide preserveLineBreaks /></dl>
        </details>
        <details className="business-details">
          <summary>Other available listing information</summary>
          <Fact label="Competition" fact={scan.businessDetails.competition} wide />
          <Fact label="Financing" fact={scan.businessDetails.financing} />
          <Fact label="Broker information" fact={scan.businessDetails.brokerInformation} wide />
          <div className="additional-details">
            {scan.businessDetails.additionalDetails
              .filter((detail) => detail.label !== "Complete source text")
              .map((detail) => (
                <details key={`${detail.label}-${detail.value.slice(0, 20)}`} className="source-line">
                  <summary>{detail.label}</summary>
                  <p>{publicReportText(detail.value)}</p>
                </details>
              ))}
          </div>
        </details>
      </Panel>

      <Panel title="Financial Intelligence">
        <dl className="detail-grid">
          <MoneyFact label="Total asking price" field={scan.financials.askingPrice} />
          <MoneyFact label="Business component price" field={scan.financials.businessAskingPrice} />
          <MoneyFact label="Gross Annual Revenue" field={scan.financials.annualRevenue} />
          <MoneyFact label={sdeLabel} field={scan.financials.sde} />
          <MoneyFact label="EBITDA" field={scan.financials.ebitda} />
          <MoneyFact
            label={`Advertised cash flow${scan.financials.advertisedCashFlow.sellerTerminology ? `: ${scan.financials.advertisedCashFlow.sellerTerminology}` : ""}`}
            field={scan.financials.advertisedCashFlow}
          />
          <AssetFact label="Inventory" asset={scan.financials.inventory} />
          <AssetFact label="FF&E" asset={scan.financials.ffe} />
          <RealEstateFact realEstate={scan.financials.realEstate} optional={optionalRealEstate} />
          <MoneyFact label="Required additional costs" field={scan.financials.knownAdditionalAcquisitionCosts} />
        </dl>
        <div className="ratio-strip">
          <Ratio label={primaryCashFlowRatio.label} value={primaryCashFlowRatio.value} />
          <Ratio label={businessCashFlowRatio.label} value={businessCashFlowRatio.value} />
          <Ratio label="Asking price / EBITDA" value={formatRatio(scan.ratios.askingPriceToEbitda)} />
          <Ratio label="SDE margin" value={formatPercent(scan.ratios.sdeToRevenue)} />
        </div>
        <div className="capital-strip" aria-label="Acquisition capital scenarios">
          <Metric label="Disclosed business component" value={formatMoney(businessPriceAmount)} detail="Not inferred from combined pricing" />
          <Metric label="Price + required costs" value={formatMoney(acquisitionCapitalWithoutOptionalRealEstate)} detail="Adds required excluded assets" />
          <Metric label={optionalRealEstate ? "With optional real estate" : "Combined transaction price"} value={formatMoney(acquisitionCapitalWithOptionalRealEstate)} detail={optionalRealEstate ? "Shown separately when optional" : "Included real estate is not added again"} />
          <Metric label="Unknown costs" value="Verify" detail="Working capital, debt, and liens" />
        </div>
        <Fact label="Equipment continuity exposure" fact={scan.financials.equipmentReplacementNeeds} wide />
        <Fact label="Immediate capital needs" fact={scan.financials.immediateCapitalNeeds} wide />
        <p className="section-note">
          Included FF&E, inventory, and real estate are not counted twice. Separately offered real estate is shown as
          optional unless transaction documents make it required.
        </p>
        <PostAcquisitionCashFlow financials={scan.financials} assumptions={cashFlowAssumptions} onChange={setCashFlowAssumptions} ownerInvolvement={scan.overview.ownerInvolvement} />
      </Panel>

      <Panel title="Deal Clarity" className="clarity-panel" id="deal-clarity">
        <div className="analysis-source">
          <span>{scan.analysisMode === "ai" ? "AI-assisted assessment" : "Rule-based assessment"}</span>
        </div>
        <div className="summary-grid">
          <SummaryQuestion label="Strategic fit" value={scan.claritySummary.strategicFit} />
          <SummaryQuestion label="Attractive characteristics" value={scan.claritySummary.attractiveCharacteristics} />
          <SummaryQuestion label="Seller dependence" value={claritySellerDependence(scan)} />
          <SummaryQuestion label="Equipment continuity" value={scan.claritySummary.equipmentContinuity} />
          <SummaryQuestion label="Financial questions" value={scan.claritySummary.financialQuestions} />
          <SummaryQuestion label="Major risks" value={scan.claritySummary.majorRisks} />
        </div>
        <section className="intelligence-panel" aria-label="Optional AI-assisted analysis">
          <div className="khda-introduction">
            <h3>KingdomHaus Deal Analyzer</h3>
            <p className="khda-subtitle">A deeper look at the opportunity.</p>
            <p>The Deal Analyzer helps connect disclosed financial information, ownership responsibilities, operating dependencies, and diligence questions behind a listing. It provides an additional analytical perspective beyond the initial rule-based screen.</p>
          </div>
          <button className="primary-action intelligence-action" type="button" onClick={() => { props.session?.assert(); if (puterAllowed) setPuterConfirmationOpen(true); }} disabled={!puterAllowed || puterPoc.isLoading} aria-busy={puterPoc.isLoading}>
            {puterPoc.isLoading ? <RefreshCw aria-hidden="true" className="spin" /> : <Sparkles aria-hidden="true" />}
            {puterPoc.isLoading ? "Analyzing deal" : "KingdomHaus Intelligence™ — Analyze Deal"}
          </button>
        </section>
        {!puterAllowed ? <p role="status">AI deal analysis is intentionally disabled in this public demonstration.</p> : null}
        {puterConfirmationOpen && puterAllowed ? (
          <div className="ai-confirmation" aria-live="polite">
            <p>This optional analysis uses an external AI service. Sign-in may be required. Usage may consume your allowance or incur charges on that account. Continue only if you accept those charges.</p>
            <div className="confirmation-actions">
              <button type="button" onClick={runPuterPoc}>Confirm and analyze</button>
              <button type="button" onClick={() => setPuterConfirmationOpen(false)}>Cancel</button>
            </div>
          </div>
        ) : null}
        <div aria-live="polite" className="puter-poc-result">
          {puterPoc.error ? (
            <div className="error-message" role="alert">
              <AlertCircle aria-hidden="true" />
              <div>
                <strong>Analysis did not complete</strong>
                <p>{puterPoc.error}</p>
              </div>
            </div>
          ) : null}
          {khdaAnalysis ? (
            <div className="puter-summary">
              <div className="analysis-source">
                <span>{khdaStale ? "Earlier KHDA analysis — source scan changed; not current" : "KHDA analysis — preliminary, unverified AI findings"}</span>
              </div>
              <p>Completed {new Date(khdaAnalysis.completedAt).toLocaleDateString()} using {khdaAnalysis.model}. These findings are separate from the rule-based recommendation and Acquisition Decision.</p>
              <div className="summary-grid">
                <SummaryQuestion label="Strategic fit" value={khdaAnalysis.summary.strategicFit} />
                <SummaryQuestion label="Attractive characteristics" value={khdaAnalysis.summary.attractiveCharacteristics} />
                <SummaryQuestion label="Seller dependence" value={khdaAnalysis.summary.sellerDependence} />
                <SummaryQuestion label="Equipment continuity" value={khdaAnalysis.summary.equipmentContinuity} />
                <SummaryQuestion label="Financial questions" value={khdaAnalysis.summary.financialQuestions} />
                <SummaryQuestion label="Major risks" value={khdaAnalysis.summary.majorRisks} />
              </div>
            </div>
          ) : null}
        </div>
      </Panel>

      </> : null}

      {props.hideDueDiligence ? null : <Panel title="Due Diligence">
        <DiligenceDetails key={scan.id} rows={buildDiligenceRows(scan)} />
      </Panel>}
      <footer className="report-disclaimer">
        <p>{resultsDisclaimer}</p>
        <details><summary>About this preliminary screen</summary><p>Keep Reading is a screening recommendation, not acquisition approval. Confirm source documents, ownership, transfer requirements, operating responsibilities, and financial assumptions with qualified advisers. Hypothetical savings and estimated cash remaining are not guaranteed distributions.</p></details>
      </footer>
    </main>
  );
}

function buildCorrections(form: FormState) {
  return Object.fromEntries(
    correctionFields
      .map(([key]) => [key, form[key]])
      .filter(([key, value]) => typeof value === "string" && (key === "businessWebsite" || key === "streetAddress" || value.trim().length > 0))
  );
}

type DiligenceRow = Pick<RiskCheck, "label" | "status" | "explanation" | "requiresVerification" | "verificationItems">;

export function DiligenceDetails({ rows }: { rows: readonly DiligenceRow[] }) {
  const priority = { watch: 0, unknown: 1, clear: 2 };
  const orderedRows = [...rows].sort((a, b) => priority[a.status] - priority[b.status]);
  const watchCount = rows.filter((item) => item.status === "watch").length;
  const unknownCount = rows.filter((item) => item.status === "unknown").length;

  return (
    <div className="diligence-overview">
      <dl className="diligence-counts">
        <div><dt>Total checks</dt><dd>{rows.length}</dd></div>
        <div><dt>Watch</dt><dd>{watchCount}</dd></div>
        <div><dt>Unknown / missing information</dt><dd>{unknownCount}</dd></div>
      </dl>
      <details className="diligence-details">
        <summary>View diligence details <ChevronDown aria-hidden="true" /></summary>
        <div className="risk-list">
          {orderedRows.map((item) => (
            <article className="risk-row" key={item.label}>
              <div>
                <h3>{item.label}</h3>
                <span className="risk-kind">{item.requiresVerification ? "Franchise terms to verify" : statusContext(item.status)}</span>
                <p>{publicReportText(diligenceReadout(item.label, item.explanation))}</p>
                {item.verificationItems ? <ul className="simple-list">{item.verificationItems.map((point) => <li key={point}>{point}</li>)}</ul> : null}
              </div>
              <StatusBadge status={item.status} requiresVerification={item.requiresVerification} />
            </article>
          ))}
        </div>
      </details>
    </div>
  );
}

function buildDiligenceRows(scan: DealScan) {
  const riskByLabel = new Map(scan.riskChecks.map((risk) => [risk.label, risk]));
  const missing = scan.missingInformation.join(" ");
  const rows = [
    {
      label: "Financial verification",
      status: riskByLabel.get("Earnings quality")?.status ?? "unknown",
      explanation: firstText(
        riskByLabel.get("Earnings quality")?.explanation,
        matchingText(missing, /financial verification|quality of earnings|add-backs|working capital/i),
        "Verify SDE, EBITDA, revenue, tax returns, add-backs, working capital, and quality of earnings."
      )
    },
    {
      label: "Owner and key-person dependence",
      status: riskByLabel.get("Owner dependence")?.status ?? "unknown",
      explanation: firstText(
        riskByLabel.get("Owner dependence")?.explanation,
        riskByLabel.get("Key-person risk")?.explanation,
        "Verify seller role, key relationships, and whether operations can continue without the owner."
      )
    },
    {
      label: "Customer concentration",
      status: riskByLabel.get("Customer concentration")?.status ?? "unknown",
      explanation: firstText(
        riskByLabel.get("Customer concentration")?.explanation,
        matchingText(missing, /customer concentration/i),
        "Request customer revenue mix and top-customer exposure."
      )
    },
    {
      label: "Equipment condition and continuity",
      status: riskByLabel.get("Equipment continuity")?.status ?? "unknown",
      explanation: firstText(
        riskByLabel.get("Equipment continuity")?.explanation,
        scan.financials.equipmentReplacementNeeds.value,
        "Verify FF&E inclusion, condition, remaining useful life, maintenance history, and replacement exposure."
      )
    },
    {
      label: "Equipment loans, liens, and payoff obligations",
      status: /loan|lien|payoff/i.test(`${scan.listingText} ${missing}`) ? "watch" : "unknown",
      explanation: firstText(
        matchingText(missing, /loan payoff|lien|payoff/i),
        "Confirm whether any equipment debt, liens, payoff obligations, or title releases must be handled at closing."
      )
    },
    {
      label: "Supplier dependence",
      status: riskByLabel.get("Supplier dependence")?.status ?? "unknown",
      explanation: firstText(
        riskByLabel.get("Supplier dependence")?.explanation,
        matchingText(missing, /supplier dependence|vendor terms|single-source/i),
        "Verify vendors, terms, and single-source exposure."
      )
    },
    {
      label: "Licensing and regulatory requirements",
      status: riskByLabel.get("Licensing and credentials")?.status ?? "unknown",
      explanation: firstText(
        riskByLabel.get("Licensing and credentials")?.explanation,
        "Confirm license, permit, credential, and regulatory requirements before proceeding."
      )
    },
    {
      label: "Seller transition",
      status: scan.businessDetails.sellerSupportTraining.value ? "watch" : "unknown",
      explanation: firstText(
        scan.businessDetails.sellerSupportTraining.value,
        matchingText(missing, /seller transition|training terms/i),
        "Confirm transition timeline, training terms, and post-close seller role."
      )
    },
    {
      label: "Working capital and immediate capital needs",
      status: riskByLabel.get("Near-term capital expenditure")?.status ?? "unknown",
      explanation: firstText(
        scan.financials.immediateCapitalNeeds.value,
        riskByLabel.get("Near-term capital expenditure")?.explanation,
        "Verify inventory, deposits, working capital, deferred maintenance, and other closing cash needs."
      )
    }
  ] as const;

  const allRows: Pick<RiskCheck, "label" | "status" | "explanation" | "requiresVerification" | "verificationItems">[] = [
    ...rows, ...scan.riskChecks.filter((item) => item.requiresVerification)
  ];
  const seen = new Set<string>();
  return allRows.map((row) => {
    const key = row.explanation.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) {
      return { ...row, explanation: "See related diligence item above; verify with source documents before relying on this point." };
    }
    seen.add(key);
    return row;
  });
}

function firstText(...values: Array<string | null | undefined>) {
  return values.find((value): value is string => Boolean(value?.trim()))?.trim() ?? "Not disclosed.";
}

function matchingText(text: string, pattern: RegExp) {
  return text
    .split(".")
    .map((item) => item.trim())
    .find((item) => pattern.test(item)) ?? null;
}

export function AppHeader({ actions }: { activeView: "Scan" | "Report"; actions?: ReactNode }) {
  const publicBase = typeof window !== "undefined" && window.location.pathname.startsWith("/kingdomhaus-deal-scanner") ? "/kingdomhaus-deal-scanner" : "";
  return (
    <header className="app-header" aria-label="Application header">
      <div className="brand-lockup">
        <img className="brand-logo" src={publicBase + "/assets/brand/kingdomhaus-logo-240.webp"} alt="KingdomHaus logo" width="112" height="84" />
        <h1>Deal Scanner</h1>
      </div>
      <div className="app-header-actions">
        <a className="kingdomhaus-home" href={publicBase + "/"}>KingdomHaus Home</a>
        <a className="kingdomhaus-home" href={publicBase + "/#help"}>Help &amp; Guide</a>
        {actions}
      </div>
    </header>
  );
}

function CorrectionAccordion(props: {
  scan: DealScan;
  form: FormState;
  isLoading: boolean;
  onFieldChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onApply: () => void;
}) {
  return (
    <details className="correction-panel">
      <summary>Review or correct extracted values</summary>
      <p className="section-note">
        Fields are prefilled from the current scan. Edited values are marked as corrections and recalculated without fetching the URL again.
      </p>
      <div className="field-grid compact">
        {correctionFields.map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input type={key === "businessWebsite" ? "url" : "text"} value={["businessWebsite", "streetAddress"].includes(key) ? props.form[key] ?? correctionValue(props.scan, key) : props.form[key] || correctionValue(props.scan, key)} onChange={(event) => props.onFieldChange(key, event.target.value)} />
          </label>
        ))}
      </div>
      <button className="primary-action secondary" type="button" onClick={props.onApply} disabled={props.isLoading}>
        <RefreshCw aria-hidden="true" className={props.isLoading ? "spin" : undefined} />
        Apply corrections
      </button>
    </details>
  );
}

function Panel({ title, children, className = "", id }: { title: string; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`panel ${className}`} id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}

function Fact({ label, fact, wide = false, preserveLineBreaks = false }: { label: string; fact: TextFact; wide?: boolean; preserveLineBreaks?: boolean }) {
  return (
    <div className={`fact ${wide ? "wide" : ""}`}>
      <dt>{label}</dt>
      <dd style={preserveLineBreaks ? { whiteSpace: "pre-line" } : undefined}>{publicReportText(fact.value ?? "Not Disclosed")}</dd>
    </div>
  );
}

function BusinessWebsite({ fact }: { fact?: TextFact }) {
  const url = safeBusinessWebsite(fact?.value);
  return <div className="fact"><dt>Business Website</dt><dd>{url
    ? <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Visit Website<span className="sr-only"> (opens in a new tab)</span></a>
    : "Not Disclosed"}</dd></div>;
}

function SourceListing({ url }: { url: string | null }) {
  const safe = safeBusinessWebsite(url);
  return <div className="fact"><dt>Source Listing</dt><dd>{safe
    ? <a href={safe} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label="View Original Listing (opens in a new tab)">View Original Listing</a>
    : "Not Disclosed"}</dd></div>;
}

function MoneyFact({ label, field }: { label: string; field: MoneyField }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{formatMoney(field.amount)}</dd>
    </div>
  );
}

function AssetFact({ label, asset }: { label: string; asset: AssetDetail }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>
        {formatMoney(asset.value.amount)}
        <span className={`inclusion ${asset.includedStatus}`}>{asset.includedStatus.replace("_", " ")}</span>
      </dd>
    </div>
  );
}

function RealEstateFact({ realEstate, optional = false }: { realEstate: RealEstateDetail; optional?: boolean }) {
  const descriptors = [realEstate.ownership.value, realEstate.buildingSize.value].filter(Boolean).join(", ");
  return (
    <div className="fact">
      <dt>Real estate</dt>
      <dd>
        {formatMoney(realEstate.value.amount)}
        <span className={`inclusion ${realEstate.includedStatus}`}>{realEstate.includedStatus.replace("_", " ")}</span>
        {optional ? <span className="inclusion optional">optional</span> : null}
        {descriptors ? ` ${descriptors}` : ""}
      </dd>
    </div>
  );
}

function LocationFacts({ location, streetAddress }: { location: TextFact; streetAddress?: TextFact }) {
  return (
    <>
      <Fact label="Market / city-state" fact={location} />
      <div className="fact">
        <dt>Street address</dt>
        <dd>{streetAddress?.value ?? (location.value ? "Not disclosed in listing" : "Not disclosed")}</dd>
      </div>
    </>
  );
}

function Ratio({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryQuestion({ label, value }: { label: string; value: string }) {
  return (
    <article className="summary-question">
      <h3>{label}</h3>
      <p>{publicReportText(value)}</p>
    </article>
  );
}

function StatusBadge({ status, requiresVerification }: { status: "clear" | "watch" | "unknown"; requiresVerification?: boolean }) {
  const label = requiresVerification ? "Requires Verification" : status === "clear" ? "Verified" : status === "watch" ? "Watch" : "Unknown";
  return <span className={`risk-status ${status}`}>{label}</span>;
}

function DecisionBadge({ decision }: { decision: DealScan["decision"]["recommendation"] }) {
  return <span className={`decision-badge ${decision.toLowerCase().replace(" ", "-")}`}>{decision}</span>;
}

function displayListingTitle(scan: DealScan) {
  const candidates = [scan.businessDetails.listingTitle.value, scan.overview.businessName.value];
  const title = candidates.find((candidate) => candidate && isSafeDisplayTitle(candidate));
  return title ?? "Business listing - title needs review";
}

function isSafeDisplayTitle(value: string) {
  const trimmed = value.trim();
  const sentenceCheck = trimmed.replace(/\b(Co|Corp|Inc|LLC|Ltd)\./gi, "$1");
  return (
    trimmed.length > 0 &&
    trimmed.length <= 120 &&
    !/[.!?]\s+/.test(sentenceCheck) &&
    !/\b(business description|detailed information|asking price|cash flow|gross revenue|annual revenue|ebitda|sde|inventory|employees?|building sf|ad\s*#)\b/i.test(trimmed)
  );
}

function correctionValue(scan: DealScan, key: (typeof correctionFields)[number][0]) {
  const values: Record<(typeof correctionFields)[number][0], string> = {
    businessName: scan.overview.businessName.value ?? scan.businessDetails.listingTitle.value ?? "",
    businessWebsite: scan.businessDetails.businessWebsite?.value ?? "",
    streetAddress: resolvedStreetAddress(scan).value ?? "",
    askingPrice: scan.financials.askingPrice.raw ?? formatMoneyForCorrection(scan.financials.askingPrice.amount),
    businessAskingPrice: scan.financials.businessAskingPrice.raw ?? formatMoneyForCorrection(scan.financials.businessAskingPrice.amount),
    annualRevenue: scan.financials.annualRevenue.raw ?? formatMoneyForCorrection(scan.financials.annualRevenue.amount),
    sde: scan.financials.sde.raw ?? formatMoneyForCorrection(scan.financials.sde.amount),
    ebitda: scan.financials.ebitda.raw ?? formatMoneyForCorrection(scan.financials.ebitda.amount),
    advertisedCashFlow: scan.financials.advertisedCashFlow.raw ?? formatMoneyForCorrection(scan.financials.advertisedCashFlow.amount),
    inventory: scan.financials.inventory.value.raw ?? assetCorrectionValue(scan.financials.inventory),
    ffe: scan.financials.ffe.value.raw ?? assetCorrectionValue(scan.financials.ffe),
    realEstate: scan.financials.realEstate.value.raw ?? assetCorrectionValue(scan.financials.realEstate)
  };
  return values[key];
}

function assetCorrectionValue(asset: AssetDetail | RealEstateDetail) {
  const amount = formatMoneyForCorrection(asset.value.amount);
  return amount ? `${amount} ${asset.includedStatus.replace("_", " ")}` : "";
}

function formatMoneyForCorrection(amount: number | null) {
  return amount === null ? "" : formatMoney(amount);
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "Not disclosed";
  }

  return `${(value * 100).toFixed(2)}%`;
}

function isDistinctText(value: string | null, comparison: string | null) {
  if (!value || !comparison) {
    return Boolean(value);
  }

  return value.trim().toLowerCase() !== comparison.trim().toLowerCase();
}

function statusContext(status: "clear" | "watch" | "unknown") {
  if (status === "clear") {
    return "Supported by retained listing evidence";
  }
  if (status === "watch") {
    return "Seller claim or calculated signal to verify";
  }
  return "Missing information";
}

function Feedback({ message, errors }: { message: string | null; errors: string[] }) {
  return (
    <div aria-live="polite">
      {message ? <p className="success-message">{message}</p> : null}
      {errors.length > 0 ? (
        <div className="error-message" role="alert">
          <AlertCircle aria-hidden="true" />
          <div>
            <strong>Scan needs attention</strong>
            <ul>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
