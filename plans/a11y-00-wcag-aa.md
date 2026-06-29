# Accessibility (WCAG 2.1 AA) for the Astro port

## Context

The Astro port is functionally complete (Phases 1–5) but is **near-greenfield on
accessibility** — a fresh scan found 0 `aria-*`, 0 `role=`, only the logo carries
`alt`, no `:focus-visible` styling, dead `?sort=` controls on a static site, and a
default color palette whose body text fails AA contrast. This phase makes the port
**WCAG 2.1 AA**.

**Decisions locked in this session:**
- **Scope = comprehensive WCAG 2.1 AA** (not just the high-impact subset).
- **Gate = a real a11y engine (axe-core)**, so the executor self-verifies against
  actual WCAG rules, not string matches.
- **Parity relaxed:** we do **not** need 1:1 class names with the original Subfolio
  PHP. This frees us to change element semantics, neutralize dead controls, and
  adjust palette values for contrast — the AGENTS.md "markup identical to PHP for
  diffing" rule no longer binds this phase. (CSS is still keyed off class names, so
  we keep existing classes where renaming them would force gratuitous SCSS churn —
  the freedom is to change *tags/structure/values*, not to rename for its own sake.)

**Model tiering (to conserve Claude sessions — see memory):** this plan + the gate
harness are the high-leverage work and are authored on **Opus** now. The moment it's
approved, switch to **`/deepseek`** to do the mechanical per-component remediation
against the gate, then a brief **Opus render-review** at the end (a green build ≠ a
correct render — Astro `<style>`/`<script>` interpolation traps have bitten before).

## Approach

Build the **gate first** (objective pass/fail), then remediate area-by-area until the
gate is green.

### 1. Automated a11y gate (build this first; it is the contract)

Two complementary checks, wired into `npm test`:

- **axe-core via Playwright over built `dist/`** — new `tests/a11y.axe.test.mjs`.
  - Add devDeps: `@playwright/test` (or `playwright`) + `@axe-core/playwright`.
  - Serve built `dist/` over HTTP so absolute `/css/main.css` resolves (contrast
    rules need real CSS): reuse the existing `astro preview`, or a tiny static
    server rooted at `dist/`. **file:// won't work** (absolute asset paths break).
  - Reuse the route list: import `EXPECTED_PAGES` concept from
    [tests/smoke.routes.test.mjs](tests/smoke.routes.test.mjs) (representative
    pages: root, a listing with embeds, a gallery folder, a file detail, the
    `.site`/`.oplx`/`.slide`/`.rss` views).
  - Run axe with tags `["wcag2a","wcag2aa","wcag21a","wcag21aa"]`; assert **zero
    violations** per page.
- **Pure-node contrast unit test** — new `tests/a11y.contrast.test.mjs`.
  - No browser. Load `src/config/colors-default.yml` + `colors-dark.yml`, compute
    WCAG contrast ratios for the foreground/background pairs the palette actually
    drives (body text on `back`, `text_light`, `text_dimmed`, `sub_link`,
    `feature_text_hover`, breadcrumb), assert ≥ 4.5:1 (normal) / 3:1 (large).
  - This is the fast, DeepSeek-friendly pre-check and the source of truth for the
    palette edits in step 5.
- Add scripts: `"test:a11y"` (build → serve → axe + contrast). Keep the existing
  `npm test` smoke suite as-is.

### 2. Layout & landmarks — [src/layouts/Layout.astro](src/layouts/Layout.astro)

- **Viewport (WCAG 1.4.4):** drop `user-scalable=no` →
  `content="width=device-width, initial-scale=1"`.
- **Main landmark:** make the content region a `<main id="content">` (currently a
  `<div>`). `<html lang="en">` already correct; Header/Footer already emit
  `<header>`/`<footer>`.
- **Skip link:** add `<a class="skip-link" href="#content">Skip to content</a>` as
  the first child of `<body>`, visually hidden until focused (style in SCSS, step 6).

### 3. Header navigation & icon-only controls — [src/layouts/Header.astro](src/layouts/Header.astro)

- Wrap the breadcrumb + prev/next in `<nav aria-label="Breadcrumb">` /
  `<nav aria-label="Pagination">`. Mark the current crumb with `aria-current="page"`.
- Icon-only links have **no accessible name** today. Add `aria-label` to prev/next
  (`Previous folder` / `Next folder`) and the collapse-header toggle; mark the
  decorative `<i class="icon …">` glyphs `aria-hidden="true"`. Disabled prev/next
  `<span>`s get `aria-disabled` semantics or are dropped from the tab order.

### 4. Listing semantics & dead controls — [src/components/listing/FilesAndFolders.astro](src/components/listing/FilesAndFolders.astro)

- **Dead `?sort=` links** (lines 55–67) do nothing on a static build — replace the
  `<a href="?sort=…">` header cells with plain `<span>` text (parity relaxed, so
  this is allowed). Removes broken keyboard/SR targets.
