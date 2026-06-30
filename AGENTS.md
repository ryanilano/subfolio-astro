# AGENTS.md

Shared guidance for any AI agent or tool working in this repo (Claude Code,
DeepSeek fan-out workers, Cursor, Codex, Aider, etc.). This is the cross-agent
channel — anything every worker must know lives here, committed, because each
parallel worktree agent starts with empty private memory.

Project-specific architecture and build commands are in [CLAUDE.md](CLAUDE.md).
This file adds the hard-won gotchas that aren't obvious from the code.

## Astro: `<style>` and `<script>` are NOT interpolated

Astro does **not** evaluate `{expr}` inside `<style>` blocks or inside
`<script type="text/template">` (and similar raw-text scripts). It treats them
as static CSS / opaque text.

- `{palette.back}` inside `<style>` → **build fails**: lightningcss reports
  "Unexpected token CurlyBracketBlock".
- `{site_root}` inside `<script type="text/template">` → emitted **literally**
  as the string `{site_root}`.

**Fix:** build the content as a string in frontmatter and emit it raw with
`set:html={...}`. This also matches how the upstream PHP (`template_colors.php`,
`header.inc.php`) echoes these blocks. See `src/layouts/Layout.astro`
(`colorCss`) and `src/layouts/Header.astro` (`dropdownHtml`) for the pattern —
remember to HTML-escape interpolated values when you build the string yourself.

Related traps in the same family:
- A `<script src="/js/foo.js">` pointing at a `public/` asset needs `is:inline`,
  or the build fails trying to bundle it.
- Astro auto-escapes `{expr}` in markup. Don't put HTML entities like `&mdash;`
  in an interpolated string — they double-escape to visible `&amp;mdash;`. Use
  the literal character (`—`).

## A green `astro build` does NOT prove a component renders

The build only compiles the routes that are actually reached. If no page
instantiates a layout/component, its render bugs stay invisible. (The Phase 2
Gate's `Layout.astro` shipped with four render bugs because the only route,
`/debug/[...path].astro`, emits its own HTML and never used `Layout`.)

**Before claiming a component works:** add a throwaway page under `src/pages/`
that imports it with realistic props, `astro build`, then grep the output for
leftover `{...}` tokens and assert key markup is present. Delete the test page
after.

## Component porting conventions (Phase 2 Wave)

- Output filenames are **PascalCase** (`Vid.astro`, `DownloadBox.astro`), even
  though the upstream PHP sources are lowercase. Match `src/components/filekinds/Img.astro`.
- Filekind components take a `file: FileViewData` prop; listing components take a
  `FolderEntry`. The prop contract is `src/components/README.md`; the data shapes
  are `src/loaders/schema.ts` + `src/lib/fileHelpers.ts`.
- Keep markup and CSS classes **identical** to the PHP output — the goal is
  visual diffing against the live PHP app. Port logic, not design.

## DeepSeek-built Astro needs a render check, not just a build check

When DeepSeek workers port views, the recurring failure mode is "Astro treated
as if it were PHP" (the `<style>`/`<script>` interpolation trap above). Review
DeepSeek output by rendering it, per the section above — don't trust a green
build.
