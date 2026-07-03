# External Integrations

**Analysis Date:** 2026-07-03

## APIs & External Services

**RSS feeds (outbound fetch):**
- Arbitrary user-authored feed URLs from `.rss` enhancer files (`feedurl:`, `count:`, `cache:`)
  - SDK/Client: `rss-parser` ^3.13.0 (`scripts/gen-rss.mjs`)
  - Auth: none (public feeds)
  - Pattern: fetched at build time into `./.rss-cache/<sha1(url)>.json`; render reads cache (`src/lib/rssFeed.ts`). Offline-safe: a failed fetch keeps stale cache, never breaks the build. Per-feed TTL default 3600s.

**Analytics:**
- Google Analytics - supported but disabled (`google_analytics_code` commented out in `config/settings.yml`)

## Data Storage

**Databases:**
- None. No server or DB — content lives on disk; a custom Astro content loader (`src/loaders/`) walks the tree at build time.

**File Storage:**
- Local filesystem only. Content root defaults to `content/examples/`, overridable via `SUBFOLIO_CONTENT_DIR`.
- Out-of-tree, gitignored build caches (never mutate content dir): `.thumb-cache/`, `.embed-cache/`, `.rss-cache/`, `.oplx-cache/`

**Caching:**
- Filesystem caches only (see above); persist across builds to honor RSS TTLs and skip regeneration.

## Authentication & Identity

**Auth Provider:**
- None. `-access` allow/deny rules are parsed (`src/loaders/access.ts`) but NOT enforced (deferred Phase 4). All served bytes are public.

## Monitoring & Observability

**Error Tracking:**
- None.

**Logs:**
- Build-time console output from gen-* scripts; no runtime logging (static site).

## CI/CD & Deployment

**Hosting:**
- Cloudflare Pages (via `wrangler` ^4.87.0)
  - Public demo project: `subfolio-astro` → `subfolio-astro.ilano.fyi`
  - Archive project: `subfolio-archive` → `archive.ilano.fyi` (noindexed)

**CI Pipeline:**
- GitHub Actions (`.github/workflows/deploy.yml`): on push to `main` / manual. Steps: checkout, setup-node (from `.nvmrc`), `npm ci`, `npm run build`, deploy via `cloudflare/wrangler-action@v3`.
- Forgejo Actions (sibling content repo `.forgejo/workflows/deploy-archive.yml`): PRIMARY archive publisher on self-hosted Tailnet runner in `node:24-bookworm`. Checks out private content, strips repo metadata, `git clone`s the public engine, builds against private content with `SUBFOLIO_SITE_URL=https://archive.ilano.fyi` / `SUBFOLIO_NOINDEX=1`, deploys via `npx wrangler pages deploy --project-name subfolio-archive`.
- GitHub archive workflow (sibling `.github/workflows/deploy-archive.yml`): manual-only, kept from racing the Forgejo publisher on the same Pages project.

## Environment Configuration

**Required for deploy (CI secrets):**
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

**Runtime/build knobs (optional):**
- `SUBFOLIO_CONTENT_DIR`, `SUBFOLIO_SITE_URL`, `SUBFOLIO_NOINDEX`, `SUBFOLIO_TEXT_RENDERING`, `SUBFOLIO_LISTING_MODE`, `SUBFOLIO_CONFIG_DIR`, and cache-dir overrides

**Secrets location:**
- CI: GitHub Actions secrets / Forgejo secrets. Local `.env` present (not read).

## Webhooks & Callbacks

**Incoming:**
- None (static site; deploys triggered by git push, not webhooks).

**Outgoing:**
- None at runtime. Only build-time RSS fetches (see APIs).

## Content Pipeline Integrations (build-time)

- **sharp** ^0.34.5 - thumbnails (`gen-thumbs.mjs`) + embed WebP banners (`gen-embeds.mjs`); also Astro image service
- **archiver** ^8.0.0 - `.oplx` project plan zips (`gen-oplx.mjs`)
- **dart-sass + lightningcss + browserslist** - theme CSS compilation (`gen-css.mjs`), targets from `package.json` `browserslist`
- **@astrojs/sitemap** - sitemap.xml (skipped on noindex builds)

---

*Integration audit: 2026-07-03*
