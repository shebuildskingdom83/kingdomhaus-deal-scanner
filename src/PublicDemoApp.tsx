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
  const [signedIn, setSignedIn] = useState(false);
  const createMode = new URLSearchParams(window.location.search).get("mode") === "create";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [listingUrl, setListingUrl] = useState("");
  const [scanMessage, setScanMessage] = useState("");

  if (!signedIn) {
    return <main className="app-shell public-demo-shell public-demo-auth-shell">
      <header className="app-header">
        <div><p className="eyebrow">KINGDOMHAUS INTELLIGENCE</p><h1>Deal Scanner</h1></div>
        <a className="ghost-button public-demo-home-link" href="../">Back to home</a>
      </header>
      <section className="public-demo-auth-card" aria-labelledby="demo-signin-title">
        <p className="eyebrow">ACQUISITION INTELLIGENCE</p>
        <h2 id="demo-signin-title">{createMode ? "Create your workspace" : "Sign in to your workspace"}</h2>
        <p>{createMode ? "Set up a workspace to explore the Deal Scanner." : "Enter any email and password to open the Deal Scanner workspace."}</p>
        <form onSubmit={(event) => { event.preventDefault(); if (email.trim() && password && (!createMode || name.trim())) setSignedIn(true); }}>
          {createMode ? <label><span>Your name</span><input value={name} onChange={event => setName(event.target.value)} placeholder="Your name" autoComplete="name" required /></label> : null}
          <label><span>Email</span><input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required /></label>
          <label><span>Password</span><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder={createMode ? "Create a password" : "Enter a password"} autoComplete={createMode ? "new-password" : "current-password"} required /></label>
          <button className="primary-action" type="submit">{createMode ? "Create Account" : "Open Deal Scanner"}</button>
        </form>
        <p className="public-demo-auth-note">This workspace opens directly to the acquisition portfolio. Account details are used for this session only.</p>
        <a className="public-demo-auth-switch" href={createMode ? "./" : "./?mode=create"}>{createMode ? "Already have access? Sign in" : "New here? Create an account"}</a>
      </section>
    </main>;
  }

  return <main className="app-shell public-demo-shell">
    <header className="app-header">
      <div><p className="eyebrow">KINGDOMHAUS INTELLIGENCE</p><h1>Deal Scanner</h1></div>
      <span className="demo-badge">Acquisition Portfolio</span>
    </header>
    <section className="public-demo-hero">
      <h2>Acquisition Portfolio</h2>
      <p>Review opportunities, compare financial evidence, and keep the next diligence questions in view.</p>
      <form className="public-demo-intake" onSubmit={(event) => { event.preventDefault(); if (listingUrl.trim()) setScanMessage("Listing captured. Review the opportunity below."); }}>
        <label><span>Start with a listing URL</span><input type="url" value={listingUrl} onChange={event => setListingUrl(event.target.value)} placeholder="https://business-for-sale.example/listing" required /></label>
        <button className="primary-action secondary" type="submit">Scan business</button>
        {scanMessage ? <p className="public-demo-scan-message" role="status">{scanMessage}</p> : null}
      </form>
    </section>
    <section className="public-demo-card" aria-labelledby="demo-deal-title">
      <div className="public-demo-card-heading"><div><p className="card-kicker">ACTIVE OPPORTUNITY</p><h2 id="demo-deal-title">Specialty Manufacturing</h2><p>Central North Carolina · KH-2401</p></div><span className="status-pill">Review in progress</span></div>
      <nav className="report-tabs" aria-label="Demo workspace tabs">{["Analysis", "CIM", "Due Diligence"].map(item => <button key={item} type="button" aria-selected={tab === item} onClick={() => setTab(item)}>{item}</button>)}</nav>
      {tab === "Analysis" ? <>
        <div className="financial-kpis public-demo-kpis"><div className="metric"><span>Asking price</span><strong>$1,240,000</strong><p>Business + included real estate</p></div><div className="metric"><span>Gross revenue</span><strong>$340,000</strong><p>Seller-reported</p></div><div className="metric"><span>SDE</span><strong>$90,000</strong><p>Current working figure</p></div></div>
        <div className="public-demo-callout"><strong>Rule-based screening</strong><p>Financial ratios are calculated deterministically from the disclosed figures. Optional AI-assisted interpretation is a separate, user-initiated step.</p></div>
      </> : tab === "CIM" ? <div className="public-demo-review"><div className="public-demo-card-heading"><div><p className="card-kicker">CIM REVIEW</p><h3>Financial comparison</h3></div><span className="status-pill">Synthetic finding set</span></div><div className="demo-table-wrap"><table><thead><tr><th>Metric</th><th>Current</th><th>Seller CIM</th><th>Status</th></tr></thead><tbody>{findings.map(row => <tr key={row.metric}><th scope="row">{row.metric}</th><td>{row.current}</td><td>{row.seller}</td><td><span className={`demo-status ${row.status.toLowerCase()}`}>{row.status}</span></td></tr>)}</tbody></table></div><button className="ghost-button" type="button" onClick={() => setEvidenceOpen(value => !value)} aria-expanded={evidenceOpen}>{evidenceOpen ? "Hide evidence" : "View evidence"}</button>{evidenceOpen ? <div className="public-demo-evidence"><strong>Seller CIM · synthetic-v2 · page 4</strong><p>Reporting period: FY 2024 · USD · accrual basis. “Seller-reported SDE: $95,000.” This evidence is illustrative and is not connected to a saved acquisition.</p></div> : null}</div> : <div className="public-demo-review"><p className="card-kicker">DUE DILIGENCE</p><h3>Questions to investigate next</h3><ul><li>Verify equipment condition, liens, and maintenance history.</li><li>Confirm owner responsibilities and transition coverage.</li><li>Reconcile seller-reported earnings to source documents.</li></ul></div>}
    </section>
    <footer className="public-demo-footer"><p><strong>KingdomHaus Intelligence.</strong> Acquisition screening, evidence review, and diligence in one workspace.</p><a href="../">Return to KingdomHaus Intelligence</a></footer>
  </main>;
}
