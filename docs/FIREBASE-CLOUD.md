# Firebase Cloud Persistence Foundation

Phase 3C preparation is documented in [Migration Readiness](MIGRATION-READINESS.md).
The initial founder-only rules and live synthetic cloud workflow were approved and
verified separately. Proposed migration metadata rules remain unpublished. No real
acquisition has been inspected or transferred by the Phase 3C preparation tools.

## Current boundary

The existing `/` local workspace is intentionally unchanged until migration is approved.
The separate `/cloud` workspace uses Firebase only: it never reads or writes acquisition
localStorage and never falls back to local storage. No migration or cleanup runs on startup.
Servers explicitly started in `cloud` or `cloud-emulator` mode use cloud persistence at
every path, so navigating to `/` or a trailing-slash URL cannot mount the local repository.
The landing page, retrieval API, financial logic and report formats are unchanged.

Cloud workspace drafts autosave after 1.2 seconds of inactivity. Named acquisitions still
require Save or confirmed Update, as the founder selected. Drafts include unfinished form
changes, complete retained analysis, and both cash-flow scenarios. A named acquisition's
ID in a draft is recovery metadata only; autosave cannot update that named acquisition.
Renames, replacements, imports over an existing record, deletes, reloads and sign-out
retain confirmation. Explicit exports remain the only download triggers.

## Storage and safety

- Firebase Auth uses Google sign-in and session authentication persistence.
- Firestore uses `memoryLocalCache()` exclusively. No persistent Firestore document cache,
  acquisition localStorage, browser database or automatic download is introduced.
- Saved means the server has acknowledged persistence; failed and offline edits remain
  in memory. Closing the tab can lose those edits. Browser exit warnings are best effort,
  not a durability guarantee. Retry failed saves explicitly; reconnect retries pending drafts.
- Transactions compare expected revisions. Conflicts stop autosave instead of silently
  rebasing over another session. Export explicitly if needed, then confirm Reload cloud
  workspace to load the server version. Concurrent sessions share one workspace draft.
- Acquisitions use their existing IDs under `users/{uid}/acquisitions/{id}`. The current
  workspace is `users/{uid}/workspace/current`. Private hashed source keys prevent duplicate
  marketplace URLs with different imported IDs. Search and pagination remain in memory.
- Record schema v1 and JSON backup v1 remain unchanged inside a validated JSON payload.
  Rules enforce ownership, envelope schema, server timestamps and sequential revisions;
  existing client validators enforce the acquisition schema and evidence/media safeguards.
- Cloud payloads exceeding 900,000 UTF-8 bytes are rejected before writing, leaving margin
  under Firestore's 1 MiB document limit. Nothing is truncated or split. Existing larger
  JSON backups remain valid backups but cannot be stored in this foundation.
- Firebase web configuration and UID are public identifiers, not privileged credentials.
  Rules are the authority. No Admin SDK or service-account credentials are used by the app.
  The shared template deliberately retains an unconfigured UID. The private founder-bound
  policy was separately approved and deployed; proposed migration rules are not deployed.
- Firestore encrypts transport and storage, not end to end. Cloud copies are not independent
  backups. Deleting a named record is permanent after confirmation; export first if needed.
  Optional AI output retains its existing session-only behavior.

## Synthetic local verification

Prerequisites: existing Node dependencies and Java 21 on PATH for Firestore's emulator.
No Firebase login, real project, billing account or service-account key is required.

1. `npm run test:cloud` starts Auth and Firestore on 127.0.0.1:9099/8080 using only
   `demo-kingdomhaus`, runs synthetic rules/repository tests, and stops the emulators.
2. `npm run verify` runs application/UI tests, TypeScript and the production build.
3. For browser verification, run `npm run dev:cloud:emulator` in a separate terminal.
   It serves http://localhost:5176/cloud without the real backend proxy.
4. Run `npm run test:cloud:browser` with Playwright available (or set
   `KH_PLAYWRIGHT_MODULE` to an existing Playwright package). It uses installed Chrome
   headlessly with a fresh isolated profile, never the founder's Chrome data. It seeds
   only synthetic Google accounts and acquisitions. Screenshots remain in ignored
   `.cloud-test-artifacts/`. The emulator test runner substitutes the synthetic founder UID
   in memory; production rule files are not changed by tests.
   Browser authentication uses an emulated Google credential with the real Firebase SDK;
   it does not contact Google's external popup bootstrap or perform a real OAuth login.

The synthetic preview requires running emulators; it is not a live cloud deployment.
No emulator exports are generated. Tests must refuse non-loopback emulator addresses.

## Founder setup required before real Firebase testing

### Local founder-rule preparation (does not publish)

After the founder has saved the Web app settings and exact UID in `.env.cloud.local`,
`npm run prepare:founder-rules` validates formats without printing values and generates:

- `.firebase/firestore.founder.rules`: UID-bound local candidate, excluded from Git.
- `firebase.founder.local.json`: rules-only deployment configuration, excluded from Git.
- `.firebase/founder-rules.review.json`: content/project hashes, with no raw UID or settings.

