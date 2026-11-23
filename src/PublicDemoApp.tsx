import { useState } from "react";
import type { ReactNode } from "react";
import { ResultsScreen, initialForm, type FormState } from "./App";
import { buildLocalPreviewScan } from "./validation";
import { createCashFlowAssumptions } from "./acquisitionCashFlow";
import type { FounderDecision } from "./founderDecision";
import { downloadScanPdf } from "./pdf";
import { WorkspaceSession } from "./workspaceSession";
import Download from "lucide-react/dist/esm/icons/download";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";

const findings = [
  { metric: "Gross revenue", current: "$340,000", seller: "$340,000", status: "Matching" },
  { metric: "SDE", current: "$90,000", seller: "$95,000", status: "Discrepant" },
  { metric: "EBITDA", current: "$80,000", seller: "$80,000", status: "Matching" },
  { metric: "Advertised cash flow", current: "$100,000", seller: "—", status: "Missing" },
];
const opportunities = [
  ["Dicostanzo Welding Services", "Metal Products > Heavy Construction · Anderson, SC", "$749,000", "10/23/2026"],
  ["Design Center Platform", "Building Material and Hardware Stores > Other · Charleston County, SC", "$4,500,000", "10/21/2026"],
  ["Well Established, Highly Profitable Printing and Packaging Company", "Printing and packaging · Torrance, CA", "$3,500,000", "10/19/2026"],
  ["Apex HVAC Services", "", "$850,000", "10/19/2026"],
] as const;
type Screen = "portfolio" | "intake" | "analysis";

