# Phase 3 — RSS fetch at build

## Context

Phase 3's build pipeline is mostly landed and pushed (`a47f20d`: thumbnails, image
metadata, sitemap, sass). Two slices remain on the roadmap (ROADMAP.md:43): **RSS
fetch at build** and **Cloudflare Pages deploy**. This plan covers RSS only — the
deploy is outward-facing, gated on the Cloudflare account, and belongs in a separate
step.

Today RSS is captured as *parsed intent* only. The loader records `{feedurl, count,
cache}` for `.rss` files ([embeds.ts:49-58](src/loaders/embeds.ts), and
[fileHelpers.ts:214-216](src/lib/fileHelpers.ts) stubs them as `""`/`10`/`3600`), but
the feed is never fetched. Both render surfaces are stubbed empty:
[InlineEmbeds.astro](src/components/listing/InlineEmbeds.astro) emits an empty
`<ul class="rss">`, and [Rss.astro](src/components/filekinds/Rss.astro) takes an
`items` prop that nothing ever populates. This mirrors the PHP engine's
`SubfolioFiles::fetch_rss()` (Subfolio.php:1535-1579) which is still deferred.

Goal: fetch + parse each feed at build time into a persistent, TTL-honoring cache
(out of tree, like the thumbnail cache), then render real items — restoring parity
with the PHP `_inline_rss.php` / `rss.php` views.

