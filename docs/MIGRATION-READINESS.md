# Phase 3C: Migration Readiness

## Subsequent approved preparation

The offset rules were separately approved, deployed and verified. Separate read-only
local and cloud preflights passed. The explicit two-window in-memory handoff is now
prepared; see `MIGRATION-HANDOFF.md` for its current consent gates and synthetic tests.
The original assessment below records the earlier pre-deployment state. It is not
approval to execute a real transfer. No real migration or local cleanup has occurred.

## Scope and current status

Preparation and demo-emulator tests only. No real acquisition, Chrome localStorage,
recovery draft, JSON backup or confidential export was read or copied in this phase.
The four original acquisitions must remain in the original Chrome profile at
http://localhost:5173/. Cloud remains a distinct workspace at http://localhost:5176/cloud.
No migration UI, startup migration, download or automatic cutover is enabled.

`migrateAcquisitions` in `src/cloudMigration.ts` accepts explicitly provided in-memory
record snapshots and, optionally, one explicitly selected recovery draft. It does not
read either browser workspace. It uses the existing validation and repository, not JSON
backup import. No cloud synchronization, local fallback or new infrastructure is added.

## Create-only protocol

1. Snapshot the selected records in memory without modifying their originals. Validate
   every record, identity, schema and cloud size before any writes. Reject normalization
   differences instead of silently hydrating addresses, stripping raw data or repairing
   photographs. Such legacy differences require separate review.
2. Detect duplicate IDs and canonical source URLs within the selection and cloud library.
   An existing identical record may be skipped; a different record stops the whole run
   before writing. Source keys also protect races between preflight and commit.
3. Create each record and its source claim in one transaction that requires absence.
   Never use unconditional upsert, normal Save, or ordinary JSON Import for migration.
   Exact retries return `already-identical` without changing any timestamps/revisions.
4. Read every created/skipped record from the server. Compare the entire canonical JSON
   object, not selected financial fields or just the ID. This includes timestamps, origin,
   historical revision, all evidence, corrections, descriptions, safe media references,
   findings and both cash-flow scenarios. Object-key order is immaterial; values and
   array order must remain identical. Any mismatch stops before the next record.
5. An optional draft is create-only too. Its linked record ID and historical revision
   must match a selected record. Existing different drafts, including cleared revision
   markers, are conflicts, never overwritten. Read back and compare the whole draft.
6. Failures report phase, failed ID and only the IDs already verified. Do not log payloads.
   Cancelled/interrupted runs retain completed cloud copies and all local originals.
   A lost acknowledgement may mean a copy exists: retry the same snapshots to compare
   and skip it. Never create a new ID to bypass a conflict or automatically delete copies.

## Historical revisions: proposed policy, NOT deployed

The deployed policy requires every new envelope to start at revision 1. Ordinary import
also changes import provenance/revision and is not a lossless historical migration path.

The proposed `firestore.migration.rules` retains that create-at-1 rule, exact founder/owner
authorization, timestamps, source claims, payload limits, default deny, and update-at-N+1.
It permits one optional immutable acquisition-envelope integer, `migrationRevisionOffset`.
For an original at revision 9, envelope revision is 1, offset is 8, and the untouched JSON
payload remains at revision 9. A later confirmed update uses envelope 2/payload 10, keeping
the original history rather than resetting it. Nonmigrated records have offset 0.
Offset addition/removal/change during updates, invalid offsets, extra fields, and offsets
on workspace documents are denied. Existing acquisition schema and JSON/CSV/PDF formats
are unchanged. Offset metadata is not proof of seller verification or a full edit log.
All cloud editing sessions must run the updated client before transfer; older cached
clients cannot interpret the revision offset. Close stale sessions before migration.

`npm run prepare:migration-rules` generates a private UID-bound proposed policy and a
hash-only review manifest under ignored `.firebase/`. It validates the prior candidate
and never changes `firebase.json`, the prior reviewed policy, or deployment configuration.
`npm run test:cloud` tests both the prior policy and proposed candidate with fictional
identities, sequentially against loopback demo emulators. It never deploys rules.

