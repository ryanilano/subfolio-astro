# Cloudflare Integration — Go Live + Auto-Deploy

## Context

The repo already has all the Cloudflare deploy *scaffolding* (`output: "static"`,
`wrangler.jsonc`, `npm run deploy`), but per project notes it was **dry-run only —
never actually deployed live**. The goal now is to:

1. Get the site **live on Cloudflare** at the domain name **`subfolio-astro`**, and
2. **Automate** the deploy so pushing to `main` redeploys.

Decisions locked in with the user:
- **Host:** Cloudflare (not GitHub Pages — `*.github.io` can't be served by Cloudflare).
- **Domain:** `subfolio-astro`. With no registered custom domain in play, the free
  Cloudflare subdomain is **`https://subfolio-astro.pages.dev`** (Cloudflare **Pages**
  project subdomains are exactly `<project>.pages.dev`, with no account-subdomain segment —
  this is what guarantees the clean `subfolio-astro` name and matches the existing
  `*.pages.dev` value in `astro.config.mjs`).
- **Content:** bundled fixture (`content/examples/`) — the live site is the demo/showcase.
  No `SUBFOLIO_CONTENT_DIR` wiring needed; the build falls back to the fixture by default.
- **Served at root** → no Astro `base` path → **no internal-URL audit needed**.

### Pages vs. the current Workers config

The current `wrangler.jsonc` uses the **Workers static-assets** pattern, whose free URL is
`<name>.<account>.workers.dev` — which can't yield a clean `subfolio-astro.pages.dev`.
To get the requested domain with the least fuss, this plan deploys via **Cloudflare Pages**
(`wrangler pages deploy`), giving a guaranteed `subfolio-astro.pages.dev`. This is a small,
deliberate switch of deploy target; the build output (`./dist`) is identical either way.

## Changes

### 1. Point config at the new URL — `astro.config.mjs`
- Change `site: "https://subfolio.pages.dev"` → `site: "https://subfolio-astro.pages.dev"`.
  (`site` feeds `@astrojs/sitemap` and any absolute-URL generation, so it must match the
  live host.)

### 2. Switch the deploy script to Pages — `package.json`
- Replace the `deploy` script:
  - From: `"deploy": "npm run build && wrangler deploy"`
  - To:   `"deploy": "npm run build && wrangler pages deploy ./dist --project-name subfolio-astro"`
- Keep the existing `build` script unchanged (it already runs the four `gen-*` pre-passes +
  `astro check` + `astro build`).

### 3. Retarget `wrangler.jsonc` for Pages (or remove it)
- The Workers `assets.directory` config isn't used by `wrangler pages deploy`. Simplest:
  trim `wrangler.jsonc` to just `{ "name": "subfolio-astro" }` so the project name is
  consistent, or leave the file but stop relying on its `assets` block. (Pages reads the
  dir from the `pages deploy ./dist` argument, not the config.)

### 4. First live deploy (manual, one time — establishes the project)
- Run locally: `npx wrangler login` (browser OAuth), then `npm run deploy`.
- This **creates** the Pages project `subfolio-astro` on first run and publishes `./dist`,
  yielding `https://subfolio-astro.pages.dev`. Confirm the URL resolves before automating.

### 5. CI/CD — GitHub Actions auto-deploy on push to `main`
New file: **`.github/workflows/deploy.yml`**. Recommended over Cloudflare's dashboard-based
Workers Builds because it keeps the build env reproducible and in-repo (Node 24 via
`.nvmrc`, the `gen-*` pipeline) and versions the deploy alongside the code.

Workflow shape:
- Trigger: `on: push: branches: [main]` (+ `workflow_dispatch` for manual runs).
- Steps:
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` with `node-version-file: .nvmrc` + `cache: npm`
  3. `npm ci`
  4. `npm run build` (build separately so failures are legible)
  5. `cloudflare/wrangler-action@v3` with
     `command: pages deploy ./dist --project-name subfolio-astro` and env
     `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` from repo secrets.
- Permissions: `contents: read`.

**Repo secrets to add** (GitHub → Settings → Secrets → Actions):
- `CLOUDFLARE_API_TOKEN` — a token scoped to **Account → Cloudflare Pages → Edit**.
- `CLOUDFLARE_ACCOUNT_ID` — from the Cloudflare dashboard.

> Note: creating the API token and adding the two secrets are **manual dashboard/UI steps**
> the user must do (can't be scripted from here). The plan provides the exact scopes.

## Files touched
- `astro.config.mjs` — `site` URL.
- `package.json` — `deploy` script.
- `wrangler.jsonc` — name/trim for Pages.
- `.github/workflows/deploy.yml` — **new**, CI auto-deploy.

## Verification
1. **Local build sanity:** `npm run build` → confirm `./dist` is produced and
   `astro check` passes (no type errors from the config change).
2. **First manual deploy:** `npm run deploy` → confirm console prints the deployed URL and
   **`https://subfolio-astro.pages.dev`** loads the listing page, with CSS/images/thumbnails
   intact (validates root-served assets, no base-path breakage).
3. **Sitemap host:** open `https://subfolio-astro.pages.dev/sitemap-index.xml` and confirm
   URLs use the `subfolio-astro.pages.dev` host (proves `site` propagated).
4. **CI dry run:** trigger the workflow via **Actions → Run workflow** (`workflow_dispatch`)
   and confirm it builds + deploys green using the secrets.
5. **End-to-end:** push a trivial commit to `main` → confirm Actions runs and the live site
   reflects the change.

## Out of scope
- **Phase 4 auth Worker** / `-access` enforcement — still deferred; live site is public-only.
- Custom registered domain (e.g. an apex you own) — `*.pages.dev` is the target here.
- KV / D1 / R2 / Durable Objects — not needed for a static site.
