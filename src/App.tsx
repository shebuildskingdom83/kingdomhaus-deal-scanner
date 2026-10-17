import { useRef, useState } from "react";
import type { ReactNode } from "react";
import AlertCircle from "lucide-react/dist/esm/icons/alert-circle";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import Download from "lucide-react/dist/esm/icons/download";
import LinkIcon from "lucide-react/dist/esm/icons/link";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Search from "lucide-react/dist/esm/icons/search";
import Send from "lucide-react/dist/esm/icons/send";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import { downloadScanPdf } from "./pdf";
import { createCashFlowAssumptions } from "./acquisitionCashFlow";
import type { CashFlowAssumptions } from "./acquisitionCashFlow";
import { PostAcquisitionCashFlow } from "./PostAcquisitionCashFlow";
import { retrieveListing } from "./urlRetrieval";
import { ListingPhotographs } from "./ListingPhotographs";
import { formatMoney, formatRatio, isOptionalRealEstate, safeRatio } from "./financial";
import { PuterResponseFormatError, runPuterDealClarityPoc } from "./puterPoc";
import type { PuterDealClaritySummary } from "./puterPoc";
import type { AssetDetail, DealScan, MoneyField, RealEstateDetail, RiskCheck, ScanResponse, TextFact } from "./types";

export type FormState = {
  businessName: string;
  listingUrl: string;
  listingText: string;
  askingPrice: string;
  businessAskingPrice: string;
  annualRevenue: string;
  sde: string;
  ebitda: string;
  advertisedCashFlow: string;
  inventory: string;
  ffe: string;
  realEstate: string;
};

