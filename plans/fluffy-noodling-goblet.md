# Plan: Load real `settings.yml` + theme `options.yml` instead of hardcoded config

## Context

Today, every site-level value (title, domain, copyright, meta description) and every
display toggle (grid vs list, visible columns, sort, header chrome) is **hardcoded** in
[src/lib/site.ts](../src/lib/site.ts) as two `const` objects — `siteConfig` and
`defaultOptions`. The file's own header admits this is a placeholder: *"Values here
mirror the legacy config. In production these would come from env vars or a config file."*

The legacy PHP engine read these from `config/settings/settings.yml` (site-wide) and the
active theme's `config/themes/<theme>/options.yml` (display toggles), merged over
hard-coded defaults. Reference copies of those files are archived in
[config-legacy/](../config-legacy/).

**Goal:** make the build actually consume a committed `config/settings.yml` + the active
theme's `config/themes/<theme>/options.yml`, so the site reflects real config instead of
placeholders — while keeping all ~13 component consumers unchanged.

## Decisions (confirmed with user)

- **Location = the active `config/` dir, flattened to match the repo's own convention.**
  The repo already flattened `config/settings/filekinds.yml` → `config/filekinds.yml`, so:
  - `config/settings.yml` (sits at `config/` root, beside `filekinds.yml`)
  - `config/themes/<theme>/options.yml` (themes keep a subdir — each theme is a folder)
  - `config-legacy/` stays as a read-only archive; nothing reads it.
- **Committed values = neutral Subfolio sample.** Commit the generic `*.sample.yml`
  values so the public repo stays identity-neutral. Real ryanilano.com config is supplied
  at deploy time via `SUBFOLIO_CONFIG_DIR` (parallel to how `SUBFOLIO_CONTENT_DIR` points
  at the live `directory/`).
- **Config source = committed default + env override.** New `SUBFOLIO_CONFIG_DIR` defaults
  to `./config` (the committed neutral files) and can point elsewhere (e.g. a private
  config dir) at deploy. Missing/malformed files fall back to hard-coded defaults — lenient,
  matching the PHP engine and the existing `filekinds` loader.
- **Theme scope = `options.yml` values only.** Read the active theme's `options.yml`
  (display toggles + logo/favicon URL + `color_palette` name + `thumbnail_height`) into
  `defaultOptions`. No asset-copy pipeline, no build-time theme switching.
  - **Known caveat:** legacy `options.yml` points logo/favicon at `config/themes/...`
    paths Astro won't serve yet. Reading the value is harmless; the asset just 404s and the
    existing **empty-logo → text site-name** fallback in
    [Header.astro](../src/layouts/Header.astro) kicks in. Serving those assets is a clean
    follow-up ("+assets" tier), explicitly out of scope here.

## Approach

Follow the existing loader pattern exactly: [src/loaders/filekinds.ts](../src/loaders/filekinds.ts)
reads YAML via `parseSubfolioYaml` from [src/loaders/yaml.ts](../src/loaders/yaml.ts),
caches the result, and is path-resolved by the caller. We mirror that for settings.

### 1. Commit neutral sample config into `config/`

- `config/settings.yml` ← copy of `config-legacy/settings/settings.sample.yml`
  (`theme: default`, Subfolio / www.subfolio.com identity).
- `config/themes/default/options.yml` ← copy of
  `config-legacy/themes/default/options.sample.yml`.

These become the committed defaults. (The legacy `options.sample.yml` files have a known
duplicated first comment line — harmless to YAML parsing; trim if tidying.)

### 2. New module: `src/loaders/settings.ts`

Two functions + a small key-normalization map. All build-time, all lenient.

- `loadSettings(configDir: string): RawSettings` — reads `<configDir>/settings.yml` via
  `parseSubfolioYaml`; returns `{}` if missing/unparseable (reuse the try/catch leniency in
  `yaml.ts`). Returns raw legacy keys (`site_name`, `site_domain`, `theme`, …).
- `loadThemeOptions(configDir, themeName): RawOptions` — reads
  `<configDir>/themes/<themeName>/options.yml`; same leniency.
- Export `THEME_DEFAULT = "default"`; active theme = `settings.theme ?? THEME_DEFAULT`.

Keep these returning *raw parsed maps* — the merge + rename logic lives in `site.ts`, so
the legacy-key→port-field mapping is in one place.

### 3. Refactor `src/lib/site.ts` to merge instead of hardcode

- Rename the two current `const` objects to `DEFAULT_SITE_CONFIG` / `DEFAULT_OPTIONS`
  (baseline = PHP hard-coded defaults). **Keep every key** — including port-only keys with
  no legacy equivalent (`shadow_style_css`, `display_max_filesize`, `enable_view_transitions`).
