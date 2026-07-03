# Manual testing checklist

A systematic walkthrough of the bundled fixture (`content/examples/`) to verify
every naming convention renders correctly.

> **Automated coverage now exists** and gates the Cloudflare deploy: the
> structural smoke suite (`npm run test` → `tests/smoke.*.test.mjs`), SEO head
> (`npm run test:seo`), `<picture>`/originals (`tests/picture.test.mjs`), perf
> budgets (`npm run test:perf`, warn-posture) and axe/contrast
> (`npm run test:a11y`). Many rows below are covered structurally by those
> tests. This checklist remains the **eyeball pass** for what only a human can
> verify: visual parity with the PHP app, popup windows, masonry JS layout,
> hover behaviors, sort links, and anything client-side.

## How to run

Do the **authoritative** pass against the static build (closest to production —
exercises the prebuild scripts, the loader, and the real generated routes):

```sh
npm run build && npm run preview      # serves dist/ at http://localhost:4321 (or next free port)
```

Use `npm run dev` only for fast iteration. A green build does **not** prove a
component renders (see AGENTS.md) — always load the page.

> **Cache gotcha:** after a rebuild, hard-refresh (Cmd+Shift+R) to bypass the
> cached `/css/main.css` and `/js/main.js`.

## Status legend

- ✅ verified correct
- 🐛 bug found (log it under "Findings")
- ⚠️ works with caveats / deferred behavior
- ⬜ not yet checked

---

## Site-wide checks (every page)

