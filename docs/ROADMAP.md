# Subfolio-Astro Roadmap

A port of [Subfolio](https://github.com/ryanilano/subfolio) from **Kohana 2.x / PHP 5.6**
(both long EOL) to an **Astro static site → Cloudflare Pages, hybrid-ready**. This is a
*port* that preserves the look and content conventions, not a redesign.

The deployment decision (Go binary → Astro static) and its rationale live in
[ADR-deployment.md](./ADR-deployment.md). The behavior being ported is captured,
stack-agnostic, in [spec/](./spec/).

## What carries over vs. gets rewritten

| Carries over ~as-is | Gets rewritten |
|---|---|
| SCSS/CSS, fonts, images, SVG icons | View *logic* (PHP views → Astro components) |
| `directory/` content + all naming conventions | The Kohana engine (`Filebrowser`/`Subfolio`/`Access`) → an Astro content loader |
| YAML config (settings/filekinds/users/groups) | YAML loading (Spyc → `yaml` npm lib) |
| URL structure / routes | Auth (custom salt → Web Crypto/`scrypt`, in the deferred Worker) |

The new app reads the *same* `directory/` content, so old PHP and new Astro can run
side-by-side against identical content for diffing. No data migration.

## Phases

- **Phase 0 — Capture the spec.** ✅ **DONE** (in the upstream `subfolio` repo). Behavior
  extracted from `Filebrowser.php`/`Subfolio.php`/`FileKind.php` into the stack-agnostic
  specs now mirrored in [spec/](./spec/).
- **Phase 1 — Astro content loader (de-risk first).** ✅ **DONE.** A custom Astro loader
  walks the content directory, interprets every naming convention (`-hidden`,
  `-t-`/`-m-`/`-b-` embeds, `.link`/`.cut`/`.pop`/`.ftr`/`.slide`/`.oplx`/`.rss`,
  `-properties`/`.info` YAML, retina/shadow variants) and emits typed entries. Validated
  against the bundled `content/examples/` fixture via a throwaway `/debug` route. Deferred
  behaviors (sharp thumbnails, RSS fetch, Textile/Markdown render, `-access` enforcement)
  are captured as **parsed intent** in the entries, not yet executed.
- **Phase 2 — Themes → Astro components.** ✅ **DONE.** Ported the `default` theme's layouts,
  listing views, and per-filekind views to Astro components consuming the loader's folder
  entries, with the existing SCSS/assets. Wired them into a catch-all route
  ([src/pages/[...path].astro](../src/pages/%5B...path%5D.astro)) that resolves folder/file/
  single/slide views like the PHP controller, plus a `/directory/<path>` raw-bytes endpoint;
  dropped the `/debug` route at cutover. Deferred behaviors (sharp dimensions, RSS fetch,
  Textile/MD body rendering, `-access`) remain captured as parsed intent. See
  [spec/SPEC-theme-api.md](./spec/SPEC-theme-api.md) and [spec/SPEC-filekinds.md](./spec/SPEC-filekinds.md).
- **Phase 3 — Build pipeline & deploy.** ✅ **DONE & LIVE.** `sharp` thumbnails at build
  (resize-if-stale per [spec/SPEC-thumbnails.md](./spec/SPEC-thumbnails.md)), RSS fetch at
  build, `sass`, sitemap; deployed to **Cloudflare Pages** (project `subfolio-astro`) via
  `wrangler pages deploy ./dist` (`npm run deploy`). Live at
  **<https://subfolio-astro.ilano.fyi>** (canonical custom domain) and
  **<https://subfolio-astro.pages.dev>**. Push-to-`main` auto-deploys via GitHub Actions
  ([.github/workflows/deploy.yml](../.github/workflows/deploy.yml), `cloudflare/wrangler-action`,
  `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` repo secrets). Diff side-by-side against the
  live PHP app on the same content.
- **Phase 4 — Auth Worker (deferred / optional).** *Only if* access-gated folders become a
  real requirement: a Cloudflare Worker for login, sessions (KV), `-access` evaluation, and
  gated file serving. Web Crypto/`scrypt` for hashing. See
  [spec/SPEC-auth.md](./spec/SPEC-auth.md) and [spec/SPEC-access.md](./spec/SPEC-access.md).
  **Skipped entirely until the need is real.** Until it exists, everything served is public.
- **Phase 5 — Enhancer polish.** ✅ **DONE.** **Markdown body rendering**
  (remark/unified, replacing the deferred Textile/MD intent — `.txt` detail views + `-t-/-m-
  /-b-` text embeds; default engine switched textile→markdown, fixture content converted);
  **`.pop` popups** verified working (`A17.Helpers.pop` in the bundled JS); **`.slide`**
  fixed (the redirect now emits the first file's detail page — was 404ing — plus prev/next
  stepping and the breadcrumb "HACK FOR SLIDE" parent-link port); **`.oplx` build-time zip
  artifacts** (pre-build `scripts/gen-oplx.mjs` zips each `.oplx` folder into an out-of-tree
  cache served at `/directory/<folder>.zip`, mirroring the thumbnail-cache pattern).

## Status

- [x] Phase 0 — Capture the spec
- [x] Phase 1 — Astro content loader
- [x] Phase 2 — Themes → Astro components
- [x] Phase 3 — Build pipeline & deploy (Cloudflare Pages + GitHub Actions CI; live)
- [ ] Phase 4 — Auth Worker (deferred / optional)
- [x] Phase 5 — Enhancer polish (Markdown + `.pop` + `.slide` + `.oplx` zip)

## Milestone 6 — Performance & build modernization (complete)

Post-port perf pass; port-fidelity constraint cut loose, **measure-don't-block** budget posture
(warn-only, never fail CI). Full task log + per-phase results live in
[DEEPSEEK-TASKS-perf.md](DEEPSEEK-TASKS-perf.md); approved plan in
[../plans/complete/milestone6-perf-build-modernization.md](../plans/complete/milestone6-perf-build-modernization.md).

- [x] Phase A — Measurement gate (perf-budget harness, ledger, baseline)
- [x] Phase B — Asset quick-wins (CSS minify, Inter font diet, lazy imgs, icons media-swap)
- [x] Phase C — Modern image formats (WebP/AVIF retina thumbnails; originals untouched)
- [x] Phase D — jQuery split + defer (non-blocking parse; `?v=` cache-bust)
- [x] Phase E — Head & SEO (Open Graph + Twitter Card + canonical; View Transitions flag, off)

| Metric | Before | After |
| --- | --- | --- |
| Font bytes shipped | 906.5 KB (5 formats × weights) | **47.3 KB** (Inter variable woff2) |
| CSS bytes (main + icons) | 93.5 KB unminified | **84.4 KB** minified, icons non-blocking |
| Linked JS (jQuery + A17) | 219.7 KB render-blocking | 219.7 KB **deferred** |
| Gallery thumbnails | PNG/JPEG only | **WebP/AVIF** retina (−64…−93%/preview) |
| Head/SEO | title only | **OG + Twitter + canonical**, absolute URLs |
| Largest per-page HTML | 13.4 KB | 13.5 KB (within 20 KB budget) |

Deliberately left out: jQuery vanilla rewrite, live View Transitions (flag wired, off),
Lighthouse scoring (measure-don't-block — no perf gate in CI).
