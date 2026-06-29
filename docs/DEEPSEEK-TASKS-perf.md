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
| Font bytes shipped (all weights × formats) | 906.5 KB (svg 573 · ttf 168 · woff 76 · eot 59 · woff2 30) | |
| Image bytes (served gallery sample) | 85.5 MB png+jpg, no WebP/AVIF | |
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

### B2 — Font diet · branch `perf/font-diet` · file `src/styles/_typography.scss` (+ delete dead font files)
In **both** `@font-face` blocks, drop the `eot`, `ttf`, and `svg` `src` entries; keep only
`woff2` then `woff`. Add `font-display: swap;` to each block.
**CRITICAL — the Regular weight has NO `.woff2` file** (`public/fonts/` has
`SuisseIntl-Regular-WebXL.woff/.ttf/.eot/.svg` but no `.woff2`; the current SCSS references a
woff2 that 404s silently). So for the **Regular** block, keep `woff` only (or both if a woff2 is
added); for the **Medium** block keep `woff2` + `woff`. Do not invent a file that isn't there.
Then **delete the now-unused font files** from `public/fonts/`: all `*.eot`, all `*.svg`, all
`*.ttf` (six files). Leave the woff/woff2 that remain referenced.
**Done when:** `git status` shows the six dead font files deleted; `_typography.scss` references
only files that exist on disk; each block has `font-display: swap`. This kills ~573 KB SVG +
~168 KB TTF + ~59 KB EOT ≈ 800 KB.

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
In `<head>`: add `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the woff2
that actually exist (Medium woff2 today; Regular only if B2 adds one — do not preload a missing
file). Replace the `A17.loadCSS("/css/icons.css")` JS-polyfill `<script>` with a native
`<link rel="stylesheet" href="/css/icons.css?v=2" media="print" onload="this.media='all'">` +
`<noscript>` fallback. Keep the A17 bootstrap script (browserSpec/touch detection) — only the
`loadCSS` icons call is replaced.
**Done when:** no `A17.loadCSS` call remains; icons.css loads via native async; woff2 preload
present and points only at existing files; render-review confirms icons still render.

**Phase B done when:** `npm run perf` shows CSS + font bytes dropped vs. Phase-A baseline; pages
render identically (render-review Gallery, a detail page, the font swap); `npm run test` +
`npm run test:a11y` green.

---

## Phase C — Modern image formats. Gated on the Opus `<picture>` Gate.

### Gate (Opus, by hand — NOT fanned out)
- `scripts/gen-thumbs.mjs` — emit WebP (and optionally AVIF) siblings via
  `sharp(...).webp({ quality })` / `.avif(...)` into `.thumb-cache/`, preserving the existing
  staleness + size-guard + dimension rules.
- `src/lib/routing.ts` — extend `thumbnailFor()` (or add a helper) to return the WebP/AVIF URL
  set, not just one `url`.
- **Reference component `src/components/listing/Gallery.astro`** — emit `<picture>` with
  `<source type="image/avif">` + `<source type="image/webp">` + `<img>` fallback, `width`/`height`
  preserved (zero-CLS). Pin this as the pattern.

### C1 — Features `<picture>` · branch `perf/picture-features` · file `src/components/listing/Features.astro`
Mirror the Gallery `<picture>` Gate: wrap the feature `<img>` in `<picture>` with avif+webp
`<source>`s and the `<img>` fallback, using the same routing helper. Keep `width`/`height` and
the lazy attributes B3b added.
**Done when:** feature thumbnails emit `<picture>`, fallback `<img>` intact.

### C2 — Detail `<picture>` · branch `perf/picture-img` · file `src/components/filekinds/Img.astro`
Mirror the Gate for the retina-aware detail variants. Preserve the `width`/`height` math (incl.
the `/2` retina case) and `decoding="async"`.
**Done when:** detail image emits `<picture>` with modern sources + original fallback.

**Phase C done when:** `.thumb-cache/` holds WebP/AVIF; `/directory/` serves them (generate in
the pre-build pass — see [memory: astro-two-phase-build-ordering]); `npm run perf` shows image
bytes down; Gallery visually identical in a modern browser, JPEG/PNG fallback still served.

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
