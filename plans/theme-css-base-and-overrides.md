# Theme CSS: `default` = base, other themes = cascade overrides

## Context

In the original PHP Subfolio, every theme owned a directly-editable
`config/themes/<name>/css/main.css`. The Astro port broke that: the base
stylesheet became SCSS partials under `src/styles/` (compiled to
`public/css/main.css`), and per-theme overrides lived in
`src/styles/themes/<name>.scss`. The `config/themes/<name>/` dirs held only
`options.yml`, so there was **no way to edit theme CSS from the themes
directory**.

Desired model (user's words): **`default` is the base CSS — exactly what renders
now — and lives editably under `config/themes/default/`. Every other theme
(`ryanilano`, future `black-and-blue`, …) is a thin layer that appends to /
overrides the cascade on top of the base.**

This restores the PHP mental model (edit theme CSS in the theme dir) while
keeping the modern dart-sass + lightningcss pipeline and the existing
override-layer cascade already used by `ryanilano`.

## Approach

Relocate the base SCSS system into `config/themes/default/css/`, point
[scripts/gen-css.mjs](scripts/gen-css.mjs) at it, and treat every **non-default**
theme dir as an override layer. Output paths (`public/css/main.css`,
`icons.css`, `theme-<name>.css`) and [Layout.astro](src/layouts/Layout.astro) are
unchanged, so the rendered result is byte-identical until someone edits a theme.

### Already done (consistent with this plan)
- `git mv src/styles/themes/ryanilano.scss → config/themes/ryanilano/css/main.scss`
- created empty `config/themes/default/css/`

### 1. Move the base stylesheet into the default theme
`git mv` the entire `src/styles/` tree (23 tracked files) into
`config/themes/default/css/`, preserving structure:
- entrypoints: `main.scss`, `icons.scss`
- partials: `_resets/_colors/_typography/_grid/_mixins/_variables.scss`
- `modules/**` and `modules/content/**`

Then remove the now-empty `src/styles/`.

`url(...)` asset refs (`../images/...`, `../fonts/...` in `_errors.scss`,
`_download_box.scss`, `_typography.scss`) need **no change** — browsers resolve
them relative to the compiled output (`public/css/`), which is not moving.

### 2. Fix the generated `$icons` map import (the one real hazard)
`main.scss` and `icons.scss` both do `@import '../img/icons'` — a relative path
to the gitignored, gen-css-generated `$icons` map at `src/img/_icons.scss`. Once
the entrypoints move and load paths include both the base dir and `src/img`, the
bare name `icons` would ambiguously match the `icons.scss` entrypoint.

Fix: rename the **generated** partial `src/img/_icons.scss` → `src/img/_icon-map.scss`
and change both imports to `@import 'icon-map';` (resolved via the `src/img` load
path — unambiguous, no entrypoint shares that name). The SVG sources in
`src/img/svg_source/` (real, committed) stay put. `modules/_icons.scss` (icon
*classes*, imported as `modules/icons`) is unaffected and moves with the tree.

### 3. Rewire `scripts/gen-css.mjs`
- **Config root, honoring the env override** (mirrors [src/lib/site.ts:156](src/lib/site.ts#L156)):
  `configDir = process.env.SUBFOLIO_CONFIG_DIR ? resolve(env) : join(root,'config')`;
  `themesDir = join(configDir,'themes')`; `baseDir = join(themesDir,'default','css')`;
  `imgDir = join(root,'src/img')`.
- `generateIconsPartial()` writes `_icon-map.scss` (was `_icons.scss`).
- Generalize `compile(entryPath, outName, loadPaths)` to take an absolute entry
  and explicit load paths (currently it joins `stylesDir`). Add: **skip writing
  when minified output is empty** (a comment-only override emits no sheet), and
  remove any stale prior output in that case.
- `main()`:
  - `compile(join(baseDir,'main.scss'), 'main', [baseDir, imgDir])` → `public/css/main.css`
  - `compile(join(baseDir,'icons.scss'), 'icons', [baseDir, imgDir])` → `public/css/icons.css`
- Rewrite `compileThemes()`: iterate `themesDir` subdirectories, **skip `default`**
  (it's the base, already compiled above), and for each remaining theme that has
  `css/main.scss`, compile → `theme-<name>.css` with
  `loadPaths: [themeCssDir, baseDir, imgDir]` so overrides may `@use` the base's
  variables / mixins / `$icons` if desired. Skip empty output.

Net effect on the active-theme cascade is unchanged: `default` ships only
`main.css` + `icons.css` (no `theme-default.css`), and [Layout.astro:73](src/layouts/Layout.astro#L73)
still links `theme-<active>.css` only when it exists.

### 4. `.gitignore`
Replace the `src/img/_icons.scss` entry with `src/img/_icon-map.scss`.
`public/css/main.css`, `icons.css`, `theme-*.css` stay ignored.

### 5. Docs (light, in-pass)
Update the `gen-css.mjs` header comment and the
[config/themes/ryanilano/css/main.scss](config/themes/ryanilano/css/main.scss)
header (path/role) to describe base-vs-override. Note in CLAUDE.md that theme CSS
now lives in `config/themes/<name>/css/`.

## Files
- **Moved:** `src/styles/**` → `config/themes/default/css/**` (23 files); ryanilano already moved.
- **Edited:** `config/themes/default/css/main.scss` + `icons.scss` (icon-map import),
  [scripts/gen-css.mjs](scripts/gen-css.mjs), `.gitignore`, doc comments.
- **Unchanged:** [src/layouts/Layout.astro](src/layouts/Layout.astro),
  [src/lib/site.ts](src/lib/site.ts), `src/img/svg_source/**`, all components.

## Verification
1. **Identical base output:** `md5` `public/css/main.css` + `icons.css` before
   the change; run `npm run gen-css`; re-`md5`. Expect **identical** hashes (same
   SCSS, only relocated + import rename) — proves no visual regression. Confirm
   `theme-ryanilano.css` is produced and **no** `theme-default.css` exists.
2. `npm run build` (astro check + build) is green.
3. `npm run preview` → default theme listing/detail render identically to now.
4. Switch active theme to `ryanilano` (`settings.yml theme: ryanilano`, or a
   `SUBFOLIO_CONFIG_DIR` pointing at a config with it active) and confirm the
   override sheet links after `main.css` and its rules win.
5. Smoke that overrides compose: temporarily add a rule to
   `config/themes/default/css/main.scss` (plain CSS) and to a non-default theme
   `main.scss` using a base `@use`/`$variable`; confirm both compile.
6. Existing suites unaffected: `npm test`, `npm run test:a11y` (operate on `dist/`
   output paths, which don't change).
