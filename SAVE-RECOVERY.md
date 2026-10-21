# Acquisition Save and Recovery

## Daily Use

- Use **Save acquisition** from a completed report. **Saved scans** opens the browser-local library.
- Reopen without fetching a listing or calling Apify, OpenAI, or Puter.
- **Update saved scan** replaces a record only after confirmation. Rename and delete also require confirmation. Renaming affects the saved record name, not the seller's listing title.
- A separate recovery draft retains the open intake/report and its unapplied corrections and calculator inputs after refresh or local application restart.
- Form edits are not financial facts until the existing Apply Corrections workflow succeeds. Both the displayed analysis and the pending form are preserved.
- Open **Saved scans**, then **Manage Backups** to access **Export Backup** and **Import Backup**. Both disclosures close with a second click or keyboard activation.
- Choose Current analysis to export pending form edits and both cash-flow scenarios, or choose a saved record to export its last saved version.
- **Import Backup** validates one versioned JSON file and adds it to Saved scans without replacing open work. Open it there to use it. Existing IDs, scan IDs, and matching HTTPS listing URLs are detected; replacement requires confirmation.
- PDF calculations are preserved. Reports now use an executive-first six-section order with a supporting evidence appendix. PDF is a readable report, not an importable acquisition backup.
- **Export CSV**, beside Download PDF, exports the current normalized analysis and both scenario assumptions/results. **Saved scans > Export saved scans CSV** exports a flat saved-library summary. CSV is not a recovery backup and cannot be imported.
- CSV text cells are quoted and potentially executable spreadsheet formulas are prefixed with an apostrophe. Numeric financial values remain numeric, including negative results. Missing amounts remain blank. Keep CSV files confidential just like JSON backups.
- Success notices dismiss after eight seconds; meaningful errors remain until another action resolves them. Manage Backups contains a short storage reminder and a fuller Privacy and recovery disclosure.

## Retained State

The versioned record stores the original listing URL/text, normalized facts and excerpts, correction provenance, verification requirements, rule-based/OpenAI report metadata, Deal Clarity, diligence, and all Current Operations/KingdomHaus Improvements assumptions and review flags.

Raw Apify dataset rows and image binaries are omitted from durable snapshots. Approved listing image URLs, their source URLs, and attribution metadata are retained through saving, correction, recovery drafts, and JSON backups. Reopening may load those externally hosted images; unavailable images show a fallback. Legacy records can recover approved references from retained raw metadata, but images already stripped from all available records cannot be reconstructed without an original source export. Complete listing text remains necessary for source verification and can contain broker/contact information.

Business Website is optional and separate from the marketplace listing URL. Enter it in intake or corrections; a validated public HTTPS destination appears as Visit Website and opens in a separate tab. The value is retained in saved records/JSON and included in CSV/PDF. Older version-1 records without this optional field remain compatible. No website is inferred from a business name, and this field does not retrieve website content.

Approved marketplace photographs are baseline output of the initial supported URL scan, before Save. Available alt text, captions, source URLs, and credit requirements travel with each reference through correction and backup recovery. Seller-website photographs are not retrieved or silently substituted into the marketplace gallery. Any future separately authorized seller-website fallback must have its own explicit source labeling.

The authorized one-time website recovery supports reviewed references in the separate Business Website Project Gallery. Each retains sourceType seller_website, its originating projects page, source caption/alt text, and attribution. Only individually approved assets and source pages are accepted, bound to the authorized listing and website. This is not an automatic website scraper or a replacement for missing marketplace photos. Saved records and JSON retain references, not image binaries; prior schema-version-1 records without this optional group remain supported. Acquisition-specific recovery notes are local-only and excluded from Git.

Optional Puter output remains session-only and is not saved or promoted to verified evidence. Existing OpenAI-derived facts retain their original source classifications. Neither import nor migration upgrades a claim or classifies generic cash flow as SDE.

## Format and Safety

