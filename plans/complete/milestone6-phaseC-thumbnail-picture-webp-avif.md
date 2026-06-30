# Milestone 6 · Phase C — Modern image formats (`<picture>` WebP/AVIF), constrained

## Context

Phase C of the perf milestone ships modern image formats. The original task spec
(`docs/DEEPSEEK-TASKS-perf.md`) proposed `<picture>` over **three** surfaces — gallery
thumbnails (Gate), feature cards (C1), and the detail view (C2). Two user constraints set
this session **narrow that scope and change the encode rules**:

1. **Originals stay original.** Only *derived previews* (auto-generated gallery thumbnails)
   may become WebP/AVIF. Full files that a visitor downloads or views at full resolution must
   remain untouched PNG/JPEG/GIF.
2. **Retina-sharp previews.** Thumbnail derivatives must carry enough pixels to render crisply
   on 2× (retina) displays while still being *laid out* at the 240px display height.

Consequence: the detail view (`Img.astro`) shows the **original full file** above its own
Download box → it must stay a plain `<img>` of the original (C2 dropped). Feature `.ftr`
images point at the **original** via `assetUrl()` and are hand-authored small assets → leave
as a plain `<img>` (C1 dropped, per user). **Only gallery thumbnails get `<picture>`.**

Pre-req already done this session: `main` fast-forwarded to `a7a71e2` (Phase B is now on the
fan-out base; `main == origin/main`).

## Scope split (Opus Gate vs. DeepSeek fan-out)

The user asked whether anything can still be farmed to DeepSeek. Yes — two genuinely disjoint
files. The coupled `<picture>`-shape work stays Opus (serialized, no merge conflicts); the
isolated encoder + a new test fan out.

### Opus Gate — serialize (coupled / hot files)
1. **`src/lib/thumbnailPipeline.ts`** — extend `ThumbnailResult` to carry a format set, not a
   single `url`. Add `sources?: { avif?: string; webp?: string }` alongside the existing
   `url` (the PNG/JPEG/GIF fallback, unchanged). Resolve each sibling in the cache
   (`<name>.avif` / `<name>.webp` next to the existing `<name>` under `-thumbnails/`), keep the
   `?rnd=<ctime>` cache-buster, suppress a format if its sibling isn't on disk. **Custom
   thumbnails (`-thumbnails-custom/`) are user-authored originals → keep single-`url`, no
   `<picture>`.** Only `kind: "auto"` gains sources.
2. **`src/components/listing/Gallery.astro`** — reference `<picture>` pattern. Wrap the
   existing `<img>` (both masonry and list/grid branches) in `<picture>` with
   `<source type="image/avif">` + `<source type="image/webp">` + the current `<img>` as
   fallback. Preserve `width`/`height` attrs, the `max-height`/shadow/browser inline styles,
   `loading="lazy"`, `decoding="async"` (zero-CLS, retina layout unchanged). Only emit
   `<source>`s when `thumb.kind === "auto"` and the sources exist; custom thumbs render the
   plain `<img>` as today.
3. **`src/pages/directory/[...path].ts`** — add `".avif": "image/webp"`… (correct:
   `"image/avif"`) to the `MIME` map so the cached `.avif`/`.webp` siblings serve with the
   right `Content-Type`. (`.webp` is already present.) The route walker already falls back to
   `cacheRoot`, so new sibling files register as static routes automatically.

### DeepSeek fan-out — disjoint (one file each)
- **`scripts/gen-thumbs.mjs`** · branch `perf/picture-thumbs` — after the existing
  `.resize(...).toFile(absThumb)`, also emit `absThumb + ".webp"` via `sharp(...).webp({quality})`
  and `absThumb + ".avif"` via `.avif({quality})`, from the **same resized pipeline**. Preserve
  staleness, the 1 MB size-guard, and the dimension/skip rules. **Retina:** change the resize
  *target* from display height (240) to **2× = 480** (and masonry width 320 → **640**), keeping
  `withoutEnlargement: true` so small sources aren't upscaled. Keep the skip threshold at the
  **display** height (`h <= THUMB_HEIGHT` i.e. 240) so already-small images still skip. Net: a
  tall source yields a 480px-tall derivative shown at 240 CSS px = crisp on retina.
- **`tests/picture.test.mjs`** · branch `perf/picture-test` — new test asserting: for a known
  fixture image, the cache holds `<name>`, `<name>.webp`, `<name>.avif`; the rendered gallery
  HTML contains `<picture>` with both `<source>` types and an `<img>` fallback whose `src` is
  the original-format thumbnail; originals under `/directory/` are still PNG/JPEG (no webp
  swap). Mirror the existing harness in `tests/perf.budget.test.mjs`.

## Verification (end-to-end)

```sh
# 1. regenerate cache with the new encoder (retina + webp/avif siblings)
npm run gen:thumbs    # or whatever package.json names the pre-build thumb pass
ls .thumb-cache/**/-thumbnails/    # expect <name>, <name>.webp, <name>.avif triples

# 2. build + serve, eyeball the gallery in a modern browser
npm run build && npm run preview
#   - gallery renders identically; DevTools Network shows .avif/.webp served for thumbs
#   - a thumbnail's intrinsic pixels ≈ 2× its CSS box (retina-sharp)
#   - detail view (open a .jpg/.png file page) still serves the ORIGINAL, plain <img>
#   - feature cards still serve originals
#   - Download box on the detail page links the untouched original bytes

# 3. perf delta + regression guards (astro build wipes dist/, so run perf immediately before test:perf)
npm run perf          # writes dist/perf-budget.json — image bytes should drop
npm run test:perf && npm run test && npm run test:a11y
#   (2 pre-existing smoke failures — markdown render + /directory bytes — are UNRELATED, don't chase)

# 4. render-review: grep dist/ for leftover {...} interpolation; a green build does NOT prove a render
```

## Per-merge ritual (don't forget)
- Render-review each merged branch (`npm run preview` + eyeball + grep `dist/` for `{`).
- Run `npm run ledger` after the fan-out → updates `docs/ledger-perf.json`.
- **Ledger caveat from Phase B:** the proxy flip did NOT route `claude -p` headless workers to
  DeepSeek (all 4 tasks billed Opus/anthropic, $2.33). Decide before launch: fix routing
  (see [[deepclaude-remap-silent-misroute]], upstream #39) or accept Phase C may bill Opus too.
- Close Phase C by appending a **Results block** to `docs/DEEPSEEK-TASKS-perf.md` (quant: image
  bytes before/after from `dist/perf-budget.json`, token/cost/backend split from the ledger;
  qual: render verdict + the originals-untouched confirmation) and update the scoreboard row
  "Image bytes (served gallery sample)".

## Out of scope (explicit, per user)
- No `<picture>` on the detail view (`Img.astro`) — it serves the original full file.
- No `<picture>` on feature cards (`Features.astro`) — originals, hand-sized.
- No format change to any downloadable/original byte. WebP/AVIF live ONLY in `.thumb-cache/`.
