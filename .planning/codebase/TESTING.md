# Testing Patterns

**Analysis Date:** 2026-07-03

## Test Framework

**Runner:**
- Node's built-in test runner — `node --test` (no Jest/Vitest). Tests are ESM `.mjs`.
- Config: none — driven entirely by `package.json` scripts + file globs. No `jest.config`/`vitest.config` exists.

**Assertion Library:**
- `node:assert/strict` — `import assert from "node:assert/strict"` in every suite. Uses `assert.ok`, `assert.equal`, `assert.match`.

**Browser / a11y tooling:**
- `playwright` (chromium) + `@axe-core/playwright` for the a11y axe gate.

**Run Commands:**
```bash
npm run build          # REQUIRED first — all tests assert against dist/
npm test               # node --test tests/smoke.*.test.mjs  (structural smoke)
npm run test:a11y      # build → axe + contrast gates against dist/
npm run test:perf      # node --test tests/perf.budget.test.mjs (reads dist/perf-budget.json)
npm run test:seo       # node --test tests/seo.test.mjs
npm run perf           # build → scripts/perf-budget.mjs (writes dist/perf-budget.json)
```

**No unit-test layer for the loader.** The loader (`src/loaders/`) has no isolated unit tests; validation is by building the site and asserting against the rendered `dist/` HTML, plus manual render review (`CLAUDE.md`, `AGENTS.md`).

> **Known state:** there are pre-existing smoke-test failures (see memory `milestone6-perf`). A red smoke run is expected in places; do not assume all green.

## Test File Organization

**Location:** All tests live flat in `tests/`. Separate from `src/` (not co-located).

**Naming:** `<suite>.<name>.test.mjs`:
- `smoke.*.test.mjs` — `smoke.encoding`, `smoke.filekinds`, `smoke.listing`, `smoke.routes`, `smoke.thumbnails`
- `a11y.axe.test.mjs`, `a11y.contrast.test.mjs`
- `perf.budget.test.mjs`, `seo.test.mjs`, `picture.test.mjs`

**Shared helper:** `tests/_dist.mjs` (underscore = not a test file, excluded from the `smoke.*` glob). Read-only; test files import it, don't modify it.

## Test Structure

Flat `test("description", fn)` calls — no `describe` nesting. Section dividers are comment banners.

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { page } from "./_dist.mjs";

test("root listing renders top intro embed text", () => {
  const html = page("");
  assert.ok(html.includes('id="inline_top_text"'), "missing inline_top_text container");
  assert.ok(html.includes("Subfolio Enhancers"), "root top embed missing intro heading");
});
```

**Patterns:**
- Every assertion carries a **failure message** as the last arg — descriptive, states what was missing.
- File-header block comment documents the test's contract, its prerequisite (`npm run build` first), and which existing suite it mirrors ("Mirrors tests/smoke.routes.test.mjs conventions").
- `before`/`after` from `node:test` used for lifecycle setup (spin up server + browser) in `a11y.axe.test.mjs`.

## The `_dist.mjs` Contract (structural tests)

Tests assert against the **static build**, not a live dev server or components in isolation:

```javascript
export const DIST = resolve(ROOT, "dist");
export function page(route)       // read dist/<route>/index.html ("" or "/" = root), throws if absent
export function pageExists(route) // boolean
export function distFile(rel)     // read any file under dist/ (e.g. "css/main.css")
```
- `page()` **throws** on a missing route so absent pages fail loudly.
- Spaces in routes are literal (build writes `dist/05 display rss feed/index.html`, not percent-encoded).

## Assertion Idioms

**Structural HTML presence:**
```javascript
assert.ok(html.includes('id="features"'), "missing features container");
```

**Regex markup matching:**
```javascript
assert.match(html, /<img[^>]*src="\/directory\/00_thumbnails\/example\.png"/, "...");
```

**Exclusion / leakage checks** — slice the HTML into regions and assert an item is present in one and absent in another:
```javascript
const listingBlock = html.slice(html.indexOf('<div class="listing">'));
assert.ok(!listingBlock.includes("featured-file.txt"), "featured-file.txt leaked into plain listing");
```

**Report-shape assertions** (perf) — assert JSON shape so later phases can trust it:
```javascript
for (const key of ["generatedAt","pages","linkedAssets","fonts","images","largestAssets","budgets"])
  assert.ok(key in report, `report missing "${key}"`);
```

## Mocking

**None.** No mocking framework, no stubs, no fixture doubles. Tests exercise the real build output end-to-end. The `content/examples/` fixture directory is the test data — it exercises every naming convention (embeds, enhancers, `.slide`/`.site`/`.oplx`, `.rss`, `-access`, thumbnails).

## Fixtures and Test Data

- **Fixture:** `content/examples/` — the canonical content tree every test renders against. Routes referenced by name: `01_embedding_text_images`, `03_featuring_content`, `00_thumbnails`, `markdown_cheat_sheet.txt`, `04_html_prototype/04_html_prototype.site`, `08_project_plan.oplx`, `05 display rss feed`.
- **Representative-route arrays:** a11y/seo suites iterate a `ROUTES` list of one route per route-kind (`tests/a11y.axe.test.mjs:87`) and generate one `test()` per route in a loop.
- Constants pinned to config: `SITE = "https://subfolio-astro.ilano.fyi"` in `seo.test.mjs` must match `astro.config.mjs` `site`.

## A11y Gate (tests/a11y.axe.test.mjs)

- Serves `dist/` over a tiny `node:http` static server (so absolute `/css/main.css`, `/js/main.js` resolve — axe needs real CSS; `file://` won't work).
- Drives each route in headless chromium, waits for `networkidle`.
- Asserts **zero** violations for tags `["wcag2a","wcag2aa","wcag21a","wcag21aa"]`; failure message summarizes impact/id/help/nodes.
- Complemented by a pure-node palette contrast check in `a11y.contrast.test.mjs`.

## Perf Gate — "measure, don't block"

`perf.budget.test.mjs` asserts only the **structural shape** of `dist/perf-budget.json`. Soft-ceiling breaches are emitted as `console.log("WARN ...")` and **do not fail** the test. Only structural breakage fails. Generate the report first with `npm run perf`.

## Test Types

- **Structural smoke** (`smoke.*`) — assert rendered `dist/` HTML matches the ported PHP output (partial order, embed positions, filekind dispatch, redirects).
- **A11y** — axe + palette contrast against the built site.
- **SEO** — canonical/OG/Twitter head-meta contract.
- **Perf budget** — asset/page-weight report shape, warn-only.
- **Picture/image** (`picture.test.mjs`) — responsive-image markup.
- **E2E:** none beyond the axe playwright drive; `@playwright/test` is installed but no `*.spec.ts` E2E suite.

---

*Testing analysis: 2026-07-03*
