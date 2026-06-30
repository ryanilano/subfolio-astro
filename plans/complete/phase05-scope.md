# Phase 5 — Enhancer Polish: Scope

## Context

Phases 1–3 are done: the loader captures every naming convention as *parsed intent*,
components render it, and the build pipeline ships to Cloudflare. Phase 4 (auth) stays
deferred. Phase 5 is the last functional gap — the four behaviors the earlier phases
deliberately left as "intent captured, not executed." Each is already plumbed through the
schema/loader/component layers with an explicit `Phase 5` TODO; this phase fills them in.

The four items, ordered by **user-visible impact** and independence:

| # | Item | Current state | Effort |
|---|------|--------------|--------|
| A | **Text body rendering** (Markdown) | `body: ""` hardcoded; embeds dump `rawText` via `set:html` | M |
| B | **`.pop` client behavior** (popup windows) | `javascript:A17.Helpers.pop(...)` href; helper exists in bundled JS | S |
| C | **`.slide` client behavior** | meta-refresh redirect to first file (Phase-2 stand-in) | **XS** (verify) |
| D | **`.oplx` build-time zip** | `archive` points at the source *folder*, no zip built | M |

**Decisions locked** (confirmed against upstream PHP):
- **A → Markdown only.** No Textile. The remark stack is already installed.
- **C → keep the redirect.** Upstream (`controllers/filebrowser.php:172`) does exactly
  what we do — redirect `.slide` to the first file's detail page. The "slideshow" is just
  stepping through files via the normal prev/next nav. **No gallery widget exists.** Item C
  shrinks to: verify prev/next works inside a `.slide` folder + port the one breadcrumb
  "HACK" (`Subfolio.php:1411`) that skips the parent link past the `.slide` segment.
- **D → real zip required.** Upstream builds the zip on demand
  (`Filebrowser::create_archive(true)` → `controllers/filebrowser.php:128`). Static site
  can't do on-demand, so we build it in a pre-build pass.

Recommended order: **A → B → C → D**. Each ships as its own commit.

---

## A. Text body rendering (Textile / Markdown)

