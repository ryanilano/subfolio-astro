# AGENTS.md

Cross-agent guidance for any AI tool in this repo (Claude Code, DeepSeek fan-out workers, Cursor, Codex, Aider). Committed because each parallel worktree agent starts with empty private memory. Architecture + build commands are in [CLAUDE.md](CLAUDE.md); this file holds the non-obvious gotchas.

## Astro: `<style>` and `<script>` are NOT interpolated

Astro treats `{expr}` inside `<style>` and raw-text `<script type="text/template">` as static text — it does not evaluate them.

- `{palette.back}` in `<style>` → **build fails** (lightningcss: "Unexpected token CurlyBracketBlock").
- `{site_root}` in `<script type="text/template">` → emitted literally as `{site_root}`.

**Fix:** build the content as a string in frontmatter, emit with `set:html={...}` (matches how upstream PHP `template_colors.php`/`header.inc.php` echo these). See `src/layouts/Layout.astro` (`colorCss`) and `src/layouts/Header.astro` (`dropdownHtml`). HTML-escape interpolated values when building the string yourself.

Same family:

- `<script src="/js/foo.js">` pointing at a `public/` asset needs `is:inline` or the build fails bundling it.
- Astro auto-escapes `{expr}` in markup. Don't put entities like `&mdash;` in an interpolated string — they double-escape to `&amp;mdash;`. Use the literal char (`—`).

## A green `astro build` does NOT prove a component renders

The build only compiles routes that are reached. A component no route instantiates keeps its render bugs invisible. (Phase 2 Gate's `Layout.astro` shipped four render bugs because its only route emitted its own HTML and never used `Layout`.)

**Before claiming a component works:** add a throwaway `src/pages/` page importing it with realistic props, `astro build`, grep output for leftover `{...}` and assert key markup is present. Delete the test page after.

## Component porting conventions

- Output filenames are **PascalCase** (`Vid.astro`, `DownloadBox.astro`) even though PHP sources are lowercase. Match `src/components/filekinds/Img.astro`.
- Filekind components take a `file: FileViewData` prop; listing components take a `FolderEntry`. Contract: `src/components/README.md`; data shapes: `src/loaders/schema.ts` + `src/lib/fileHelpers.ts`.
- Keep markup + CSS classes **identical** to PHP output — goal is visual diffing. Port logic, not design.

## DeepSeek output needs a render check, not just a build check

DeepSeek workers' recurring failure is "Astro treated as PHP" (the interpolation trap above). Review by rendering, not by trusting a green build.
