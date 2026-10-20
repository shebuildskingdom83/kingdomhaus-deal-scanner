# KingdomHaus Deal Scanner

Lightweight acquisition listing screener for KingdomHaus Corporation. It is a preliminary scouting tool, not a valuation authority, due diligence replacement, or acquisition approval system.

## What It Does

- Scan a public HTTPS listing URL or paste a business listing into the intake form.
- If a site blocks server-side access, paste the listing text manually. The app does not bypass website restrictions.
- Send the listing to a server-side AI endpoint using an API key from environment variables.
- Extract listing facts into a structured scan.
- Preserve the complete original listing text and unrecognized details.
- Keep seller claims, calculations, AI inferences, and missing information separate.
- Calculate financial ratios and known excluded asset costs in deterministic application code.
- Separate included assets from additional acquisition costs, without double-counting included FF&E.
- Let the user correct important values and refresh the result.
- Save scans in browser local storage.
- Download a readable PDF summary.
- Leave Notion as a clearly labeled next-phase integration until credentials and the existing pipeline schema are configured.
- Test an optional Puter.js proof of concept from the results screen without replacing the existing OpenAI or rule-based paths.

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from `.env.example`:

   ```bash
   cp .env.example .env
   ```

3. Add your server-side OpenAI key:

   ```bash
   OPENAI_API_KEY=your_key_here
   OPENAI_MODEL=gpt-5-mini
   PORT=8787
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open the Vite URL, usually `http://localhost:5173`.

If `OPENAI_API_KEY` is not set, scans run in rule-based mode. URL extraction, manual entry, financial calculations, saving, and PDF generation still work without an API key.

## Hybrid BizBuySell Retrieval (Apify)

Set `APIFY_API_TOKEN` in the server's `.env` (never a `VITE_` variable), `APIFY_MAX_CHARGE_USD` (default 0.25, valid range above 0 through 10 USD), and `APIFY_RUN_TIMEOUT_SECS` (default 180, range 30–600 seconds). Restart the API after configuration. The Actor may require an Apify plan with US Residential proxy access; verify current account access and pricing before a live test.

Use the existing **Scan from URL** action for a single BizBuySell business-opportunity URL. The application requests confirmation of the spending limit, then starts Actor `jUaA3ZUjFvx5NnFEb` with `fetchDetails: true`, `maxListings: 1`, and `maxPages: 1`. Apify's documented `maxTotalChargeUsd`, `maxItems: 1`, timeout, and `restartOnError: false` run options bound each run. No paid start is retried automatically. Read-only status requests never launch another run. Reported usage may be preliminary; confirm final billing in Apify.

The local API retains the run and dataset IDs, uses bearer authentication server-side, and returns only a local retrieval ID. It fetches the dataset created by that run, validates the listing identity, reconciles structured values with source text, then uses the existing deterministic analysis. Optional Puter remains available on the resulting report. Manual/OpenAI scans retain their existing path. Generic `cashFlow` remains advertised cash flow; SDE requires a source SDE field or explicit SDE label. User corrections take priority. Conflicts remain visible as diligence gaps and in PDF output.

Photographs are referenced from approved BizBuySell/LoopNet image hosts, with attribution and failure fallbacks. They are not downloaded, embedded in PDFs, or republished. Raw dataset rows remain in the live retrieval state, but durable saves/backups omit raw rows and image binaries while preserving approved image URLs and metadata. Normalized evidence, listing text, source metadata and conflicts are preserved. See [SAVE-RECOVERY.md](SAVE-RECOVERY.md).

If retrieval fails, the URL and pasted text stay intact. Paste listing text and use **Scan business**. Editing the URL or text detaches the retrieval session. Request deduplication lasts for the current API process (maximum 100 sessions); before restarting the server or starting another run after an uncertain network failure, check the Apify console for an existing paid run. Closing the browser does not abort a run; its spending and time limits still apply. The API remains bound to loopback; paid requests are accepted only from the existing localhost:5173 / 127.0.0.1:5173 application origins. It is not a remotely authenticated service.

