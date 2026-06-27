# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Backend note:** This repo is developed with the DeepClaude proxy (`ANTHROPIC_BASE_URL=http://127.0.0.1:3200`), which routes Claude Code through a local proxy to the **DeepSeek** backend. To switch to Anthropic passthrough, run `/anthropic`.
>
> **See also [AGENTS.md](AGENTS.md)** — cross-agent gotchas shared by all tools and fan-out workers (Astro `<style>`/`<script>` interpolation traps, why a green build doesn't prove a component renders, component porting conventions).

## Build & dev commands

```sh
npm install                  # Node 24 (see .nvmrc)
npm run dev                  # astro dev → browse the rendered listing/detail pages
npm run build                # astro check (types) + astro build
npm run preview              # serve the static build
```

There are no tests yet — Phase 1 was validated by eyeballing the (now-removed) `/debug` route against the bundled `content/examples/` fixture; Phase 2 is validated by loading the rendered pages (`npm run preview`) against the same fixture.

## Architecture

This is a port of [Subfolio](https://github.com/ryanilano/subfolio) (Kohana 2.x / PHP 5.6) to an **Astro 6 static site** targeting Cloudflare Pages. Content lives in a directory on disk; file-naming conventions encode structure (embeds, enhancers, features, access). A custom Astro **content loader** walks that directory at build time and emits typed folder entries — this replaces the old PHP runtime engine (`Filebrowser.php` + `Subfolio.php`).

### Content loader pipeline (`src/loaders/`)

The loader is registered in [src/content.config.ts](src/content.config.ts) as a collection named `"folders"` and emits one entry per directory. The content root defaults to `content/examples/` (bundled fixture) but can point at any live Subfolio `directory/` via the `SUBFOLIO_CONTENT_DIR` env var.

| Module | Role |
|---|---|
| [index.ts](src/loaders/index.ts) | Orchestrator: walks the tree, assembles each folder entry, calls all parsers. The `subfolioLoader()` factory returns an Astro `Loader`. |
| [conventions.ts](src/loaders/conventions.ts) | Naming primitives: `isHidden()`, `positionOf()` (`-t-`/`-m-`/`-b-`), `fileEnhancerOf()` / `folderEnhancerOf()`, `displayName()`. Direct port of the PHP engine's convention logic. |
| [filekinds.ts](src/loaders/filekinds.ts) | Loads [config/filekinds.yml](config/filekinds.yml) and resolves extension → kind (first-match in YAML order). |
| [embeds.ts](src/loaders/embeds.ts) | Collects position-prefixed files (`-t-`/`-m-`/`-b-`) into `{ top, middle, bottom }` grouped embeds of type `img` / `txt` / `rss`. Phase 1 captures raw text + src paths but defers rendering/sharp/RSS fetch to later phases. |
| [enhancers.ts](src/loaders/enhancers.ts) | Parses enhancer file bodies: `.link` → internet location, `.pop` → popup window params, `.ftr` → feature cards, `.cut` → shortcuts/related items. |
| [access.ts](src/loaders/access.ts) | Parses `-access` YAML into typed access rules (allow/deny users & groups). Not enforced — Phase 1 only captures intent. |
| [yaml.ts](src/loaders/yaml.ts) | Lenient YAML wrapper: normalizes the legacy Spyc `key:>` folded-scalar marker to standard `key: >`, then parses with the `yaml` npm lib. Falls back to `{}` on parse failure so one bad user-authored YAML doesn't break the build. |
| [schema.ts](src/loaders/schema.ts) | Single source of truth: Zod schema + TypeScript types for `FolderEntry`, `ChildFile`, `ChildFolder`, `Embed`, `Feature`, `Related`, `AccessRules`. All loader modules derive types from here via `z.infer`. |

### Key design decisions

- **Build-time, not runtime.** Everything is interpreted at Astro build time. No server, no database. Deferred behaviors (sharp thumbnails, RSS HTTP fetch, Textile/Markdown rendering, `-access` enforcement) are captured as *parsed intent* in the entry data, not executed yet.
- **Same content, new stack.** The loader reads the same `directory/` layout the PHP app uses, so old PHP and new Astro can run side-by-side against identical content for diffing.
- **Lenient parsing.** User-authored YAML (enhancers, `-access`) is parsed defensively — a single malformed file won't break the build. The same leniency the old PHP engine applied.
- **Hidden items still matter.** Files/folders with `-hidden`/`.` prefixes or enhancer extensions (`.ftr`, `.cut`, info files) are excluded from plain listings but still read explicitly for embeds, features, and shortcuts.

### Routing

Two URL namespaces, mirroring the PHP engine (so old and new can be diffed on the same content):

- **HTML pages** — [src/pages/[...path].astro](src/pages/[...path].astro) is the catch-all that ports `Filebrowser_Controller::index()`. Its `getStaticPaths()` resolves each loader entry to one of four route kinds: a **folder** listing ([Listing.astro](src/components/listing/Listing.astro) composes the seven partials in PHP order), a **file** detail view (kind→component dispatch via [src/lib/routing.ts](src/lib/routing.ts) `componentForKind`), a **single** view for `.site`/`.oplx` folders, or a meta-refresh **redirect** for `.slide` folders. Breadcrumb and prev/next nav are derived in `routing.ts`.
- **Raw bytes** — [src/pages/directory/[...path].ts](src/pages/directory/[...path].ts) serves file contents under `/directory/<path>` (ports `get_file_url()`). Every `<img src>` / download href routes through `routing.ts` `assetUrl()`. `-access` enforcement is still deferred (Phase 4) — everything served is public.

The Phase-1 `/debug` JSON-dump route was removed at the Phase-2 cutover.

### Content fixture

[content/examples/](content/examples/) exercises every naming convention:
- `-t-`/`-m-`/`-b-` position embeds (text, images, RSS)
- `-hidden` directories
- `.link` internet locations, `.pop` popup windows, `.cut` shortcuts
- `.ftr` feature cards that exclude their target from plain listings
- `.slide` slideshow directories, `.site` mini-site single-view
- `.rss` feed enhancers (with `.rss.cache` companion)
- `-access` access rules
- `-thumbnails/` and `-thumbnails-custom/` image directories

## Phase roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for full details. Current state:
- **Phase 0** ✅ — Spec captured from the PHP engine (see [docs/spec/](docs/spec/))
- **Phase 1** ✅ — Content loader (this code)
- **Phase 2** ✅ — Theme components wired into real listing/detail routes; `/debug` dropped
- **Phase 3–5** — Build pipeline (sharp/RSS/sass), deferred auth, enhancer polish
