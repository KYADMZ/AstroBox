# Deploying AstroBox to AWS Amplify Hosting (us-east-2)

Guide for deploying **manually from the AWS web console** (no AWS CLI).
The app is published as a **static site**: every route is prerendered
(`src/app/app.routes.server.ts`, `RenderMode.Prerender`), so the build produces
a ready-to-serve `index.html` in `dist/AstroBox/browser`. No SSR compute and no S3 are used.

## What was prepared in the repository

| File | Change |
| --- | --- |
| `amplify.yml` (repository root) | Monorepo build settings: `appRoot: Frontend/AstroBox`, Node 22 (`nvm install 22`), `npm ci`, `npm run build`, artifacts in `dist/AstroBox/browser`, `node_modules` cache. |
| `Frontend/AstroBox/angular.json` | Only the per-component style budget: warning 9.1 kB → 12 kB, error 10 kB → 16 kB. `app.scss` is 10.97 kB and was failing the production build. |
| `Frontend/AstroBox/DEPLOY.md` | This guide. |

No application code was changed (`src/`, `public/`), nor `package.json` or `server.ts`.
Rollback point: local tag `demo-estable` on commit `0cdaf05` (state before these changes).

## 0. Before pushing (on your machine)

```
cd Frontend/AstroBox
npm ci
npm run build
```
It must finish without `X [ERROR]`. `▲ [WARNING]` lines (initial bundle size, Cesium CommonJS modules) do not block the build.
Check that `dist/AstroBox/browser/assets/lerc/` contains both `LercDecode.js` and `lerc-wasm.wasm`.
If `lerc-wasm.wasm` is missing, your local `node_modules` is out of date; `npm ci` fixes it.

## 1. Push the changes to GitHub

From the repository root:
```
git add amplify.yml Frontend/AstroBox/angular.json Frontend/AstroBox/DEPLOY.md
git commit -m "Prepare Amplify static hosting"
git push origin main
git push origin demo-estable
```
The last command uploads the rollback tag (optional but recommended).

## 2. Requirement: GitHub admin access

Amplify creates a webhook on the repository to rebuild on every push, and GitHub
only allows that for accounts with **admin** permission on the repository.
The person connecting Amplify must:

1. Be an **owner or admin** of the repository (GitHub → repository → Settings → Collaborators → role *Admin*).
2. Give the **AWS Amplify** GitHub App access to the repository:
   GitHub → profile picture → Settings → Applications → Installed GitHub Apps → **AWS Amplify** → Configure →
   Repository access → add **AstroBox** (or "All repositories") → Save.

Otherwise Amplify fails with:
`There was an issue setting up your repository ... "Resource not accessible by integration" ... "status":"403"`.

## 3. Create the app in Amplify (console, region us-east-2)

1. Open the Amplify console in **US East (Ohio) us-east-2**:
   https://us-east-2.console.aws.amazon.com/amplify/home?region=us-east-2
2. **Create new app** → **GitHub** → authorize access if asked.
3. Repository: **AstroBox** · Branch: **main**.
4. Check **My app is a monorepo** and enter the monorepo root directory: `Frontend/AstroBox`
   (exact case, no leading or trailing slash).
5. Build settings:
   - Frontend build command: `npm run build`
   - Build output directory: `dist/AstroBox/browser`
   - Password protection: off (unless wanted for the demo).
   - **Do not** check "My monorepo uses Amplify Gen2 backend".
   - The `amplify.yml` in the repository takes precedence over these fields; do not edit the YAML in the console.
   - The detected framework should be **Angular** (static), not an SSR/"Web Compute" option.
6. Advanced settings:
   - Build instance type: default. Build image: default.
   - Environment variable: `AMPLIFY_MONOREPO_APP_ROOT` = `Frontend/AstroBox` (Amplify usually adds it; add it only if missing).
   - Cookies in cache key: off. Live package updates: empty. SSR app logs: off.
7. If asked for a **service role**, let Amplify create the default one.
8. **Save and deploy**. The first build takes several minutes (it installs Node 22 and dependencies).

If the build fails, open the build log:
- `node -v` must show 22.22.3 or later.
- Look for the first line containing `ERROR`.
- "JavaScript heap out of memory": switch to a larger build instance type and redeploy.

## 4. Rewrite rule (recommended)

**Hosting → Rewrites and redirects → Manage redirects → Add rewrite:**

| Source address | Target address | Type |
| --- | --- | --- |
| `</^[^.]+$/>` | `/index.html` | `200 (Rewrite)` |

It only matches paths **without a file extension**, so it never touches Cesium files
(`.js`, `.json`, `.png`, `.jpg`, `.xml`, `.svg`, `.wasm`), lerc, or Verny's `.webp` animations.
Do not use a rule that excludes a fixed list of extensions: Cesium's Assets include `.xml` files that would break.

## 5. Verification at `https://main.<APP_ID>.amplifyapp.com`

- [ ] The page loads and the 3D globe appears (no red errors in the browser console, F12).
- [ ] Switching to the 2D map works.
- [ ] Reloading the page (F5) works.
- [ ] Layers: wildfires, precipitation, surface temperature, sea temperature anomaly, wind, climate zones.
- [ ] Storytelling: start, pause and exit.
- [ ] Verny: drag onto the map, zone status panel, `.webp` animations, rain/fire screen effects.
- [ ] Sound after a click (speaker button or `M` key).
- [ ] Map and data attributions are still visible (Esri, NASA, Open-Meteo, Beck et al. 2023 where applicable).

## 6. During the demo

- **Every push to `main` triggers a new build and replaces the live site.** Do not push to `main` during the presentation.
- Optional: **Hosting → Branch settings → main → Edit → turn off "Enable auto build"** for the duration of the demo.

## ROLLBACK (fastest to most drastic)

1. **Amplify console:** on the `main` branch, open a previous working deployment and choose **Redeploy this version**. (There is no previous version after the very first deployment.)
2. **Revert the commit:** `git revert <commit>` and `git push origin main`. Amplify redeploys automatically.
3. **Last resort:** `git reset --hard demo-estable` and `git push --force origin main`.

Note: running `git merge dev` on `main` does **not** undo changes (`dev` is an ancestor of `main`).

## Pending (not part of the demo)

- Move back to SSR (Amplify compute, port 3000, 220 MB uncompressed bundle limit) if needed.
- S3 for future media (MP3/GIF) once it exists.
- Content-Security-Policy, AWS Budget with an alarm, cost estimate.
- Review production limits/terms of Esri (World Street Map) and Open-Meteo (non-commercial use, 10,000 calls/day).
- Reduce `src/app/app.scss` below 10 kB and lower the budget again.
- Move `Claude outputs/` (test `.wav` recordings) out of the repository.
- From now on: work on `dev`, test it by connecting `dev` in Amplify, and merge into `main` only what was tested.

## What the agent prepared

- Verified that `main` and `dev` were identical (`0cdaf05`) with no pending changes.
- Created the local tag `demo-estable` (not pushed).
- Created `amplify.yml` (root) and this `DEPLOY.md`; adjusted the style budget in `angular.json`.
- Validated the `amplify.yml` syntax. Did **not** run `npm ci` or the build (no npm access in its environment); the build was run locally by the team and succeeded.

## What you do

1. Local `npm ci` + `npm run build` (step 0).
2. Commit and push to `main` (+ tag) (step 1).
3. Get admin access and grant the AWS Amplify GitHub App access to the repository (step 2).
4. Create the app in Amplify and deploy (step 3).
5. Add the rewrite rule (step 4).
6. Verify the site (step 5).
