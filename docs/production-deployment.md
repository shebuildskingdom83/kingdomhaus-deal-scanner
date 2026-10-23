# Production preparation — Stage 4

## Local verification and file inventory

Completed locally on 2026-10-23:
- 543 regression tests across 44 files passed (18 new production-runtime cases).
- 9 packaged-production HTTP/startup tests passed; authentication was synthetic.
- 11 isolated Firestore emulator tests passed, including cross-user denial, immutable
  migration offsets, historical founder revisions, drafts and account cancellation.
- Production frontend/API build and the existing frontend build passed. The latter
  used `--outDir dist/development-check` to retain the separately tested Hosting output.
- Browser read-only QA confirmed the packaged landing controls and signed-out `/cloud`
  screen. No Google popup, account sign-in or acquisition read was attempted. Mobile
  authentication has a manual checklist below; it has not been live-validated.
- All 37 public output files were checked against configured provider secret values
  and private-key markers; none were present. Existing rules baseline/candidate
  hashes remained unchanged. No dependencies were added or updated.
- Docker is unavailable locally: the Dockerfile was inspected, but image build,
  digest validation and vulnerability scan remain unverified before cloud release.
- Both frontend builds retain the existing Firebase chunk-size warning (>500 kB).

Modified existing working files: `package.json`, `server/index.ts`, `server/api.ts`,
`src/websiteNavigation.ts`. Other preexisting edits were retained.

Created: `scripts/buildProduction.ts`, `scripts/previewProduction.ts`,
`server/runtime.ts`, `vite.server.config.ts`, `vitest.production.config.ts`,
`Dockerfile`, `.dockerignore`, `firebase.hosting.json`,
`tests/productionRuntime.test.ts`, `tests/production.package.ts`, this document,
`website/README.md`, and the 28 reviewed public files under `website/landing/`.
Generated build outputs and emulator logs are ignored. No environment file,
`firebase.json`, Firebase account, rules source, IAM or ADC setting was changed.

Status: local preparation only. No cloud deployment, billing changes, IAM changes,
account changes, pilot claims, rules deployment, or acquisition changes are authorized
by this document. The Cloud Run service name `kingdomhaus-api` and region
`us-central1` are proposals; verify region support and proximity to the existing
Firestore database before approval. No custom domain purchase is required.

## Architecture and local commands

Firebase Hosting serves the approved landing at `/` and the authenticated React
workspace at `/cloud` (including nested paths). Its API rewrites precede the
workspace fallback. Browser API requests remain relative `/api/**`, with Firebase ID
tokens verified by Admin including revocation/disabled-user checks. Firestore remains
browser-SDK access to the existing UID paths, with no migration or new data model.

- `npm run build:production`: type check, package frontend to `dist/hosting`, build
  Node API to `build/server/index.js`. Uses existing `.env.cloud.local` public
  Firebase values and shell overrides. The `cloud` build mode forces CloudApp in
  the workspace entry. The landing is a separate generated HTML page.
- `npm run test:production`: build and test production artifacts over loopback HTTP,
  including actual compiled backend startup with synthetic configuration. These
  authenticated tests use injected synthetic verification, not genuine Google tokens.
- `npm test`: existing regression suite plus runtime tests.
- `npm run preview:production`: loopback-only `http://127.0.0.1:4176` QA server,
  forwarding `/api` to the existing local backend at `127.0.0.1:8787`. A missing
  backend returns JSON 502, never HTML. This is not a production hosting process.
- `npm run dev:cloud` / `npm run dev`: existing development behavior is retained.
- `npm run start:server`: compiled API; set `NODE_ENV=production` for hosted settings.

The frontend snapshot is in `website/landing`, with photo credits retained.
Only generated public artifacts belong in Hosting; never upload the repository root.
The API Docker context is allowlisted to package files, source, and server build config.
Runtime uses an unprivileged `node` user and no environment files. Pin/verify the base
image digest and run image vulnerability scanning before a cloud build is approved.

## Configuration and least privilege