**Reachability note:** the fixture's `content/examples/05 display rss feed/rss-enhancer.rss`
has no `-t-/-m-/-b-` prefix, so it's neither a position embed nor (currently) a detail
page — `.rss` carries `enhancer="rss"` and [getStaticPaths skips enhancer files](src/pages/%5B...path%5D.astro#L78).
The plan makes standalone `.rss` files reachable as detail pages so the work is
verifiable against the fixture.

## Approach

Mirror the established **pre-build pass → gitignored cache → read at render** pattern
from `scripts/gen-thumbs.mjs` + `src/lib/imageMeta.ts`. RSS adds network I/O, so the
fetch must run in the pre-build script (never lazily at render — see the two-phase
build ordering note in memory), and the cache must persist across builds to honor the
`cache:` TTL the way PHP's `-<name>.cache` did.

Use **rss-parser** (new dep) for RSS 2.0 + Atom parsing — closest to PHP's
`feed::parse()`.

### 1. Dependency

- `npm install rss-parser` (runtime dep; the pre-build script and any render reader
  both run under Node at build time).

### 2. Build-time fetch + cache — `scripts/gen-rss.mjs` (new)

Model on [gen-thumbs.mjs](scripts/gen-thumbs.mjs):

- Walk `contentRoot` (`SUBFOLIO_CONTENT_DIR` ?? `./content/examples`) for `.rss` files
  (both position-prefixed and standalone). Reuse the YAML read via `parseSubfolioYaml`
  /`asNumber` — or inline a minimal YAML read to keep the script dependency-light like
  gen-thumbs does (gen-thumbs imports nothing from src). **Decision: inline-parse the
  three fields** (`feedurl`, `count`, `cache`) with the `yaml` lib directly, matching
  gen-thumbs' self-contained style.
- Cache dir: `.rss-cache/` (gitignored), resolved from `SUBFOLIO_RSS_CACHE` ?? that
  default. **Never write into `SUBFOLIO_CONTENT_DIR`** (same rule as the thumb cache).
- Cache key: a stable hash of `feedurl` (e.g. `crypto.createHash('sha1')`), file
  `.rss-cache/<hash>.json` holding `{ feedurl, fetchedAt, items: RssItem[] }`.
- Staleness: if `Date.now() - fetchedAt < cache*1000`, skip (fresh). Else fetch via
  `new Parser().parseURL(feedurl)`, map to `{ title, description, link }` (the shape
  [Rss.astro's RssItem](src/components/filekinds/Rss.astro#L12) already expects),
  truncate to `count`, write JSON.
- **Lenient / offline-safe**: on fetch failure, keep any existing stale cache (don't
  clobber); if none exists, write `{ items: [] }`. One bad/unreachable feed must not
  break the build — same posture as the rest of the loader. Log a one-line summary
  (`N feeds → X fetched, Y fresh, Z failed`).

### 3. Render-time reader — `src/lib/rssFeed.ts` (new)

Model on [imageMeta.ts](src/lib/imageMeta.ts) (sync, lenient, in-build memo):

- `rssItemsFor(feedurl: string, count = 10): RssItem[]` — hash the url, sync-read
  `.rss-cache/<hash>.json`, return `items.slice(0, count)`; return `[]` on any miss.
- Export the `RssItem` type here as the single source of truth; have Rss.astro import
  it from here instead of re-declaring it.

### 4. Wire the two render surfaces

- **Inline embeds** ([InlineEmbeds.astro](src/components/listing/InlineEmbeds.astro)):
  replace the empty-`<ul>` stub. For each rss embed, call `rssItemsFor(embed.feedurl,
  embed.count)` and render `<li class="standard_paragraph item">` items mirroring the
  Rss.astro markup (parity with `_inline_rss.php`).
- **Detail view** ([Rss.astro](src/components/filekinds/Rss.astro)): import `RssItem`
  from `rssFeed.ts`. Items are passed in by the route (next step).
- **fileHelpers** ([fileHelpers.ts:214-216](src/lib/fileHelpers.ts)): populate
  `feedurl`/`count`/`cache` from the `.rss` file's parsed YAML instead of the
  `""`/`10`/`3600` stubs (parse the file body in `buildFileViewData` when
  `file.kind === "rss"`, reusing `parseSubfolioYaml`).

### 5. Make standalone `.rss` reachable + pass items — `src/pages/[...path].astro`

- In `getStaticPaths()`, allow `enhancer === "rss"` files through the detail-route loop
  ([currently skipped at line 78](src/pages/%5B...path%5D.astro#L78)) — change the
  guard to skip only `link`/`pop` (the listing-anchor enhancers), not `rss`. This gives
  `rss-enhancer.rss` a real detail page.
- In the `kind === "file"` branch, when `fileView.kind === "rss"`, compute
  `const rssItems = rssItemsFor(fileView.feedurl, fileView.count)` and pass it to the
  detail component. `<DetailComponent file={fileView} />` → conditionally
  `items={rssItems}` (only Rss.astro consumes it; other filekind components ignore an
  extra prop, but to stay clean, branch: render `<Rss>` with items when kind is rss,
  else the generic `<DetailComponent>`).

### 6. Pipeline + ignore wiring

- [package.json](package.json): add `gen-rss` script and prepend
  `node scripts/gen-rss.mjs` to `dev`, `start`, and `build` (after gen-thumbs/gen-css,
  before astro). Add a standalone `"gen-rss": "node scripts/gen-rss.mjs"`.
- [.gitignore](.gitignore): add `.rss-cache/` with a comment, alongside `.thumb-cache/`.

## Files

| File | Change |
|---|---|
| `package.json` | add rss-parser dep; add `gen-rss` to dev/start/build chains |
| `.gitignore` | ignore `.rss-cache/` |
| `scripts/gen-rss.mjs` | **new** — build-time fetch + TTL cache (mirrors gen-thumbs.mjs) |
| `src/lib/rssFeed.ts` | **new** — sync cache reader + `RssItem` type (mirrors imageMeta.ts) |
| `src/components/listing/InlineEmbeds.astro` | render fetched rss items |
| `src/components/filekinds/Rss.astro` | import `RssItem` from rssFeed.ts |
| `src/lib/fileHelpers.ts` | populate `feedurl`/`count`/`cache` from the `.rss` YAML |
| `src/pages/[...path].astro` | let `.rss` files get detail routes; pass items to Rss |

## Verification

1. **Offline-safe build first.** `npm run build` with no network (or an unreachable
   feed) must succeed — gen-rss logs failures, writes `{ items: [] }`, build is green.
   Confirms leniency.
2. **Live fetch.** `npm run gen-rss` once with network; inspect `.rss-cache/<hash>.json`
   — should hold real `{ title, description, link }` items from the fixture feed
   (`http://feeds.feedburner.com/area17/news`; if that feedburner URL is dead, swap the
   fixture's `feedurl` to a known-good feed for the test only, then revert).
3. **Render.** `npm run dev`, browse `/05 display rss feed/rss-enhancer` — the detail
   page renders `<ul class="rss">` with real `<h4>`/`<p>`/Read-more items. Add a
   temporary `-t-test.rss` (position-prefixed) to that folder to also exercise the
   inline-embed path on the listing page, then remove it.
4. **TTL.** Re-run `npm run gen-rss` immediately → log shows the feed as "fresh"
   (skipped), proving the `cache:` TTL is honored across runs.
5. **Types.** `astro check` clean (part of `npm run build`).
6. **No content mutation.** Confirm nothing was written under `content/examples/`
   (cache lives only in `.rss-cache/`).

## Out of scope / follow-ups

- Cloudflare Pages deploy (the other open Phase 3 slice) — separate step, needs CF
  account + wrangler auth.
- Squash the RSS commits before pushing (per the per-phase squash convention), then
  push.