- Decorative filetype icons (`<i class="icon icon__…">`) → `aria-hidden="true"`.
- Give the list meaningful structure: the row `<a>` should expose the filename as
  its accessible name (the icon span is decorative). Consider `role="list"`/
  `role="listitem"` or a real list wrapper if axe flags the `<a><span>` grid; keep
  the `.list__*` classes so SCSS is untouched.

### 5. Images & contrast (the visible changes)

- **`alt` on every content image** — derive from the human filename already
  available (`file.displayName` / `image.filename` / `feature.title`); use `alt=""`
  for purely decorative embeds:
  - [Img.astro](src/components/filekinds/Img.astro) (4 `<img>`),
    [Gallery.astro](src/components/listing/Gallery.astro) (2),
    [InlineEmbeds.astro](src/components/listing/InlineEmbeds.astro) (line 46),
    [Features.astro](src/components/listing/Features.astro) (line 53).
- **Color contrast** — adjust the failing values in
  [src/config/colors-default.yml](src/config/colors-default.yml) (and
  `colors-dark.yml`) until the contrast unit test passes. Confirmed failures on
  white: `text #7F7F7F` (~4.0), `text_light #808080` (~3.9), `text_dimmed #CCC`
  (~1.6), `feature_text_hover #999`. Darken to hit ≥4.5:1 (e.g. `text`/`text_light`
  → ~`#717171`/darker; `text_dimmed` is the big offender — only acceptable on
  large/non-essential text, otherwise darken substantially). The palette feeds
  `colorCss` in Layout, so no markup change needed — values only.

### 6. Focus visibility & reduced motion — `src/styles/`

- Add a global `:focus-visible` outline (the `.focusable` rows/gallery links and all
  `<a>`/controls) in [src/styles/_resets.scss](src/styles/) or `_mixins.scss`, plus
  the `.skip-link` visually-hidden-until-focus rule. Run through `npm run gen-css`.
- Add a `@media (prefers-reduced-motion: reduce)` block neutralizing the jQuery
  `.animate()`/transition effects in `public/js/main.js` where feasible (at minimum,
  CSS transitions; JS-driven animation is best-effort and documented).

### 7. Legacy media `<embed>` alternatives — Vid/Snd/Swf

- [Vid.astro](src/components/filekinds/Vid.astro),
  [Snd.astro](src/components/filekinds/Snd.astro),
  [Swf.astro](src/components/filekinds/Swf.astro) emit a bare QuickTime/Flash
  `<embed>` with no accessible name or fallback. Wrap in a labelled region and
  ensure the `HideableDownloadBox` (accessible download link) is always reachable as
  the text alternative. Don't try to resurrect dead plugins — provide the download
  path as the a11y fallback.

## Critical files

- **New (gate):** `tests/a11y.axe.test.mjs`, `tests/a11y.contrast.test.mjs`;
  `package.json` (devDeps `@playwright/test`/`playwright` + `@axe-core/playwright`,
  `test:a11y` script).
- **Remediation:** `src/layouts/Layout.astro`, `src/layouts/Header.astro`,
  `src/components/listing/{FilesAndFolders,Gallery,InlineEmbeds,Features}.astro`,
  `src/components/filekinds/{Img,Vid,Snd,Swf}.astro`,
  `src/config/colors-default.yml`, `src/config/colors-dark.yml`,
  `src/styles/_resets.scss` (or `_mixins.scss`).
- **Watch (may need test updates):** existing `tests/smoke.*.test.mjs` assert exact
  markup (e.g. the `?sort=` cells, gallery `<img>` rule). Changing markup in step 4
  may require updating those assertions — keep them green.
- **Read-only reference:** [tests/_dist.mjs](tests/_dist.mjs) (gate helpers),
  [src/lib/site.ts](src/lib/site.ts) (display options), `public/js/main.js`.

## Verification

1. **Gate green:** `npm run build && npm run test:a11y` → axe reports **zero**
   wcag2a/2aa/21a/21aa violations across the route set; contrast unit test passes
   for both palettes.
2. **Existing suite still green:** `npm run build && npm test`.
3. **Keyboard pass (manual):** `npm run preview`, Tab from page load — skip link
   appears first and jumps to `<main>`; every row, gallery thumb, breadcrumb, and
   prev/next is reachable with a **visible** focus ring; no focus lands on a dead
   `?sort=` control.
4. **Zoom:** pinch/zoom to 200%+ works (viewport fix).
5. **Screen-reader spot check:** landmarks announce (`main`, `nav` ×2), images read
   sensible alt text, icon-only nav buttons announce names.
6. **Opus render-review (final, on `/anthropic`):** eyeball listing + detail +
   gallery pages to confirm the markup/landmark/contrast edits render correctly and
   visually hold — a green build does not prove the render.
