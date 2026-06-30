# DeepSeek-Offloadable Tasks — Milestone 6 (Performance & Build Modernization)

Decomposition of the perf milestone (see [../plans/zippy-coalescing-rainbow.md](../plans/zippy-coalescing-rainbow.md))
into self-contained units that fan out conflict-free across the DeepSeek backend. Same shape as
the Phase-2 Wave ([DEEPSEEK-TASKS.md](./DEEPSEEK-TASKS.md)): Opus builds the Gate, DeepSeek
executes disjoint per-file tasks in parallel worktrees, Opus render-reviews the merges.

> **Per [AGENTS.md](../AGENTS.md): a green `astro build` does NOT prove a render.** Every merge
> gets a render-review: `npm run preview`, grep `dist/` for leftover `{...}` tokens, eyeball the
> page. The Astro `<style>`/`<script>` no-interpolation trap is the recurring footgun.

## How to use this

- **One branch per task**, branched off `main`. Branch names are listed per task and in
  [run-deepseek-perf.sh](./run-deepseek-perf.sh).
- **Each task brief is the prompt.** It names the **single file** the task may touch, the exact
  change, and the "done when" bar. Tasks are disjoint → merges are conflict-free in any order.
- **The Phase-A measurement Gate must be on `main` first** (`scripts/perf-budget.mjs`). The
  runner guards for it. Workers don't run it — they just make their one edit and commit.
- **Hot shared files are Opus-owned, never fanned out**: `src/layouts/Layout.astro`,
  `scripts/gen-css.mjs`, `scripts/gen-thumbs.mjs`, `src/lib/routing.ts`, and the reference
  `<picture>` component. They're listed here for context but executed by hand, serialized.

---

## Milestone scoreboard (before → after)

Baseline captured Phase A (`dist/perf-budget.json`, this session). `after` filled at milestone close.

| Metric | Before (Phase A baseline) | After |
|---|---|---|
| Per-page HTML weight (avg / largest) | 8.2 KB avg · 13.4 KB largest | |
| Inline per page (js + css) | ~1.7 KB js + ~2.9 KB css | |
| Linked JS (`main.js`, jQuery+A17) | 219.7 KB | |
| CSS bytes (`main.css` + `icons.css`) | 93.5 KB unminified | |
| Font bytes shipped (all weights × formats) | 906.5 KB (svg 573 · ttf 168 · woff 76 · eot 59 · woff2 30) | **47.3 KB** (Inter variable woff2, latin subset) ✅ |
| Image bytes (served gallery sample) | 85.5 MB png+jpg, no WebP/AVIF | **Thumbnails now WebP/AVIF** (−64…−93% per preview, e.g. 120→8 KB AVIF); originals untouched ✅ |
| Lighthouse perf (optional) | (not yet measured) | |
| Total token spend / cost | (ledger per phase) | |
| DeepSeek vs Anthropic task split | (ledger per phase) | |

> Note: the Phase-A harness corrected two plan-doc estimates — fonts are **906 KB** (not ~600;
> it counts *both* weights × *five* formats), and jQuery ships **external** at 219.7 KB (a real
> cached `<script src>`, not inlined into each HTML doc as the plan table guessed). The win is
> still real: kill the SVG/EOT/TTF formats, minify CSS, defer the JS, ship WebP/AVIF.

---

## Phase A — Measurement Gate ✅ (Opus, done this session)

Not a fan-out. Produced on `perf-milestone-a`:
- `scripts/perf-budget.mjs` — walks `dist/`, reports per-page-type HTML + inline weight, linked
  shared assets, fonts by format, images by ext, largest assets; writes `dist/perf-budget.json`.
  **Warn-only**, never exits non-zero. Skips dot-dirs (a `.git/` rode along in the served
  content tree).
- `tests/perf.budget.test.mjs` — asserts report shape + WARN-only budget rows.
- `scripts/ledger.mjs` — reads `claude -p --output-format json` results, writes
  `docs/ledger-perf.json` + a Markdown model/token/cost table; backend split via model id.
