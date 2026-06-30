# Milestone 6 — Performance & Build Modernization

## Context

The Subfolio→Astro port is functionally complete (Phases 0–3, 5 done & live on Cloudflare
Pages; Phase 4 auth deliberately deferred). It was built as a **faithful, diff-able port** of
the 5-year-old PHP app — markup and classes were kept identical so the two could be compared
side-by-side. That constraint has now served its purpose and is **cut loose**: we're free to
change output to optimize.

The site is fast in architecture (pure SSG, no hydration) but carries heavy legacy payload.
Concrete baseline measured this session:

| Asset | Current | Problem |
|---|---|---|
| `public/js/main.js` | **225 KB jQuery 2.2.0, `is:inline` into every page's HTML** | ~80% unused; bloats every HTML doc, blocks parse |
| Fonts (`public/fonts/`) | **~600 KB** across 2 weights × eot/ttf/svg/woff/woff2 | **286 KB SVG format per weight** is dead weight; no `font-display`, no preload |
| Thumbnails | JPEG/PNG only (`gen-thumbs.mjs:105` `.toFile()`) | no WebP/AVIF |
| CSS | `main.css` 47 KB + `icons.css` 48 KB, **not minified** (`gen-css.mjs:96` omits `minify:true`) | ~96 KB unminified; `icons.css` async-loaded via a 2013-era JS polyfill |
| Gallery `<img>` | width/height present (good), but **no `loading="lazy"` / `decoding="async"`** | eager image download |
| Measurement | none | no Lighthouse, bundle budget, or regression guard |

**Outcome:** materially smaller per-page payload (target: kill the SVG fonts, minify CSS, ship
WebP/AVIF, get jQuery out of the HTML doc) with a **measurement harness** so wins are provable.
We reuse the proven **DeepSeek fan-out methodology** (Opus builds a Gate → DeepSeek workers
execute conflict-free per-file tasks in git worktrees → Opus render-reviews the merges).

### Decisions locked (this session)
- **Thrust:** performance & build. **Port fidelity:** cut loose. **Scope:** multi-phase milestone.
- **jQuery:** *split + defer only* this milestone (move it out of inline HTML into a cached,
  deferred external file). **Full vanilla teardown is explicitly out of scope** — a future
  optional phase once the budget harness shows its exact cost.
- **Budgets:** *measure, don't block* — track & report deltas; do **not** fail CI on regression.
- **Handoff:** I (Opus) author each phase's Gate + the `DEEPSEEK-TASKS-perf*.md` + a
  `run-deepseek-perf.sh` runner; **you launch the fan-out**; I render-review the merges.

### Out of scope
Visual redesign, jQuery→vanilla teardown, Phase 4 auth Worker, new app features (search/tags/etc.).

### Accountability requirements (this milestone, new)
1. **Per-task model/token ledger.** Every fanned-out task records which **backend/model** ran it
   (DeepSeek vs. Opus/Sonnet) and its **token + cost** footprint. Captured automatically from
   `claude -p --output-format json` (emits `usage.input_tokens`/`output_tokens`,
   `total_cost_usd`, `num_turns`, `duration_ms`, model id), aggregated into a per-phase ledger.
2. **Quant + qual results on every phase and the milestone.** Each phase closes with a results
   block: **quantitative** (byte/score deltas from the perf harness, token spend, model split)
   and **qualitative** (what changed, render-review verdict, risk notes). The milestone rolls
   these up. This is the proof-of-work, not just a checkbox.

---

## Fan-out reality (important)

The original waves fanned out cleanly because each task = **one new file** (disjoint, conflict-free
merges). Perf work mostly **edits shared files**, which does *not* fan out safely. So the split is:

- **Opus owns the hot shared files** (serialize, no merge conflicts): `src/layouts/Layout.astro`,
  `scripts/gen-css.mjs`, and the **reference `<picture>` pattern** in one component.
- **DeepSeek fans out the disjoint work**: per-component image edits, `gen-thumbs.mjs`, new
  budget/test files, the font partial, docs — each task touches a *different* file, mirroring a
  reference the Gate pins (exactly how the Phase-2 Wave mirrored `Img.astro`).

Per [AGENTS.md](../../AGENTS.md): a green `astro build` does **not** prove a render. Every merge gets a
render-review (`npm run preview`, grep `dist/` for leftover `{...}` tokens, eyeball the page).

---

## Phase A — Measurement Gate (Opus)

The Gate every later wave verifies against. **No behavior change; establishes the baseline.**

- **New `scripts/perf-budget.mjs`** — walks `dist/` after build, reports per-page-type byte
  weight (HTML, linked CSS, linked/inline JS), total font bytes, total image bytes, and the
  largest single assets. Prints a table + writes `dist/perf-budget.json`. **Warn-only** (never
  exits non-zero) per the locked decision.
