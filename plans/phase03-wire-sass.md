# Phase 3 — Wire SASS into the build (pre-build compile script)

## Context

Phase 3 (build pipeline) is partially done — commit `37eafde` (1 ahead of origin, unpushed)
delivered thumbnails, image metadata, and sitemap. Three Phase-3 items remain open per
[docs/ROADMAP.md](../docs/ROADMAP.md): **sass**, **RSS fetch at build**, and **Cloudflare deploy**.
This plan covers **sass**.

**The problem.** The SCSS sources in [src/styles/](../src/styles/) exist and the Vite SCSS
preprocessor is configured in [astro.config.mjs](../astro.config.mjs), but **nothing consumes
them**. The CSS actually served is two *frozen static files* committed at
[public/css/main.css](../public/css/main.css) and [public/css/icons.css](../public/css/icons.css),
linked by a hardcoded `<link href="/css/main.css?v=2">` in
[src/layouts/Layout.astro:204](../src/layouts/Layout.astro#L204) (+ `A17.loadCSS("/css/icons.css")`
at line ~248). These two files are the outputs of the **upstream grunt pipeline**
(svgcss → dart-sass → autoprefixer) in `../subfolio/config/themes/default/grunt/`.

**The hidden blocker.** A fresh `sass src/styles/main.scss` fails with `exit 65: Can't find
stylesheet to import`. Both [main.scss:38](../src/styles/main.scss#L38) and
[icons.scss:4](../src/styles/icons.scss#L4) do `@import '../img/icons'` — but `src/img/_icons.scss`
**does not exist in this repo**. Upstream it was a grunt-*generated* partial (a Sass map
`$icons: ( name: ( datauri:'…', width:…, height:… ), … )`) built by the `svgcss` task from
54 SVGs in `../subfolio/config/themes/default/grunt/img/svg_source/*.svg`, and was always
gitignored. It is consumed by [_mixins.scss](../src/styles/_mixins.scss) (`map-get($icons, …)`)
and [modules/_icons.scss](../src/styles/modules/_icons.scss) (`@each $icon in $icons`).

**Intended outcome.** `npm run build` / `npm run dev` compile the SCSS from source into
`public/css/main.css` + `public/css/icons.css` instead of relying on hand-committed artifacts,
following the same **pre-build node-script** pattern already established by
[scripts/gen-thumbs.mjs](../scripts/gen-thumbs.mjs). The rendered pages must look identical to today.

## Approach: a `scripts/gen-css.mjs` pre-build pass

Mirror `gen-thumbs.mjs` exactly in spirit: a standalone node script, run before `astro` in the
npm scripts, that regenerates the icon partial and compiles the SCSS. Goal is **visual parity**
with the frozen CSS, not byte-for-byte reproduction.

### 1. SVG sources → vendor into this repo
The 54 SVGs currently live only in the sibling `../subfolio` checkout, which the build must not
depend on. Copy them into this repo at **`src/img/svg_source/*.svg`** (54 files) so the build is
self-contained. These are committed (they're real source, unlike the generated partial).

### 2. `scripts/gen-css.mjs` — generate the `$icons` partial
- Read every `src/img/svg_source/*.svg`.
- For each: derive `name` (basename without `.svg`), parse `width`/`height` from the `<svg
  width="Npx" height="Npx">` attributes (fallback 16px — matches upstream `defaultWidth/Height`),
  and build a data-URI. Match the upstream grunt-svg-css encoding:
  `data:image/svg+xml;charset=US-ASCII,<url-encoded-svg>` (URL-encode, not base64 — confirmed by
  inspecting committed `icons.css`).
- Write **`src/img/_icons.scss`** with the same shape the Handlebars template
  (`grunt/hbs/svgcss_template.hbs`) emitted:
  ```scss
  $icons: (
    arrow_left: ( datauri:'data:image/svg+xml;charset=US-ASCII,…', width:20, height:20 ),
    …
  );
  ```
- **`src/img/_icons.scss` is a generated artifact → gitignore it** (like `.thumb-cache/`).

### 3. `scripts/gen-css.mjs` — compile both entrypoints
- Use the already-installed `sass` (dart-sass, devDep) Node API:
  `sass.compile('src/styles/main.scss')` and `sass.compile('src/styles/icons.scss')`.
  - `main.scss` has `$include_icons: false` → its output contains **no** data-URIs, only the
    icon *dimension* rules from the `$icons` map. Low-risk, large file (~59 KB today).
  - `icons.scss` has `$include_icons: true` → emits the 54 inlined data-URI backgrounds.
- Suppress the noisy `@import` deprecation warnings (`silenceDeprecations: ['import']` or
  `quietDeps: true`) — the SCSS legitimately uses legacy `@import`.
- **Autoprefixer parity:** the committed `main.css` has ~25 vendor-prefixed rules from
  upstream's `autoprefixer` postcss step. We have no postcss/autoprefixer installed, but
  **lightningcss is already a devDep**. Run the dart-sass output through
  `lightningcss` (`browserslist`-targeted, `transform`) to add prefixes + minify-optionally.
  This keeps tooling to deps we already have and matches the configured CSS transformer.
- Write results to `public/css/main.css` and `public/css/icons.css`.

### 4. Make the generated CSS an artifact
- Add `public/css/main.css`, `public/css/icons.css`, and `src/img/_icons.scss` to
  [.gitignore](../.gitignore). They become build outputs, not committed source.
- Leave [Layout.astro](../src/layouts/Layout.astro) **unchanged** — the `/css/main.css?v=2` and
  `/css/icons.css` links keep working because the script writes to those exact paths.

### 5. Wire into npm scripts
In [package.json](../package.json), chain the new script alongside `gen-thumbs` (keep both):
```jsonc
"dev":   "node scripts/gen-thumbs.mjs && node scripts/gen-css.mjs && astro dev",
"start": "node scripts/gen-thumbs.mjs && node scripts/gen-css.mjs && astro dev",
"build": "node scripts/gen-thumbs.mjs && node scripts/gen-css.mjs && astro check && astro build",
"gen-css": "node scripts/gen-css.mjs"
```

## Files

| File | Change |
|---|---|
| `src/img/svg_source/*.svg` | **New** — 54 SVGs vendored from `../subfolio/.../grunt/img/svg_source/` (committed source) |
| `scripts/gen-css.mjs` | **New** — generate `$icons` partial + dart-sass compile + lightningcss prefix → `public/css/*.css` |
| `src/img/_icons.scss` | **Generated** (gitignored) — `$icons:` Sass map |
| `public/css/main.css`, `public/css/icons.css` | Change from committed artifacts → generated (gitignored) |
| `.gitignore` | Add the three generated paths |
| `package.json` | Chain `gen-css.mjs` into `dev`/`start`/`build`; add `gen-css` script |

Reuse: follow the structure/leniency/comment style of
[scripts/gen-thumbs.mjs](../scripts/gen-thumbs.mjs) (out-of-tree/generated artifacts, never mutate
sources, lenient skip-on-error, summary `console.log`).

## Verification

1. **Cold compile works:** `rm -f public/css/main.css public/css/icons.css src/img/_icons.scss`,
   then `npm run gen-css`. Both CSS files regenerate; script exits 0; `src/img/_icons.scss`
   has 54 `name: ( datauri:…, width:…, height:… )` entries.
2. **Parity check (visual, not byte):** `git stash` the .gitignore change so the old committed
   CSS is still in git; `git diff --stat public/css/` to eyeball size deltas. Then
   `diff <(committed) <(generated)` to spot only expected differences (whitespace/output-style,
   prefix ordering). Confirm `main.css` still has the dimension rules (`grep 'icon__grid_doc'`)
   and `icons.css` still has 54 `data:image/svg+xml` refs.
3. **Rendered pages:** `npm run build && npm run preview`, load the listing + a file-detail page
   against `content/examples/`. Confirm icons (info button, grid/list filekind icons, arrows),
   layout, fonts, and the color palette all render identically to before. Compare against the
   live PHP app if convenient (same fixture).
4. **Clean tree:** `git status` shows the generated CSS + `_icons.scss` as ignored (untracked but
   not staged), only `scripts/gen-css.mjs`, vendored SVGs, `.gitignore`, `package.json` as changes.

## Out of scope / follow-ups (still open in Phase 3)
- RSS fetch at build ([InlineEmbeds.astro](../src/components/listing/InlineEmbeds.astro) renders an
  empty `<ul class="rss">` today).
- Cloudflare Pages deploy via Wrangler.
- Squash this into the existing unpushed Phase-3 commit `37eafde` before pushing (per prior
  squash-per-phase convention) — confirm with Ryan at push time.