export default function PublicDemoApp() {
  const params = new URLSearchParams(window.location.search);
  const guestMode = params.get("guest") === "1";
  const createMode = params.get("mode") === "create";
  const [signedIn, setSignedIn] = useState(guestMode);
  const [screen, setScreen] = useState<Screen>("portfolio");
  const [tab, setTab] = useState("Analysis");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [listingUrl, setListingUrl] = useState("https://www.bizbuysell.com/Business-Opportunity/specialty-manufacturing-company/kh-2401/");
  const [scanMessage, setScanMessage] = useState("");
  const [search, setSearch] = useState("");

  if (!signedIn) return <main className="app-shell public-demo-shell public-demo-auth-shell"><PublicHeader compact /><section className="public-demo-auth-card" aria-labelledby="demo-signin-title"><p className="eyebrow">ACQUISITION INTELLIGENCE</p><h2 id="demo-signin-title">{createMode ? "Create your workspace" : "Sign in to your workspace"}</h2><p>{createMode ? "Set up a workspace to explore the Deal Scanner." : "Enter any email and password to open the Deal Scanner workspace."}</p><form onSubmit={event => { event.preventDefault(); if (email.trim() && password && (!createMode || name.trim())) setSignedIn(true); }}>{createMode ? <label><span>Your name</span><input value={name} onChange={event => setName(event.target.value)} placeholder="Your name" autoComplete="name" required /></label> : null}<label><span>Email</span><input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required /></label><label><span>Password</span><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder={createMode ? "Create a password" : "Enter a password"} autoComplete={createMode ? "new-password" : "current-password"} required /></label><button className="primary-action" type="submit">{createMode ? "Create Account" : "Open Deal Scanner"}</button></form><p className="public-demo-auth-note">This workspace opens directly to the acquisition portfolio. Account details are used for this session only.</p><a className="public-demo-auth-switch" href="./?guest=1">Continue without signing in</a><br /><a className="public-demo-auth-switch" href={createMode ? "./" : "./?mode=create"}>{createMode ? "Already have access? Sign in" : "New here? Create an account"}</a></section></main>;
  if (screen === "intake") return <main className="app-shell public-demo-shell public-demo-workspace-shell"><PublicHeader onReturn={() => setScreen("portfolio")} /><IntakeView listingUrl={listingUrl} setListingUrl={setListingUrl} onScan={() => { setScanMessage("Scan complete. Open the opportunity to review the findings."); setScreen("portfolio"); }} scanMessage={scanMessage} /></main>;
  if (screen === "analysis") return <main className="app-shell public-demo-shell public-demo-workspace-shell"><DemoResultsView onReturn={() => setScreen("portfolio")} /></main>;
  return <main className="app-shell public-demo-shell public-demo-workspace-shell"><PublicHeader /><section className="portfolio-heading"><div><p className="eyebrow">OVERVIEW</p><h2>Acquisition Portfolio</h2><p>Evaluate opportunities. Manage your pipeline. Make informed acquisition decisions.</p></div><button className="primary-action secondary" type="button" onClick={() => setScreen("intake")}>＋&nbsp; Analyze an Opportunity</button></section><section className="portfolio-stats" aria-label="Portfolio summary"><div><span>▣ &nbsp; Opportunities</span><strong>4</strong><small>Unique saved opportunities</small></div><div><span>Portfolio Asking Value</span><strong>$9,599,000</strong><small>4 of 4 opportunities with disclosed asking prices</small></div><div><span>KingdomHaus Deal Analyzer</span><strong>0</strong><small>Unique saved opportunities with a completed KHDA analysis</small></div></section><p className="portfolio-note">Saved asking prices may include your corrections. These figures are unverified asking values, not a portfolio valuation.</p><section className="opportunity-list" aria-labelledby="opportunity-title"><div className="section-heading"><h3 id="opportunity-title">Your Opportunities</h3><span>−</span></div><div className="portfolio-tools"><input aria-label="Search opportunities" value={search} onChange={event => setSearch(event.target.value)} placeholder="⌕  Search opportunities..." /><button type="button" className="ghost-button"><Download aria-hidden="true" /> Export Portfolio <small>CSV</small></button></div>{opportunities.filter(([title, detail]) => `${title} ${detail}`.toLowerCase().includes(search.toLowerCase())).map(([title, detail, price, date]) => <article className="opportunity-row" key={title}><div><h4>{title}</h4>{detail ? <p>{detail}</p> : null}<small>Updated {date} · Imported backup</small></div><div className="opportunity-price"><span>Asking price</span><strong>{price}</strong><small>Saved figure · unverified</small></div><button className="ghost-button" type="button" onClick={() => setScreen("analysis")}>View Analysis&nbsp; ↗</button><button className="icon-action" type="button" aria-label={`Edit ${title}`} title="Edit opportunity"><Pencil aria-hidden="true" /></button><button className="icon-action" type="button" aria-label={`Delete ${title}`} title="Delete opportunity"><Trash2 aria-hidden="true" /></button></article>)}</section><details className="portfolio-backups"><summary>＋ &nbsp;Portfolio utilities &amp; backups</summary><h3>Acquisition to export</h3><select aria-label="Acquisition to export"><option>Current analysis</option></select><div><button className="ghost-button" type="button" disabled>⇩ &nbsp; Export Backup</button><button className="ghost-button" type="button">⇧ &nbsp; Import Backup</button></div><details><summary>Privacy and recovery</summary><p>Cloud records and drafts require a confirmed server save. Keep exported backups secure.</p></details></details></main>;
}

