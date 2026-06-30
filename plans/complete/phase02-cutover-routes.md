# Phase 2 cutover — wire ported components into real routes, drop /debug

## Context

Phase 1 built the content loader (`src/loaders/`) that emits one typed `FolderEntry`
per directory. Phase 2 (Gate + Wave) ported the theme's SCSS, layout shell
(`Layout`/`Header`/`Footer`), all 5 listing views, and all 13 filekind views into
`src/components/`. But nothing renders them yet — the only page route is the
throwaway `src/pages/debug/[...path].astro` that dumps entry JSON.

This task finishes Phase 2: replace `/debug` with the real site. Mirror the PHP
`_default` route's behavior — resolve a path to either a **folder listing** or a
**file detail view** — compose the listing partials in PHP order, derive
breadcrumb/prev-next, and serve raw content at `/directory/<path>` so images and
downloads actually work (decided: full working pages, PHP-matching asset URLs).

The PHP reference for the routing logic is
`/Users/ryan/local-dev/subfolio/engine/application/controllers/filebrowser.php`
(`index()` method) and `config/themes/default/pages/listing.php` (partial order).

## Two URL spaces (the key model)

PHP uses two distinct URL namespaces; the port must preserve both for side-by-side diffing:

| Space | Serves | Used by |
|---|---|---|
| `/<path>` | **HTML detail/listing pages** | listing file rows, breadcrumb links, prev/next, gallery anchors |
| `/directory/<path>` | **raw file bytes** (`get_file_url()`) | `<img src>` in detail + gallery + embeds + features, download links |

Folder/file resolution (from PHP `index()`):
- **Folder** → renders `listing.php`. Exceptions: `.slide` folder redirects to its
  first child's detail page; `.site`/`.oplx` folder renders as a single filekind
  detail view (`single=true`).
- **File** (regular, `enhancer===null`) → renders `pages/filekinds/<kind>.php`,
  falling back to `default.php`. Enhancer files (`.link`/`.pop`) are listing anchors
  only (external URL / JS popup) and get **no** detail page.

## Implementation

### 1. New helper: `src/lib/routing.ts`
Centralize the wiring logic so route files stay thin:
- `componentForKind(kind: string)` → returns the filekind component (or `Default`).
  Map by the `kind` field on `ChildFile` (from `filekinds.yml`): `img→Img`,
  `snd→Snd`, `vid→Vid`, `swf→Swf`, `txt→Txt`, `rss→Rss`, `site→Site`, `oplx→Oplx`,
  `webloc→Webloc`, `link→Link`; everything else → `Default`.
- `buildBreadcrumb(path: string)` → `{name,url}[]`. Split `entry.path` on `/`,
  build cumulative `/<segment>/...` URLs using `displayName()` from
  `src/loaders/conventions.ts`; last crumb has empty `url` (Header already renders
  this shape — see `src/layouts/Header.astro`).
- `siblingNav(entry, allEntries)` → `{prevLink, nextLink}` derived from the parent
  entry's sorted `folders` (for folder pages) or the folder's sorted `files` (for
  detail pages). Keep simple; null when no neighbor.
- `assetUrl(relPath)` → ``/directory/${encodeURIComponent-parts}`` — single source
  of truth for the raw-bytes prefix.

### 2. Listing composition: `src/components/listing/Listing.astro`
Port `pages/listing.php` — render the existing partials in **exact PHP order**:
`InlineEmbeds top → Features → Gallery → InlineEmbeds middle → FilesAndFolders →
Related → InlineEmbeds bottom`. Props: `entry: FolderEntry`, plus the
`folderPath`/context the children already expect. Pass
`entry.embeds.{top,middle,bottom}` to the three `InlineEmbeds`, `entry.features`,
`entry.related`, and the whole `entry` to `Gallery`/`FilesAndFolders`.

### 3. Main route: `src/pages/[...path].astro` (replaces /debug)
Single catch-all whose `getStaticPaths()` emits **both** page types from
`getCollection("folders")`:
- **Folder listing path** per entry (`.` → index/undefined param). Skip emitting a
  plain listing for `single` (site/oplx) and `.slide` entries — handle them specially
  (below). Props: `{ kind: "folder", id }`.
- **File detail path** per regular file (`enhancer===null`) in each entry:
  param = `<entry.path>/<file.name>` (root files: just `<file.name>`).
  Props: `{ kind: "file", folderId, fileName }`.
- **Slide redirect**: for `.slide` entries, emit the folder path with
  `{ kind: "redirect", to: assetUrl-less detail path of slideTarget }`.
- **Single folder**: for `site`/`oplx` entries, emit folder path with
  `{ kind: "single", id }`.

Frontmatter dispatches on `kind`:
- `folder` → `<Layout title pageClass breadcrumb prev/next><Listing entry/></Layout>`.
  Title = `entry.displayName`; pageClass from listing.
