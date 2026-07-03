# Codebase Concerns

**Analysis Date:** 2026-07-03

This is `subfolio-astro`, an Astro 6 static-site port of the PHP (Kohana 2.x) Subfolio engine. Many "concerns" below are **intentional deferrals** captured as parsed-but-unenforced intent, not bugs — they are flagged as such. Genuine bugs and fragility are called out separately.

## Tech Debt

**`-access` rules parsed but never enforced (intentional deferral, real authorization gap):**
- Issue: `-access` files are parsed into typed allow/deny rules and attached to folder entries as metadata, but nothing consumes them. The static build serves every byte publicly.
- Files: `src/loaders/access.ts` (parses, explicitly documents "there is NO enforcement"), `src/pages/directory/[...path].ts:11` ("Everything served here is public"), `docs/ROADMAP.md` Phase 4.
- Impact: Any folder the author marked access-gated is fully readable by anyone who knows/guesses the URL. This is a design decision (Phase 4 auth Worker "skipped entirely until the need is real"), but it is a live security/authorization gap for any deployment that assumes `-access` means something. See Security Considerations below.
- Fix approach: Implement the deferred Phase 4 Cloudflare Worker (login, KV sessions, `-access` evaluation, gated serving) per `docs/spec/SPEC-auth.md` / `docs/spec/SPEC-access.md`. Until then, do not host non-public content.

**Deferred behaviors captured as parsed intent (intentional):**
- Most Phase 1 "deferred" items (sharp dimensions, RSS fetch, Textile/Markdown render) were subsequently implemented in Phases 3 and 5 per `docs/ROADMAP.md`. The remaining true deferral is `-access` enforcement (above).
- Files: `docs/ROADMAP.md` (Phase 3–5 status), `CLAUDE.md` (Phase roadmap).

**Slide/breadcrumb port carries a labelled HACK:**
- Issue: The `.slide` parent-link behavior is a direct port of the PHP "HACK FOR SLIDE" (`Subfolio::parent_link`), preserved verbatim for fidelity rather than cleanly modeled.
- Files: `src/lib/routing.ts:87`, `src/pages/[...path].astro:114`.
- Impact: Low — works, but is fragile logic that future refactors can silently break; only covered by rendering, not a unit test.
- Fix approach: Add a focused test for `.slide` redirect + prev/next stepping before refactoring.

## Known Bugs

Three smoke tests fail on the current build (confirmed via `npm test`: **21 pass, 3 fail**). These are pre-existing and read against `dist/`, so a stale/missing build can also surface them — build first (`npm run build`) to isolate genuine failures.

**Raw-byte serving smoke test fails:**
- Symptoms: `/directory/<path> serves raw file bytes` fails.
- Files: `tests/smoke.routes.test.mjs`, endpoint under test `src/pages/directory/[...path].ts`.
- Trigger: `npm test` against `dist/`. The `/directory/` route is a static endpoint; the test asserts served bytes exist in the build output.
- Workaround: None; investigate whether the endpoint emits expected static files during `astro build`.

**Markdown `.txt` renders raw source instead of HTML:**
- Symptoms: `markdown .txt renders formatted HTML, not raw # source` fails — the `#`-prefixed markdown source is emitted rather than rendered HTML.
- Files: `tests/smoke.filekinds.test.mjs`; render path via `src/lib/routing.ts` `componentForKind` → the `.txt`/text filekind component; markdown engine wired in Phase 5.
- Trigger: `npm test`.
- Workaround: None documented. Phase 5 claims Markdown body rendering is done; this test disagrees — reconcile.

**Featured-listing exclusion fails:**
- Symptoms: `03_featuring_content excludes featured targets from plain listing` — expected an empty-listing message when all items are featured, got a non-empty listing.
- Files: `tests/smoke.listing.test.mjs:86` (assertion at `:91`); logic in `src/lib/listingHelpers.ts`.
- Trigger: `npm test`.
- Workaround: None. Either the fixture `03_featuring_content` or the exclusion filter is off.

## Security Considerations

