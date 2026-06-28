# subfolio-astro

A port of [Subfolio](https://github.com/ryanilano/subfolio) — a no-database file
browser that turns a folder on disk into a themeable web gallery — from its
original Kohana 2.x / PHP 5.6 stack to an **Astro static site** (Cloudflare
Pages target, hybrid-ready).

Content is authored by dropping files into a content directory and naming them by
convention (`-t-`/`-m-`/`-b-` embeds, `.link`/`.cut`/`.pop`/`.ftr`/`.slide`/
`.site`/`.oplx`/`.rss` enhancers, `-hidden`, `-access`). A custom Astro content
**loader** walks that directory at build time and interprets the conventions —
this is the port of the old PHP engine (`Filebrowser.php` + `Subfolio.php`).

## Quickstart

```sh
npm install      # Node 24 (see .nvmrc)
npm run dev      # astro dev → browse the rendered listing/detail pages
npm run build    # astro check (types) + astro build
npm run preview  # serve the static build locally
npm run deploy   # build + publish to Cloudflare (Wrangler, Workers static-assets)
```

## Content Root

The loader reads `SUBFOLIO_CONTENT_DIR` (see `.env`), defaulting to the bundled
`content/examples/` fixture so the repo runs standalone. Point it at a live
Subfolio install's `directory/` to run against real content.

## Layout

- `src/loaders/` — the content loader (one module per concern; see
  `schema.ts` for the emitted entry shape).
- `src/pages/[...path].astro` — catch-all that ports the PHP controller,
  resolving each entry to a folder/file/single/slide view.
- `src/pages/directory/[...path].ts` — raw-bytes endpoint serving file
  contents under `/directory/<path>`.
- `src/components/` — ported `default`-theme listing and per-filekind views.
- `config/filekinds.yml` — extension → kind → view mapping (from upstream).
- `content/examples/` — bundled fixture exercising every convention.
- `docs/` — port plan and reference: [ROADMAP](docs/ROADMAP.md), the
  [deployment ADR](docs/ADR-deployment.md), and the stack-agnostic
  [behavior specs](docs/spec/) extracted from the original PHP engine.