- `file` → build `FileViewData` via `buildFileViewData()`
  (`src/lib/fileHelpers.ts`), pick component via `componentForKind`, render inside
  `<Layout pageClass="page--detail" ...>`. Title = file displayName.
- `single` → synthesize a minimal `FileViewData` for the folder and render
  `Site`/`Oplx` (folder-as-file). Title = folder displayName.
- `redirect` → emit a tiny page with `<meta http-equiv="refresh" content="0;url=...">`
  (static build can't do a server redirect; meta-refresh is the Phase-2 stand-in).

### 4. Raw content route: `src/pages/directory/[...path].ts`
Static endpoint that serves the actual bytes so `/directory/<path>` resolves.
- `getStaticPaths()`: walk the content root (`SUBFOLIO_CONTENT_DIR ?? ./content/examples`,
  same resolution as `src/content.config.ts`) recursively, emit one route per **real
  file on disk** (including hidden embed images, feature thumbnails, gallery images —
  everything referenceable). Reuse `readdirSync`/`statSync` like
  `src/loaders/index.ts` does.
- `GET({ params })`: `readFileSync` the file, return `new Response(buffer)`. The output
  filename keeps its extension, so the static host infers MIME. This honors the env
  var with no copy step and works in both `dev` and `build`.

### 5. Reconcile asset-URL prefixes (the inconsistency cleanup)
Standardize every raw-bytes URL on `/directory/` via `assetUrl()`:
- `src/lib/fileHelpers.ts` — `url` and the non-enhancer `link` currently build
  `/<relPath>`; change to `/directory/<relPath>` (img `src` in detail view + download
  box href).
- `src/components/listing/Gallery.astro` — thumbnail `img` `url` currently
  `${folderPath}/${file.name}`; prefix with `/directory`. The anchor `link` stays a
  **detail page** URL (`/<path>/`).
- `src/components/listing/InlineEmbeds.astro` — `<img src={image.src}>` where
  `image.src` is the bare `relPath`; wrap with `assetUrl()`.
- `src/components/listing/Features.astro` — already uses `/directory/...`; leave as
  the reference, optionally route through `assetUrl()` for consistency.
- `src/components/listing/FilesAndFolders.astro` + `src/lib/listingHelpers.ts` —
  file-row hrefs already point at detail pages (`/<folderPath><name>`, no
  `/directory/`); **leave unchanged** — these are correct.

### 6. Drop `/debug`
Delete `src/pages/debug/[...path].astro`. Update `CLAUDE.md` (Routing section) and
`docs/ROADMAP.md` (mark Phase 2 done) to reflect the cutover.

## Files

| Action | Path |
|---|---|
| add | `src/lib/routing.ts` (dispatch map, breadcrumb, sibling nav, assetUrl) |
| add | `src/components/listing/Listing.astro` (composition wrapper) |
| add | `src/pages/[...path].astro` (folder + file + single + slide routes) |
| add | `src/pages/directory/[...path].ts` (raw-bytes static endpoint) |
| edit | `src/lib/fileHelpers.ts` (url/link → /directory/) |
| edit | `src/components/listing/Gallery.astro` (img url → /directory/) |
| edit | `src/components/listing/InlineEmbeds.astro` (img src → /directory/) |
| delete | `src/pages/debug/[...path].astro` |
| edit | `CLAUDE.md`, `docs/ROADMAP.md` (status/routing notes) |

## Verification

A green `astro check && astro build` is necessary but **not sufficient** — per repo
memory, a clean build hid four render bugs in the Gate. Verify by actually loading
pages:

1. `npm run build` — confirm it emits real folder/file routes (not `/debug/*`) and
   `/directory/*` asset files into `dist/`. Spot-check `dist/index.html` renders the
   root listing, and `dist/directory/01_embedding_text_images/-t-top-image.png` exists.
2. `npm run preview` (or `npm run dev`) and open in a browser / curl:
   - `/` → root listing: breadcrumb, files-and-folders rows, the `-t-`/`-b-` text
     embeds rendered.
   - `/01_embedding_text_images/` → top + middle + bottom embeds, images load from
     `/directory/...` (check no broken `<img>`).
   - A regular image file detail page → `Img` view with `<img src="/directory/...">`
     plus the hideable download box.
   - `/03_featuring_content/` → feature cards with thumbnails.
   - `/06 slideshow.slide/` → meta-refresh lands on the first slide's detail page.
   - `/04_html_prototype/04_html_prototype.site/` → `Site` "View Site" detail view.
3. Diff a couple of pages side-by-side against the live PHP app (same content) to
   confirm class/markup parity, per the project's diffing goal.

## Out of scope (later phases)

sharp thumbnails + real image dimensions, RSS HTTP fetch, Textile/Markdown body
rendering, `-access` enforcement/auth, `.oplx` zip generation, `.pop`/`.slide`
client JS polish. These remain captured as parsed intent (Phase 3/4/5).