Separate founder approval is required to publish this proposed rules-only change. The
current live policy intentionally rejects historical migration envelopes; a regression
test proves that rejection leaves no acquisition or source-key orphan. Do not attempt
real migration until the candidate is separately deployed and verified.

## Draft cleanup finding

New Scan already clears draft contents by saving JSON `null` at the next revision.
The small envelope remains to prevent stale sessions from recreating an old draft at
revision 1 (an ABA/reset hazard). It contains no listing or scenario payload after clear.
No cleanup rule change is warranted. Physical deletion remains denied to clients.
The previous live test required conditional administrative deletion only to meet its
explicit zero-test-documents cleanup instruction; it is not normal application cleanup.
Do not use administrative draft deletion as part of real migration or ordinary reset.

## Founder approval and exact real-run checklist

1. Review this implementation, test results, limits and proposed policy. Approve ONLY a
   separate rules deployment first; confirm the project, UID binding and candidate hash,
   publish rules only, and reverify synthetic access. No migration is implied by that approval.
2. Separately authorize read-only source review in the exact original Chrome profile,
   origin http://localhost:5173. Confirm the four selected names and IDs: Design Center
   Platform; DiCostanzo Welding Services; Well Established, Highly Profitable Printing and
   Packaging Company; Apex HVAC Services. This phase has not inspected their current
   revisions, sizes, schemas or actual contents; those remain mandatory preflight checks.
3. Agree on and test the explicit source-to-cloud in-memory handoff before reading real
   data. The core runner is prepared but no live source-reader/transfer control is activated.
   Do not use DevTools snippets, clipboard/chat payloads, automatic downloads, a different
   Chrome profile, or ordinary backup import as an unreviewed substitute. Any browser
   handoff must bind exact origins and window identity, use a one-time challenge, require
   founder action and use memory only. Do not expose a general local-file/storage API.
4. Review a metadata-only four-record plan, byte sizes, identities, historical revisions,
   duplicate/conflict status and whether the local recovery draft should be included.
   Stop for any legacy-normalization, media, schema, size or conflict issue. Do not edit
   the source to force migration, truncate fields, or add automatic downloads/backups.
5. Obtain explicit approval for the exact four-record transfer and optional draft. Freeze
   edits in both workspaces and keep other cloud editing sessions closed. Run the
   create-only adapter using the approved snapshots; stop on the first failed comparison.
6. Review each verified cloud copy, all financial classifications, included-asset treatment,
   source references, descriptions, photographs and both scenarios. Check existing
   PDF/CSV/JSON content equivalence in memory, then refresh, reopen and test a new
   authenticated browser session. Do not claim image URLs guarantee future remote loads.
7. Founder explicitly approves cutover to cloud. Keep originals and existing backup files
   unchanged. Do not remove local records without another separately scoped approval.

## Rollback and remaining risks

Before cutover: stop cloud edits, leave partial copies alone, and return to the original
http://localhost:5173 Chrome profile. Local originals have not been changed. No destructive
rollback operation is required. If cloud edits occurred after transfer, original local
records are only the baseline; reconcile newer edits with the founder before rollback.
No automated cloud-to-local overwrite or cloud deletion is provided.

Migration is a sequence of per-record transactions, not one all-four-record transaction.
Interruption can leave a verified subset. Safe retries reconcile it. A cleared cloud draft
can deliberately block draft migration until separately reviewed. Firestore remains
memory-cached, session-authenticated, not end-to-end encrypted or an independent backup.
The encrypted acquisition archive remains paused. Runtime/cloud deployment, authentication
changes, billing, indexes, remote API hosting and local-storage cleanup are out of scope.

Status: core and proposed policy are synthetic-testable; live transfer is NOT activated.
Rule approval/deployment, approved source review, and a separately reviewed in-memory
handoff are explicit blockers before any real four-record transfer.