const initialForm: FormState = {
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
  const [form, setForm] = useState<FormState>(initialForm);
  const [scan, setScan] = useState<DealScan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const retrievalId = useRef<string | undefined>(undefined);
  const retrievalBusy = useRef(false);
  const formRevision = useRef(0);

  async function submitScan(overrides?: Partial<FormState>) {
    const nextForm = { ...form, ...overrides };
    setErrors([]);
    setMessage(null);

    if (nextForm.listingText.trim().length < 30) {
      setErrors(["Paste at least 30 characters from the business listing."]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/scan", {
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
      if (!payload.ok) {
        setErrors(payload.details?.length ? payload.details : [payload.error]);
        return;
      }
      setScan(payload.scan);
      setMessage("Scan complete.");
    } catch {
      setErrors(["Scan failed. Check that the local API server is running and try again."]);
    } finally {
      setIsLoading(false);
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
    try {
      const payload = await retrieveListing(form.listingUrl, { confirm: (notice) => window.confirm(notice), progress: setMessage });
      if (!payload) return;
      if (revision !== formRevision.current) {
        setMessage("Retrieval completed, but your edited listing was kept. Scan your pasted text or review the existing run in Apify.");
        return;
      }
      retrievalId.current = payload.retrievalId;
      const nextForm = {
        ...form,
        businessName: form.businessName || (payload.retrievalId ? "" : payload.title) || "",
        listingUrl: payload.finalUrl,
        listingText: payload.listingText
      };
      setForm(nextForm);
      setMessage(payload.message);
      await submitScan(nextForm);
      setMessage(payload.message);
    } catch (error) {
      setMessage(null);
      setErrors([error instanceof Error ? error.message : "URL scan failed. Paste the listing text and scan again."]);
    } finally {
      retrievalBusy.current = false;
      setIsFetchingUrl(false);
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
        scan={scan}
        form={form}
        message={message}
        errors={errors}
        isLoading={isLoading}
        isFetchingUrl={isFetchingUrl}
        onBack={() => {
          setScan(null);
          setMessage(null);
          setErrors([]);
        }}
        onDownload={(assumptions) => downloadScanPdf(scan, assumptions)}
        onFieldChange={updateForm}
        onRefresh={submitScan}
        onScanFromUrl={scanFromUrl}
      />
    );
  }

  return (
    <main className="app-shell intake-shell">
      <AppHeader activeView="Scan" />

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
  onDownload: (assumptions?: CashFlowAssumptions) => void;
  onFieldChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onRefresh: () => void;
  onScanFromUrl: () => void;
}) {
  const { scan } = props;
  const [cashFlowAssumptions, setCashFlowAssumptions] = useState(createCashFlowAssumptions);
  const optionalRealEstate = isOptionalRealEstate(scan.financials.realEstate);
  const optionalRealEstateAmount = optionalRealEstate ? scan.financials.realEstate.value.amount : null;
  const requiredAdditionalCosts = scan.financials.knownAdditionalAcquisitionCosts.amount;
  const businessPriceAmount = scan.financials.businessAskingPrice.amount ?? scan.financials.askingPrice.amount;
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
    summary: PuterDealClaritySummary | null;
    error: string | null;
  }>({
    isLoading: false,
    summary: null,
    error: null
  });
  const [puterConfirmationOpen, setPuterConfirmationOpen] = useState(false);

  async function runPuterPoc() {
    setPuterConfirmationOpen(false);
    setPuterPoc((current) => ({ ...current, isLoading: true, error: null }));
    try {
      const result = await runPuterDealClarityPoc(scan);
      setPuterPoc({
        isLoading: false,
        summary: result.summary,
        error: null
      });
    } catch (error) {
      setPuterPoc({
        isLoading: false,
        summary: null,
        error:
          error instanceof PuterResponseFormatError
            ? "Puter did not return structured analysis. No deal facts were changed."
            : error instanceof Error
              ? error.message
            : "Puter analysis failed. Try again after checking your Puter sign-in.",
      });
    }
  }

  return (
    <main className="app-shell results-shell">
      <AppHeader activeView="Report" />

      <section className="results-header executive-header" id="report-top">
        <div className="executive-copy">
          <button className="ghost-button" type="button" onClick={props.onBack}>
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
        <Metric label="SDE" value={formatMoney(scan.financials.sde.amount)} detail="Seller discretionary earnings" />
        <Metric label="EBITDA" value={formatMoney(scan.financials.ebitda.amount)} detail="Reported EBITDA" />
        <Metric label={primaryCashFlowRatio.label} value={primaryCashFlowRatio.value} detail="Preliminary multiple" />
      </section>

      <Feedback message={props.message} errors={props.errors} />

      {scan.analysisMode !== "ai" ? (
        <div className="provider-status" role="status">
          <AlertCircle aria-hidden="true" />
          <span>Rule-based scan. AI analysis is opt-in and only runs when requested.</span>
        </div>
      ) : null}

      <div className="report-toolbar">
        <section className="action-row" aria-label="Result actions">
          <button type="button" onClick={() => props.onDownload(cashFlowAssumptions)}>
            <Download aria-hidden="true" />
            Download PDF
          </button>
          <button type="button" disabled aria-disabled="true">
            <Send aria-hidden="true" />
            Send to Notion — Coming soon
          </button>
        </section>
      </div>

      <Panel title="Business Profile">
        {scan.retrieval ? <ListingPhotographs photographs={scan.retrieval.photographs} /> : null}
        <dl className="detail-grid profile-grid">
          {isDistinctText(scan.businessDetails.listingTitle.value, scan.overview.businessName.value) ? (
            <Fact label="Listing title" fact={scan.businessDetails.listingTitle} />
          ) : null}
          <LocationFacts location={scan.overview.location} />
          <Fact label="Industry" fact={scan.overview.industry} />
          <Fact label="Services" fact={scan.overview.services} wide />
          <Fact label="Business model" fact={scan.overview.revenueModel} />
          {scan.overview.customerSegments ? <Fact label="Customer segments" fact={scan.overview.customerSegments} /> : null}
          <Fact label="Year established" fact={scan.overview.yearEstablished} />
          <Fact label="Years operating" fact={scan.overview.yearsOperating} />
          <Fact label="Employee count" fact={scan.overview.employeeCount} />
          <Fact label="Reason for sale" fact={scan.overview.reasonForSale} />
          <Fact label="Owner involvement" fact={scan.overview.ownerInvolvement} wide />
          <Fact label="Seller transition and training" fact={scan.businessDetails.sellerSupportTraining} wide />
          <Fact label="Business description" fact={scan.businessDetails.fullDescription} wide preserveLineBreaks />
          <Fact label="Facilities" fact={scan.businessDetails.facilities} wide />
          <Fact label="Growth opportunities" fact={scan.businessDetails.growthOpportunities} wide />
        </dl>
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
                  <p>{detail.value}</p>
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
          <MoneyFact label="SDE" field={scan.financials.sde} />
          <MoneyFact label="EBITDA" field={scan.financials.ebitda} />
          <MoneyFact
            label={`Advertised cash flow${scan.financials.advertisedCashFlow.sellerTerminology ? `: ${scan.financials.advertisedCashFlow.sellerTerminology}` : ""}`}
            field={scan.financials.advertisedCashFlow}
          />
          <Fact label="Included assets" fact={scan.overview.includedAssets} wide />
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
          <Metric label="Business price only" value={formatMoney(businessPriceAmount)} detail="Business component before included real estate" />
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
          <span>{scan.analysisMode === "ai" ? "OpenAI-assisted assessment" : "Rule-based assessment"}</span>
          {puterPoc.summary ? <span>Puter-assisted assessment available below</span> : null}
        </div>
        <div className="clarity-lede">
          <h3>Executive readout</h3>
          <p>{scan.decision.explanation}</p>
        </div>
        <div className="summary-grid">
          <SummaryQuestion label="Strategic fit" value={scan.claritySummary.strategicFit} />
          <SummaryQuestion label="Attractive characteristics" value={scan.claritySummary.attractiveCharacteristics} />
          <SummaryQuestion label="Seller dependence" value={scan.claritySummary.sellerDependence} />
          <SummaryQuestion label="Equipment continuity" value={scan.claritySummary.equipmentContinuity} />
          <SummaryQuestion label="Financial questions" value={scan.claritySummary.financialQuestions} />
          <SummaryQuestion label="Major risks" value={scan.claritySummary.majorRisks} />
        </div>
        <section className="intelligence-panel" aria-label="Puter-assisted analysis">
          <div aria-hidden="true" />
          <button className="primary-action intelligence-action" type="button" onClick={() => setPuterConfirmationOpen(true)} disabled={puterPoc.isLoading} aria-busy={puterPoc.isLoading}>
            {puterPoc.isLoading ? <RefreshCw aria-hidden="true" className="spin" /> : <Sparkles aria-hidden="true" />}
            {puterPoc.isLoading ? "Analyzing deal" : "KingdomHaus Intelligence™ — Analyze Deal"}
          </button>
        </section>
        {puterConfirmationOpen ? (
          <div className="ai-confirmation" aria-live="polite">
            <p>Puter may require sign-in. Usage can count against your Puter allowance or incur charges under your Puter account.</p>
            <div className="confirmation-actions">
              <button type="button" onClick={runPuterPoc}>Continue with Puter</button>
              <button type="button" onClick={() => setPuterConfirmationOpen(false)}>Cancel</button>
            </div>
          </div>
        ) : null}
        <div aria-live="polite" className="puter-poc-result">
          {puterPoc.error ? (
            <div className="error-message" role="alert">
              <AlertCircle aria-hidden="true" />
              <div>
                <strong>Puter analysis did not complete</strong>
                <p>{puterPoc.error}</p>
              </div>
            </div>
          ) : null}
          {puterPoc.summary ? (
            <div className="puter-summary">
              <div className="analysis-source">
                <span>Puter-assisted assessment</span>
              </div>
              <div className="summary-grid">
                <SummaryQuestion label="Strategic fit" value={puterPoc.summary.strategicFit} />
                <SummaryQuestion label="Attractive characteristics" value={puterPoc.summary.attractiveCharacteristics} />
                <SummaryQuestion label="Seller dependence" value={puterPoc.summary.sellerDependence} />
                <SummaryQuestion label="Equipment continuity" value={puterPoc.summary.equipmentContinuity} />
                <SummaryQuestion label="Financial questions" value={puterPoc.summary.financialQuestions} />
                <SummaryQuestion label="Major risks" value={puterPoc.summary.majorRisks} />
              </div>
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel title="Due Diligence">
        <div className="risk-list">
          {buildDiligenceRows(scan).map((item) => (
            <article className="risk-row" key={item.label}>
              <div>
                <h3>{item.label}</h3>
                <span className="risk-kind">{item.requiresVerification ? "Franchise terms to verify" : statusContext(item.status)}</span>
                <p>{item.explanation}</p>
                {item.verificationItems ? <ul className="simple-list">{item.verificationItems.map((point) => <li key={point}>{point}</li>)}</ul> : null}
              </div>
              <StatusBadge status={item.status} requiresVerification={item.requiresVerification} />
            </article>
          ))}
        </div>
      </Panel>

    </main>
  );
}

function buildCorrections(form: FormState) {
  return Object.fromEntries(
    correctionFields
      .map(([key]) => [key, form[key]])
      .filter(([, value]) => value.trim().length > 0)
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

function AppHeader(_: { activeView: "Scan" | "Report" }) {
  return (
    <header className="app-header" aria-label="Application header">
      <div className="brand-lockup">
        <div className="topbar-mark" aria-hidden="true">
          KH
        </div>
        <div>
          <p className="eyebrow">KingdomHaus Corporation</p>
          <h1>Deal Scanner</h1>
        </div>
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
            <input value={props.form[key] || correctionValue(props.scan, key)} onChange={(event) => props.onFieldChange(key, event.target.value)} />
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
      <dd style={preserveLineBreaks ? { whiteSpace: "pre-line" } : undefined}>{fact.value ?? "Not Disclosed"}</dd>
    </div>
  );
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

function LocationFacts({ location }: { location: TextFact }) {
  return (
    <>
      <Fact label="Market / city-state" fact={location} />
      <div className="fact">
        <dt>Street address</dt>
        <dd>{location.value ? "Not disclosed in listing" : "Not disclosed"}</dd>
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
      <p>{value}</p>
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
