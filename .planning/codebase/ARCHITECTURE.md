<!-- refreshed: 2026-07-03 -->
# Architecture

**Analysis Date:** 2026-07-03

## System Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                  PRE-BUILD PASSES (scripts/*.mjs)                │
│  gen-thumbs · gen-embeds · gen-css · gen-rss · gen-oplx         │
│  Network + image I/O happen here, writing out-of-tree caches    │
└───────────────┬─────────────────────────────────────────────────┘
                │  gitignored caches: .thumb-cache/ .embed-cache/
                │  .rss-cache/ .oplx-cache/ · public/css/*.css
                ▼
┌─────────────────────────────────────────────────────────────────┐
│              CONTENT LOADER (src/loaders/)                       │
│   subfolioLoader() walks SUBFOLIO_CONTENT_DIR, emits one        │
│   typed FolderEntry per directory into the "folders" collection │
│   `src/loaders/index.ts` + conventions/filekinds/embeds/...     │
└───────────────┬─────────────────────────────────────────────────┘
                │  Astro content collection "folders"
                │  `src/content.config.ts`
                ▼
┌──────────────────────────────┬──────────────────────────────────┐
│   HTML PAGES                 │   RAW BYTES                       │
│  `src/pages/[...path].astro` │  `src/pages/directory/[...path].ts`│
│  folder / file / single /    │  serves file contents + caches    │
│  redirect routes             │  under /directory/<path>          │
└───────────────┬──────────────┴──────────────────────────────────┘
                │  routing helpers `src/lib/routing.ts`
                ▼
┌─────────────────────────────────────────────────────────────────┐
│   COMPONENTS + LAYOUT                                            │
│  `src/layouts/Layout.astro` shell                               │
│  `src/components/listing/Listing.astro` (7 partials, PHP order) │
│  `src/components/filekinds/*` detail views (kind → component)   │
└───────────────┬─────────────────────────────────────────────────┘
                ▼
        Static output → dist/ (Cloudflare Pages / Workers assets)
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Loader orchestrator | Walk content tree, assemble typed `FolderEntry` per folder | `src/loaders/index.ts` |
| Schema | Zod source of truth + all shared types (`z.infer`) | `src/loaders/schema.ts` |
| Conventions | Naming primitives (`isHidden`, `positionOf`, enhancer parsing) | `src/loaders/conventions.ts` |
| HTML route | Path → folder/file/single/redirect view dispatch | `src/pages/[...path].astro` |
| Raw-bytes route | Serve file contents + out-of-tree caches at `/directory/` | `src/pages/directory/[...path].ts` |
| Routing helpers | `componentForKind`, `assetUrl`, breadcrumb, prev/next | `src/lib/routing.ts` |
| Listing composer | Compose 7 listing partials in fixed PHP include order | `src/components/listing/Listing.astro` |
| Layout shell | Page shell, color palette inline, SCSS/theme asset wiring | `src/layouts/Layout.astro` |
| Pre-build passes | Generate thumbs/embeds/css/rss/oplx into gitignored caches | `scripts/gen-*.mjs` |

## Pattern Overview

**Overall:** Build-time static-site generation via a custom Astro content loader — a from-scratch TypeScript port of the PHP Subfolio runtime (`Filebrowser.php` + `Subfolio.php`).

**Key Characteristics:**
- **Build-time, not runtime.** No server, no database. Content on disk; file-naming conventions encode structure.
- **Parsed intent, not execution.** Deferred behaviors (sharp thumbnails, RSS fetch, text render, `-access`) are captured as typed data during the walk, executed in separate pre-build passes or at render.
- **Two URL namespaces** mirroring the PHP engine so both stacks diff on the same content: `/<path>` HTML pages and `/directory/<path>` raw bytes.
- **Lenient parsing.** One malformed user YAML never breaks the build (mirrors old PHP).

## Layers

**Pre-build passes:**
- Purpose: Do all network/image-decode work up front; write gitignored caches consumed by `getStaticPaths` at build.
- Location: `scripts/gen-*.mjs`, chained before `astro build`/`astro dev` in `package.json`.
- Depends on: `sharp`, `rss-parser`, `sass`, `archiver`, content root.
- Used by: raw-bytes route (serves caches), thumbnail/rss/embed render helpers.

**Content loader:**
- Purpose: Walk `SUBFOLIO_CONTENT_DIR`, interpret conventions, emit one typed `FolderEntry` per folder.
- Location: `src/loaders/` (registered in `src/content.config.ts` as collection `"folders"`).
- Depends on: `config/filekinds.yml`, `yaml`, `sharp` (feature/embed dimension enrichment only).
- Used by: both page routes via `getCollection("folders")`.

**Routing / pages:**
- Purpose: Resolve each entry to a route kind and dispatch to a component.
- Location: `src/pages/`, `src/lib/routing.ts`.
- Used by: Astro's static build (`getStaticPaths`).

**Presentation:**
- Purpose: Render listings and file-detail views.
- Location: `src/components/`, `src/layouts/`, `src/lib/*` view helpers.

## Data Flow

### Primary Request Path (folder listing)

1. Pre-build passes generate caches (`scripts/gen-*.mjs`).
2. Loader walks tree, emits `FolderEntry` entries (`src/loaders/index.ts:62` `walk`).
3. `getStaticPaths()` maps each entry to a route (`src/pages/[...path].astro:45`).
4. Folder kind → `Listing.astro` composes 7 partials (`src/components/listing/Listing.astro:31`).
5. `Layout.astro` wraps with shell, breadcrumb, prev/next (`src/pages/[...path].astro:233`).

### File detail path

1. Loader records each `ChildFile` with `kind` from `filekinds.yml`.
2. Route emits a `file` route per non-`link`/`pop` file (`src/pages/[...path].astro:97`).
3. `componentForKind(file.kind)` selects a `filekinds/*` view (`src/lib/routing.ts:46`).
4. `.rss` files additionally read cached items via `rssItemsFor` (`src/lib/rssFeed.ts`).

### Slide / single / redirect flows

- `.slide` folder with direct files → meta-refresh redirect to first file's detail page; per-file detail routes still emitted (`src/pages/[...path].astro:57`).
- `.site`/`.oplx` folder → single detail view, folder synthesized as a `ChildFile` (`src/pages/[...path].astro:81`).

**State Management:** None at runtime. All state is the immutable content collection built once per build.

## Key Abstractions

**FolderEntry:**
- Purpose: One folder's fully-interpreted listing data (files, folders, embeds, features, related, access).
- Examples: `src/loaders/schema.ts`, consumed everywhere via `getCollection("folders")`.
- Pattern: Zod schema is the single source of truth; TS types derived via `z.infer`.

**Enhancers:**
- Purpose: Hidden convention files (`.link`/`.pop`/`.cut`/`.ftr`) that annotate visible items.
- Examples: `src/loaders/enhancers.ts`, parsed in `src/loaders/index.ts:97`.

**Filekind → component map:**
- Purpose: Extension → kind → detail view dispatch.
- Examples: `config/filekinds.yml`, `KIND_COMPONENTS` in `src/lib/routing.ts:33`.

## Entry Points

**`src/content.config.ts`:**
- Triggers: Astro content layer at build.
- Responsibilities: Register `subfolioLoader` as collection `"folders"`; read `SUBFOLIO_CONTENT_DIR` / `SUBFOLIO_TEXT_RENDERING` env.

**`src/pages/[...path].astro`:**
- Triggers: Static build page generation.
- Responsibilities: `getStaticPaths` route emission + per-page view resolution.

**`src/pages/directory/[...path].ts`:**
- Triggers: Static build endpoint generation.
- Responsibilities: Serve raw file bytes and out-of-tree caches with traversal guard.

**`scripts/gen-*.mjs`:**
- Triggers: `npm run dev`/`build` (chained before astro).
- Responsibilities: Produce gitignored caches (thumbs/embeds/css/rss/oplx).

## Architectural Constraints

- **Two-phase build ordering:** `getStaticPaths()` runs before any component renders, so all artifacts (thumbnails, zips, RSS) must be generated in pre-build passes, never lazily during render.
- **Astro `<style>`/`<script>` are not interpolated:** dynamic values must use `set:html` / palette inlining (see `Layout.astro`); a green `astro check` build does not prove a working render.
- **Content-dir env must be a real shell var:** `SUBFOLIO_CONTENT_DIR` is read at config time; dotfile `.env` values may be ignored — use `./dev-content.sh`.
- **Out-of-tree caches:** loader and encoder scripts must agree on cache locations via matching env defaults (`SUBFOLIO_EMBED_CACHE`, `SUBFOLIO_THUMB_CACHE`, etc.).
- **Global state:** none beyond module-level memoization in render helpers (`rssFeed.ts`, `imageMeta.ts`).

## Anti-Patterns

### Lazy artifact generation during render

**What happens:** Generating a thumbnail/zip/RSS fetch inside a component or `getStaticPaths`.
**Why it's wrong:** `getStaticPaths` runs before render and route registration; lazily generated assets 404 or race the two-phase build.
**Do this instead:** Add a pre-build pass in `scripts/gen-*.mjs` writing to an out-of-tree cache, then read it (`src/lib/thumbnailPipeline.ts` reads, `scripts/gen-thumbs.mjs` writes).

### Interpolating dynamic values into `<style>`/`<script>`

**What happens:** Writing `<style>{color}</style>` expecting substitution.
**Why it's wrong:** Astro does not interpolate style/script bodies; the literal token ships.
**Do this instead:** Inline via `set:html` or a palette `<style>` block (`src/layouts/Layout.astro`).

### Enforcing deferred behavior in the loader

**What happens:** Executing `-access` rules or rendering text bodies during the walk.
**Why it's wrong:** The loader captures parsed intent only; execution belongs to later phases/passes.
**Do this instead:** Store typed intent on the entry (`access` captured in `src/loaders/access.ts`, not enforced).

## Error Handling

**Strategy:** Lenient / fail-soft. Filesystem and parse errors degrade gracefully rather than aborting the build.

**Patterns:**
- `safeIsDir`/`readSafe` swallow fs errors and continue (`src/loaders/index.ts:243`).
- Unreadable images leave dimensions unset; view falls back to box dims (`src/loaders/index.ts:174`).
- YAML parse failures fall back to `{}` (`src/loaders/yaml.ts`).
- Raw-bytes route rejects path traversal with 403, missing files with 404 (`src/pages/directory/[...path].ts:109`).

## Cross-Cutting Concerns

**Logging:** Astro `logger.info` from the loader (`src/loaders/index.ts:202`); scripts log to stdout.
**Validation:** Zod schema validates every emitted entry (`src/loaders/schema.ts`).
**Authentication:** `-access` parsed but not enforced (deferred Phase 4); everything served is public.
**i18n:** `src/lib/i18n.ts` (English only currently).

---

*Architecture analysis: 2026-07-03*