| # | Check | Status | Notes |
|---|---|---|---|
| G1 | Header logo + "Index of …" breadcrumb render | ⬜ | |
| G2 | Breadcrumb segments are clickable and resolve to the right folder | ⬜ | |
| G3 | Prev/next nav (`← →`) points at sibling folders in sort order | ⬜ | |
| G4 | Footer ("© Subfolio", updated-since) renders | ⬜ | |
| G5 | Root `-t-introduction.txt` (top) + `-b-footer.txt` (bottom) embeds show on `/` | ⬜ | |
| G6 | `-hidden/` dir is absent from every plain listing | ⬜ | |
| G7 | Raw bytes serve at `/directory/<path>` (open an image's `/directory/...` URL directly) | ✅ | smoke.encoding.test.mjs; dot-entries + `-access` are blocked by design (Findings #3) |
| G8 | A bogus path (e.g. `/does-not-exist`) returns the 404 page | ⬜ | |

Listing pages compose seven partials in this fixed order
([Listing.astro](../src/components/listing/Listing.astro)):
**top embeds → features → gallery → middle embeds → files/folders → related → bottom embeds.**

---

## Route-by-route walkthrough

### `/` — root listing
Conventions: top/bottom embeds, hidden dir, `.cut` shortcut.

| # | Check | Status | Notes |
|---|---|---|---|
| R1 | `-t-introduction.txt` renders as top embed | ⬜ | |
| R2 | `-b-footer.txt` renders as bottom embed | ⬜ | |
| R3 | `hiding_content.cut` appears as a shortcut/related item | ⬜ | |
| R4 | `markdown_cheat_sheet.txt` is listed as a normal file | ⬜ | |
| R5 | `-hidden/` does not appear | ⬜ | |
| R6 | All `0X_…` folders listed in order | ⬜ | |

### `/00_thumbnails` — thumbnail enhancer
Conventions: auto thumbnails (`-thumbnails`), custom (`-thumbnails_custom`), gif/jpg/png.
Spec: [SPEC-thumbnails.md](spec/SPEC-thumbnails.md).

| # | Check | Status | Notes |
|---|---|---|---|
| T1 | Three thumbnails render in the gallery | ✅ | gif/jpg/png |
| T2 | Thumbnails retain source aspect ratio (no squish) | ✅ | Fixed — see Findings #1 |
| T3 | `00_thumbnails.info` description shows (top text) | ⬜ | |
| T4 | Gallery filenames shown under each thumb | ⬜ | |
| T5 | Clicking a thumb opens its `Img` detail view | ⬜ | |
| T6 | (custom) drop a thumb into `-thumbnails_custom/` → served verbatim, class `custom` | ⬜ | dir currently only has a readme |

### `/01_embedding_text_images` — position embeds
Conventions: `-t-`/`-m-`/`-b-` text **and** image embeds.

| # | Check | Status | Notes |
|---|---|---|---|
| E1 | Top: `-t-top-text.txt` + `-t-top-image.png` render above the listing | ⬜ | |
| E2 | Middle: `-m-middle_text.txt` + `-m-middle-image.png` render between gallery and files | ⬜ | |
| E3 | Bottom: `-b-bottom-text.txt` + `-b-bottom-image.png` render below | ⬜ | |
| E4 | `file-listing-placeholder-0X.txt` still appear in the plain file listing | ⬜ | |
| E5 | Embed source files are NOT also shown as plain files | ⬜ | |

### `/02_popups_links_shortcuts` — link/popup/shortcut enhancers
Conventions: `.link`, `.pop`, `.cut`. Spec: [SPEC-filekinds.md](spec/SPEC-filekinds.md).

| # | Check | Status | Notes |
|---|---|---|---|
| P1 | `area17.com.link` renders as an external link to the internet location | ⬜ | |
| P2 | `giant_step_jukebox.pop` opens a popup window with the parsed width/height | ⬜ | |
| P3 | `internal-shortcut.cut` renders as a shortcut to its target | ⬜ | |

### `/03_featuring_content` — feature cards
Conventions: `.ftr` for file / folder / link. Spec: [SPEC-theme-api.md](spec/SPEC-theme-api.md).

| # | Check | Status | Notes |
|---|---|---|---|
| F1 | `featured_file.ftr` → feature card for `featured-file.txt` | ⬜ | |
| F2 | `featured_folder.ftr` → feature card for `featured_folder/` | ⬜ | |
| F3 | `featured-link.ftr` → feature card for an external link | ⬜ | |
| F4 | Featured targets are EXCLUDED from the plain file/folder listing | ✅ | smoke.listing.test.mjs; NO emptyfolder message shows — upstream `is_empty_folder()` counts hidden entries (Findings #4) |
| F5 | Feature card thumbnails resolve (`-thumbnails-custom/`) | ⬜ | |

### `/04_html_prototype` — `.site` single view
Conventions: `.site` folder renders as one mini-site detail view (no listing).
Spec: [SPEC-routes.md](spec/SPEC-routes.md).

| # | Check | Status | Notes |
|---|---|---|---|
| S1 | `/04_html_prototype` shows a listing with the `.site` entry | ⬜ | |
| S2 | `/04_html_prototype/04_html_prototype.site` renders as a single view, not a listing | ⬜ | |

### `/05 display rss feed` — RSS enhancer (note the spaces)
Conventions: `.rss` enhancer + `.rss.cache`. URL-encoded spaces.

| # | Check | Status | Notes |
|---|---|---|---|
| RS1 | Folder URL with spaces resolves (`/05%20display%20rss%20feed`) | ⬜ | |
| RS2 | `rss-enhancer.rss` detail renders feed items from `.rss.cache` | ⬜ | |
| RS3 | `-t-readme.txt` description shows | ⬜ | |
| RS4 | Live feed refresh | ⚠️ | Broken — see Findings #2 (falls back to cache) |

### `/06 slideshow.slide` — `.slide` redirect
Conventions: `.slide` folder → meta-refresh redirect to first child's detail page.

| # | Check | Status | Notes |
|---|---|---|---|
| SL1 | `/06%20slideshow.slide` redirects to the first file's detail page | ⬜ | |
| SL2 | Nested `slideshow.slide/` behaves per spec | ⬜ | |
| SL3 | Breadcrumb crumb for the `.slide` links straight to the first image (not the redirect) | ⬜ | |

### `/07_protecting_a_folder` — `-access` (deferred enforcement)
Conventions: `-access` YAML parsed but NOT enforced (Phase 4). Spec: [SPEC-access.md](spec/SPEC-access.md).

| # | Check | Status | Notes |
|---|---|---|---|
| A1 | Folder is still fully served (no auth gate yet) | ⚠️ | enforcement deferred to Phase 4 |
| A2 | `-t-readme.txt` renders | ⬜ | |
| A3 | `-access` file itself is not listed | ⬜ | |

### `/08_project_plan.oplx` — `.oplx` zip single view
Conventions: `.oplx` folder → single detail view; zip generated by `gen-oplx`.

| # | Check | Status | Notes |
|---|---|---|---|
| O1 | `/08_project_plan.oplx` renders as a single `Oplx` view | ⬜ | |
| O2 | Generated `.oplx` zip is downloadable | ⬜ | |
| O3 | Inner `contents/` files have working detail routes | ⬜ | |

### `markdown_cheat_sheet.txt` — Markdown/Textile rendering
| # | Check | Status | Notes |
|---|---|---|---|
| M1 | `/markdown_cheat_sheet.txt` detail view renders formatted HTML, not raw source | ✅ | smoke.filekinds.test.mjs; was broken by the `.env` textile override (Findings #3) |

---

## Cross-cutting checks

| # | Check | Status | Notes |
|---|---|---|---|
| X1 | **List mode** (default) gallery + listing render | ⬜ | |
| X2 | **Grid mode** gallery renders, ratios held | ⬜ | set `listing_mode` in [src/lib/site.ts](../src/lib/site.ts) |
| X3 | **Masonry mode** gallery renders (`width:100%` thumbs), JS masonry lays out | ⬜ | |
| X4 | Sort links (`?sort=filename/size/date/kind`) reorder the listing | ⬜ | |
| X5 | Folders/files with spaces encode/decode correctly in every link | ⬜ | `05 …`, `06 …` |
| X6 | File-kind dispatch: each detail view uses the right component (img/snd/vid/swf/txt/rss/site/oplx/webloc/link, else download box) | ⬜ | [routing.ts](../src/lib/routing.ts) `componentForKind` |

---

## Findings

### #1 — Thumbnail aspect ratios squished (FIXED)
- **Where:** [Gallery.astro](../src/components/listing/Gallery.astro) + [_gallery.scss](../src/styles/modules/content/_gallery.scss)
- **Cause:** `<img>` emitted the *source* dimensions (`width="596" height="843"`) while its `src` was the small thumbnail. The oversized width drove the `display:table` cell wide, and inline `max-height:240px` clamped height independently → ratio broke; `overflow:hidden` hid the spill so images looked squished.
- **Fix:** `width:auto` on `.gallery li a img` so width follows the height-constrained ratio. Masonry's `width:100%` override preserved.
- **Follow-up (optional):** emit the *thumbnail's* real dimensions on the `<img>` instead of the source's — also fixes custom thumbnails and CLS. Pipeline change, deferred.

### #2 — RSS live fetch fails (open)
- **Where:** `scripts/gen-rss.mjs`
- **Symptom:** `[gen-rss] fetch failed … Unexpected close tag` on `http://feeds.feedburner.com/area17/news`. Build continues; `05` renders from `.rss.cache`.
- **Status:** live refresh broken; cached render works. Needs a tolerant feed parser or a different feed.

### #3 — `.env` split-brain build: fixture pages + live `/directory/` bytes, `.git` leaked into dist (FIXED)
- **Where:** `.env` (now `.env.content`) × [src/pages/[...path].astro](../src/pages/%5B...path%5D.astro) / [src/pages/directory/[...path].ts](../src/pages/directory/%5B...path%5D.ts)
- **Cause:** Astro auto-loads `.env` into `process.env` at *render* time but not *config* time. The loader (config time) walked the fixture with markdown, while the route modules (render time) picked up `.env`'s `SUBFOLIO_CONTENT_DIR` (live content repo) and `SUBFOLIO_TEXT_RENDERING=textile` (→ plain-text fallback). One build, two content roots: the raw-bytes route published the live content repo's `.git/`, `.github/`, `.claude/` etc. into `dist/directory/`, and the "2 known pre-existing test failures" (markdown render + `/directory` bytes) were this bug, tolerated for a whole milestone.
- **Fix:** live-content config moved to `.env.content` (invisible to Astro; `dev-content.sh` is its sole consumer — see README "Why `.env.content`"). Engine-level guard added: the raw route blocks dot-prefixed entries and `-access` files at walk time and 403s them in dev, with a regression test in `smoke.encoding.test.mjs`. Deploys are now test-gated in CI.
- **Lesson:** never normalize a red test as "known-failing" — both "known failures" were one live leak.

### #4 — Smoke test asserted an emptyfolder message upstream never shows (FIXED)
- **Where:** `tests/smoke.listing.test.mjs` (03_featuring_content)
- **Cause:** the DeepSeek-authored test expected "No items in this directory" when all items are featured away. Upstream `is_empty_folder()` (`Subfolio.php:813` → `Filebrowser.php:453`, `file_or_folder_count(TRUE)`) counts every on-disk entry *including hidden/`.ftr`*, so a featured-away folder is never "empty" and the message never shows. The component was right; the test also sliced on a `<div class="listing">` that doesn't exist on that page, making its exclusion checks vacuous (`indexOf` = −1).
- **Fix:** test rewritten to the real contract — no listing block, no rows, no emptyfolder message, featured targets present only in `id="features"` — with the PHP line refs in a comment.

### #5 — SEO test hardcoded the pre-rebrand site name (FIXED)
- **Where:** `tests/seo.test.mjs`
- **Cause:** asserted `og:site_name === "Subfolio"`; `config/settings.yml` was rebranded to `Subfolio-Astro` after Phase E and the suite wasn't re-run, so the break went unnoticed until the suite became a deploy gate.
- **Fix:** the test now derives expectations from the build's own sources — `site` via astro.config's `SUBFOLIO_SITE_URL ?? default` resolution, `site_name` parsed from `config/settings.yml`.
