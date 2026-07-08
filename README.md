# Subfolio-Astro

AstroJS port of [Subfolio](https://github.com/area17/subfolio) — a no-database file browser that turns a folder on disk into a themeable web gallery. The project has been reimagined from its original Kohana 2.x / PHP 5.6 stack to an **Astro static site** (Cloudflare Pages target, hybrid-ready).

## Docs

Full conventions reference and getting-started guide: **[Subfolio-Astro docs](https://ryanilano.github.io/subfolio-astro-docs/)**.

## Quickstart

```sh
npm install      # Node 24 (see .nvmrc)
npm run dev      # astro dev → browse the rendered listing/detail pages
npm run build    # astro check (types) + astro build
npm run preview  # serve the static build locally
npm run deploy   # build + publish to Cloudflare Pages (wrangler pages deploy)
```

Content is authored by dropping files into a content directory and naming them by convention (`-t-`/`-m-`/`-b-` embeds, `.link`/`.cut`/`.pop`/`.ftr`/`.slide`/`.site`/`.oplx`/`.rss` enhancers, `-hidden`, `-access`). A custom Astro content **loader** walks that directory at build time and interprets the conventions — this is the port of the old PHP engine (`Filebrowser.php` + `Subfolio.php`).

## Content Root

The loader reads `SUBFOLIO_CONTENT_DIR`, defaulting to the bundled `content/examples/` fixture so the repo runs standalone. Point it at a live Subfolio install's `directory/` to run against real content.

Set it in `.env.content` (gitignored):

```sh
SUBFOLIO_CONTENT_DIR=/path/to/subfolio/directory
```

Then run through `./dev-content.sh` instead of `npm` directly:

```sh
./dev-content.sh          # npm run dev
./dev-content.sh build    # npm run build
./dev-content.sh preview  # npm run preview
```

The wrapper is needed because Astro only loads dotenv values at render time — not at config time when the loader resolves the content dir — and the `gen-*` scripts read no dotfile at all. `dev-content.sh` promotes `SUBFOLIO_CONTENT_DIR` from `.env.content` to a real exported shell var so both build phases see the same value. Plain `npm run dev` still works; it just falls back to `content/examples/`.

> **Why `.env.content` and not `.env`?** Astro auto-loads `.env` at render time only. With the content dir in `.env`, a plain `npm run build` produced a split-brain build: pages came from the fixture while the `/directory/` raw-bytes route walked the live content tree — leaking the content repo's `.git/` into `dist/` and permanently failing two smoke tests. Keeping the value in a file Astro never reads means every build is internally consistent: plain `npm` commands = pure fixture, `./dev-content.sh` = pure live content.

## Layout

- `src/loaders/` — the content loader (one module per concern; see `schema.ts` for the emitted entry shape). - `src/pages/[...path].astro` — catch-all that ports the PHP controller, resolving each entry to a folder/file/single/slide view. - `src/pages/directory/[...path].ts` — raw-bytes endpoint serving file contents under `/directory/<path>`. - `src/components/` — ported `default`-theme listing and per-filekind views. - `config/filekinds.yml` — extension → kind → view mapping (from upstream). - `content/examples/` — bundled fixture exercising every convention. - `docs/` — port plan and reference: [ROADMAP](docs/ROADMAP.md), the [deployment ADR](docs/ADR-deployment.md), and the stack-agnostic [behavior specs](docs/spec/) extracted from the original PHP engine.

## License

Subfolio-Astro is a modified derivative — an Astro port — of [Subfolio](https://github.com/area17/subfolio) by [AREA17](https://area17.com), and is distributed under the **same** license: the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-or-later`).

- Original Subfolio © AREA17.
- Astro port © 2026 Ryan Ilano.

Per the AGPL, the complete corresponding source for the deployed demo is this repository; the live demo footer links back to it.