- `package.json` — `perf`, `test:perf`, `ledger` scripts.
- `docs/run-deepseek-perf.sh` — worktree-per-task runner with the perf-budget guard + JSON
  ledger tee.

---

## Phase B — Asset quick wins. Gated on Phase A. Mostly parallel.

Run: `./docs/run-deepseek-perf.sh B`. **B4 is Opus-owned** (hot `Layout.astro`) and runs by hand.

### B1 — CSS minify · branch `perf/css-minify` · file `scripts/gen-css.mjs`
Pass `minify: true` to the lightningcss `transform()` call in `compile()` (around line 96, the
`transform({ filename, code, targets })` object). That's the only change — add the one property.
lightningcss minifies (whitespace, longhand collapse) when the flag is set. Do not touch the
SVG/sass logic.
**Done when:** `node scripts/gen-css.mjs` runs clean and `public/css/main.css` is visibly smaller
(no newlines between rules). Expect ~20–30% off both CSS files.

### B2 — Font diet ✅ DONE (Opus, by hand — superseded the original brief)

Done early as part of a typeface swap to **Inter** (Google Fonts, self-hosted). Rather than
trim the Suisse 5-format set, the whole family was replaced: `src/styles/_typography.scss` now
declares one Inter `@font-face` pointing at `public/fonts/Inter-Variable-latin.woff2` — Inter v20
is a **variable font**, so a single 48 KB latin-subset woff2 covers the full 100–900 weight axis
(`font-weight: 100 900`), answering both body text and the 700 used for bold. All 9 Suisse files
deleted; `font-display: swap` set. **Result: fonts 906.5 KB → 47.3 KB.** (This also resolved the
latent missing-Regular-woff2 404 by removing Suisse entirely.)

### B3a — Lazy gallery images · branch `perf/lazy-gallery` · file `src/components/listing/Gallery.astro`
Add `loading="lazy"` and `decoding="async"` to the gallery `<img>` tag(s) (around lines 133 and
156 — there are two `<img` openings). Add the two attributes; change nothing else (keep
`width`/`height`, `src`, `class`, the inline style). These are below-the-fold thumbnails.
**Done when:** both `<img>`s carry `loading="lazy" decoding="async"`; no other edits.

### B3b — Lazy feature images · branch `perf/lazy-features` · file `src/components/listing/Features.astro`
Same change as B3a on the feature-card `<img>` (around line 53): add `loading="lazy"
decoding="async"`, nothing else.
**Done when:** the feature `<img>` carries both attributes.

### B3c — Lazy detail image (decoding only) · branch `perf/lazy-img` · file `src/components/filekinds/Img.astro`
The four `<img class="detailIMG">` tags (lines ~39–48) are the **primary above-the-fold content**
of a detail page — keep them EAGER (no `loading="lazy"`). Add only `decoding="async"` to each of
the four. Do **not** add `loading="lazy"` here (it would delay the main subject).
**Done when:** all four `detailIMG` tags carry `decoding="async"` and none has `loading="lazy"`.

### B4 — Font preload + native-async icons.css · `src/layouts/Layout.astro` · **OPUS, not fanned out**

Font preload **already done** with the Inter swap (`<link rel="preload" as="font" type="font/woff2"
crossorigin href="/fonts/Inter-Variable-latin.woff2">` is in `<head>`). **Remaining:** replace the
`A17.loadCSS("/css/icons.css")` JS-polyfill `<script>` with a native
`<link rel="stylesheet" href="/css/icons.css?v=2" media="print" onload="this.media='all'">` +
`<noscript>` fallback. Keep the A17 bootstrap script (browserSpec/touch detection) — only the
`loadCSS` icons call is replaced.
**Done when:** no `A17.loadCSS` call remains; icons.css loads via native async; render-review
confirms icons still render.

**Phase B done when:** `npm run perf` shows CSS + font bytes dropped vs. Phase-A baseline; pages
render identically (render-review Gallery, a detail page, the font swap); `npm run test` +
`npm run test:a11y` green.