function PublicHeader({ compact = false, onReturn }: { compact?: boolean; onReturn?: () => void }) { return <header className="workspace-header"><a href={compact ? "../" : "#"}><img src="/kingdomhaus-deal-scanner/assets/brand/kingdomhaus-logo-240.webp" alt="KingdomHaus" /></a><nav><a href="../">Home</a><a href="../#help">Help &amp; Guide</a>{onReturn ? <button type="button" onClick={onReturn}>← &nbsp; Return to Workspace</button> : null}<button type="button" onClick={() => window.location.assign("../")}>⇥ &nbsp; Sign out</button></nav></header>; }
function IntakeView({ listingUrl, setListingUrl, onScan, scanMessage }: { listingUrl: string; setListingUrl: (value: string) => void; onScan: () => void; scanMessage: string }) { return <section className="intake-layout public-intake-layout"><div className="intro-panel"><p className="eyebrow">ACQUISITION INTELLIGENCE</p><h2>Screen business listings with discipline.</h2><p>Capture the listing, preserve the evidence, and focus on the diligence questions that matter before deeper review.</p><div className="notice">Preliminary screen only. The scanner supports diligence; it does not approve acquisitions.</div></div><form className="intake-form public-intake-form" onSubmit={event => { event.preventDefault(); onScan(); }}><div className="form-section"><h2>Listing Intake</h2><p>Start with a public listing URL or paste the full listing text when access is blocked.</p></div><div className="scan-card"><label><span>Business name</span><input placeholder="Optional" /></label><label><span>Business Website (optional)</span><input placeholder="https://business.example.com/" /></label></div><div className="scan-card"><label><span>Listing URL</span><input type="url" value={listingUrl} onChange={event => setListingUrl(event.target.value)} /></label><button className="primary-action secondary" type="button" onClick={onScan}>⌁ &nbsp; Scan from URL</button></div><div className="scan-card primary-scan-card"><textarea aria-label="Listing text" placeholder="Paste complete business listing here..." rows={12} /></div><button className="primary-action" type="submit">⌕ &nbsp; Scan business</button>{scanMessage ? <p className="public-demo-scan-message" role="status">{scanMessage}</p> : null}</form></section>; }
const demoListingText = `Dicostanzo Welding Services
Asking Price: $749000
Gross Revenue: $300000
Cash Flow: $220000
Location: Anderson, SC
Industry: Metal Products > Heavy Construction
Employees: 1 Full-time
Facilities: Synthetic commercial shop with real estate included in the sale. Sale includes approximately $80,000 in welding and fabrication equipment and tools.
Competition: Fictional local competitors.
Growth & Expansion: Fictional additional staffing and installation projects.
Reason for Selling: Relocation
Broker Name: Jordan Fixture
Inventory: $5000
FF&E: $80000
Real Estate: $450000
Business Description
This fictional welding workshop is operated by one owner. The owner is also a Certified Welding Inspector (CWI). These invented credentials are synthetic diligence-test claims and do not describe a real person.
Ad#: 9900105`;

function DemoRecoveryControls() {
  return <section className="acquisition-recovery" aria-label="Demo acquisition saving and recovery"><div className="recovery-actions portfolio-save-state"><button type="button" className="primary-action" onClick={() => {}}><span aria-hidden="true">▣</span> Save Changes</button><span className="recovery-state" role="status">Saved</span></div><details className="saved-acquisitions"><summary>▣ &nbsp; Saved scans <span>(4)</span><span aria-hidden="true">＋</span></summary><p className="section-note">Saved scans are disabled in this public demonstration.</p></details></section>;
}

function DemoResultsView({ onReturn }: { onReturn: () => void }) {
  const [form, setForm] = useState<FormState>(() => ({ ...initialForm, businessName: "Dicostanzo Welding Services", listingUrl: "https://www.bizbuysell.com/business-opportunity/synthetic-fabrication-fixture/9900105/", listingText: demoListingText, askingPrice: "749000", annualRevenue: "300000", advertisedCashFlow: "220000", inventory: "5000", ffe: "80000", realEstate: "450000" }));
  const [scan, setScan] = useState(() => buildLocalPreviewScan({ businessName: form.businessName, listingUrl: form.listingUrl, listingText: form.listingText }));
  const [founderDecision, setFounderDecision] = useState<FounderDecision>({ decision: "Pass", rationale: "", nextDiligenceAction: "" });
  const [session] = useState(() => new WorkspaceSession("public-demo", false, () => true));
  const refresh = () => setScan(buildLocalPreviewScan({ businessName: form.businessName, listingUrl: form.listingUrl, listingText: form.listingText, corrections: form }));
  const onFieldChange = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(current => ({ ...current, [key]: value }));
  const headerActions: ReactNode = <><button type="button" className="ghost-button cloud-header-action" onClick={onReturn}>← &nbsp; Return to Workspace</button><button type="button" className="ghost-button cloud-header-action" onClick={() => window.location.assign("./")}>⇥ &nbsp; Sign out</button></>;
  return <ResultsScreen scan={scan} form={form} message={null} errors={[]} isLoading={false} isFetchingUrl={false} onBack={onReturn} onDownload={(assumptions, decision) => downloadScanPdf(scan, assumptions, decision)} onFieldChange={onFieldChange} onRefresh={refresh} onScanFromUrl={() => {}} cashFlowAssumptions={createCashFlowAssumptions()} onCashFlowChange={() => {}} founderDecision={founderDecision} onFounderDecisionChange={setFounderDecision} recoveryControls={<DemoRecoveryControls />} headerActions={headerActions} session={session} />;
}
