# Restore KingdomHaus Deal Scanner

## Project identity

The dedicated local project is `C:\Users\brand\OneDrive\Documents\KingdomHaus Deal Scanner`.
The private GitHub repository is [shebuildskingdom83/kingdomhaus-deal-scanner](https://github.com/shebuildskingdom83/kingdomhaus-deal-scanner).
GitHub access to that repository is required to restore from it.
The original folder remains intact; do future KingdomHaus work in the dedicated folder.
CX Ledger and the separate Sites exploration are separate projects.

## Replacement computer

1. Install Git and Node.js. This copy was verified using Node.js 24.15.0 and npm 11.12.1.
   The current Vite package requires Node.js ^20.19.0 or >=22.12.0.
2. Sign into GitHub with an account authorized for the private repository.
3. Clone the private repository:
   ```powershell
   Set-Location "$env:USERPROFILE\OneDrive\Documents"
   git clone https://github.com/shebuildskingdom83/kingdomhaus-deal-scanner.git "KingdomHaus Deal Scanner"
   Set-Location "KingdomHaus Deal Scanner"
   npm ci
   Copy-Item -LiteralPath .env.example -Destination .env
   ```
   If OneDrive is not configured, choose another local project parent folder instead.
   No application source files require the original directory name.
4. Open `.env` locally and restore `APIFY_API_TOKEN` from your password manager or Apify account.
   Add `OPENAI_API_KEY` only if you want the existing optional OpenAI path.
   Keep `APIFY_MAX_CHARGE_USD=0.25`, `APIFY_RUN_TIMEOUT_SECS=180`, and `PORT=8787`.
   Never put tokens in `VITE_` variables, source files, Git commits, or chat.
5. Run:
   ```powershell
   npm run verify
   npm run dev
   ```
6. Open http://localhost:5173/. The local API listens on http://127.0.0.1:8787/.
   Both ports should be free before startup. The paid-scan origin check expects
   localhost:5173 or 127.0.0.1:5173; do not use Vite's alternate port for paid scanning.
7. Check configuration without starting a run:
   ```powershell
   Invoke-RestMethod http://127.0.0.1:8787/api/retrieval-config
   ```
   This local endpoint reports configuration readiness and the spending limit, never the token.
   A configured token does not establish that Apify accepts it or that the account has Actor/plan access.
   Do not click or confirm a paid scan until a live test has been approved.

## What the repository should preserve

Track `src/`, `server/`, `tests/`, `index.html`, `package.json`,
`package-lock.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`,
`.env.example`, `README.md`, and this guide.
The saved Apify JSON fixtures are listing regression data, not API credentials.
Dependencies and builds are recreated using `npm ci` and `npm run build`.

Before each commit, review the proposed file list and scan it for credentials.
Keep the approved repository private.
Keep the Sites prototype out of this repository. Do not change CX Ledger's remote or files.

## Separate local data and secrets

Git stores source code and fixtures, not the ignored `.env`, browser storage, downloaded
reports, Apify run history, or in-memory retrieval sessions.
Keep API secrets in a password manager. Back up any needed saved scan data and downloaded
reports separately. Browser-local data does not transfer automatically when cloning,
and in-memory retrieval sessions disappear when the API restarts.
Do not assume OneDrive synchronization alone is a versioned source-code backup.

## Day-to-day workflow

Use the dedicated folder and make focused branches/commits. Run `npm run verify`
before committing. Review `git status` and staged changes before each commit, and push
only after reviewing the destination remote and confirming no secrets are staged.
Review any dependency/lockfile change together. Keep this project independent of CX Ledger.
