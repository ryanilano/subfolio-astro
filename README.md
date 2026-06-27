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

## Status — Phase 1 (content loader, de-risk)

The loader is implemented and validated against the bundled example fixture. It
fully interprets every naming convention and emits typed folder entries.
Deferred to later phases: `sharp` thumbnails + image dimensions, RSS HTTP fetch,
Textile/Markdown rendering, `-access` enforcement, theming, and deploy. Those are
captured as *parsed intent* in the entries, not yet executed.

## Develop

```sh
npm install
npm run dev      # then visit /debug to inspect the parsed folder entries
npm run build    # astro check (types) + astro build
```

## Content root

The loader reads `SUBFOLIO_CONTENT_DIR` (see `.env`), defaulting to the bundled
`content/examples/` fixture so the repo runs standalone. Point it at a live
Subfolio install's `directory/` to run against real content.

## Layout

- `src/loaders/` — the content loader (one module per concern; see
  `schema.ts` for the emitted entry shape).
- `config/filekinds.yml` — extension → kind → view mapping (from upstream).
- `content/examples/` — bundled fixture exercising every convention.
- `src/pages/debug/` — throwaway loader-output inspector (removed before theming).