- **New `tests/perf.budget.test.mjs`** — asserts presence/shape of the report and soft ceilings
  (logs a `WARN` line over budget, still passes). Mirrors the structure of
  [tests/smoke.routes.test.mjs](../../tests/smoke.routes.test.mjs) + [tests/_dist.mjs](../../tests/_dist.mjs).
- **`package.json`** — add `"perf": "npm run build && node scripts/perf-budget.mjs"`.
- **Author the fan-out scaffolding**: `docs/DEEPSEEK-TASKS-perf.md` (task briefs) and
  `docs/run-deepseek-perf.sh` (copy of [docs/run-deepseek-tasks.sh](../../docs/run-deepseek-tasks.sh):
  worktree-per-task off `main`, throttled parallel `claude -p`, proxy auto-switch with EXIT-trap
  restore, **guard check that `scripts/perf-budget.mjs` exists** before fanning out).
- **Build the model/token ledger into the runner** (the new accountability req): launch each
  worker with `claude -p --output-format json` instead of plain `-p`, tee the JSON to
  `$WT_DIR/$id.json`, and after fan-out run a small `scripts/ledger.mjs` that reads every
  `*.json`, extracts `model` / `usage.{input,output}_tokens` / `total_cost_usd` / `num_turns` /
  `duration_ms`, and writes a Markdown table + `docs/ledger-perf.json`. Opus-run tasks are logged
  too (model id distinguishes them), so the **DeepSeek-vs-Anthropic split is provable per phase**.

**Done when:** `npm run perf` prints a baseline table + writes the JSON; `scripts/ledger.mjs`
produces a per-task model/token table from a dry-run; the new test is green; existing smoke +
a11y suites still green. Commit the captured baseline numbers into the task doc so workers can
show deltas, and fill the milestone scoreboard's "before" row.

---

## Phase B — Asset quick wins (Opus single-file + small DeepSeek fan-out)

Highest payoff-per-effort. Each item below is one disjoint file → a clean DeepSeek task, except
the two Layout.astro items (Opus).

