import { useId, useState } from "react";
import {
  calculateAcquisitionCashFlow,
  cashFlowDisclaimer,
  currentCashFlowFields,
  formatCashFlowMoney,
  improvementCashFlowFields,
  parseCashFlowInput,
  startingMetricLabels
} from "./acquisitionCashFlow";
import type { CashFlowAssumptions, StartingMetric } from "./acquisitionCashFlow";
import type { FinancialSnapshot, TextFact } from "./types";

export function PostAcquisitionCashFlow({ financials, assumptions, onChange, ownerInvolvement }: {
  financials: FinancialSnapshot;
  assumptions: CashFlowAssumptions;
  onChange: (value: CashFlowAssumptions) => void;
  ownerInvolvement?: TextFact;
}) {
  const id = useId();
  const [view, setView] = useState<"current" | "improvements">("current");
  const result = calculateAcquisitionCashFlow(financials, assumptions);
  const { starting } = result;

  function update<K extends keyof CashFlowAssumptions>(key: K, value: CashFlowAssumptions[K]) {
    onChange({ ...assumptions, [key]: value });
  }

  return (
    <details className="cash-flow-calculator">
      <summary>Post-Acquisition Cash Flow</summary>
      <div className="cash-flow-body">
        <fieldset className="cash-flow-views">
          <legend className="sr-only">Cash flow scenario</legend>
          {([ ["current", "Current Operations"], ["improvements", "KingdomHaus Improvements"] ] as const).map(([value, label]) => (
            <label key={value}>
              <input type="radio" name={`${id}-view`} value={value} checked={view === value} onChange={() => setView(value)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        <div hidden={view !== "current"}>
          <h3>Current Operations</h3>
          <p className="section-note">Annual amounts in USD. Blank means unknown. Enter 0 only when no additional amount is needed.</p>
          <div className="cash-flow-inputs">
            <label htmlFor={`${id}-metric`}>
              <span id={`${id}-metric-label`}>Starting metric</span>
              <select id={`${id}-metric`} aria-labelledby={`${id}-metric-label`} aria-describedby={`${id}-metric-hint`} value={starting.metric} onChange={(event) => {
                onChange({ ...assumptions, startingMetric: event.target.value as StartingMetric, startingAmount: null, normalizationNotes: "", currentReviewed: false });
              }}>
                {(Object.entries(startingMetricLabels) as Array<[StartingMetric, string]>).map(([metric, label]) => (
                  <option key={metric} value={metric}>{label}</option>
                ))}
              </select>
              <small id={`${id}-metric-hint`}>
                {starting.source === "user_estimate" ? "User estimate; source earnings remain unchanged." :
                  starting.source === "user_correction" ? "User-corrected listing amount; follows applied corrections." :
                    starting.amount === null ? "Source amount not disclosed." : "Seller-reported amount; unverified and linked to listing corrections."}
              </small>
            </label>
            <DollarInput id={`${id}-starting`} label="Starting annual cash flow" value={starting.input}
              signed onChange={(value) => update("startingAmount", value)}
              hint={assumptions.startingAmount === null ? "Linked source amount. Editing creates a user estimate." : "Edited estimate. Choose the starting metric again to restore its source amount."} />
          </div>
          <p className="cash-flow-basis" id={`${id}-basis`}>
            {starting.metric === "sde" ?
              "SDE includes owner benefits. Account for necessary owner replacement compensation below." :
              starting.metric === "ebitda" ?
                "EBITDA is not available cash. Record the adjustments needed to bridge earnings to cash before relying on this estimate." :
                "Confirm what this cash flow measure includes, including existing debt service, owner pay, and capital costs."}
          </p>
          {ownerInvolvement?.value ? (
            <p className="section-note">Review the seller-reported owner role in Business Profile. Enter only incremental replacement pay below; no salary or available KingdomHaus staffing is assumed.</p>
          ) : null}
          <div className="cash-flow-inputs">
            {currentCashFlowFields.map((field) => (
              <DollarInput key={field.key} id={`${id}-${field.key}`} label={field.label} hint={field.hint}
                signed={field.signed} value={assumptions[field.key]} onChange={(value) => update(field.key, value)} />
            ))}
            <label htmlFor={`${id}-notes`}>
              <span>Normalization assumptions{starting.metric === "sde" ? " (optional)" : " (required)"}</span>
              <textarea id={`${id}-notes`} rows={3} maxLength={2000} value={assumptions.normalizationNotes}
                required={starting.metric !== "sde"} aria-describedby={`${id}-basis`}
                onChange={(event) => update("normalizationNotes", event.target.value)} />
            </label>
          </div>
          <label className="cash-flow-check">
            <input type="checkbox" checked={assumptions.currentReviewed} onChange={(event) => update("currentReviewed", event.target.checked)} />
            <span>I have accounted for owner replacement and entered only costs or adjustments not already reflected in starting cash flow.</span>
          </label>
          <IncompleteState missing={result.current.missing} />
        </div>

        <div hidden={view !== "improvements"}>
          <h3>KingdomHaus Improvements</h3>
          <p className="section-note">A separate scenario. Proposed savings are hypothetical and may not be achieved.</p>
          <label className="cash-flow-savings-basis" htmlFor={`${id}-savings-basis`}>
            <span id={`${id}-savings-label`}>Savings basis</span>
            <select id={`${id}-savings-basis`} aria-labelledby={`${id}-savings-label`} aria-describedby={`${id}-savings-hint`} value={assumptions.savingsBasis}
              onChange={(event) => update("savingsBasis", event.target.value as CashFlowAssumptions["savingsBasis"])}>
              <option value="proposed">Proposed savings</option>
              <option value="verified">Verified savings (user assessment)</option>
            </select>
            <small id={`${id}-savings-hint`}>{assumptions.savingsBasis === "verified" ? "User-reported verification; the scanner has not verified these savings or future results." : "User assumptions; not achieved savings."}</small>
          </label>
          <div className="cash-flow-inputs">
            {improvementCashFlowFields.map((field) => (
              <DollarInput key={field.key} id={`${id}-${field.key}`} label={field.label} hint={field.hint}
                value={assumptions[field.key]} onChange={(value) => update(field.key, value)} />
            ))}
            <DollarInput id={`${id}-implementation`} label="One-time implementation costs (optional)"
              hint="Transition and setup costs. Deducted only from the first-year result; blank remains unknown."
              value={assumptions.implementationCosts} onChange={(value) => update("implementationCosts", value)} />
          </div>
          <label className="cash-flow-check">
            <input type="checkbox" checked={assumptions.improvementsReviewed} onChange={(event) => update("improvementsReviewed", event.target.checked)} />
            <span>I have accounted for replacement responsibilities and offsetting costs, and excluded savings already reflected in the baseline or another savings input.</span>
          </label>
          <IncompleteState missing={result.improvements.missing} />
        </div>

        <div className="cash-flow-results" aria-live="polite" aria-atomic="true">
          <section aria-label="Current Operations estimates">
            <h3>Current Operations</h3>
            <CashResult label="Estimated annual cash remaining" value={result.current.annual} />
            <CashResult label="Estimated monthly cash remaining" value={result.current.monthly} />
          </section>
          <section aria-label="KingdomHaus Improvements estimates">
            <h3>KingdomHaus Improvements</h3>
            <p className="cash-flow-result-note">{assumptions.savingsBasis === "proposed" ? "Proposed savings scenario" : "Savings verified by user; future results estimated"}</p>
            <CashResult label="Estimated annual cash after improvements" value={result.improvements.annual} />
            <CashResult label="Estimated monthly cash after improvements" value={result.improvements.monthly} />
            <CashResult label="Annual difference from Current Operations" value={result.improvements.difference} />
            <CashResult label="One-time implementation costs" value={result.improvements.implementationCosts} empty="Unknown" />
            <CashResult label="First-year cash after implementation" value={result.improvements.firstYear} />
          </section>
        </div>
        <p className="section-note cash-flow-disclaimer">{cashFlowDisclaimer}</p>
        <p className="section-note cash-flow-disclaimer">Estimates are not guaranteed cash distributions.</p>
      </div>
    </details>
  );
}

function DollarInput({ id, label, hint, value, onChange, signed = false }: {
  id: string; label: string; hint: string; value: string; onChange: (value: string) => void; signed?: boolean;
}) {
  const invalid = value.trim() !== "" && parseCashFlowInput(value, signed) === null;
  return (
    <label htmlFor={id}>
      <span id={`${id}-label`}>{label}</span>
      <input id={id} type="number" inputMode="decimal" step="0.01" min={signed ? -1e12 : 0} max={1e12}
        value={value} placeholder="Not supplied" aria-labelledby={`${id}-label`} aria-invalid={invalid || undefined} aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)} />
      <small id={`${id}-hint`} className={invalid ? "cash-flow-input-error" : undefined}>
        {invalid ? `Enter ${signed ? "an amount" : "0 or a positive amount"} with up to two decimal places, within $1 trillion.` : hint}
      </small>
    </label>
  );
}

function IncompleteState({ missing }: { missing: string[] }) {
  return missing.length > 0 ? <p className="cash-flow-incomplete">Incomplete: {missing.join("; ")}.</p> : null;
}

function CashResult({ label, value, empty = "Incomplete" }: { label: string; value: number | null; empty?: string }) {
  return (
    <div className="cash-flow-result">
      <span>{label}</span>
      <strong className={value !== null && value < 0 ? "cash-flow-negative" : undefined}>{value === null ? empty : formatCashFlowMoney(value)}</strong>
    </div>
  );
}