Frontend build values (existing mechanism, public identifiers only):
`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
`VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_FOUNDER_UID`. The project must remain
`kingdomhaus-deal-scanner`; independently check founder UID agreement with the
server before release. Do not place Admin credentials or provider secrets in VITE variables.

Runtime values:
- `NODE_ENV=production`; `PORT` is supplied by Cloud Run (default 8080).
- `FIREBASE_PROJECT_ID=kingdomhaus-deal-scanner`.
- `FIREBASE_FOUNDER_UID`: the unchanged original founder UID, supplied privately.
- `APP_ORIGIN`: exact HTTPS Hosting origin, without trailing slash, path, or wildcard.

Production startup does not read `.env`, fails for missing/incorrect project or
missing founder configuration, and forbids auth/Firestore emulator settings.
Production API initialization strips OpenAI/Apify credentials and process quotas
even if accidentally provided. There is no production paid-provider opt-in in this
stage. Existing development founder-only provider behavior is unchanged. Puter
remains founder-only under the existing browser controls; do not invoke it during
hosted validation. Firebase sign-out does not sign out Puter.

Use an attached runtime service account and Cloud Run metadata ADC; never upload
developer ADC, refresh tokens, or a key file. Review whether the existing service
account is appropriately scoped before reusing it. Runtime ID-token revocation
checking requires `firebaseauth.users.get`; it needs no rules deployment permission,
custom-claim update permission, or Firestore document access for this API. A custom
role with the exact required permission can be evaluated; do not grant Firebase
Admin/Editor/Owner as a shortcut. The caller needs permission to attach that specific
runtime account. Keep deployment permissions separate: scoped Cloud Run deployment,
Artifact Registry write/build access, Firebase Hosting release access, service account
act-as, and any build-worker permissions must be reviewed for the selected workflow.
Creating roles, enabling APIs or granting permissions requires explicit approval.

If secrets are needed in a later paid-provider stage, use Secret Manager with
`secretmanager.versions.access` limited to the specific secret; no such provider
secrets are required for this hosted pilot. Never log Authorization headers, token
values, request bodies, or acquisition content.

Firebase authorized domains must include the chosen Hosting hostname (for example
the existing project's default `web.app` hostname after confirming it is available).
Keep the existing Firebase authDomain unless an independently approved auth-domain
change is required. Verify Google OAuth authorized redirect handler for that actual
authDomain (`https://<authDomain>/__/auth/handler`) and homepage CSP. A custom
application domain would also require domain/redirect review; it is optional.
Existing Google popup behavior is unchanged. Validate desktop Chrome, Android Chrome,
and iPhone Safari manually on the real HTTPS origin. Do not add redirect sign-in
unless observed compatibility failures justify a separately reviewed change.

## Approval checkpoint 1 — infrastructure and deployment

Confirm billing account/Blaze status, region, account permissions, and resource names
without changing them. Required APIs for the proposed container workflow:
Cloud Run (`run.googleapis.com`), Artifact Registry (`artifactregistry.googleapis.com`),
and Cloud Build (`cloudbuild.googleapis.com`) if using Cloud Build. Existing Firebase
Hosting, Firebase Authentication/Identity Toolkit, Firestore, and Firebase Rules APIs
must be available for their respective operations. Secret Manager is only needed
if separately approved secrets are added. No VPC connector, load balancer, VM,
organization system, or additional database is proposed.

Blaze/billing is required for Cloud Run integration. Initial request-based service
settings: minimum instances 0, maximum instances 1, modest memory/CPU, no provider
secrets, and a reviewed request timeout below Hosting's 60-second limit. Use budget
alerts and conservative scaling, acknowledging neither is a hard spending cap.
Expect roughly $0–$5/month for a lightly used two-person pilot, not a guarantee.
Builds, images, logging, egress, Firestore and excess traffic can cost extra. Validate
current official pricing before approval. Provider charges remain separate and disabled.

Deploy sequence after explicit approval only:
1. Verify rules baseline/candidate hashes and record existing releases/configuration.
   Verify founder identity/configuration without revealing it. Keep founder-only
   Firestore policy and pilot claims unchanged during initial hosting rollout.
2. Build the minimal container from `Dockerfile`, scan it, and retain its immutable
   image digest. Deploy `kingdomhaus-api` with the reviewed attached runtime identity,
   runtime environment and safe scaling. Retain previous Cloud Run revision/traffic
   state (or record that this is the first release).
