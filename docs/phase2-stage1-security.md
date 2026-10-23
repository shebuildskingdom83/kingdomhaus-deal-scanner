# Phase 2, Stage 1: local security foundations

No deployment, account changes, claims assignment, production document access, or provider calls are part of this stage. The current founder-only workspace UI is unchanged.

## Authoritative baseline and candidate

The active `cloud.firestore` release and its referenced ruleset were retrieved read-only from the existing project through the existing authorized Firebase CLI session on 2026-10-22. No acquisition endpoints were queried. The response was captured before preparing the candidate.

The ignored `.firebase/phase2-stage1/` directory contains:

- `deployed.rules`: exact retrieved source, with the existing founder binding.
- `baseline.review.json`: retrieval time, release/ruleset references, project, and baseline SHA-256.
- `pilot.proposed.rules`: project-bound local candidate, not deployed.
- `pilot.review.json`: baseline and candidate hashes.
- `emulator.local.json` and `deny-all.rules`: isolated demo-project configuration with a deny-all startup policy. The test SDK then loads the reviewed synthetic candidate. Neither file changes the real deployment configuration.

`firestore.pilot.rules` is the shareable candidate with the founder replaced by `FOUNDER_UID_NOT_CONFIGURED`. It is intentionally not deployable as the configured founder policy. `firebase.json`, the older `firestore.rules` placeholder, and the existing founder and migration artifacts were not changed.

`scripts/pilotRules.ts` generates only from the captured, hash-reviewed deployed source. It refuses mismatching sources/artifacts and never overwrites a differing candidate. The synthetic emulator uses the actual reviewed candidate after replacing the real founder identity with `synthetic-founder`.

Exact policy differences:

1. Add a boolean `kingdomhausPilot` token-claim predicate. Ownership now requires a matching authenticated path UID and either the original founder or this signed claim.
2. Explicitly require ownership metadata to remain unchanged on acquisition and draft updates.
3. Restrict creation of acquisition migration-offset metadata to the founder. Existing founder creation and historical revision compatibility remain unchanged; offset presence and value remain immutable on updates for everyone.

All other deployed policy conditions remain intact: document schema and size bounds, IDs, server timestamps, sequential revisions, bounded offsets, no draft offsets, draft deletion denial, per-user source-key referential validation/immutability, and catch-all denial. Founder status never grants cross-user document access.

## Admission and paid capabilities

Firebase Admin still verifies signatures, project/audience, expiry, revocation, and disabled-user state with `verifyIdToken(token, true)`. The backend admission decision accepts the original founder or the exact boolean claim `kingdomhausPilot: true` from that verified result. Emails, request bodies, UID parameters, and client-supplied role flags do not confer access. Missing, false, and string-valued claims are denied.

The original founder requires no claim and keeps existing behavior. No real pilot claims have been assigned. A claim is a single admission marker, not a new role-management service or profile collection. Assignment/removal requires separate approval for a verified Firebase UID and a privileged operator; any later claim update must preserve unrelated existing custom claims. There is no claim-granting application endpoint.

`requireFounderPaidAccess` independently protects OpenAI extraction, Apify launches, polling, and reconciliation. Pilots receive disabled paid-retrieval configuration. They can use deterministic scanning when OpenAI is not configured; when the scanner would select OpenAI, it returns 403 for pilots before any provider call. Selecting an explicit nonchargeable scan mode when the founder has OpenAI configured is deferred to Stage 2. Existing monetary limits, process quotas, owner-scoped jobs/cache keys, and no-retry protections are retained.

Puter remains behind the unchanged founder-only workspace UI. Customer enablement is not included. Stage 2 must retain a founder-only Puter capability check when broadening workspace UI admission; Firebase sign-out does not manage Puter's separate account session.

Custom-claim changes reach clients through newly issued Firebase ID tokens. This is not an immediate policy-revocation mechanism for already issued tokens. Standard Firebase sign-out is the approved pilot behavior; no revocation metadata collection or new session system is introduced.

## Verification commands

Existing dependencies and the existing portable Java 21 runtime are sufficient. Never substitute a real project or non-loopback host in emulator tests.

```powershell
npx vitest run tests/apiSecurity.test.ts tests/firebaseAdmin.test.ts tests/authenticatedApi.test.ts tests/pilotRules.test.ts tests/founderRules.test.ts
# Add the existing Java 21 bin directory to this shell's PATH only, then:
npx firebase emulators:exec --only firestore --project demo-kingdomhaus-pilot --config .firebase/phase2-stage1/emulator.local.json "npx vitest run --config vitest.pilot.config.ts"
npm run build
```

The emulator suite requires `FIRESTORE_EMULATOR_HOST=127.0.0.1:8180`, uses only fictional accounts/documents, and tests the captured candidate without ever sending the real founder UID to the emulator. The default test command does not select emulator-only files.

## Stage 2 boundary

Still pending approval: browser admission based on refreshed claims, binding each repository to the authenticated UID, registration routing, clearing account-bound UI state, stopping polling/requests/autosaves and discarding stale results on account switch/sign-out, and keeping Puter disabled for customers. These are not implemented in Stage 1.

Separate explicit approval is required before deploying this candidate or assigning any pilot claims. Public registration, paid customer operations, migration, and real acquisition writes remain out of scope.

## Completed local verification

- 77 focused unit/integration regressions passed, including existing founder sign-in behavior.
- 9 isolated Firestore emulator tests passed against the reviewed candidate, using synthetic accounts and data only. The final run used deny-all startup rules and shut the emulator down afterwards.
- TypeScript and the production build passed; the existing Firebase bundle-size warning remains.
- Checksums confirmed founder environment files, Firebase deployment configuration, existing founder/migration candidates, and unrelated preexisting work were unchanged.
