# Read-Only Acquisition Preflight

## Approval boundary

Prepared for review; do not run on founder records without a separate explicit approval.
Synthetic tests use fabricated records and isolated browser contexts only. This page is
not linked from the scanner, does not mount React/App, and is not a migration handoff.

After approval, use the existing original Chrome profile and open
`http://localhost:5173/preflight-inspector.html`. Loading the page does not read storage.
Only the explicit Inspect saved acquisitions button reads the single existing
`kingdomhaus-deal-scans:v1` key. It reads twice to detect concurrent edits and has no
write/remove/clear API. Do not open saved acquisitions or refresh the scanner to inspect.
The original development mode and exact localhost:5173 origin are required; cloud mode,
other origins and production disable the control. The normal production build does not
include this standalone HTML entry. The development server must remain local-only.

## Checks and report

- Validate the version-2 library and version-1 acquisition/draft schemas on detached
  in-memory copies, using the existing record validation and migration checks.
- Compare complete canonical content before/after validation. Hydration, normalization,
  legacy photo recovery, discarded raw data or any other implicit change blocks migration.
- Validate IDs and historical revisions without printing their values. Report duplicate
  IDs and duplicate canonical listing identities using the same identity function as
  the cloud source-key adapter. Missing identities require review.
- Measure UTF-8 JSON bytes against the existing conservative 900,000-byte payload limit,
  below Firestore's full document limit. No truncation, splitting, repairs or calculations.
- Check financial classifications/evidence, corrections, source references, descriptions,
  photographs/provenance, findings and both cash-flow scenario structures. Counts describe
  what is retained, not proof of accuracy or completeness against an original listing.
  Blank/unreviewed assumptions are preserved, not filled in or treated as verified.
- Inspect the draft separately, including linkage to the selected historical revision.
  No raw draft, IDs, URLs, financial amounts, contact details or evidence text is reported.

Results contain only acquisition names, status, byte sizes, counts and fixed blockers.
They are rendered with textContent, never HTML interpolation. No console logs, network
requests, image loads, downloads, cloud imports, acquisition opens, autosaving or browser
permission expansion are used. CSP blocks connections and external content. Close the
page to discard its in-memory report; no report is persisted by the inspector.

## Limits

Compatible means local structural compatibility without data changes, not authorization
to migrate and not independent verification of seller evidence. Photograph URLs are
validated and retained, not loaded or guaranteed to remain available. The inspector cannot
prove recovery of data already missing from storage, or validate assumptions as sufficient
for an investment decision. Concurrent edits after the second read invalidate the snapshot.

Cloud conflicts are explicitly NOT checked. No acquisition data or source identities
are sent to Firebase. A separately approved cloud read-only duplicate/source-claim/draft
check is still required before any real transfer. Do not label this report migration-ready
until those checks and the separately reviewed handoff are complete.
