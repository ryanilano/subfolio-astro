# Plan: per-theme CSS layer + faithful ryanilano theme

## Context

The port ships only the **default** AREA17 theme. The active theme name (`settings.theme`)
today drives `options.yml` toggles and a `color_palette` *name* — but **no mechanism loads a
per-theme stylesheet**. `gen-css.mjs` compiles `src/styles/main.scss` → `/public/css/main.css`,
linked once at [Layout.astro:264](../src/layouts/Layout.astro#L264); the only theme-aware CSS is
the inline `colorCss` `<style set:html>` block (palette *values*, not structure). The live
ryanilano.com look — a dark-tile gallery on `#ececec` — lived in a customized theme CSS that was
never ported (captured in [spike-ryanilano-theme-css.md](spike-ryanilano-theme-css.md)).

**Goal:** add a generic "compile + `<link>` the active theme's CSS" capability, then author a
faithful `ryanilano` theme as the demonstrating case. Default theme is unaffected (its look *is*
`main.css`).

## Decisions (confirmed with user)

- **Commit ryanilano to the public repo** (`src/styles/themes/ryanilano.scss` +
  `config/themes/ryanilano/options.yml`). ⚠️ This intentionally relaxes the
  identity-neutral principle from the settings.yml work ([[settings-yml-loader-task]]) — user
  accepted that tradeoff. `config/settings.yml` stays `theme: default`; ryanilano is activated
  only at deploy (via `SUBFOLIO_CONFIG_DIR`/settings override), so the committed default build
  stays neutral.
- **Faithful port:** dark gallery tiles + page bg + container width + Helvetica-first font +
  logo padding — selector-translated to the port's real DOM.

## Key findings driving the approach

- **Override-layer model, not a fork.** Legacy `ryanilano/css/main.css` was the *whole* default
  file + edits + trims (and ~150 lines of an unrelated appended "slamborne"/Eric-Meyer reset).
  We load `main.css` then a thin override sheet, so we only ADD the ~6 identity rules; the
  legacy "removed" hunks (hr, `.columns4`, `ul.group`, iOS tap-highlight) are irrelevant.
- **Selectors renamed.** `#container`/`#logo`/`.standard_paragraph` survive, but the dark-tile
  targets do **not**: port grid markup is `div.gallery.gallery--grid > ul > li > a.focusable >
  div.gallery_thumbnail` ([Gallery.astro:128-167](../src/components/listing/Gallery.astro#L128)) —
  no `#gallery` id, no `.grid` class. Rules must re-point (table below).
- **`color_palette: default`** for ryanilano → dark tiles come from theme CSS, not a palette; no
  collision with the `colorCss` block.

## Approach

### 1. Generic theme compile — `scripts/gen-css.mjs`
Add a pass after the `main`/`icons` compiles: for each `src/styles/themes/*.scss`, compile →
`public/css/theme-<name>.css` (reuse the existing `compile()` helper, which already handles
loadPaths + lightningcss prefixing/minify). Generic, so future themes need no script change.

### 2. Export the active theme name — `src/lib/site.ts`
The resolved `theme` is currently a local `const` (site.ts:158). Add `export const activeTheme = theme;`
so Layout can reference it.

### 3. Conditionally link the theme sheet — `src/layouts/Layout.astro`
Frontmatter runs at build (SSG), so use Node `fs`:
```ts
import { existsSync } from "node:fs";
import { activeTheme } from "../lib/site.ts";
const themeCssPath = resolve(process.cwd(), `public/css/theme-${activeTheme}.css`);
const hasThemeCss = existsSync(themeCssPath);
```
Emit `<link href={`/css/theme-${activeTheme}.css?v=1`} rel="stylesheet" />` **after** the
`colorCss` `<style>` block (Layout.astro:288) so the theme layer has the last cascade word.
`hasThemeCss` gate means themes without a sheet (incl. `default`) link nothing — no 404.

### 4. Author `src/styles/themes/ryanilano.scss` (the override layer)
Plain override sheet (loaded after `main.css`; may `@use 'sass:...'` but needs no `@import` of
main). Selector-translated identity rules:

| Legacy rule (spec) | Port selector | Declaration |
|---|---|---|
| `body { background:#ececec }` | `body` | `background-color:#ececec;` |
| `#content { font:…"Helvetica Neue"… }` | `#content` | `font-family:"Helvetica Neue",Arial,Helvetica,Geneva,sans-serif;` |
| `#container { max-width:1024px }` | `#container` | `max-width:1024px;` |
| `#gallery { max-width:70em }` | `.gallery` | `max-width:70em;` |
| `.list li { background:#333 }` (tile) | `.gallery--grid .gallery_thumbnail` | `background-color:#333;` |
| `.grid li a:hover { background:#000 }` | `.gallery--grid li a:hover` | `background-color:#000;` |
| `#logo { padding-left:1.6em }` | `#logo` | `padding-left:1.6em;` |

- **Risk line — `body{font-size:10px}`:** legacy halved the base then used `1em` everywhere. The
  port's typography scale (`_typography.scss`, rem/em) may not assume a 10px root → shrinks
  everything. **Include cautiously and verify rendered;** drop if it breaks the scale (identity
  survives without it). Noted in verification.
- Verify each selector against the rendered DOM during execution (the table is the spec, not
  gospel — re-point any that don't match).

### 5. Commit `config/themes/ryanilano/options.yml`
Cleaned copy of `config-legacy/themes/ryanilano/options.yml` (grid mode, `display_size:false`,
`display_file_extensions:false`, `display_file_names_in_gallery:false`, logo `.gif` path,
`color_palette:default`). The logo/favicon paths 404 → existing empty-logo→text fallback in
[Header.astro:74-87](../src/layouts/Header.astro#L74) (the "+assets" tier stays deferred).
`coerceLike` in site.ts tolerates any unknown values.

### 6. Gitignore the generated sheets
Ensure `public/css/theme-*.css` is ignored (verify the existing `public/css/` rule covers it;
add a line if not). `theme-ryanilano.css` is generated, not committed — the `.scss` source is.

## Files

- **Edit:** [scripts/gen-css.mjs](../scripts/gen-css.mjs) (themes loop),
  [src/lib/site.ts](../src/lib/site.ts) (`export activeTheme`),
  [src/layouts/Layout.astro](../src/layouts/Layout.astro) (conditional `<link>`).
- **New (committed source):** `src/styles/themes/ryanilano.scss`,
  `config/themes/ryanilano/options.yml`.
- **Maybe:** `.gitignore` (theme-*.css).
- **Reuse (no edit):** `compile()` in gen-css.mjs; `loadThemeOptions` / theme resolution in
  site.ts; the Header logo fallback.

## Verification

1. **Default build unaffected.** `npm run build` (no env) → green; `npm run preview` shows the
   neutral default look; **no** `theme-*.css` link in `<head>` (default has no sheet).
2. **Theme compiles + links.** Confirm `public/css/theme-ryanilano.css` is generated by
   `gen-css.mjs` and contains the override rules.
3. **ryanilano look.** Activate the theme — `SUBFOLIO_CONFIG_DIR=/tmp/cfg` with
   `settings.yml: {theme: ryanilano}` + a copy of `config/themes/ryanilano/options.yml` — rebuild
   + `npm run preview` against `content/examples/`. Confirm: page bg `#ececec`; grid gallery with
   **dark `#333` tiles** + **black `#000` hover**; logo → text fallback; `<link
   .../theme-ryanilano.css>` present **after** the inline color `<style>`.
4. **Font-size sanity.** Inspect rendered type scale; if `font-size:10px` shrinks the UI, drop
   that one line and re-verify the rest of the identity holds.
5. `astro check` passes (the new `activeTheme` export + `existsSync` are typed).

## Out of scope (noted)

- **Latent finding:** the existing `colorCss` block targets dead selectors (`#gallery ul li a
  div.gallery_thumbnail`, `.grid li a:hover`) → the palette `back`/hover colors don't currently
  reach the gallery in any theme. Real bug, but separate from this task; ryanilano sidesteps it
  with correct selectors. Worth a follow-up.
- Serving theme **assets** (logo `.gif`, favicon, palette images) — the deferred "+assets" tier.
- Build-time theme **switching** UI; porting the legacy slamborne/Eric-Meyer appended cruft.
