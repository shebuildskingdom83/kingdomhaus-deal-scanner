# Phase A: founder-only scanner API

Implemented locally. Public registration, live Firebase configuration, Firestore rules, records, portfolio metrics, calculations, reports, session persistence and the homepage design are unchanged. No live credentials are included or generated.

## Required setup before live validation

1. Keep the existing Firebase project. Set server-only `FIREBASE_PROJECT_ID` to that project's ID and `FIREBASE_FOUNDER_UID` to the exact original founder UID, matching the existing frontend authorization. Do not change or substitute the founder identity. These are server settings in the ignored `.env` or process environment; the server does not load `.env.cloud.local`.
2. Supply a reviewed Application Default Credentials (ADC) mechanism with permission for Firebase Authentication user lookup, required for revocation/disabled-user checks. Prefer attached workload identity on a compatible eventual host. Local service-account impersonation/ADC must be approved and verified for the existing project. An ordinary Firebase CLI login is not sufficient evidence of Admin access. No service-account key is created, downloaded or required by this implementation. Do not put credentials in frontend source, `VITE_*` variables, logs or source control.
3. Approve paid usage configuration explicitly. Missing/invalid limits keep paid operations disabled. No local secret file or approved limit is changed automatically.
4. Start the local API with `npm run dev:server` after setup. The existing Vite proxy remains `/api` → `127.0.0.1:8787`; the unified website stays on localhost:5176. Ports 5173 and 5176 are allowed origins for both localhost and 127.0.0.1. Origin is an additional browser boundary, never authentication.

## Configuration

| Server variable | Meaning |
| --- | --- |
| `FIREBASE_PROJECT_ID` | Existing Firebase project; Admin verifies token project/issuer/audience |
| `FIREBASE_FOUNDER_UID` | Exact existing authorized UID; compared only after token verification |
| ADC environment/runtime identity | Server-only credentials for verification with revocation checking |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Existing server provider configuration; absent key preserves deterministic scans |
| `OPENAI_MAX_REQUESTS_PER_PROCESS` | Explicit approved attempt quota, integer 1–10000; no default |
| `OPENAI_MAX_OUTPUT_TOKENS` | Explicit approved output cap, integer 1–32000; no default |
| `APIFY_API_TOKEN` | Existing server-only provider token |
| `APIFY_MAX_CHARGE_USD` | Explicit approved per-run ceiling, above zero through 10 USD; no default |
| `APIFY_MAX_RUNS_PER_PROCESS` | Explicit approved run-attempt quota, integer 1–10000; no default |
| `APIFY_RUN_TIMEOUT_SECS` | Existing actor timeout; default 180, accepted 30–600 |
| `PORT` | Existing loopback API port, default 8787 |

Do not set `FIREBASE_AUTH_EMULATOR_HOST` for this API: live Admin verification deliberately refuses emulator trust. Synthetic tests inject their verifier and never need live credentials.

The numerical ranges above validate configuration; they do not approve a budget. OpenAI count/output limits bound usage, not a guaranteed dollar bill. Founder approval is still needed for attempt quotas, output limits, model choice and the Apify dollar ceiling. Provider account billing limits remain separate. Do not copy example test limits into a live environment.

## Authentication and errors

Only `GET /api/health` (minimal `{ok:true}`) and CORS preflight are public. All other routes require a Firebase ID token and founder authorization. The browser obtains tokens from the existing SDK session for each request; Firebase handles refresh. Tokens are never separately persisted or logged. Requests are never automatically replayed. Auth errors preserve in-memory work and do not sign the user out or clear recovery state.

Admin `verifyIdToken(token, true)` checks signatures, expiration, issuer, audience, revocation and disabled users. Missing/invalid/expired/revoked credentials return 401; valid nonfounders 403; unavailable/misconfigured verification 503. Missing founder configuration fails closed. Verification is bounded to eight seconds. Provider operations occur only after authorization.