- Repository key: kingdomhaus-deal-scans:v1 (reused, not a parallel storage system).
- Library schema version: 2. Acquisition record and single-record backup schema version: 1.
- Backup format identifier: kingdomhaus-acquisition.
- Up to 100 saved records; a 2 MB backup limit and 4 MB application storage budget apply. Browser quotas may be lower. Nothing is silently evicted.
- Saved scans search matches business names case-insensitively, including partial phrases. Results are sorted by most recent update and shown ten per page. Search and pagination do not change saved records or limit the full-library CSV export.
- Invalid fields, unexpected keys, unsafe prototype keys and unsupported versions are rejected. Imports cannot configure credentials or trigger provider calls. A backup is untrusted user-supplied data, not proof that its claims or review flags are authentic.
- Known earlier scan arrays migrate without recalculating historical values. Fields absent from those formats stay unknown or explicitly unavailable. Earlier cash-flow assumptions cannot be recovered if they were never saved.
- Malformed/unsupported existing storage is not cleared or replaced. **Export stored recovery data** downloads its exact bytes for manual recovery; this is not necessarily a normal importable acquisition backup.
- Storage denial/quota failures retain open work and show a warning. Copy intake text or export a completed acquisition before leaving. Refresh/navigation warnings are best-effort browser safeguards, not crash-proof backups.
- A stale tab cannot knowingly replace another tab's newer library. Export its work, close extra tabs and reload. Browser storage is not transactional multiuser storage; use one editing tab.

## Confidentiality and Recovery Limits

Browser storage is not encrypted by the application, server-backed, authenticated, or synchronized. Anyone with access to the browser profile can access saved work. Use only an authorized personal/work profile and device, not a shared public computer.

Backups are plaintext and may contain confidential seller information, contact details, corrections and internal acquisition assumptions. Keep them in approved encrypted storage, control sharing, and delete unnecessary copies yourself. Do not paste credentials into listing text, notes or backup files.

The application's backup filename patterns are Git-ignored to reduce accidental commits of acquisition data. Renaming a backup can bypass that pattern; still review every staged file.

The same browser profile and exact origin (protocol, hostname and port) are required for automatic recovery. localhost and 127.0.0.1, different ports, and a later hosted domain have separate storage. Clearing browser data, private browsing or losing the computer can remove saved work. Use JSON export/import for cross-computer recovery until separately authorized cloud persistence exists. GitHub stores code, not your acquisitions or backup files.

## Phase 3B Boundary

AcquisitionRepository centralizes persistence and confirmation/revision checks behind a reusable record contract. Future authenticated storage will require user ownership, server validation, durable version/concurrency checks, encryption/backup policy and migration from browser exports. No authentication, hosting, cloud sync or paid provider request is implemented by this phase.

## Verification (October 19, 2026)

- npm run verify: 127 tests across 10 files passed; TypeScript and production build passed.
- Added regressions cover complete save/load, recovery drafts, update/delete revisions and confirmations, malformed/future schemas, quota/access failures, stale-tab writes, capacity, earliest legacy formats, duplicate imports, provenance/retention, generic cash flow, recovered dashboard rendering and the existing PDF generator.
- Acceptance checks ran in the actual localhost:5173 scanner with a disposable synthetic Painting Co. record: manual deterministic scan, save/open/update, corrected SDE refresh recovery, both scenarios, duplicate import confirmation, unsupported-backup rejection, rename cancel/confirm, delete cancel/confirm, delete-then-import recovery, and restored PDF download.
- Current Operations retained $18,392 annually / $1,532.67 monthly; replacement cost sensitivity produced $3,392 annually and negative cash displayed correctly. Improvements retained $20,892 annually, separately from Current Operations.
- Desktop (1440px), tablet (820px), and mobile (390px) layouts were inspected and screenshots captured. Keyboard disclosure activation, dialog Escape dismissal, and focus on Cancel were exercised. This is a targeted accessibility check, not a full assistive-technology audit.
- The approved logo replaces the KH placeholder. Backup controls and their confidentiality notice are secondary utilities inside closed Saved scans / Manage Backups disclosures. The existing schema, financial engine and PDF calculations are unchanged.
- Painting QA retained $18,392 annual / $1,532.67 monthly, $3,392 annual at $40,000 owner replacement, and separate modeled improvements. The downloaded restored PDF contained the same saved inputs and results.
- Two actual earlier browser records were validated via a read-only exported copy; absent historical fields remain unknown, without reinterpreting financial values.
- No financial calculation engine, Apify reconciliation/paid retrieval logic, Puter request/authentication logic, environment file, dependency manifest or Sites source was changed. PDF organization and user-facing provider/fallback wording were refined. No paid provider calls, deployment or Phase 3B work occurred.
- The final quality pass adds source-classification regression coverage and CSV/formula-safety checks. Acquisition-specific verification reports are kept locally, outside the source backup.
- The final corrections pass retains approved photo references and adds seller website and street-address persistence/reporting. External images remain references rather than offline copies.

## Git Backup Fixture Safety

The imported-address recovery fixture is fully synthetic, including its identity, address, financial values and image reference. It exercises the same validation, provenance, corrections and JSON recovery paths without storing a private saved acquisition. The original real backup is preserved outside the repository. Browser data and acquisition exports are not included in Git.