**Public serving of all content (no auth):**
- Risk: `-access` deny/allow rules are inert; gated folders are served openly under `/directory/<path>`.
- Files: `src/pages/directory/[...path].ts`, `src/loaders/access.ts`.
- Current mitigation: None. Path-traversal is guarded (see below), but there is zero authorization.
- Recommendations: Only publish public content until Phase 4 lands. Treat every file in the content root as world-readable.

**Path traversal — guarded (good):**
- The raw-byte endpoint rejects traversal: `safeResolve()` resolves against each root and returns `null` unless the absolute path equals the root or starts with `root + "/"`, returning 403 otherwise.
- Files: `src/pages/directory/[...path].ts:102-119`.
- Note: Guard relies on `path.resolve` normalization; does not resolve symlinks, so a symlink inside the content root pointing outside it would be followed. Low risk for a curated content dir, but worth noting if `SUBFOLIO_CONTENT_DIR` points at untrusted trees.

**Hidden ≠ private:**
- `-hidden`/`.`-prefixed and enhancer-extension files are hidden from listings but still read and, where referenced (embeds, features), their bytes are served publicly via `/directory/`. Hidden is a display convention, not an access control.
- Files: `src/loaders/conventions.ts`, `src/pages/directory/[...path].ts`.

## Performance Bottlenecks

**Build-time generation is fully re-run each dev/build:**
- Problem: `npm run dev`/`build` chain five sequential `gen-*.mjs` passes (thumbs, embeds, css, rss, oplx) before `astro`. Cold builds pay full sharp resize + RSS fetch cost.
- Files: `package.json` scripts; `scripts/gen-thumbs.mjs`, `gen-embeds.mjs`, `gen-css.mjs`, `gen-rss.mjs`, `gen-oplx.mjs`.
- Cause: Pre-build passes must complete before `getStaticPaths` runs (two-phase build ordering). Caches are resize-if-stale, so warm builds are cheaper.
- Improvement path: Already largely optimized in Milestone 6 (WebP/AVIF, font diet, CSS minify). RSS fetch at build time depends on network — a slow/failing feed slows the build.

**RSS fetch at build depends on live network:**
- Problem: `scripts/gen-rss.mjs` fetches feeds during the build; a slow or down feed delays or degrades the build output.
- Files: `scripts/gen-rss.mjs`, cache `.rss-cache/`.
- Improvement path: Ensure graceful fallback to cached `.rss-cache/` on fetch failure.

## Fragile Areas

**Astro `<style>`/`<script>` interpolation trap:**
- Files: documented in `AGENTS.md`; live examples `src/layouts/Layout.astro` (`colorCss`), `src/layouts/Header.astro` (`dropdownHtml`).
- Why fragile: `{expr}` inside `<style>` fails the build; inside raw `<script>` it emits literally. New contributors (and DeepSeek fan-out workers) reintroduce this repeatedly ("Astro treated as PHP").
- Safe modification: Build strings in frontmatter, emit with `set:html={...}`, HTML-escape interpolated values. Grep built output for leftover `{...}`.
- Test coverage: `tests/smoke.encoding.test.mjs` catches some cases; no lint rule prevents it.

**Green build ≠ working render:**
- Files: `AGENTS.md` ("A green `astro build` does NOT prove a component renders").
- Why fragile: Only routed components compile-render; unrouted components hide render bugs. Phase 2 Gate shipped four render bugs this way.
- Safe modification: Add a throwaway `src/pages/` page importing the component with realistic props, build, grep for leftover `{...}`, then delete. Do not trust CI green alone.
- Test coverage: Smoke tests assert against `dist/` markup, partially mitigating this — but only for routed pages.

**Two-phase build ordering:**
- Files: `package.json` build script; consumers `src/pages/directory/[...path].ts` (reads `.thumb-cache/`, `.oplx-cache/`, `.embed-cache/`), `src/pages/[...path].astro`.
- Why fragile: `getStaticPaths` runs before render; artifacts must be generated in the pre-build `gen-*` passes, not lazily. Reordering or dropping a `gen-*` step silently drops routes/files.
- Safe modification: Keep the pre-build pass ordering intact; add new generated artifacts to both the script chain and `.gitignore`.

