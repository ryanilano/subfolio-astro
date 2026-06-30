# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repo.

> **Backend:** developed via the DeepClaude proxy (`ANTHROPIC_BASE_URL=http://127.0.0.1:3200`) → **DeepSeek**. Run `/anthropic` for Anthropic passthrough.
>
> **See [AGENTS.md](AGENTS.md)** for cross-agent gotchas (Astro `<style>`/`<script>` interpolation traps, why a green build ≠ a working render, porting conventions).

## Build & dev

```sh
npm install                  # Node 24 (.nvmrc)
npm run dev                  # astro dev → rendered listing/detail pages
npm run build                # astro check (types) + astro build
npm run preview              # serve static build
```

No unit tests; validate by rendering pages (`npm run preview`) against the `content/examples/` fixture. (See AGENTS.md: a green build does not prove a render.)

## Architecture

A port of [Subfolio](https://github.com/ryanilano/subfolio) (Kohana 2.x / PHP 5.6) to an **Astro 6 static site** for Cloudflare Pages. Content lives on disk; file-naming conventions encode structure (embeds, enhancers, features, access). A custom Astro **content loader** walks the tree at build time and emits typed folder entries — replacing the old PHP runtime (`Filebrowser.php` + `Subfolio.php`).

### Content loader (`src/loaders/`)

Registered in [src/content.config.ts](src/content.config.ts) as collection `"folders"`, one entry per directory. Content root defaults to `content/examples/`; override via `SUBFOLIO_CONTENT_DIR` to point at a live Subfolio `directory/`.

| Module | Role |
|---|---|
| [index.ts](src/loaders/index.ts) | Orchestrator: walks tree, assembles entries, calls parsers. `subfolioLoader()` returns an Astro `Loader`. |
| [conventions.ts](src/loaders/conventions.ts) | Naming primitives: `isHidden()`, `positionOf()` (`-t-`/`-m-`/`-b-`), `fileEnhancerOf()`/`folderEnhancerOf()`, `displayName()`. |
| [filekinds.ts](src/loaders/filekinds.ts) | Loads [config/filekinds.yml](config/filekinds.yml); resolves extension → kind (first-match in YAML order). |
| [embeds.ts](src/loaders/embeds.ts) | Groups position-prefixed files into `{ top, middle, bottom }` embeds of type `img`/`txt`/`rss`. |
| [enhancers.ts](src/loaders/enhancers.ts) | Parses enhancer bodies: `.link`→location, `.pop`→popup params, `.ftr`→feature cards, `.cut`→shortcuts/related. |
| [access.ts](src/loaders/access.ts) | Parses `-access` YAML into typed allow/deny rules. Captured, not enforced. |
| [yaml.ts](src/loaders/yaml.ts) | Lenient YAML: normalizes legacy Spyc `key:>` → `key: >`, parses with `yaml`, falls back to `{}` on failure. |
| [schema.ts](src/loaders/schema.ts) | Source of truth: Zod schema + types (`FolderEntry`, `ChildFile`, `ChildFolder`, `Embed`, `Feature`, `Related`, `AccessRules`). Modules derive types via `z.infer`. |

### Key design decisions

- **Build-time, not runtime.** No server/DB. Deferred behaviors (sharp thumbnails, RSS fetch, Textile/Markdown render, `-access` enforcement) are captured as *parsed intent*, not executed.
- **Same content, new stack.** Loader reads the same `directory/` layout as the PHP app, so both can run side-by-side for diffing.
- **Lenient parsing.** One malformed user YAML won't break the build (matches old PHP).
- **Hidden items still matter.** `-hidden`/`.`-prefixed or enhancer-extension files are hidden from listings but read explicitly for embeds, features, shortcuts.

### Routing

Two URL namespaces mirroring the PHP engine (for diffing on the same content):

- **HTML pages** — [src/pages/[...path].astro](src/pages/[...path].astro) ports `Filebrowser_Controller::index()`. `getStaticPaths()` resolves each entry to: **folder** listing ([Listing.astro](src/components/listing/Listing.astro) composes seven partials in PHP order), **file** detail (kind→component via [routing.ts](src/lib/routing.ts) `componentForKind`), **single** view (`.site`/`.oplx` folders), or meta-refresh **redirect** (`.slide` folders). Breadcrumb + prev/next derived in `routing.ts`.
- **Raw bytes** — [src/pages/directory/[...path].ts](src/pages/directory/[...path].ts) serves contents under `/directory/<path>` (ports `get_file_url()`). All `<img src>`/download hrefs route through `routing.ts` `assetUrl()`. `-access` deferred (Phase 4) — everything served is public.

### Fixture

[content/examples/](content/examples/) exercises every convention: `-t-`/`-m-`/`-b-` embeds (text/image/RSS); `-hidden` dirs; `.link`/`.pop`/`.cut`/`.ftr` enhancers; `.slide`/`.site` folders; `.rss` feeds (+`.rss.cache`); `-access` rules; `-thumbnails/` and `-thumbnails-custom/`.

## Phase roadmap

Full details in [docs/ROADMAP.md](docs/ROADMAP.md). State:

- **Phase 0** ✅ — Spec from PHP engine ([docs/spec/](docs/spec/))
- **Phase 1** ✅ — Content loader
- **Phase 2** ✅ — Theme components on real routes; `/debug` dropped
- **Phase 3–5** — Build pipeline (sharp/RSS/sass), deferred auth, enhancer polish