| Task | File | Owner |
|---|---|---|
| **B1** CSS minify | `scripts/gen-css.mjs` — pass `minify: true` to lightningcss `transform()` (line ~96). ~20–30% CSS cut. | DeepSeek (1-line, mirror-trivial) or Opus |
| **B2** Font diet | `src/styles/_typography.scss` — drop `eot`/`ttf`/`svg` from `@font-face`, keep `woff2`+`woff`; add `font-display: swap`. Delete the now-unused font files from `public/fonts/`. Kills ~286 KB SVG × 2 weights. | DeepSeek |
| **B3** Lazy images | `src/components/listing/Gallery.astro`, `Features.astro`, `src/components/filekinds/Img.astro` — add `loading="lazy"` + `decoding="async"` (Gallery/Features; Img detail keep eager). Disjoint files → parallel tasks. | DeepSeek ×3 |
| **B4** Font preload + native-async icons.css | `src/layouts/Layout.astro` — `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the two woff2; replace the `A17.loadCSS("/css/icons.css")` JS polyfill with `<link rel="stylesheet" media="print" onload="this.media='all'">`. | **Opus** (hot file) |

**Done when:** `npm run perf` shows CSS + font bytes dropped vs. Phase-A baseline; pages render
identically (render-review Gallery, a detail page, the font swap); a11y suite green.

---

## Phase C — Modern image formats (Opus Gate + DeepSeek)

The meatier win. **Opus builds the Gate** (the format change + one reference `<picture>`), then
DeepSeek mirrors the `<picture>` pattern to the remaining image surfaces.

- **Gate (Opus):**
  - `scripts/gen-thumbs.mjs` — emit WebP (and optionally AVIF) alongside/instead of the source
    format via `sharp(...).webp({quality})` / `.avif(...)`, writing siblings into `.thumb-cache/`.
    Keep the staleness + size-guard + dimension rules intact (lines 76–106).
  - `src/lib/routing.ts` — extend `thumbnailFor()` / add a helper so a component can get the
    WebP/AVIF URL set, not just one `url`.
  - **Reference component:** convert **`Gallery.astro`** to emit `<picture>` with
    `<source type="image/avif">` + `<source type="image/webp">` + `<img>` fallback (width/height
    preserved to keep zero-CLS). Pin this as the pattern in the task doc.
- **DeepSeek fan-out:** mirror the `<picture>` pattern into `Features.astro` and `Img.astro`
  (retina-aware variants) — disjoint files, mirror the Gate component.

**Done when:** `.thumb-cache/` contains WebP/AVIF; `/directory/` route serves them (the two-phase
build ordering gotcha — generate in the pre-build pass, see
[memory: astro-two-phase-build-ordering]); `npm run perf` shows image bytes down; a Gallery page
visually identical in a modern browser, JPEG/PNG fallback still served. Render-review required.

---

## Phase D — jQuery split + defer (Opus, low-risk)

Get the 225 KB out of the HTML document. **No teardown** — same jQuery+A17, just delivered better.

- `src/layouts/Layout.astro` — change the end-of-body `<script src="/js/main.js" is:inline>` to a
  cacheable **external, deferred** script (drop `is:inline` so it's a real cached request with a
  `?v=` cache-bust; add `defer`). Verify A17 init still runs after DOM (it's already at body end).
- **Smoke-test the behaviors that depend on it**: `.pop` popups (`A17.Helpers.pop`), gallery
  masonry (`data-behavior="masonry"`), `.slide` prev/next, search autocomplete. These are the
  risk surface; render-review each on the fixture.

**Done when:** the HTML doc no longer contains the inlined 225 KB (perf table confirms per-page
HTML weight drops sharply); jQuery loads once, cached, deferred; all four behaviors verified live.

---

## Phase E — Head & SEO polish (Opus + optional fan-out)

- `src/layouts/Layout.astro` — add Open Graph + Twitter Card meta (title/description/image from
  the folder entry; the gallery's first thumbnail is a sensible `og:image`), `preconnect` if any
  cross-origin remains. These are absent today.
- **Optional / behind a flag:** Astro `ClientRouter` (View Transitions) for SPA-like nav — only if
  Phase D's deferred jQuery coexists cleanly. Flag as a stretch item; do not block the milestone.

**Done when:** OG tags present and validated (sharing preview), a11y + smoke + perf suites green.

---

## Results blocks (close every phase with this)

Each phase (A–E) ends by appending a results block to its section — the proof-of-work the
accountability req demands. Template:

```
### Phase X — Results
Quantitative:
- Perf delta (vs. baseline): HTML/page __ KB → __ KB, CSS __ → __, fonts __ → __, images __ → __
- Lighthouse (optional): perf __ → __
- Cost: $__ total; tokens __ in / __ out; backends — DeepSeek __ tasks, Anthropic __ tasks
Qualitative:
- What changed (1–2 lines)
- Render-review verdict (pages checked, leftover `{...}` grep clean? behaviors verified?)
- Risk / follow-ups
```

The numbers come straight from `dist/perf-budget.json` (perf harness) and `docs/ledger-perf.json`
(model/token ledger) — not hand-tallied.

## Milestone scoreboard

A single rollup table maintained in [docs/ROADMAP.md](../../docs/ROADMAP.md) (and mirrored at the top
of `DEEPSEEK-TASKS-perf.md`), one row per metric, `before → after`:

| Metric | Before (Phase A baseline) | After (milestone close) |
|---|---|---|
| Per-page HTML weight | (jQuery inline) | |
| CSS bytes (main+icons) | ~96 KB unminified | |
| Font bytes shipped | ~600 KB (5 formats ×2) | |
| Image bytes (gallery sample) | JPEG/PNG | |
| Lighthouse perf (optional) | | |
| Total token spend / cost | | |
| DeepSeek vs Anthropic task split | | |

Qualitative milestone summary: one paragraph on what "modernized" delivered, the
measure-don't-block budget posture, and what's deliberately left (jQuery teardown, View
Transitions, auth) for a future milestone.

## Verification (whole milestone)

1. **Baseline → delta:** `npm run perf` before (Phase A) and after each phase; the JSON/table is
   the scoreboard. Target: per-page HTML weight down (jQuery out), CSS bytes down (minify),
   font bytes down (SVG/EOT gone), image bytes down (WebP/AVIF).
2. **Don't trust the build:** for every DeepSeek merge, `npm run preview` and **render-review** the
   affected page; grep `dist/` for leftover `{...}` interpolation tokens (the Astro
   `<style>`/`<script>` trap — see [memory: astro-no-interpolation-in-style-and-script]).
3. **Regression suites stay green:** `npm run test` (smoke) and `npm run test:a11y` (axe +
   contrast) after each phase — these are the existing safety net; do not let perf work break them.
4. **Behavior smoke (Phase D especially):** `.pop`, masonry, `.slide` stepping, search on the
   `content/examples/` fixture.
5. **Optional external check:** Lighthouse against `npm run preview` (or the live Pages URL after
   deploy) to corroborate the in-repo budget numbers.

## Sequencing & handoff

- **Order:** A (measure) → B (quick wins) → C (images) → D (jQuery) → E (head/SEO). A is the
  prerequisite Gate; B–E each rebaseline against it. C and D are independent and could swap.
- **Per phase:** I author the Gate + `DEEPSEEK-TASKS-perf.md` task briefs + ensure
  `run-deepseek-perf.sh` guards are right → **you launch** `./docs/run-deepseek-perf.sh` → I merge
  + render-review each branch, tear down worktrees (`git worktree remove`).
- **Commits:** offer to squash each phase to one commit before pushing (per
  [memory: git-squash-per-phase]); push to `main` auto-deploys via the existing GitHub Actions CI.
- **Docs:** update [docs/ROADMAP.md](../../docs/ROADMAP.md) with this as the post-port milestone and
  check off phases as they land.
