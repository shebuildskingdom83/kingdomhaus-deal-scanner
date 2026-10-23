# KingdomHaus Intelligence source of truth

The authoritative application source is
`C:\Users\brand\OneDrive\Documents\KingdomHaus Deal Scanner`.
Assess current code, design, features and development status from this repository.
The October 18 ChatGPT Site “KingdomHaus Intelligence — UI Exploration” is a
historical design preview and does not show the current application.

The current landing source is `website/landing/`, integrated locally by
`scripts/unifiedWebsite.ts`. The authenticated application starts in `src/main.tsx`:
`/cloud` renders `src/CloudApp.tsx`, which admits the original founder or users
with the exact Firebase claim `kingdomhausPilot: true`. The Acquisition Portfolio
and analyzer are in `src/AcquisitionWorkspace.tsx` and `src/App.tsx`. They use
the current Firebase UID through `src/firebaseClient.ts` and the existing
UID-owned Firestore collections. The local Node API starts in `server/index.ts`;
Vite proxies `/api` to it through `vite.config.ts`.

For the current connected website, run `npm run dev:server` and
`npm run dev:cloud` in separate terminals, then open:

- Landing: http://localhost:5176/
- Acquisition workspace: http://localhost:5176/cloud

`npm run dev` uses Vite's default 5173 port and starts both processes.
`npm run build:production` packages the same repository landing and workspace
for proposed Firebase Hosting, with the protected Node API prepared for
Cloud Run. These are the proposed production hosts; no deployment is implied.

To verify a preview's source, confirm the server process runs from this
repository, inspect the repository's `scripts/unifiedWebsite.ts` and
`website/landing/` files, and verify `/cloud` serves the Vite React entry
while `/api/health` returns JSON from the local Node API. Do not use the
historical ChatGPT Sites URL or screenshots to infer repository features.
Sign-in and account data checks require an authorized Firebase session; a
signed-out `/cloud` page shows only the authentication gate.
