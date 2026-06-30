# Plan — High-quality WebP for `-t-`/`-m-`/`-b-` embed banners

## Context

The Milestone-6 perf scoreboard, re-run against **live content** (888 pages, not the
fixture), shows the remaining byte weight is almost entirely **original PNG/JPGs**: 103 MB
of 112 MB total. The ten largest single assets are all position-prefixed **embed banners**
(`-t-…png`, `-m-…png`) at 1–2 MB each, e.g. `flavorwire/-t-01-flavorwire.png` (2.0 MB).

These embeds are *presentation* images — banners composited into the top/middle/bottom of a
folder listing page — **not** downloadable originals a visitor saves. The perf milestone
deliberately left "originals" untouched, but embeds aren't really originals; they're
directory chrome. So they're the right place to apply modern compression. The user asked for
**high-quality WebP** specifically.

Decisions locked with the user:
- **WebP only** (no AVIF sibling). One high-quality WebP per embed; original PNG/JPG kept as
  `<picture>` fallback.
- **Keep full resolution** — no downscaling. Savings come purely from PNG→WebP re-encode
  (~50–75% typical) at high quality, preserving native pixel dimensions and fidelity.
- **Hidden folders not worth special-casing.** Folders prefixed `-` (`-archive`, `-archived`,
  `-old0613`) are hidden from listings; their pages are built but orphaned (unlinked). The
  encoder will convert *all* position-prefixed embeds uniformly — the handful in hidden
  folders are cheap and adding folder-visibility logic to a build script isn't worth it.

Outcome: listing pages that carry big embed banners drop ~1–1.5 MB each on first paint, with
no visible quality change and originals still served byte-for-byte for anyone who wants them.

## Approach

Mirror the existing **`gen-thumbs.mjs` → `.thumb-cache/` → `<picture>` in component** pipeline
exactly, but for embeds and WebP-only. Three changes, all following established patterns.

### 1. New pre-build script: `scripts/gen-embeds.mjs`

Structurally a clone of [scripts/gen-thumbs.mjs](scripts/gen-thumbs.mjs) (same env-var
resolution, recursive walk, staleness check, summary log). Differences:

