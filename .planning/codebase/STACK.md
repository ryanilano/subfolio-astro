# Technology Stack

**Analysis Date:** 2026-07-03

## Languages

**Primary:**
- TypeScript ^5.9.3 (`astro/tsconfigs/strict` via `tsconfig.json`) - loaders (`src/loaders/`), lib (`src/lib/`), routes (`src/pages/`)
- Astro 6 component syntax (`.astro`) - `src/components/`, `src/pages/`, `src/layouts/`

**Secondary:**
- JavaScript / ESM (`.mjs`) - pre-build generation scripts in `scripts/`
- SCSS - theme stylesheets under `config/themes/<name>/css/`, compiled by `scripts/gen-css.mjs`
- YAML - config (`config/settings.yml`, `config/filekinds.yml`) and content enhancer files

## Runtime

**Environment:**
- Node.js 24 (`.nvmrc` pins `24`; sibling archive workflow runs `node:24-bookworm` container)
- Package `"type": "module"` (ESM throughout)

**Package Manager:**
- npm
- Lockfile: present (`package-lock.json`, ~289KB); CI uses `npm ci`

## Frameworks

**Core:**
- Astro ^6.4.2 - static site generator, `output: "static"` (`astro.config.mjs`)
- `@astrojs/sitemap` ^3.7.3 - sitemap integration (disabled when `SUBFOLIO_NOINDEX=1`)

**Testing:**
- Node built-in test runner (`node --test`) - smoke, SEO, perf-budget tests in `tests/`
- `@playwright/test` ^1.61.1 + `@axe-core/playwright` ^4.12.1 - a11y (axe + contrast) tests

**Build/Dev:**
- `@astrojs/check` ^0.9.9 + TypeScript - `astro check` type-gate before build
- `sass` ^1.97.3 (dart-sass, `api: "modern-compiler"`) - SCSS compilation
- `lightningcss` ^1.32.0 - CSS transformer (Vite) + vendor prefixing via `browserslistToTargets()`
- `browserslist` ^4.28.4 - single source of prefix targets (`"browserslist": ["defaults"]`)
- `svgo` ^4.0.1 + `mini-svg-data-uri` ^1.4.4 - SVG icon optimization / data-URI embedding

## Key Dependencies

**Critical (runtime/build deps):**
- `sharp` ^0.34.5 - image thumbnails (`scripts/gen-thumbs.mjs`) and embed WebP banners (`scripts/gen-embeds.mjs`); also Astro's image service (`astro/assets/services/sharp`)
- `rss-parser` ^3.13.0 - pre-build RSS feed fetch (`scripts/gen-rss.mjs`, non-strict xml2js)
- `yaml` ^2.6.1 - lenient parsing of settings + content enhancer YAML (`src/loaders/yaml.ts`)
- `archiver` ^8.0.0 - `.oplx` project zip generation (`scripts/gen-oplx.mjs`, `ZipArchive` named import)

**Infrastructure:**
- `wrangler` ^4.87.0 - Cloudflare Pages deploy CLI
- `@types/node` ^26.0.1 - Node type definitions

## Configuration

**Environment variables (all optional, `SUBFOLIO_*`):**
- `SUBFOLIO_CONTENT_DIR` - content root (default `./content/examples`)
- `SUBFOLIO_CONFIG_DIR` - override committed `config/`
- `SUBFOLIO_SITE_URL` - site URL (default `https://subfolio-astro.ilano.fyi`)
- `SUBFOLIO_NOINDEX` - `1` opts out of sitemap/indexing (archive deploy)
- `SUBFOLIO_TEXT_RENDERING` - text engine (e.g. `markdown`)
- `SUBFOLIO_LISTING_MODE` - listing mode (default `list`)
- Cache dir overrides: `SUBFOLIO_THUMB_CACHE`, `SUBFOLIO_EMBED_CACHE`, `SUBFOLIO_RSS_CACHE`, `SUBFOLIO_OPLX_CACHE`
- A `.env` file is present (contents not read; permission-denied per project notes)

**Build:**
- `astro.config.mjs` - site URL, static output, `compressHTML`, conditional sitemap, sharp image service, Vite CSS (lightningcss + modern SCSS compiler)
- `wrangler.jsonc` - `{ name: "subfolio-astro", pages_build_output_dir: "./dist" }`
- `tsconfig.json` - extends `astro/tsconfigs/strict`
- `config/settings.yml` + `config/filekinds.yml` - site/content config
- Pre-build chain (`npm run build`): `gen-thumbs → gen-embeds → gen-css → gen-rss → gen-oplx → astro check → astro build`

## Platform Requirements

**Development:**
- Node 24, npm; run `npm run dev` (runs all gen-* passes then `astro dev`)
- Optional live content via `SUBFOLIO_CONTENT_DIR` + `./dev-content.sh`

**Production:**
- Static build to `./dist`, deployed to Cloudflare Pages (`subfolio-astro` and `subfolio-archive` projects)

---

*Stack analysis: 2026-07-03*
