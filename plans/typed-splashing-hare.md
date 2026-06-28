# Modernize `scripts/gen-css.mjs`

## Context

`scripts/gen-css.mjs` is a pre-build pass that bakes the vendored SVG icons into a
Sass `$icons` map of data-URIs, compiles `main.scss` + `icons.scss` with dart-sass,
and vendor-prefixes the result with lightningcss. It faithfully reproduces an old
**grunt** pipeline (`svgcss`/`sass`/`postcss`), which means it carries 2016-era
assumptions that no longer pay rent in 2026:

- **Dead browser targets.** The prefixer targets are hand-encoded version ints
  (`chrome: 49<<16`, …) that deliberately force `-webkit-/-moz-/-ms-` prefixes and
  still include **IE 11** (Microsoft ended support June 2022). Magic bit-shifts are
  also opaque and easy to get wrong.
- **Heaviest-possible SVG encoding.** `cleanSvg()` is regex-based and the data-URI
  uses `charset=US-ASCII` + full `encodeURIComponent()` — the most verbose encoding
  available. `public/css/icons.css` is **~92KB**. The SVG sources are raw Adobe
  Illustrator exports full of cruft (`id="Layer_1"`, `enable-background`,
  `xml:space`, generator comments).

**Decisions (confirmed with user):**
1. Browser floor → **Modern, drop IE** (`browserslist` "defaults").
2. SVG → **compact encoding + SVGO optimize** (accept byte changes; verify visual parity).

**Outcome:** one readable browserslist source of truth for prefixing, IE/dead-browser
prefixes gone, and a substantially smaller `icons.css` — with a visual-parity check to
honor the project's "same rendering, new stack" goal.

## Approach

Edit only `scripts/gen-css.mjs` plus dependency/config bookkeeping. No SCSS sources,
no Astro config, no served paths change (still writes `public/css/main.css` + `icons.css`,
and `src/img/_icons.scss`).

### 1. Browser targets → browserslist
- Add `browserslist` as a devDependency (lightningcss is already present and exposes
  `browserslistToTargets()` — confirmed available in the installed version).
- Replace the hand-encoded `targets` object (lines 36–45) with:
  ```js
  import { browserslistToTargets } from "lightningcss";
  import browserslist from "browserslist";
  const targets = browserslistToTargets(browserslist("defaults"));
  ```
- Add a `browserslist` key to `package.json` (`["defaults"]`) so the query is a
  single, discoverable source of truth (also picked up by any future tooling).
- This drops IE11 and the legacy prefix floor. Note: the **manual** legacy prefixes
  hand-written in `src/styles/_mixins.scss` (`-khtml-`, `-ms-touch-action`,
  `-webkit-box-shadow`, etc.) live in SCSS source and are **out of scope** here — the
  prefixer change won't strip them. Removing those is a separate, optional follow-up
  and is **not** part of this plan (keeps the diff to one file + config).

### 2. SVG: compact encoding + SVGO
- Add `svgo` (4.x) and `mini-svg-data-uri` (1.4.x) as devDependencies — both confirmed
  available.
- **Preserve dimension extraction order — critical.** `dimOf()` (lines 62–66) parses
  `width=`/`height=` off the `<svg>` tag to set each icon's CSS `width`/`height`. SVGO's
  default preset can remove `width`/`height` and `viewBox`, which would silently break
  icon sizing (falling back to the 16px `DEFAULT_DIM`). Mitigation:
  - Run SVGO with a config that **keeps `width`, `height`, and `viewBox`** (override
    `removeViewBox`, and do not enable `removeDimensions`), OR
  - Extract `width`/`height` from the **raw** SVG *before* SVGO runs, then optimize.
  - Plan uses **both belt-and-suspenders**: extract dims from raw first, and configure
    SVGO to retain them — so sizing is robust regardless of preset drift.
- Replace `cleanSvg()` regex cleanup with an `svgo.optimize()` pass (preset-default
  minus the dimension/viewBox removals), stripping Illustrator cruft and collapsing
  precision.
- Replace the `data:image/svg+xml;charset=US-ASCII,${encodeURIComponent(cleaned)}`
  construction (lines 80–81) with `mini-svg-data-uri` (`svgToTinyDataUri`), which emits
  the minimally-escaped `data:image/svg+xml,...` form (`"`→`'`, only reserved chars
  escaped). Expect ~30–40% smaller `icons.css`.
- Keep the generated `_icons.scss` map shape identical (`datauri:'…', width:Npx,
  height:Npx`) so `_mixins.scss` `background-image()` / `icon-type()` consume it
  unchanged.

### 3. Housekeeping
- Update the file's top doc comment to describe the new pipeline (browserslist +
  SVGO + mini-svg-data-uri) instead of the grunt lineage.
- Remove the now-unused `cleanSvg()` helper.

## Critical files

- `scripts/gen-css.mjs` — the only source file changed (targets, SVG encode/optimize,
  dim-extraction ordering, doc comment).
- `package.json` — add devDeps (`browserslist`, `svgo`, `mini-svg-data-uri`) + a
  `browserslist` field.
- Consumers that must keep working unchanged (read-only reference, do NOT edit):
  - `src/styles/_mixins.scss` — `icon-type()` / `background-image()` read the `$icons`
    map (`datauri`, `width`, `height` keys).
  - `src/styles/main.scss`, `src/styles/icons.scss` — `@import '../img/icons'`.
  - generated `src/img/_icons.scss`, `public/css/{main,icons}.css` (gitignored outputs).

## Verification

1. **Build the CSS:** `npm run gen-css` → expect the `[gen-css] N icon(s) …` log; note
   the new `icons.css` KB figure and confirm it dropped meaningfully from ~92KB.
2. **Map integrity:** confirm `src/img/_icons.scss` still has all 54 icons, each with a
   non-default `width:`/`height:` (not silently collapsed to `16px`) — spot-check
   `grid_dir` (should be `55px × 43px`) and `arrow_left` (`20px × 14px`).
3. **Sass still compiles:** the same `npm run gen-css` covers this (it compiles both
   entrypoints); a clean exit = no broken `$icons` references.
4. **Prefixer sanity:** grep `public/css/main.css` for `\-ms\-` / IE-only prefixes —
   they should be largely gone (save any that come from the still-present manual SCSS
   prefixes). Confirm modern prefixes (e.g. `-webkit-` where browserslist "defaults"
   still warrants) are present.
5. **Visual parity (the real test):** `npm run dev`, open a folder listing + a file
   detail page, and confirm every grid/file-type icon, arrow, and close glyph renders
   identically (right glyph, right size, no broken background-image). This is the gate
   that justifies the SVGO byte changes.
6. **Full build smoke:** `npm run build` to confirm the pass still slots cleanly ahead
   of `astro check && astro build`.
