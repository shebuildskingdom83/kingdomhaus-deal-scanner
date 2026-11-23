import { useState } from "react";

const findings = [
  { metric: "Gross revenue", current: "$340,000", seller: "$340,000", status: "Matching" },
  { metric: "SDE", current: "$90,000", seller: "$95,000", status: "Discrepant" },
  { metric: "EBITDA", current: "$80,000", seller: "$80,000", status: "Matching" },
  { metric: "Advertised cash flow", current: "$100,000", seller: "—", status: "Missing" },
];

export default function PublicDemoApp() {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [tab, setTab] = useState("Analysis");
  return <main className="app-shell public-demo-shell">
    <header className="app-header">
      <div><p className="eyebrow">KINGDOMHAUS INTELLIGENCE</p><h1>Deal Scanner · Public Demo</h1></div>
      <span className="demo-badge">Synthetic data only</span>
    </header>
    <section className="public-demo-hero">
      <p className="eyebrow">INTERVIEW DEMONSTRATION</p>
      <h2>Acquisition Portfolio</h2>
      <p>This read-only demonstration shows the screening, evidence review, and decision safeguards in the KingdomHaus practice build. No account or confidential records are used.</p>
    </section>
    <section className="public-demo-card" aria-labelledby="demo-deal-title">
      <div className="public-demo-card-heading"><div><p className="card-kicker">SYNTHETIC WORKSHOP</p><h2 id="demo-deal-title">Specialty Manufacturing</h2><p>Central North Carolina · KH-DEMO-01</p></div><span className="status-pill">Review in progress</span></div>
      <nav className="report-tabs" aria-label="Demo workspace tabs">{["Analysis", "CIM", "Due Diligence"].map(item => <button key={item} type="button" aria-selected={tab === item} onClick={() => setTab(item)}>{item}</button>)}</nav>
      {tab === "Analysis" ? <>
        <div className="financial-kpis public-demo-kpis"><div className="metric"><span>Asking price</span><strong>$1,240,000</strong><p>Business + included real estate</p></div><div className="metric"><span>Gross revenue</span><strong>$340,000</strong><p>Seller-reported</p></div><div className="metric"><span>SDE</span><strong>$90,000</strong><p>Current working figure</p></div></div>
        <div className="public-demo-callout"><strong>Rule-based screening</strong><p>Financial ratios are calculated deterministically from the disclosed figures. Optional AI-assisted interpretation is a separate, user-initiated step.</p></div>
      </> : tab === "CIM" ? <div className="public-demo-review"><div className="public-demo-card-heading"><div><p className="card-kicker">CIM REVIEW</p><h3>Financial comparison</h3></div><span className="status-pill">Synthetic finding set</span></div><div className="demo-table-wrap"><table><thead><tr><th>Metric</th><th>Current</th><th>Seller CIM</th><th>Status</th></tr></thead><tbody>{findings.map(row => <tr key={row.metric}><th scope="row">{row.metric}</th><td>{row.current}</td><td>{row.seller}</td><td><span className={`demo-status ${row.status.toLowerCase()}`}>{row.status}</span></td></tr>)}</tbody></table></div><button className="ghost-button" type="button" onClick={() => setEvidenceOpen(value => !value)} aria-expanded={evidenceOpen}>{evidenceOpen ? "Hide evidence" : "View evidence"}</button>{evidenceOpen ? <div className="public-demo-evidence"><strong>Seller CIM · synthetic-v2 · page 4</strong><p>Reporting period: FY 2024 · USD · accrual basis. “Seller-reported SDE: $95,000.” This evidence is illustrative and is not connected to a saved acquisition.</p></div> : null}</div> : <div className="public-demo-review"><p className="card-kicker">DUE DILIGENCE</p><h3>Questions to investigate next</h3><ul><li>Verify equipment condition, liens, and maintenance history.</li><li>Confirm owner responsibilities and transition coverage.</li><li>Reconcile seller-reported earnings to source documents.</li></ul></div>}
    </section>
    <footer className="public-demo-footer"><p><strong>Practice build.</strong> This demo is read-only, synthetic, and does not make provider calls or modify acquisition records.</p><a href="/">Return to KingdomHaus Intelligence</a></footer>
  </main>;
}