Official references: [Actor input and output](https://apify.com/abotapi/bizbuysell-scraper), [Run Actor](https://docs.apify.com/api/v2/actors-runs-post), [Get run](https://docs.apify.com/api/v2/actor-run-get), [Dataset items](https://docs.apify.com/api/v2/dataset-items-get).

Regression fixtures `tests/apify-painting.json` and `tests/apify-concrete.json` are synthetic provider-shaped examples, not original seller exports. Their generic `cashFlow` values remain advertised cash flow, and SDE stays undisclosed unless explicit SDE evidence or a user correction is supplied. The test suite covers missing values, conflicts, malformed fields and provider failures; every Apify HTTP request in tests is mocked. Arithmetic regression constants do not represent a real acquisition. Minimal public photo-allowlist compatibility references remain only where required by unchanged source-protection rules. See [tests/README.md](tests/README.md). No live paid scan is needed to verify the project.

Files changed for Hybrid Listing Intelligence V1:
- Server: `server/index.ts`, new `server/apify.ts`.
- Reconciliation and requests: new `src/hybridListing.ts`, new `src/urlRetrieval.ts`, `src/types.ts`, `src/validation.ts`, `src/listingExtraction.ts`.
- Existing interface and PDF: `src/App.tsx`, new `src/ListingPhotographs.tsx`, `src/styles.css`, `src/pdf.ts`.
- Configuration and documentation: `.env.example`, `README.md`.
- Regression coverage: new `tests/apify.test.tsx`, `tests/apify-painting.json`, `tests/apify-concrete.json`.

No dependency changes were required. The acquisition cash-flow calculator, financial calculation module, and Puter implementation were not edited. No Sites landing-page files were changed as part of this integration.

## Optional Puter.js Proof Of Concept

The results screen includes an experimental Puter.js button that can produce a structured Deal Clarity Summary from the current scan. It loads `https://js.puter.com/v2/` only after the button is clicked and defaults to `openai/gpt-5-nano`.

This is not a replacement for the current server-side OpenAI integration. Puter may prompt the user to sign in, and usage is subject to the user's Puter account allowance, rate limits, and possible charges. The existing no-AI fallback, deterministic financial calculations, local saving, PDF download, and complete listing details continue to work without Puter.

## Post-Acquisition Cash Flow

Expand **Post-Acquisition Cash Flow** inside Financial Intelligence to enter annual USD assumptions for Current Operations and a separate KingdomHaus Improvements scenario. Source-linked earnings follow applied listing corrections; editing the starting amount creates a user estimate. Unknown costs stay blank, and estimates require explicit inputs (including 0 where appropriate) and review of owner replacement and overlapping expenses.

EBITDA and advertised cash flow require normalization notes. Savings default to proposed, and one-time implementation costs affect only the first-year result. Calculator assumptions do not change listing facts or trigger AI. Save acquisition, recovery drafts and versioned JSON backups retain both scenarios. PDF downloads include complete scenarios and their assumptions; incomplete estimates are omitted.

## Acquisition Saving and Recovery

Use **Save acquisition** and **Saved scans** in the existing intake/report workflow. **Saved scans > Manage Backups** contains **Export Backup** and **Import Backup**. Explicit updates, renames, deletions and duplicate imports require confirmation. An independent recovery draft restores open work after refresh. Records retain corrected financial evidence and both cash-flow scenarios; Puter results remain session-only.

**Export CSV**, beside Download PDF, reports the current acquisition and scenario assumptions. **Saved scans > Export saved scans CSV** reports the saved library. Missing amounts stay blank; spreadsheet formula-like text is literalized. CSV is a confidential summary, not a complete backup, and CSV import is intentionally unsupported. See [SAVE-RECOVERY.md](SAVE-RECOVERY.md).

This is unencrypted browser-local storage, not authenticated cloud storage or synchronization. Keep confidential JSON backups securely; they are the cross-computer recovery path. Capacity errors and incompatible legacy data do not silently erase existing records. See [SAVE-RECOVERY.md](SAVE-RECOVERY.md) for formats, limits, migration, retention and Phase 3B boundaries.

## Scripts

- `npm run dev` starts the Vite client and local API server.
- `npm run test` runs calculation and validation tests.
- `npm run build` type-checks and builds the client.
- `npm run verify` runs tests and build together.

## Environment Variables

- `OPENAI_API_KEY`: Required for AI-assisted scans.
- `OPENAI_MODEL`: Optional. Defaults to `gpt-5-mini`.
- `PORT`: Optional. Defaults to `8787`.

## Security Notes

- API keys stay on the server and are never exposed to browser code.
- The Puter.js POC is browser-side and sends the current listing and scan facts to Puter only after the user clicks the POC button.
- URL scanning uses a server-side HTTPS request with private-network checks, redirect validation, response size limits, and no restriction bypass.
- Pasted listing text is treated as untrusted source material.
- The UI renders extracted text as React text content, not raw HTML.
- Request bodies are size-limited before AI processing.
- `.env` files are ignored by git.

## Dedicated Project And Recovery

Use the dedicated folder `C:\Users\brand\OneDrive\Documents\KingdomHaus Deal Scanner` for future development. The original folder was preserved during separation. See [RESTORE.md](RESTORE.md) for replacement-computer setup, secret handling, verification, and the proposed private GitHub workflow. The dedicated private repository is [shebuildskingdom83/kingdomhaus-deal-scanner](https://github.com/shebuildskingdom83/kingdomhaus-deal-scanner).