- Resolve config dir once: `const configDir = process.env.SUBFOLIO_CONFIG_DIR ?? "./config"`.
- `loadSettings(configDir)` → derive theme → `loadThemeOptions(configDir, theme)`.
- Build and export **under the same names `siteConfig` / `defaultOptions`** so no consumer
  changes:
  - `siteConfig` = `DEFAULT_SITE_CONFIG` ← settings.yml (with renames below).
  - `defaultOptions` = `DEFAULT_OPTIONS` ← theme `options.yml` (key names already match the
    port's option names — verified against `default/options.sample.yml`).
- Keep `export type SiteConfig` / `Options` as `typeof` the merged objects.

#### Key renames / reconciliations (settings.yml → siteConfig)

| settings.yml key            | siteConfig field        | Note |
|-----------------------------|-------------------------|------|
| `site_name`                 | `site_title`            | rename |
| `site_root`                 | `site_root`             | 1:1 |
| `site_domain`               | `site_domain`           | 1:1 |
| `site_copyright`            | `site_copyright`        | 1:1 (legacy holds HTML entities, e.g. `&copy;`) |
| `site_meta_description`     | `site_meta_description` | 1:1 |
| `google_analytics_code`     | `google_analytics_code` | 1:1 (commented in sample → stays default `""`) |
| `theme`                     | (drives theme load)     | not stored on siteConfig |
| `text_rendering`            | — **out of scope**      | already `SUBFOLIO_TEXT_RENDERING`-driven in `content.config.ts`; leave untouched to avoid a second source of truth |
| `thumbnail_max_filesize`    | — **out of scope**      | lives in the thumbnail pipeline, not a `siteConfig` field today |

Logo/favicon/`color_palette`/`thumbnail_height` come from **options.yml**, overriding the
same-named fields (the port flattened settings+options; options wins — matches PHP precedence).

## Files

- **New (committed config):** `config/settings.yml`, `config/themes/default/options.yml`.
- **New (code):** [src/loaders/settings.ts](../src/loaders/settings.ts) — `loadSettings`,
  `loadThemeOptions`, `THEME_DEFAULT`.
- **Edit:** [src/lib/site.ts](../src/lib/site.ts) — defaults → merge; same exports.
- **Reuse (no edit):** [src/loaders/yaml.ts](../src/loaders/yaml.ts) `parseSubfolioYaml`;
  [src/loaders/filekinds.ts](../src/loaders/filekinds.ts) as the structural template.
- **No change:** the ~13 importers of `siteConfig` / `defaultOptions`
  (Layout, Header, Footer, Listing, Gallery, FilesAndFolders, Related, `filekinds/*`).

## Verification

1. **Committed default builds clean.** `npm run build` (no env var) → green; `npm run
   preview` shows the neutral Subfolio identity from `config/settings.yml` (title
   "Subfolio", domain www.subfolio.com), default-theme list view. Matches today's defaults.
2. **Env override applies real config.** Point at the archived ryanilano config and rebuild:
   ```sh
   SUBFOLIO_CONFIG_DIR=./config-legacy/settings  # settings.yml location...
   ```
   — note `config-legacy` uses the legacy nested layout (`settings/settings.yml`,
   `themes/ryanilano/options.yml`), so for a clean override test, copy those into a flat
   dir (e.g. `/tmp/cfg/settings.yml` + `/tmp/cfg/themes/ryanilano/options.yml`) and set
   `SUBFOLIO_CONFIG_DIR=/tmp/cfg`. Confirm:
   - `<title>` / header → **"Ryan Ilano | Art Director + Designer | Brooklyn, NY"**.
   - Breadcrumb root domain → **ryanilano.com**.
   - Footer copyright → **"© 2014 Ryan Ilano — All rights reserved"** (entity decoded).
   - Listing defaults to **grid**, **size column hidden**, **extensions hidden**
     (`listing_mode: grid`, `display_size: false`, `display_file_extensions: false`).
   - Logo 404s → **text site-name fallback** (expected; documents the assets caveat).
3. **Leniency.** Malform `config/settings.yml` (bad indent) → build still succeeds, falls
   back to defaults (matches `parseSubfolioYaml`'s `{}` fallback).
4. `astro check` passes — the `typeof` exports keep types intact for all consumers.

## Out of scope (noted for follow-up)

- Serving theme assets (logo/favicon/color-palette images & YAMLs) — the "+assets" tier.
- Build-time theme **switching** — layouts are already Astro components, largely moot.
- Folding `text_rendering` / `thumbnail_max_filesize` from settings.yml — already covered
  by dedicated env vars; would create competing sources of truth.
- Production deploy wiring (setting `SUBFOLIO_CONFIG_DIR` to the real private config dir in
  the Cloudflare build env) — a config step, not code.
