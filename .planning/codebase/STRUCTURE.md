# Codebase Structure

**Analysis Date:** 2026-07-03

## Directory Layout

```
subfolio-astro/
├── src/
│   ├── content.config.ts       # Registers subfolioLoader as collection "folders"
│   ├── loaders/                # Custom content loader (PHP runtime port)
│   ├── pages/                  # Two route namespaces (HTML + raw bytes)
│   ├── components/             # Listing partials + filekind detail views
│   ├── layouts/                # Layout / Header / Footer shell
│   ├── lib/                    # Render-time helpers (routing, thumbs, rss, site)
│   ├── config/                 # (build-time config helpers)
│   └── img/                    # (source imagery)
├── scripts/                    # Pre-build passes (gen-*.mjs) + tooling
├── config/                     # Committed runtime config
│   ├── filekinds.yml           # Extension → kind mapping
│   ├── settings.yml            # Site settings
│   └── themes/<name>/          # Theme CSS (default = base) + options.yml
├── content/examples/           # Bundled fixture (default content root)
├── public/                     # Static assets (css/js/fonts/images); gen-css output
├── tests/                      # node --test smoke + a11y + perf + seo suites
├── docs/                       # ROADMAP + spec/ (PHP engine spec)
├── plans/                      # Planning docs (plans/complete archived)
├── config-legacy/              # Reference-only legacy config
├── astro.config.mjs            # Astro static config (sitemap, sharp, lightningcss)
├── package.json                # Node 24 (.nvmrc); build chains gen-* → astro
└── CLAUDE.md / AGENTS.md       # Agent guidance
```

Gitignored out-of-tree caches (pre-build output): `.thumb-cache/`, `.embed-cache/`, `.rss-cache/`, `.oplx-cache/`.

## Directory Purposes

**`src/loaders/`:**
- Purpose: The content loader — from-scratch port of `Filebrowser.php` + `Subfolio.php`.
- Key files: `index.ts` (orchestrator), `schema.ts` (Zod source of truth), `conventions.ts`, `filekinds.ts`, `embeds.ts`, `enhancers.ts`, `access.ts`, `yaml.ts`, `settings.ts`.

**`src/pages/`:**
- Purpose: Two URL namespaces.
- Key files: `[...path].astro` (HTML folder/file/single/redirect), `directory/[...path].ts` (raw bytes).

**`src/components/`:**
- Purpose: Presentation.
- `listing/`: `Listing.astro` composes `InlineEmbeds`, `Features`, `Gallery`, `FilesAndFolders`, `Related`.
- `filekinds/`: per-kind detail views (`Img`, `Snd`, `Vid`, `Swf`, `Txt`, `Rss`, `Site`, `Oplx`, `Webloc`, `Link`, `Default`, `DownloadBox`, `HideableDownloadBox`).

**`src/lib/`:**
- Purpose: Render-time helpers (read-only; no generation).
- Key files: `routing.ts`, `thumbnailPipeline.ts`, `rssFeed.ts`, `imageMeta.ts`, `fileHelpers.ts`, `listingHelpers.ts`, `renderText.ts`, `site.ts`, `colors.ts`, `i18n.ts`.

**`scripts/`:**
- Purpose: Pre-build generation + tooling.
- Key files: `gen-thumbs.mjs`, `gen-embeds.mjs`, `gen-css.mjs`, `gen-rss.mjs`, `gen-oplx.mjs`, `perf-budget.mjs`, `ledger.mjs`.

**`config/themes/<name>/`:**
- Purpose: Theme layer. `default` = editable base stylesheet (`css/` → `public/css/main.css`); other themes override. Each has `options.yml`.

## Key File Locations

**Entry Points:**
- `src/content.config.ts`: Register loader collection.
- `src/pages/[...path].astro`: HTML route + view dispatch.
- `src/pages/directory/[...path].ts`: Raw-bytes route.

**Configuration:**
- `astro.config.mjs`: Astro config (static, sitemap, sharp image service, lightningcss).
- `config/filekinds.yml`: Extension → kind.
- `config/settings.yml`: Site settings.
- `.nvmrc`: Node 24.

**Core Logic:**
- `src/loaders/index.ts`: Tree walk + entry assembly.
- `src/loaders/schema.ts`: Types + validation.
- `src/lib/routing.ts`: URL builders + component dispatch.

**Testing:**
- `tests/smoke.*.test.mjs`, `tests/a11y.*`, `tests/perf.budget.test.mjs`, `tests/seo.test.mjs` (run via `node --test`).

## Naming Conventions

**Files:**
- Astro components: PascalCase `.astro` (`Listing.astro`, `Img.astro`).
- Loader/lib modules: camelCase `.ts` (`routing.ts`, `thumbnailPipeline.ts`).
- Pre-build scripts: `gen-<thing>.mjs`.

**Content conventions (encoded in filenames, interpreted by the loader):**
- Position embeds: `-t-` / `-m-` / `-b-` prefix (top/middle/bottom).
- Enhancers: `.link`, `.pop`, `.cut`, `.ftr` extensions.
- Folder suffixes: `.slide`, `.site`, `.oplx`.
- Hidden: `-hidden` / leading `.`; access: `-access` file.

## Where to Add New Code

**New filekind detail view:**
- Component: `src/components/filekinds/<Kind>.astro`.
- Register in `KIND_COMPONENTS` map: `src/lib/routing.ts:33`.
- Map extension → kind in `config/filekinds.yml`.

**New listing section:**
- Partial: `src/components/listing/<Section>.astro`.
- Insert in PHP-order composition: `src/components/listing/Listing.astro:31`.

**New convention / enhancer:**
- Primitive: `src/loaders/conventions.ts`; parser: `src/loaders/enhancers.ts`.
- Wire into walk: `src/loaders/index.ts`; extend schema: `src/loaders/schema.ts`.

**New build-time artifact (network/image work):**
- Add a `scripts/gen-<thing>.mjs` pass; chain it before astro in `package.json`; write to an out-of-tree gitignored cache; read via a `src/lib/*` helper (never generate during render).

**Shared render helper:**
- `src/lib/<helper>.ts` (read-only, lenient, memoized where hot).

## Special Directories

**`.thumb-cache/`, `.embed-cache/`, `.rss-cache/`, `.oplx-cache/`:**
- Purpose: Pre-build generated artifacts served under `/directory/`.
- Generated: Yes (scripts). Committed: No (gitignored).

**`content/examples/`:**
- Purpose: Default content root / fixture exercising every convention.
- Committed: Yes. Override with `SUBFOLIO_CONTENT_DIR`.

**`config-legacy/`:**
- Purpose: Reference-only legacy config from the PHP app. Committed: Yes.

**`public/css/`:**
- Purpose: `gen-css.mjs` output (`main.css`, `icons.css`) plus static assets. Partly generated.

---

*Structure analysis: 2026-07-03*