- **Target set**: only files whose basename matches a position prefix `-t-`/`-m-`/`-b-` AND
  whose extension is a raster image (`.png/.jpg/.jpeg`). Reuse `positionOf()` from
  [src/loaders/conventions.ts](src/loaders/conventions.ts#L49) for the prefix test. Skip
  `.gif` (animation would be lost) and skip files already `.webp`.
- **Cache root**: new `SUBFOLIO_EMBED_CACHE ?? "./.embed-cache"`, layout mirrors content
  (`<relPath>.webp` next to where the source sits, e.g.
  `.embed-cache/flavorwire/-t-01-flavorwire.png.webp`). The `.png.webp` suffix convention
  matches gen-thumbs' sibling naming exactly.
- **Encode**: `sharp(absSource).webp({ quality: 90, effort: 6 }).toFile(dest)` — **no
  `.resize()`** (full resolution per the locked decision). Quality 90 = high; gallery thumbs
  use 80, embeds get the higher bar since they're hero imagery.
- **Staleness**: same `mtime` check as gen-thumbs (skip if `<name>.png.webp` newer than
  source). **No 1 MB size-guard** — the whole point is the big files; instead keep
  `withoutEnlargement` moot (no resize) and just guard against unreadable images via the
  `sharp().metadata()` try/catch.

Export `cacheRoot` so the serving route can import it (same as gen-thumbs/gen-oplx do).

### 2. Wire the script into the build pipeline + gitignore

- [package.json](package.json#L11-L13): add `node scripts/gen-embeds.mjs &&` into the `dev`,
  `start`, and `build` script chains (alongside `gen-thumbs`/`gen-rss`/`gen-oplx`). Add a
  standalone `"gen-embeds": "node scripts/gen-embeds.mjs"` for manual runs.
- [.gitignore](.gitignore): add `.embed-cache/` (matching the other three cache entries).

### 3. Serve the cache + render `<picture>`

**Serving** — [src/pages/directory/[...path].ts](src/pages/directory/[...path].ts): the route
already unions multiple cache roots into `getStaticPaths()` and falls back through them in
`GET`. Add `embedCacheRoot` as a fourth root exactly like `oplxCacheRoot`:
- import/resolve `SUBFOLIO_EMBED_CACHE`,
- `walkFiles(embedCacheRoot, …)` into the path set in `getStaticPaths()`,
- add the `readFileSync(absEmbed)` fallback link in the `GET` try-chain.
`.webp` MIME is already in the `MIME` map (line 42) — no change needed there.

**Rendering** — [src/components/listing/InlineEmbeds.astro](src/components/listing/InlineEmbeds.astro#L42-L51):
replace the bare `<img src={assetUrl(image.src)}>` with a `<picture>`:

```astro
<picture>
  <source type="image/webp" srcset={assetUrl(image.src + ".webp")} />
  <img src={assetUrl(image.src)} alt="" />
</picture>
```

This mirrors the gallery `<picture>` in [Gallery.astro](src/components/listing/Gallery.astro)
(AVIF/WebP source + `<img>` fallback). The browser picks WebP when supported, falls back to
the original PNG/JPG otherwise. `assetUrl()` already routes `<src>.webp` to
`/directory/<src>.webp`, which the serving change above resolves from `.embed-cache/`.

> **Astro interpolation trap** (see memory `astro-no-interpolation-in-style-and-script`): the
> `<source>`/`<img>` here are real template markup, so `{…}` interpolates fine — this is JSX,
> not a `<style>`/`<script>` block. No `set:html` needed. Confirm at render-review that no
> literal `{assetUrl(...)}` string leaks into `dist/`.

### Whether the `.webp` always exists

`gen-embeds.mjs` skips `.gif` embeds and any image sharp can't read, so a `.webp` sibling may
not exist for every embed. Options considered: (a) always emit `<source>` and let the browser
fall back if the URL 404s — wasteful, and a 404 `<source>` is ignored gracefully but noisy;
(b) only emit `<source>` when the sibling exists. **Recommend (b)** for correctness, but it
requires the component to know which embeds got a webp. Cleanest: have the loader record a
`hasWebp` boolean on image embeds.

That pulls in a fourth touch-point. Two sub-approaches:
- **Loader-checks-disk (preferred):** in [src/loaders/index.ts](src/loaders/index.ts#L161)'s
  existing async enrichment pass (already does `sharp().metadata()` on feature images), stat
  the embed-cache sibling and set `embed.hasWebp`. Add the optional field to the `embedImg`
  schema in [src/loaders/schema.ts](src/loaders/schema.ts#L24). Component emits `<source>`
  only when `image.hasWebp`.
- **Component-stat fallback:** not possible — Astro components can't stat the cache cleanly at
  render. So the loader is the right home.

This keeps the `<picture>` honest: WebP `<source>` appears only for embeds that actually have
one; `.gif` and unreadable embeds render an unchanged `<img>`.

## Files touched

| File | Change |
|---|---|
| `scripts/gen-embeds.mjs` | **new** — WebP encoder for position-prefixed embeds |
| `package.json` | add `gen-embeds` to dev/start/build chains + standalone script |
| `.gitignore` | add `.embed-cache/` |
| `src/pages/directory/[...path].ts` | add embed-cache as 4th serving root |
| `src/loaders/schema.ts` | add optional `hasWebp` to `embedImg` |
| `src/loaders/index.ts` | stat webp sibling in the enrichment pass, set `hasWebp` |
| `src/components/listing/InlineEmbeds.astro` | `<img>` → conditional `<picture>` + webp `<source>` |

## Verification

1. **Encode runs clean**: `./dev-content.sh build` (or `SUBFOLIO_CONTENT_DIR=… npm run build`)
   — confirm `gen-embeds` logs a non-zero "created" count and `.embed-cache/` holds
   `<…>.png.webp` siblings for the big banners (e.g. `flavorwire/-t-01-flavorwire.png.webp`).
2. **Size win**: `node scripts/perf-budget.mjs` against the live `dist/` (the env-promoted way
   we ran it this session — NOT `npm run perf`, which rebuilds the fixture). Expect a new
   `webp` row reflecting embed bytes and confirm the originals' `png` total is unchanged
   (originals untouched). Spot-check: `ls -la` an original vs its `.webp` to see the ~50–75% drop.
3. **Render-review** (a green build doesn't prove a render — see `AGENTS.md`):
   `./dev-content.sh preview`, open a folder with a top embed (e.g. `/flavorwire`), and:
   - DevTools Network: the embed loads the `.webp` (not the `.png`) in a modern browser;
   - `grep -r "{assetUrl" dist/` is clean (no leaked interpolation);
   - the banner looks visually identical (high quality, full resolution).
4. **Fallback intact**: confirm a `.gif` embed (if any) or a hidden-folder embed still renders
   a plain `<img>` with the original, and the original is still byte-served under `/directory/`.
5. **Gates green**: `npm run test` + `npm run test:a11y` (and `npm run test:perf` if present)
   still pass.

## Risk / follow-ups

- **Quality 90 is a starting point.** If any banner shows artifacts, bump to 95 or lossless
  (`webp({ lossless: true })`) for that tier — but 90 is visually transparent for typical
  web banners and still ~50%+ smaller than PNG.
- **Build time**: full-res WebP at `effort: 6` on 1–2 MB PNGs is slower than thumbnailing.
  The staleness cache means it's a one-time cost per image; if the cold build gets slow,
  drop to `effort: 4`.
- **Out of scope**: AVIF, downscaling, and any change to gallery thumbnails or to true
  downloadable originals. Those stay as-is per the locked decisions.
