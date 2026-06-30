# Plan: gen-thumbs honors `thumbnail_max_filesize` from settings.yml

## Context

On the live site (`archive.ilano.fyi/the-corner/`) only **COR06** and **COR09**
have thumbnails. Root cause: [scripts/gen-thumbs.mjs](../../scripts/gen-thumbs.mjs)
hardcodes the source-size cap at 1 MB
(`MAX_FILESIZE_BYTES = 1 * 1024 * 1024`, [gen-thumbs.mjs:30](../../scripts/gen-thumbs.mjs#L30)).
The Corner's 16 PNG screenshots are all ~1.0–1.5 MB; only `COR06-no-sympathy-02.png`
(934 KB) and `COR09-juzer-horseplay-01.png` (901 KB) fall under 1 MB, so they're
the only two that pass the size guard at [gen-thumbs.mjs:88](../../scripts/gen-thumbs.mjs#L88).
The `.thumb-cache/the-corner/-thumbnails/` directory contains exactly those two
(plus webp/avif siblings), confirming the diagnosis.

The fix is the "proper" option: read `thumbnail_max_filesize` from the merged
site config instead of hardcoding. The config value **already exists** —
[config/settings.yml:47](../../config/settings.yml#L47) sets `thumbnail_max_filesize: 5`
— it's just never consumed. SPEC ([SPEC-config.md:71](../../docs/spec/SPEC-config.md#L71),
[SPEC-thumbnails.md:279](../../docs/spec/SPEC-thumbnails.md#L279)) defines this as the
intended knob (int MB, PHP default 1). Intended outcome: all 16 Corner PNGs (and
any other ≤5 MB source) get thumbnails on the next build.

## Approach

Make the cap config-driven in `gen-thumbs.mjs`, reusing existing loader utilities.
Do **not** add this key to `src/lib/site.ts` — that module intentionally excludes
`thumbnail_max_filesize` (see its comment at [site.ts:168-173](../../src/lib/site.ts#L168-L173)),
delegating it to its "dedicated source", which is this script. We follow that
convention rather than fight it.

### Change: [scripts/gen-thumbs.mjs](../../scripts/gen-thumbs.mjs)

1. Add imports (the `.mjs`→`.ts` import pattern is already proven in
   [gen-embeds.mjs:29](../../scripts/gen-embeds.mjs#L29)):
   ```js
   import { loadSettings } from "../src/loaders/settings.ts";
   import { asNumber } from "../src/loaders/yaml.ts";
   ```

2. Replace the hardcoded constant ([gen-thumbs.mjs:30](../../scripts/gen-thumbs.mjs#L30))
   with a config-derived value, honoring `SUBFOLIO_CONFIG_DIR` (same default as
   [site.ts:156](../../src/lib/site.ts#L156)) and keeping the **PHP default of 1 MB**
   when settings.yml is absent/omits the key:
   ```js
   const configDir = process.env.SUBFOLIO_CONFIG_DIR ?? "./config";
   const settings = loadSettings(configDir);
   // thumbnail_max_filesize is in MB (SPEC-config §15); PHP default 1.
   const THUMB_MAX_MB = asNumber(settings.thumbnail_max_filesize, 1);
   const MAX_FILESIZE_BYTES = THUMB_MAX_MB * 1024 * 1024;
   ```

3. Update the `[gen-thumbs]` summary `console.log` to include the resolved cap
   (e.g. `… skipped (cap: ${THUMB_MAX_MB} MB, cache: ${cacheRoot})`) so a build log
   makes the active limit visible.

That's the whole change — one script, no schema/site.ts edits, no new deps.

### Notes / non-goals
- **No cache clear needed.** Newly-eligible images have no cached thumb, so the
  mtime staleness check ([gen-thumbs.mjs:79-85](../../scripts/gen-thumbs.mjs#L79-L85))
  falls through to generation. Existing COR06/COR09 thumbs stay "fresh".
- The dimension guard (`h <= THUMB_HEIGHT`) still applies and is fine here — the
  screenshots are far taller than 240 px.
- Orphaned `the-corner-cor0X-...side-a.jpg` entries in the cache are stale leftovers
  from an older source naming; they're unused (no matching source) and out of scope.

## Verification

1. Point at the real content + config and run the thumbnail pass:
   ```sh
   SUBFOLIO_CONTENT_DIR=/Users/ryan/local-dev/subfolio-astro-content \
   SUBFOLIO_CONFIG_DIR=./config \
   npm run gen-thumbs
   ```
   Expect the summary to report `cap: 5 MB` and ~14 newly generated thumbnails.
2. Confirm the cache now holds all 16 Corner thumbs:
   ```sh
   ls .thumb-cache/the-corner/-thumbnails/COR*.png
   ```
   (Each should also have `.webp` and `.avif` siblings.)
3. Full build + preview against the live content dir, then load `/the-corner/`
   and confirm every COR item shows a thumbnail:
   ```sh
   SUBFOLIO_CONTENT_DIR=/Users/ryan/local-dev/subfolio-astro-content npm run build
   npm run preview   # visit http://localhost:4321/the-corner/
   ```
4. Regression: with no `SUBFOLIO_CONFIG_DIR` and a settings.yml lacking the key,
   the cap falls back to 1 MB (PHP parity) — verify via the logged `cap:` value.
5. Re-deploy (content repo CI) so `archive.ilano.fyi/the-corner/` regenerates.
