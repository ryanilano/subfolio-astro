# Coding Conventions

**Analysis Date:** 2026-07-03

## Naming Patterns

**Files:**
- Loader/lib modules: lowercase camelCase `.ts` — `src/loaders/conventions.ts`, `src/lib/fileHelpers.ts`, `src/lib/routing.ts`.
- Astro components: **PascalCase** `.astro` even when the ported PHP source is lowercase — `src/components/filekinds/Img.astro`, `src/components/filekinds/DownloadBox.astro`, `src/layouts/Layout.astro`. (Rule stated in `AGENTS.md` "Component porting conventions".)
- Build scripts: `scripts/gen-*.mjs` (kebab), one per pre-build pass (`gen-thumbs`, `gen-embeds`, `gen-css`, `gen-rss`, `gen-oplx`).
- Tests: `tests/<suite>.<name>.test.mjs` — `smoke.listing.test.mjs`, `a11y.axe.test.mjs`, `perf.budget.test.mjs`.

**Functions:**
- camelCase, verb-first predicates return `boolean` with `is`/`has` prefix — `isHidden()`, `isThumbnailDir()`, `positionOf()`, `fileEnhancerOf()` (`src/loaders/conventions.ts`).
- Coercion helpers prefixed `as` — `asNumber()`, `asString()` (`src/loaders/yaml.ts`).

**Variables:**
- camelCase locals; short single-letter for the primary prop (`const f = Astro.props.file`) in filekind components (`src/components/filekinds/Img.astro:21`).
- Module-level constants SCREAMING_SNAKE — `DEFAULT_CONVENTION_CONFIG`, `THUMBNAIL_DIRS`, `POSITION_PREFIX`, `FILE_ENHANCER_EXT` (`src/loaders/conventions.ts`).

**Types:**
- PascalCase interfaces/types — `ConventionConfig`, `Position`, `FileEnhancer`, `FolderEnhancer`.
- Domain types are derived from the Zod schema via `z.infer`, not hand-written — `FolderEntry`, `ChildFile`, `ChildFolder`, `Embed`, `Feature`, `Related`, `AccessRules` all originate in `src/loaders/schema.ts`.

## Code Style

**Formatting:**
- No Prettier/ESLint/Biome config committed (none of `.eslintrc*`, `.prettierrc*`, `eslint.config.*`, `biome.json` present). Style is enforced by convention + review, not tooling.
- 2-space indent, double-quoted strings, semicolons, trailing commas in multiline literals throughout `src/`.

**Linting / type-checking:**
- `astro check` runs in the `build` script (`package.json:14`) — types are the gate, not a linter.
- TypeScript is **strict**: `tsconfig.json` extends `astro/tsconfigs/strict`, includes `**/*`, excludes `dist`.
- Explicit `.ts`/`.mjs` extensions in relative imports (ESM, `"type": "module"`) — `import { siteConfig } from "../../lib/site.ts"`.

## Import Organization

**Order (observed):**
1. `node:*` builtins — `import { test } from "node:test"`, `node:fs`, `node:path`, `node:url`.
2. Third-party — `astro/zod`, `yaml`, `playwright`, `@axe-core/playwright`.
3. Local relative modules with explicit extension — `./_dist.mjs`, `../../lib/fileHelpers.ts`.
- `import type { ... }` used for type-only imports in components (`src/components/filekinds/Img.astro:15`).

**Path aliases:** None. Relative paths only.

## Error Handling

**Lenient-parse philosophy (core rule):** user-authored content must never break the build. `parseSubfolioYaml()` wraps `parse()` in try/catch and returns `{}` on failure (`src/loaders/yaml.ts:25`). Mirrors the old PHP Spyc leniency.
- Coercion helpers take a fallback and defensively type-check before converting (`asNumber(v, fallback)`).
- Nullish-coalescing for absent lookups — `FILE_ENHANCER_EXT[extOf(name)] ?? null`.

## Logging

**Framework:** `console` only. No logging library.
- Tests emit `WARN` via `console.log` for soft-budget breaches (measure-don't-block posture) — `tests/perf.budget.test.mjs:79`.

## Comments

**Heavy, explanatory JSDoc-style block comments are the norm.** Every module and most exported functions carry a block comment that:
- names the PHP source being ported and the spec section (`Ports Filebrowser::is_hidden() (SPEC-conventions §1, §6)`);
- flags deferred behavior by phase (`Dimensions deferred to Phase 3 (sharp)`, `Rendering deferred to Phase 5`) — `src/loaders/schema.ts`.
- Zod field-level `/** ... */` doc comments document intent inline (`src/loaders/schema.ts:14-60`).

## Function Design

- Small, single-responsibility pure functions in loaders (`stripPosition`, `extOf`, `displayName`).
- Record-lookup tables preferred over switch chains (`POSITION_PREFIX`, `FILE_ENHANCER_EXT`).
- Config passed as a parameter with a default constant (`isHidden(name, cfg = DEFAULT_CONVENTION_CONFIG)`).

## Module Design

**Zod schema is the single source of truth.** `src/loaders/schema.ts` defines the Zod objects; all loader modules `z.infer` their types from it rather than declaring parallel interfaces. Change the schema, and the types propagate.

**Astro component contracts:**
- Filekind components take a `file: FileViewData` prop; listing components take a `FolderEntry`. Contract documented in `src/components/README.md`; data shapes in `schema.ts` + `src/lib/fileHelpers.ts`.
- Ported markup preserves PHP CSS classes and structure verbatim for visual diffing — "Port logic, not design" (`AGENTS.md`).

## Astro-Specific Gotchas (from AGENTS.md — enforce when writing components)

- **No `{expr}` interpolation inside `<style>` or `<script type="text/template">`.** Astro treats it as static text; `{palette.back}` in `<style>` fails the lightningcss build. Build the string in frontmatter and emit with `set:html={...}` (see `src/layouts/Layout.astro` `colorCss`, `src/layouts/Header.astro` `dropdownHtml`). HTML-escape values you interpolate yourself.
- **`<script src>` to a `public/` asset needs `is:inline`** or bundling fails.
- **Don't put HTML entities in interpolated strings** — Astro auto-escapes, so `&mdash;` becomes `&amp;mdash;`. Use the literal char (`—`).
- **A green `astro build` does not prove a component renders.** Only reached routes compile. Verify by rendering a throwaway page and grepping output for leftover `{...}`, then delete it.

---

*Convention analysis: 2026-07-03*