The shared `firestore.rules` remains a placeholder template. No project is selected,
no login is initiated, no Firebase API is called, and nothing is published by preparation.
Different existing artifacts are never overwritten silently. Production deny-all rules
remain unchanged until a separate rules-deployment approval is explicitly given.

When a prepared candidate exists, emulator tests first check its exact match to the
reviewed template, configured founder UID and recorded hashes. They substitute only a
fictional UID in memory before loading the policy into the demo emulator. The real UID
and Web configuration never enter emulator requests or its diagnostic logs. Direct
malicious writes and cross-owner reads/lists are tested for every protected collection.

The future approval scope should be Firestore rules only, not application hosting,
indexes, migration, or local-storage cleanup. Rules restrict client access; privileged
Google Cloud IAM/Admin access remains a separate administrative trust boundary. The
JSON payload schema is validated by existing application code, not parsed by Rules.

Do not perform these steps or deploy Rules until separately approved.

1. In Firebase Console, create a founder-owned project on Spark. Do not attach billing.
   Analytics is unnecessary for this foundation. Register a Web app; do not enable Hosting.
2. Enable Authentication > Sign-in method > Google and select the support email. Add the
   approved local test hostname under authorized domains if absent. Protect the Google
   account with two-step verification and retain account recovery methods separately.
3. Create Cloud Firestore in Standard edition, select the approved database location,
   and start with locked/production rules, never open test rules. Do not create Storage,
   Functions, service accounts, or paid resources.
4. Copy only the four public Web app configuration values into ignored `.env.cloud.local`,
   using the VITE_FIREBASE names in `.env.example`; initially leave FOUNDER_UID blank.
   Start `npm run dev:cloud`, open http://localhost:5176/cloud and sign in with the founder's
   Google account once. Account setup alone cannot grant acquisition access. Obtain the
   exact UID from Firebase Console > Authentication > Users. Enter that UID in
   VITE_FIREBASE_FOUNDER_UID in the ignored frontend configuration. Run
   `npm run prepare:founder-rules` to generate the private UID-bound candidate without
   putting the UID in the shared template. Run synthetic emulator authorization tests.
5. Obtain separate approval to publish only the reviewed founder rules using the local
   rules-only configuration. Index changes need their own approval. Verify wrong
   and unsigned accounts are denied, using synthetic records only. Run `npm run dev:cloud`
   and open http://localhost:5176/cloud. A normal `npm run build` does not deploy anything.

Do not share passwords, tokens or recovery codes in chat. No credentials are needed for
the emulator tests. A real Google popup, production Rules and real cross-device access
remain unverified until the founder completes setup and approves live synthetic testing.

The existing Node API remains loopback-only and is not made remotely authenticated by
Firebase storage. Any future remote scanning requires a separate secured backend plan.

## Separate migration checklist (core prepared; real transfer not authorized)

See `MIGRATION-READINESS.md` for the create-only implementation, proposed immutable
revision offset, full readback comparison, draft cleanup finding and current blockers.

- Obtain explicit migration approval and identify the original localhost:5173 Chrome profile.
- Review a dedicated create-only migration path for records whose existing revision is
  greater than 1. Normal cloud creation starts at revision 1; the backup-import UI is not
  a lossless migration tool for historical revision metadata. Preserve that history through
  a separately reviewed migration adapter/rule change rather than silently resetting it.
- Read the four existing records and draft without changing them. Validate every record,
  cloud size and stable identity; resolve duplicates/conflicts before any upload.
- Copy records individually using create-only revision checks and stable IDs. Repeat runs
  must compare validated content and skip identical copies, never overwrite silently.
- Compare canonical full-state content after server readback: financial classifications,
  corrections, source evidence/links, photographs, descriptions, both scenarios and exports.
- Verify Saved Scans counts, reopen, refresh, browser restart and a second authorized device.
- Founder reviews each copy and explicitly approves the cutover. Keep originals unchanged.
- Before cleanup, rollback is returning to the unchanged local workspace. After cleanup,
  recovery depends on cloud records or separately retained founder-requested JSON backups.
  If newer cloud edits exist, stop cloud writes and reconcile those edits with founder
  approval before rollback; the original local copy represents only the migration baseline.
- Obtain a second explicit approval before targeted local-storage cleanup. Never clear all
  browser data or delete existing JSON files. Confirm cloud mode creates no persistent
  acquisition cache. The encrypted acquisition archive remains paused.

## Dependency review

The runtime dependency audit reports no production advisories after pinning the patched
gRPC dependency used by Firebase. The full development dependency audit still reports
10 advisories (including existing Vitest/Tinypool findings and Firebase CLI dependencies).
No force-fix, major test-runner upgrade or broad dependency rewrite was performed. These
tooling findings need separate review before production readiness; emulators remain
loopback-only and tests accept trusted synthetic inputs only. The build also reports a
nonfatal size warning for the lazy-loaded Firebase cloud chunk.
