# DeepSeek-Offloadable Tasks — Structural smoke-test suite

A second fan-out wave (the first, [DEEPSEEK-TASKS.md](./DEEPSEEK-TASKS.md), ported the Phase-2
theme components and is complete). This wave fills the repo's biggest gap: **there are no
automated tests.** It turns the manual checklist in [TESTING.md](./TESTING.md) into a
**structural** suite that asserts against the static build (`dist/`) — grep-on-HTML, not
eyeballs — so a headless worker can self-verify.

## Why this is a good DeepSeek fit

- **Mechanical & verifiable.** Each task writes assertions against already-built HTML and
  proves itself with `npm run build && npm run test`. No design judgment.
- **Conflict-free.** Every task creates ONE new `tests/smoke.*.test.mjs` file. Disjoint files
  merge in any order, in parallel — same shape as the first wave.
- **Gated.** The harness + reference test (the Gate, below) is built in Opus first, so every
  worker has a working pattern to mirror.

## How to use this

- **One branch per task** (name given per task), branched off `main`.
- **Each task brief is the prompt.** It says what to read, what to produce, and the done-when bar.
- **Mirror the reference test** `tests/smoke.routes.test.mjs` — same imports (`node:test`,
  `node:assert/strict`, `./_dist.mjs` helpers), same "build then assert dist/" shape.
- **Discover exact markers by building first.** Run `npm run build`, then `grep` the relevant
  `dist/<route>/index.html` to find the precise class/tag/href to assert on. A few verified
  anchors are seeded per task; confirm them and add more from what you find.
- **Assert on stable structure**, not brittle whitespace/byte counts. Prefer presence of a
  class, tag, or href substring.
- **Do NOT touch** `tests/_dist.mjs`, `tests/smoke.routes.test.mjs`, `package.json`, or any
  other task's file. Only add your one new test file.

---

## Gate — test harness + reference test (built in Opus, already on main)

**Produces (do not rebuild — these exist):**
1. `tests/_dist.mjs` — shared helpers: `pageExists(route)`, `page(route)` (reads
   `dist/<route>/index.html`; `""` = root; spaces literal), `distFile(rel)` (any file under
   `dist/`).
2. `tests/smoke.routes.test.mjs` — REFERENCE test: every fixture route is built; `-hidden`
   omitted from root listing; gallery `width:auto` regression guard. **Mirror its structure.**
3. `package.json` `"test": "node --test tests/*.test.mjs"`.

**Verify the gate before fanning out:** `npm run build && npm run test` → 3 passing tests.

---

## Wave — one new test file per task. Conflict-free, parallel.

> Run `npm run build` once in your worktree before writing assertions, then iterate with
> `npm run test`. Your done-when bar is: **`npm run build && npm run test` passes with your new
> file, and you have NOT broken the existing tests.**

### ST1 — Listing partials & embeds  ·  branch `test/smoke-listing`
**Produce:** `tests/smoke.listing.test.mjs`
**Read:** `src/components/listing/Listing.astro` (the 7-partial order: top embeds → features →
gallery → middle embeds → files/folders → related → bottom embeds), `src/components/listing/InlineEmbeds.astro`.
**Assert (verified anchors — confirm by grepping dist, add more):**
- Root page (`page("")`) contains the top intro embed text and the `-b-footer.txt` bottom embed.
- `01_embedding_text_images` page has all three embed positions present — top text+image,
  middle text+image, bottom text+image. (Anchor: top text renders inside `id="inline_top_text"`;
  grep the page for the middle/bottom equivalents and the embedded `<img` tags.)
- `01_embedding_text_images` still lists the plain `file-listing-placeholder-0X.txt` files.
- `03_featuring_content` page renders feature cards (grep for the feature card class/markup) and
  the featured targets are EXCLUDED from the plain file/folder listing.
**Done when:** the new file adds ≥4 assertions and the suite is green.