**Lenient YAML swallows malformed input:**
- Files: `src/loaders/yaml.ts:25-33` (`parseSubfolioYaml` returns `{}` on parse failure or empty).
- Why fragile: A malformed enhancer/config YAML silently becomes an empty object — no warning, no build failure. Authoring errors (typos in `.ftr`, `.pop`, `-access`, `settings.yml`) vanish instead of surfacing.
- Impact: Missing features/embeds/access rules appear as "author didn't configure it" rather than "config is broken." Matches old PHP leniency by design, but hides mistakes.
- Safe modification: Consider logging a build-time warning (not error) with the file path when `parse()` throws, so authors get a signal without breaking the build.

## Scaling Limits

**Whole content tree walked into memory at build:**
- Current capacity: Fine for the demo fixture and typical portfolio sizes.
- Files: `src/loaders/index.ts` (walks tree, one entry per directory), `src/pages/directory/[...path].ts` `walkFiles()` (recursive `readdirSync`, collects every file path into a `Set`).
- Limit: Both `getStaticPaths` and the loader materialize the full file/dir list synchronously in memory. Very large content trees (tens of thousands of files) will inflate build memory and time.
- Scaling path: Stream/paginate the walk, or move to on-demand (hybrid/SSR) serving for large trees.

## Dependencies at Risk

**Ported-from stack is long EOL (source, not this app):**
- Risk: Upstream Subfolio is Kohana 2.x / PHP 5.6, both EOL. This port exists precisely to escape that; noted only because spec fidelity to a dead engine constrains refactors.
- Files: `docs/ROADMAP.md`, `docs/spec/`.

**Runtime deps are current and pinned by caret:**
- `astro ^6.4.2`, `sharp ^0.34.5`, `yaml ^2.6.1`, `rss-parser ^3.13.0`, `@astrojs/sitemap ^3.7.3` (`package.json`). Caret ranges mean minor/patch drift between installs; a lockfile should pin exact versions for reproducible Cloudflare builds — verify `package-lock.json` is committed.

## Missing Critical Features

**Auth Worker (Phase 4) — deferred:**
- Problem: No login, sessions, or `-access` enforcement.
- Blocks: Any private/gated content. See Security Considerations.
- Files: specs at `docs/spec/SPEC-auth.md`, `docs/spec/SPEC-access.md`; no implementation.

## Test Coverage Gaps

**No unit tests — smoke/structural only:**
- What's not tested: Loader parsing units (`conventions.ts`, `enhancers.ts`, `embeds.ts`, `access.ts`, `yaml.ts`) have no direct unit tests; coverage is structural assertions against `dist/`.
- Files: `tests/smoke.*.test.mjs` (build-output assertions), `tests/a11y.*`, `tests/perf.budget.test.mjs`, `tests/seo.test.mjs`, `tests/picture.test.mjs`.
- Risk: Parser regressions (e.g., Spyc `key:>` normalization, position-prefix embed grouping, enhancer body parsing) surface only if they happen to change rendered output on the fixture.
- Priority: Medium — add unit tests for the loader modules, especially `yaml.ts` leniency and `access.ts` rule parsing.

**`.slide` / breadcrumb HACK untested:**
- What's not tested: The ported "HACK FOR SLIDE" parent-link and prev/next stepping.
- Files: `src/lib/routing.ts:87`, `src/pages/[...path].astro:114`.
- Risk: Silent breakage on refactor.
- Priority: Medium.

**Tests require a fresh build and can false-fail on stale `dist/`:**
- What's not tested cleanly: `npm test` reads `dist/`; it does not build first (`test:a11y`/`perf` do). Running `npm test` against a stale build produces misleading failures.
- Files: `tests/_dist.mjs` (documents "Always build first"), `package.json` `test` script.
- Risk: The 3 known failures conflate genuine bugs with stale-build artifacts; run `npm run build` before `npm test` to isolate.
- Priority: Low — make the `test` script build first, or document it in the runner.

**Perf/a11y budgets are warn-only, never fail CI:**
- What's not tested (gating): Milestone 6 adopted a "measure-don't-block" posture; no perf gate fails CI.
- Files: `scripts/perf-budget.mjs`, `tests/perf.budget.test.mjs`, `docs/ROADMAP.md` Milestone 6.
- Risk: Performance regressions land silently.
- Priority: Low (deliberate decision).

---

*Concerns audit: 2026-07-03*