JSON bodies are limited to 100000 raw bytes and 15 seconds; malformed JSON returns 400, oversized bodies 413, stalled bodies 408 and incorrect media type 415. Server header/upload/socket deadlines are explicit. Client errors omit credentials, raw provider bodies and internal exception messages.

## Cost and request protections

- API admission: eight active protected requests, 120 requests/minute per process, including failed authentication. Loopback-only binding is retained.
- OpenAI: two concurrent extractions, ten new extractions/minute, explicit process attempt quota/output cap, 60-second abort deadline and 1.5 MB response cap. A UID plus validated-content hash deduplicates identical requests for the process, including failures with uncertain outcomes. Cache is capped at 100 entries; no automatic eviction/retry can cause duplicate spending.
- Apify: two active/uncertain actor jobs, ten launches/minute, explicit process attempt quota and per-run dollar ceiling. Provider HTTP calls have a 15-second deadline and 1.5 MB response cap. Actor timeout and one-listing bounds remain. Owner UID scopes request IDs, same-URL deduplication, status, results and reconciliation. Unknown/foreign jobs return the same 404. Uncertain launches remain reserved; inspect provider runs manually before restarting.
- Public URLs: HTTPS only, no URL credentials/custom ports, all DNS answers must be public, including IPv6 checks. Each connection is pinned to one validated IP with the original hostname retained for Host/TLS certificate verification; no pooled connection or second DNS lookup can change the destination. Every redirect is revalidated. Responses retain content-type/size checks and a 12-second per-hop deadline, including DNS resolution. Special-use address filtering is conservative.

## Limits of this phase

Quotas, idempotency and jobs are process-local. Restarting resets usage counters and loses retrieval status; do not restart to escape a limit or retry an uncertain paid operation. This is not a durable billing ledger and is unsuitable for multiple API instances/public registration. Durable job/idempotency accounting belongs in the separately approved next phase using existing Firestore. No new database or hosting service was added.

Puter remains the existing separate opt-in browser/provider integration, with its own account and allowance; these API quotas do not govern it. No Puter behavior or calculations were changed.

## Verification and live approval boundary

Security tests use fictional identities, injected verifiers, fake provider fetches, mocked HTTPS connections and ephemeral loopback servers. No live acquisitions, recovery drafts, Google popup, Firebase Admin credentials or paid provider calls are used. Live credential validity, deployed rules, actual provider account access/billing and deployment TLS remain unverified. Review those separately before live validation; Phase B and public registration remain unapproved.

The production dependency audit reports zero known vulnerabilities. The complete development dependency audit reports ten advisories (including existing Vitest and Firebase CLI dependency chains); no unrelated force upgrades were applied. Development-tool remediation requires a separate compatibility review before publication.

## Exact Phase A source change manifest

- Server: `server/index.ts`, `server/api.ts` (new; existing routes/extraction moved here), `server/apiSecurity.ts` (new), `server/firebaseAdmin.ts` (new), `server/publicListingTransport.ts` (new), `server/apify.ts`.
- Frontend callers: `src/authenticatedApi.ts` (new), `src/App.tsx`, `src/urlRetrieval.ts`.
- Security tests (new): `tests/apiSecurity.test.ts`, `tests/authenticatedApi.test.ts`, `tests/firebaseAdmin.test.ts`, `tests/publicListingTransport.test.ts`.
- Existing test updates: `tests/apify.test.tsx`, `tests/initialUrlPhotographs.test.tsx`, `tests/listingRetrievalAcceptance.test.tsx` (explicit fictional owners and limits); `tests/acquisitionWorkspace.test.tsx` (await existing focus effect); `tests/unifiedWebsite.browser.ts` (synthetic session token and intercepted API probe).
- Configuration/documentation: `.env.example`, `package.json`, `package-lock.json`, `README.md`, `docs/API-SECURITY.md` (new). Local scanner `dist/` was regenerated for verification; no deployment was made.

Other pre-existing workspace changes were retained. No Phase A changes were made to `src/firebaseClient.ts`, `src/CloudApp.tsx`, `src/AcquisitionWorkspace.tsx`, `src/styles.css`, Firestore rules or landing-page source.
