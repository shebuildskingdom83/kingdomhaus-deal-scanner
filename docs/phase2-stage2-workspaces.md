# Phase 2, Stage 2: local private workspace integration

Stage 2 integrates the existing Acquisition Portfolio and Deal Analyzer. It introduces no separate customer dashboard, collections, provisioning service, registration backend, or paid scan mode. Live enrollment and Stage 3 are not included.

## Admission and repository selection

- The original founder retains access without a pilot claim. Other accounts require the exact `kingdomhausPilot: true` claim obtained from the Firebase SDK ID-token result. The backend and Firestore rules remain the authoritative enforcement points; browser UI checks are not a security boundary.
- Both landing authentication actions reuse the existing synchronous Google popup. Existing sessions can enter without opening another popup. Claims checks are asynchronous and discarded if the selected account changes before they complete.
- `/cloud` observes SDK token changes, including identity changes and claim refreshes. A workspace session captures the exact SDK user object and UID. Token refresh for the same admitted SDK user preserves the active workspace; a different SDK session, even for the same UID, receives a fresh workspace instance.
- Cloud repositories use the captured authenticated UID. The existing no-argument repository entry used by migration/review tools remains founder-only. Document paths, IDs, payload schema, and revisions are unchanged.
- An empty user's existing UID path returns an empty portfolio and no draft. No founder records or browser-local recovery data are copied into it. Documents are created only by normal user actions/autosave after editing.

## Cancellation and stale-result boundaries

`WorkspaceSession` provides an in-memory abort signal and an assertion against the originating SDK identity. Workspace components are keyed by UID and session epoch. Auth changes close the old session before waiting for the replacement account's admission check. Confirmed sign-out closes and hides workspace content before awaiting the SDK; a failed sign-out leaves the workspace closed with a retry. A delayed old sign-out cannot clear a subsequently selected account.

- API requests capture their originating workspace before asynchronous SDK loading. They check the session before token retrieval, after token retrieval, immediately before sending, and after receiving. They never retrieve a new account's token for old workspace content. Tokens stay inside the SDK and immediate transport.
- Scanning and retrieval have component/generation abort signals. Poll delays stop on abort; late bodies, progress updates, follow-on scans, and results are ignored after an account/workspace change. No provider operation is automatically retried.
- Autosave cancellation drops queued work immediately. Repository transaction guards run before the transaction, on retries, and after the asynchronous callback before commit. Late completions are rejected. Recovery actions recheck the session after awaits and before changing state or exporting.
- JSON/CSV/PDF exports operate only on the current workspace's state. An obsolete component cannot export its previous account's in-memory records. User-downloaded files remain outside the app after sign-out.
- Puter is disabled for pilots in the existing analyzer UI. Founder analysis checks its workspace before and after script loading, external authentication, and the chat operation; late results are discarded. Firebase sign-out deliberately does not call Puter sign-out or change its billing/session behavior.

Firestore commits already accepted by the server cannot be undone by a browser abort, and the current Puter SDK call has no cancellation interface used here. Guards prevent new work/transaction retries, fixed UID paths and rules preserve ownership, and late results are discarded. An already-started founder provider operation can continue externally; cancellation does not imply cancellation of charges. No cancellation bypass or compensating data writes are added.

## Paid capabilities

Stage 1 server authorization is unchanged: OpenAI extraction and Apify launch, polling, and reconciliation remain founder-only. Pilot retrieval configuration remains disabled. A scan that would select OpenAI returns 403 for a pilot and the existing interface explains that paid access is founder-only while retaining the input. No new scan mode or automatic fallback has been introduced. Customers cannot invoke Puter through their workspace controls.

## Files

Application changes: `src/CloudApp.tsx`, `src/firebaseClient.ts`, `src/firestoreAcquisitionRepository.ts`, `src/landingAuth.ts`, `src/authenticatedApi.ts`, `src/cloudPersistence.ts`, `src/useCloudAcquisitionRecovery.ts`, `src/useAcquisitionRecovery.ts`, `src/App.tsx`, `src/urlRetrieval.ts`, `src/puterPoc.ts`. New session helpers: `src/workspaceSession.ts`, `src/useWorkspaceOperation.ts`.

Existing tests updated: `tests/cloudPresentation.test.tsx`, `tests/cloudRecovery.test.tsx`, `tests/landingAuth.test.ts`, `tests/pilot.emulator.ts`, and the synthetic SDK fixture in `tests/unifiedWebsite.browser.ts`.

New tests: `tests/privateWorkspace.test.tsx`, `tests/workspaceSession.test.ts`, `tests/workspaceRepository.test.ts`, `tests/workspaceCancellation.test.ts`, `tests/firebaseWorkspaceClient.test.ts`, `tests/puterSession.test.ts`.

## Validation and release boundary

All verification uses synthetic identities, records and provider transports. The demo Firestore emulator tests the reviewed Stage 1 candidate, not the deployed policy. Coverage includes founder compatibility, pilot and unapproved admission, empty onboarding, cross-user CRUD, historical revision offsets, forged ownership, account changes during token refresh/transactions/autosave/scanning/polling/analysis, sign-out cleanup, exports, and nonfounder paid-provider denial.

Completed results: all 525 regression tests across 43 files passed; all 11 isolated Firestore emulator tests passed; TypeScript and the production build passed. The existing Firebase bundle-size warning remains. No live founder or pilot data operations were used to establish these results.

Controlled live pilot validation is blocked until separate explicit approval to deploy the reviewed rules candidate and assign a pilot claim to a verified existing test UID. Claim assignment requires a freshly issued ID token before testing. Neither action was performed. Production rules remain founder-only, and no actual pilot workspace access is claimed.

The founder environment, Firebase deployment configuration, Stage 1 rules candidate, server paid-provider enforcement, ADC, IAM, Firebase accounts, and production acquisitions are not changed by Stage 2. Production publication/routing, real pilot enrollment, additional provider permissions, and Stage 3 require separate approval. No additional Stage 2 product decision is needed.