---

## Phase C — Modern image formats. Gated on the Opus `<picture>` Gate.

> **Scope constraint (set this session):** WebP/AVIF apply ONLY to *derived previews*
> (auto-generated gallery thumbnails). Originals a visitor downloads or views at full
> resolution stay untouched PNG/JPEG/GIF. So the original C1 (Features `<picture>`) and C2
> (Detail `<picture>`) were **DROPPED** — those surfaces serve originals. The remaining
> fan-out is the encoder + a test. Plan: `plans/elegant-coalescing-bee.md`.

### Gate (Opus — DONE, on `main` at `c155e8f`)
- `src/lib/thumbnailPipeline.ts` — `ThumbnailResult.sources?: { avif?, webp? }`, resolved from
  cache siblings (`<name>.webp` / `<name>.avif`), **auto thumbs only** (custom thumbs are
  user originals → single `url`, no sources). Shares the `?rnd=<ctime>` cache-buster.
  *(Note: the thumbnail URL helper lives in `thumbnailPipeline.ts`, NOT `routing.ts` as the
  old draft said — `routing.ts` only has `assetUrl`/`pageUrl`.)*
- `src/components/listing/Gallery.astro` — `<picture>` with `<source type="image/avif">` +
  `<source type="image/webp">` + the existing `<img>` fallback, both masonry and list/grid
  branches; `width`/`height`/`loading`/`decoding` preserved (zero-CLS). Reference pattern.
- `src/pages/directory/[...path].ts` — `.avif` MIME added (`.webp` already present); the route
  walker already traverses `.thumb-cache/`, so siblings register as static routes.