**The gap.** Two call sites currently bypass rendering:
- [src/lib/fileHelpers.ts:241](src/lib/fileHelpers.ts#L241) — `body: ""` (the `.txt` detail view shows nothing).
- [src/components/listing/InlineEmbeds.astro](src/components/listing/InlineEmbeds.astro) — text embeds inject `rawText` raw via `<Fragment set:html>`, no Textile/MD pass.

**Upstream behavior** (`format::get_rendered_text()`): switch on the global
`text_rendering` setting (`none` | `textile` | `markdown`), auto-link bare URLs first, then
render. Our config already carries this: `SUBFOLIO_TEXT_RENDERING=textile` (`.env`),
threaded as `Renderer` through the loader onto every text embed (`embeds.ts` `renderer`
field). So the *selector* is wired — only the renderer functions are missing.

**Decision needed — Textile.** The default is `textile`, but **no Textile JS lib is
installed** and there isn't a well-maintained one. The Markdown path is easy (remark stack
is already in `node_modules`: `remark-parse`, `remark-rehype`, `remark-gfm`,
`remark-smartypants`). Options:
1. **`textile-js`** (npm `textile-js`, MIT) — the one viable JS Textile port; add as dep.
2. **Switch the default to Markdown** — drop Textile parity, since the bundled fixture
   content is light and Markdown covers it. (The upstream Go port keeps both via goldmark
   + a Textile lib; we'd be narrower.)
3. **Pre-convert at build** — render in a `gen-*` script, store HTML. Overkill; rendering
   in a helper is fine since it's build-time already.

**Plan (recommended).**
- New `src/lib/renderText.ts`: `renderText(raw, renderer)` →
  - `none`: escape + auto-link, return as-is.
  - `markdown`: unified/remark pipeline (libs present) → sanitized HTML.
  - `textile`: `textile-js` if we add it; else fall through to `none` with a one-time
    build warning.
  - Shared `autoLinkUrls()` prepass mirroring PHP `text::auto_link_urls(text, '_blank')`.
- Wire into `buildFileViewData` (`body = renderText(safeReadText(absPath), renderer)`) —
  note `fileHelpers` doesn't currently receive the renderer; thread it through
  `FileViewContext` (loader already knows it).
- Wire into `InlineEmbeds.astro` — render `text.rawText` through the same helper using the
  embed's `renderer` field instead of raw `set:html`.
- **Files:** `src/lib/renderText.ts` (new), `src/lib/fileHelpers.ts`,
  `src/components/listing/InlineEmbeds.astro`, `src/content.config.ts`/loader (pass
  renderer into file ctx), maybe `package.json` (+`textile-js`).

---

## B. `.pop` popup windows (client behavior)

**The gap.** Almost nothing — the href is already
`javascript:A17.Helpers.pop('url','name',w,h,'style')` (built in `fileHelpers.ts` and
`listingHelpers.ts`), and **`A17.Helpers.pop` already exists** in the bundled
`public/js/main.js:4982`. So popups likely *work* once `main.js` loads.

**Plan.** Mostly **verify, don't build**:
- Confirm `main.js` is actually loaded on the relevant pages (`Layout.astro`) and
  `A17.Helpers.pop` runs.
- The `javascript:` href is the legacy approach; if it trips CSP or feels wrong, swap to a
  small `is:inline` click handler keyed off a `data-pop` attribute. Optional polish.
- **Files:** likely none, or a tiny handler in `Layout.astro` + drop the `javascript:` URI
  in the two helpers.

---

## C. `.slide` slideshow (client behavior)

**The gap.** A `.slide` folder currently **meta-refresh redirects** to its first file's
detail page ([src/pages/[...path].astro](src/pages/%5B...path%5D.astro), the Phase-2
stand-in). Upstream intent is a *slideshow* — sequential nav through the folder's images
with prev/next.

**Plan.**
- Build a real slideshow view (new `src/components/Slideshow.astro` or a slide route)
  that lists the folder's image files and provides prev/next + keyboard nav. The SVG icon
  set already has `arrow_left`/`arrow_right`/`close` (`src/img/svg_source/`).
- Replace the redirect branch in the catch-all with this view for `enhancerFolder === "slide"`.
- Client JS: small `is:inline` script or reuse jQuery already in `main.js` (`slideDown`
  etc. exist but that's animation, not a gallery — likely hand-roll a few lines).
- **Decision needed:** full slideshow vs. keep the redirect-to-first-image as "good
  enough." Worth confirming how much the real Subfolio slideshow did before investing.
- **Files:** `src/components/Slideshow.astro` (new), `src/pages/[...path].astro`,
  possibly a `src/styles/modules/` partial.

---

## D. `.oplx` build-time zip

**The gap.** `.oplx` folders render a "Download Zip" box
([src/components/filekinds/Oplx.astro](src/components/filekinds/Oplx.astro)) whose
`archive` href is `/{folderPath}` — the **source folder**, not a zip. No artifact is built.

**Plan.**
- New pre-build pass (extend the `gen-*` pattern — `scripts/gen-oplx.mjs`, mirror
  `gen-thumbs.mjs`): walk for `.oplx` folders, zip each into a deterministic artifact under
  the served tree (e.g. `dist/directory/<path>.zip` or a `-archives/` dir), skip-if-stale
  like the thumbnail cache.
- Point `archive` at the built `.zip` URL in `fileHelpers.ts` (currently `archive:
  \`/${ctx.folderPath}\``).
- Wire the script into the `build`/`dev` npm chains alongside the other three.
- Zip lib: `archiver` (npm) or node's built-in — check what's already available.
- **Files:** `scripts/gen-oplx.mjs` (new), `package.json` (chain + maybe dep),
  `src/lib/fileHelpers.ts`, `.gitignore` (cache dir).

---

## Decisions — all resolved
1. **Render engine → Markdown.** Drop Textile; remark stack already installed.
2. **Slideshow → keep redirect.** Matches upstream; item C is verify + breadcrumb hack.
3. **Scope → TBD by user** (recommendation: A + B + C now, D optional/last).

## Verification (per item)
- A: `npm run build`, load a `.txt` detail page + a `-t-` text embed — body renders as
  HTML, bare URLs auto-link.
- B: load `02_popups_links_shortcuts/`, click a `.pop` item — popup window opens.
- C: load `06 slideshow.slide/` — slideshow (or redirect) behaves as decided.
- D: `npm run build`, the `.oplx` download link serves a real `.zip` that unpacks.
- Throughout: `astro check` stays green; side-by-side diff against the live PHP app.