3. Use application Firebase-token authentication. Standard Hosting-to-Run integration
   requires an invocation configuration compatible with Firebase tokens; do not
   assume Cloud Run IAM invocation accepts Firebase ID tokens. If allowing transport
   invocation publicly, every protected API route must still enforce current verified
   founder/pilot admission. Test the direct Run URL as well as Hosting. Review that
   invocation policy explicitly; CORS is not an authentication boundary.
4. Verify `/api/health`, missing/invalid-token JSON 401, approved/unapproved identity
   outcomes, no-cache headers, exact origin, and provider-disabled settings.
5. Publish only `dist/hosting` using an explicit command:
   `firebase deploy --only hosting --config firebase.hosting.json --project kingdomhaus-deal-scanner`.
   Never run a bare `firebase deploy`; this separate Hosting-only config has no
   Firestore section and does not select older rules. `pinTag: true` binds the Hosting
   release to the corresponding API revision. First validate a Hosting preview
   channel if approved; preview deployment is still a live cloud change and preview
   origins need separate authorized-domain/origin review.
6. Verify root landing/CTAs, `/cloud`, nested assets, unknown protected API JSON,
   no backend-outage HTML fallback, real founder sign-in, and mobile behavior.

## Approval checkpoint 2 — controlled pilot activation

After hosted founder checks pass, obtain separate authorization for the reviewed
rules candidate `.firebase/phase2-stage1/pilot.proposed.rules` and the single intended
test account's exact boolean `kingdomhausPilot: true` claim. Re-read source hashes
and account metadata immediately before changes; preserve unrelated claims.
Verify founder IDs/revisions read-only against the approved baseline before enrolling
the pilot. No migration or relocation is needed.

Use genuine Firebase sessions for founder/pilot HTTP checks and private workspace
tests. Use synthetic pilot acquisitions/drafts with recorded exact paths and verify
ownership before cleanup; never use real founder records for destructive probes.
Prove sign-out/account switching, stale autosaves/results, exports and paid-provider
denials. No real providers are invoked. Local synthetic results are not live proof.

## Rollback and remaining limits

- Retain previous Firebase Hosting release and Cloud Run immutable image/revision.
  With `pinTag`, Hosting rollback also restores the pinned backend revision; verify
  both after rollback. If first release has no predecessor, remove serving access or
  route to an approved maintenance release; do not invent a previous version.
- Independently restore recorded Cloud Run traffic/configuration if required; retain
  tagged revisions/images until the rollback window closes. Do not delete data.
- Rules rollback is separate from frontend/backend rollback. Restore the verified
  baseline release reference only under approved rollback authorization, and verify
  source hash. Restore only the previous pilot claim value, preserving latest unrelated
  claims. Issued tokens can retain claims until refresh/expiry; no automatic session
  revocation. Never run database cleanup as part of a hosting rollback.
- The API retains process-local retrieval jobs, caches, and usage limits. Restarts
  invalidate them; multiple revisions can overlap even with maximum instances 1.
  These are not durable spending caps. Paid production operation requires a separate
  durability/quota review, not merely enabling keys.
- Hosting imposes a 60-second upstream timeout; extraction currently permits up to
  60 seconds plus overhead, and the existing Node socket timeout is 90 seconds.
  Paid extraction stays disabled; no retry or async redesign is introduced here.
- Public listing fetches retain SSRF protections and may consume egress. Cold starts,
  user-requested cancellation and temporary backend failures require live validation.
- Production container image build/scan, cloud integration, real-device sign-in and
  genuine hosted identity tests remain approval-dependent; local checks cannot prove them.

References: https://firebase.google.com/docs/hosting/cloud-run,
https://cloud.google.com/run/docs/container-contract,
https://cloud.google.com/run/docs/securing/service-identity,
https://cloud.google.com/run/docs/authenticating/end-users,
https://firebase.google.com/docs/auth/web/google-signin,
https://firebase.google.com/docs/hosting/usage-quotas-pricing,
https://cloud.google.com/run/pricing.
