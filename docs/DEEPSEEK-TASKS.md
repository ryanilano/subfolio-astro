# DeepSeek-Offloadable Tasks — Phase 2 (Themes → Astro components)

Decomposition of **Phase 2** from [ROADMAP.md](./ROADMAP.md) into self-contained units that
each run on their own branch via the DeepSeek backend (`/deepseek` to switch the proxy,
`/anthropic` to switch back). Adapted from the original Go-port fan-out: same shape (a Gate
built in Opus, then a wave of conflict-free mechanical ports offloaded to DeepSeek in
parallel worktrees), new unit of work (one Astro component per PHP view).

## How to use this

- **One branch per task.** Branch name is given per task. Branch off `main`.
- **Each task brief is the prompt.** It lists exactly what to read, what to produce, and the
  "done when" bar. No extra context needed.
- **Source PHP views live in the UPSTREAM repo**, not in this repo's worktrees. Read them at
  the absolute path `/Users/ryan/local-dev/subfolio/config/themes/default/`. Write the new
  `.astro` components into *this* repo (the worktree).
- **The Wave is conflict-free** — every task writes a *new* `.astro` file under
  `src/components/` (filekinds) or `src/components/listing/` (listings), so branches merge
  cleanly in any order, in parallel.
- **Keep markup and CSS classes identical** to the PHP output. The whole point is visual
  diffing against the live PHP app on the same content. Port logic, not design.
- DeepSeek is strong at mechanical PHP→Astro translation and reading existing code; weaker at
  architecture. That is exactly why the Gate (below) is built in Opus first, not offloaded.

---

## Gate — Astro theme skeleton + prop contract (do this in Opus, NOT DeepSeek)

This sets the shared contract every Wave task depends on, so it must be right before fan-out.
Build it on `main` (or a long-lived `phase-2` branch the Wave tasks branch from).

**Produces:**
1. `src/layouts/Layout.astro` — ported from upstream `layouts/template.php` +
   `header.inc.php` + `footer.inc.php` + `prev_next.inc.php` + `template_colors.php`. Wires
   the SCSS import pipeline and color themes (`colors/default.yml`, `colors/dark.yml`).
2. **The component prop contract** — how a filekind/listing component receives data. Source of
   truth for the entry shape is `src/loaders/schema.ts` (`FolderEntry`, `ChildFile`,
   `ChildFolder`, `Embed`, `Feature`, `Related`). Decide: filekind components take a
   `ChildFile` (+ folder context) prop; listing components take a `FolderEntry`. Map the old
   `Subfolio::` / `view::get_option()` helper surface (see [spec/SPEC-theme-api.md](./spec/SPEC-theme-api.md))
   to Astro props / a config import.
3. **One reference filekind component ported end-to-end** — `src/components/filekinds/Img.astro`
   from upstream `pages/filekinds/img.php`. This is the concrete pattern every Wave worker
   mirrors. Pin its prop signature, import style, and class-preserving markup here.

**Inputs:** [spec/SPEC-theme-api.md](./spec/SPEC-theme-api.md),
[spec/SPEC-filekinds.md](./spec/SPEC-filekinds.md),
[spec/SPEC-conventions.md](./spec/SPEC-conventions.md), `src/loaders/schema.ts`.

**Done when:** `Layout.astro` renders, `Img.astro` consumes a `ChildFile` and reproduces the
PHP markup, and the prop contract + helper mapping is written down (a short
`src/components/README.md` or a doc block) so a worker can port a view without rereading the
loader. The launcher's `--guard` checks for `Layout.astro` + `Img.astro` before fanning out.

---

## Wave — Filekind + listing view ports. Gated on the skeleton. Parallel & conflict-free.

Each view becomes one new `.astro` component — disjoint files, so these fan out cleanly. Read
the PHP view + the cited spec, produce the Astro component, keep markup/classes identical.

### Filekind views
Branch `port/filekind-<kind>`. Read SPEC-filekinds + the Gate's `Img.astro` as the pattern.
Source dir: upstream `config/themes/default/pages/filekinds/`. Output:
`src/components/filekinds/<Kind>.astro`.

- **C1** `vid.php` → `Vid.astro`
- **C2** `snd.php` → `Snd.astro`
- **C3** `link.php` → `Link.astro`
- **C4** `oplx.php` → `Oplx.astro`  (download box; see the two partials below)
- **C5** `rss.php` → `Rss.astro`
- **C6** `site.php` → `Site.astro`
- **C7** `txt.php` → `Txt.astro`
- **C8** `swf.php` → `Swf.astro`
- **C9** `webloc.php` → `Webloc.astro`
- **C10** `default.php` → `Default.astro`  (the fallback view)
- **C11** the `_download_box.php` + `_hideable_download_box.php` partials →
  `DownloadBox.astro` + `HideableDownloadBox.astro` (used by oplx). *Port this BEFORE/with C4.*

> `img.php` is the Gate's reference component — not a Wave task.

### Listing views
Branch `port/listing-<name>`. Read SPEC-conventions + SPEC-theme-api. Source dir: upstream
`config/themes/default/pages/listing/` (+ `pages/listing.php` orchestrator). Output:
`src/components/listing/<Name>.astro`. These consume a `FolderEntry`.

- **C12** `gallery.php` → `Gallery.astro`
- **C13** `files_and_folders.php` → `FilesAndFolders.astro`
- **C14** `features.php` → `Features.astro`  (consumes `entry.features`)
- **C15** `related.php` → `Related.astro`  (consumes `entry.related`)
- **C16** the inline embeds — `inline_top.php` / `inline_middle.php` / `inline_bottom.php` +
  `_inline_rss.php` → `InlineEmbeds.astro` (consumes `entry.embeds.{top,middle,bottom}`).

### Standalone pages (optional, lower priority)
Branch `port/page-<name>`. Source dir: upstream `pages/`. Output: `src/pages/` or
`src/components/`.

- **C17** `denied.php` / `notfound.php` → error views
- **C18** `login.php` / `logout.php` → deferred to Phase 4 (auth Worker); port markup only if
  convenient, no auth logic.

> CMS views (`config/themes/default/cms/**`) are auth-admin UI — **out of scope for Phase 2**,
> deferred with the auth Worker (Phase 4).

---

## Suggested order

1. **You (Opus / anthropic mode):** build the Gate. Land on `main`.
2. **After the Gate merges, in parallel (DeepSeek):** the Wave. Run
   `./docs/run-deepseek-tasks.sh` (flips proxy → fans out worktrees → restores). ~16 tasks.
3. **Review + merge** each branch from the main checkout; visually diff against the live PHP
   app on the same content. Drop the `/debug` route once listings render at parity.