### ST2 — Filekind detail dispatch  ·  branch `test/smoke-filekinds`
**Produce:** `tests/smoke.filekinds.test.mjs`
**Read:** `src/lib/routing.ts` (`componentForKind` map), the `src/components/filekinds/*.astro` it
dispatches to.
**Assert (verified anchors):**
- Image detail `page("00_thumbnails/example.png")` contains an `<img` tag pointing at the file.
- Link enhancer: `02_popups_links_shortcuts` page contains the external href
  `http://www.area17.com` (from `area17.com.link`).
- `.site` single view `page("04_html_prototype/04_html_prototype.site")` renders the site view
  (anchor: contains `icon__site`), not a folder listing.
- `.oplx` single view `page("08_project_plan.oplx")` renders as one detail view.
- Markdown: `page("markdown_cheat_sheet.txt")` renders FORMATTED html — contains `<h1>`,
  `<strong>`, `<code>` — not raw `#`/`**` source.
- `.slide` redirect: `page("06 slideshow.slide/slideshow.slide")` contains
  `<meta http-equiv="refresh"` whose `url=` points at the first image
  (`…/example.gif`). NOTE: the OUTER `06 slideshow.slide` is a normal listing (it has no direct
  image files) — only the INNER folder redirects.
**Done when:** ≥6 assertions, suite green.

### ST3 — URL encoding & raw-byte route  ·  branch `test/smoke-encoding`
**Produce:** `tests/smoke.encoding.test.mjs`
**Read:** `src/lib/routing.ts` (`pageUrl`/`assetUrl` per-segment encoding), `src/pages/directory/[...path].ts`.
**Assert (verified anchors):**
- Space-named routes build: `pageExists("05 display rss feed")` and
  `pageExists("06 slideshow.slide")` are true.
- Links to space-named paths are percent-encoded in HTML: the root page contains `%20` in an
  href to `05%20display%20rss%20feed` (grep the root listing for the encoded href).
- The `.slide` redirect target is encoded: the inner slide page's `refresh` url contains `%20`.
- Raw-byte route exists: `pageExists("directory/04_html_prototype/04_html_prototype.site")` (the
  `/directory/<path>` namespace serves file bytes). Confirm what `/directory/...` pages are built
  by listing `dist/directory/`.
**Done when:** ≥4 assertions, suite green.

### ST4 — Thumbnail / gallery structure  ·  branch `test/smoke-thumbnails`
**Produce:** `tests/smoke.thumbnails.test.mjs`
**Read:** `src/components/listing/Gallery.astro`, [SPEC-thumbnails.md](./spec/SPEC-thumbnails.md),
[TESTING.md](./TESTING.md) Findings #1.
**Assert (verified anchors):**
- `00_thumbnails` page contains exactly three `gallery_thumbnail` blocks (gif/jpg/png).
- Each gallery `<img src>` points at a `-thumbnails/` URL (the generated thumbnail, not the raw
  source path).
- The gallery filenames (`example.gif` etc.) appear under the thumbs.
- Regression cross-check (complements the gate's CSS guard): assert each gallery `<img` carries
  `width`/`height` attributes AND the page's gallery markup is intact, so a future change that
  drops the gallery can't silently pass.
**Done when:** ≥4 assertions, suite green.

---

## Optional second concern — RSS parser fix (separate branch)

### RSS1 — Tolerant feed parsing  ·  branch `fix/gen-rss-tolerant`
**Produce:** edit `scripts/gen-rss.mjs` (single existing file — its own branch, conflict-free
with the test wave).
**Problem:** `npm run build` logs
`[gen-rss] fetch failed for http://feeds.feedburner.com/area17/news: Unexpected close tag`.
The feed XML is malformed; the strict parser throws and the feed never caches.
**Read:** `scripts/gen-rss.mjs`, [SPEC-config.md](./spec/SPEC-config.md) (RSS section).
**Fix:** make parsing tolerant of the malformed feed — e.g. parse non-strictly / sanitize before
parse, keeping the existing lenient "one bad feed won't break the build" posture. Do not change
the cache layout or output contract.
**Done when:** `npm run build` logs `[gen-rss] … 0 failed` for that feed (it fetches & caches),
and the build still completes. Keep the graceful-fallback behavior for genuinely unreachable
feeds.