### C1 — Thumbnail encoder · branch `perf/picture-thumbs` · file `scripts/gen-thumbs.mjs`
After the existing `.resize(resizeOpts).toFile(absThumb)`, ALSO write two siblings **from the
same resized pipeline**: `sharp(absSource).resize(resizeOpts).webp({ quality: 80 }).toFile(absThumb + ".webp")`
and `.avif({ quality: 55 }).toFile(absThumb + ".avif")`. Keep the staleness check, the 1 MB
size-guard, and the skip rules — apply the SAME staleness/skip decision to the siblings (if the
base is `fresh`, the siblings are too; if the source skips, no siblings).
**Retina (this session's 2nd constraint):** raise the resize *target* to 2× so previews are
crisp on retina while still laid out at the 240px display height. Change `THUMB_HEIGHT`-based
resize from `height: 240` → `height: 480`, and masonry `width: 320` → `width: 640`. Keep
`withoutEnlargement: true` (never upscale a small source). Keep the **skip** threshold at the
display height (`h <= THUMB_HEIGHT`, i.e. 240) so already-small images still skip.
**Done when:** `.thumb-cache/**/-thumbnails/` holds `<name>`, `<name>.webp`, `<name>.avif`
triples; a tall source's base thumb is ~480px tall; small sources still skip.

### C2 — Picture test · branch `perf/picture-test` · file `tests/picture.test.mjs` (NEW)
New `node --test` file, mirroring `tests/perf.budget.test.mjs`. Assert: (a) after
`gen-thumbs.mjs` runs, a known fixture image has all three cache files (`<name>`/`.webp`/`.avif`);
(b) the built gallery HTML (`dist/`) contains `<picture>` with `type="image/avif"` and
`type="image/webp"` `<source>`s and an `<img>` fallback whose `src` is the original-format
thumbnail (not `.webp`); (c) originals served under `/directory/` keep their PNG/JPEG bytes —
no webp swap. Lenient like the rest of the suite.
**Done when:** `node --test tests/picture.test.mjs` passes against a fresh build.

**Phase C done when:** `.thumb-cache/` holds WebP/AVIF triples; `/directory/` serves them
(generated in the pre-build pass — see [memory: astro-two-phase-build-ordering]); `npm run perf`
shows image bytes down; Gallery visually identical in a modern browser, PNG/JPEG fallback still
served; **originals (detail view, feature cards, downloads) verified unchanged**.

---

## Phases D & E — Opus-owned, not fanned out

- **D (jQuery split + defer):** `Layout.astro` — make the end-of-body `<script src="/js/main.js">`
  external + `defer` + `?v=` cache-bust (it's already external; add `defer`, drop `is:inline`).
  Smoke `.pop` popups, masonry, `.slide` stepping, search on the fixture.
- **E (head/SEO):** `Layout.astro` — Open Graph + Twitter Card meta from the folder entry
  (gallery's first thumbnail as `og:image`); optional `ClientRouter` behind a flag.

---

## Results blocks

Each phase closes by appending a results block (numbers from `dist/perf-budget.json` +
`docs/ledger-perf.json`, not hand-tallied):

```
### Phase X — Results
Quantitative:
- Perf delta (vs. baseline): HTML __→__, CSS __→__, fonts __→__, images __→__
- Cost: $__ total; tokens __ in / __ out; backends — DeepSeek __ tasks, Anthropic __ tasks
Qualitative:
- What changed; render-review verdict (pages checked, `{...}` grep clean? behaviors verified?)
- Risk / follow-ups
```

---

### Phase C — Results

**Quantitative:**
- **Per-thumbnail served bytes** (gallery previews, browser picks best format):
  - `example.png` thumb: **120.4 KB → 8.0 KB AVIF** (−93%) / 12.0 KB WebP
  - `example.jpg` thumb: **11.1 KB → 4.0 KB AVIF** (−64%) / 5.4 KB WebP
  - `example.gif` thumb: **16.8 KB → 4.2 KB AVIF** (−75%) / 6.6 KB WebP
- Derived-preview formats now in build: AVIF 31.7 KB + WebP 47.1 KB total (these are
  *additive* cache siblings; the browser fetches ONE per thumbnail, not the original-format one).
- **Originals unchanged:** png 50.4 MB + jpg 31.7 MB of source/downloadable bytes untouched
  (constraint #1 — verified by magic-byte test + `find` shows zero `.avif`/`.webp` outside
  `-thumbnails/`).
- Retina: thumbnail resize target doubled to 480px tall / 640px wide (masonry), laid out at
  240px → 2× crisp; `withoutEnlargement` keeps small sources from upscaling.
- Budgets all green: css-total 84.4/96 KB, fonts 47.3/620 KB, html-page-max 13/20 KB,
  js-linked 219.7/240 KB.
- **Cost (proxy truth):** DeepSeek **17 requests, $0.0829 actual** vs $0.6984 Anthropic-equiv
  (**saved $0.6155**); 159,390 in / 14,686 out tokens; backends — **DeepSeek 2 tasks, Anthropic 0**.
  (The local `claude -p` envelope mislabels these as opus/$1.56 — the Phase-B ledger fix now
  reports the proxy truth alongside it. The tiering worked this phase.)

**Qualitative:**
- **What changed:** Gallery thumbnails emit `<picture>` (avif→webp→original `<img>` fallback)
  in both masonry and list/grid branches; `gen-thumbs.mjs` writes webp(q80)+avif(q55) siblings
  from the same retina resize; `.avif` MIME added; new `tests/picture.test.mjs` (5/5).
- **Render-review:** built `dist/00_thumbnails/index.html` — `<picture>` markup correct, fallback
  `<img src>` is original-format thumbnail (not `.webp`/`.avif`), `width`/`height`/`loading`/
  `decoding`/`max-height` all preserved (zero-CLS). `grep dist/ for '{'` clean (no leftover
  interpolation). Served original confirmed PNG by magic bytes.
- **Scope cut:** original C1 (Features) / C2 (Detail) `<picture>` DROPPED — those serve
  originals. Phase C = derived gallery previews only.
- **Risk / follow-ups:** test suite back to the 2 known pre-existing failures (`/directory`
  bytes + markdown render); fixed a 3rd that B1's CSS-minify had silently broken (aspect-ratio
  guard regex). AVIF encode adds build time (q55) but cache is incremental (staleness-gated).
