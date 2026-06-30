# SPEC-conventions — File-naming conventions & enhancers

> Extracted from the PHP engine; intended as the single source of truth for the Go port.

---

## 1. Hidden files (`-` and `.` prefix, plus special extensions)

### Rule

A file or folder is **hidden** (excluded from normal directory listings) when **any** of these is true:

1. The name **starts with** `-` (dash).
2. The name **starts with** `.` (dot).
3. The name **ends with** the configured info extension (default `.info`).
4. The name **ends with** the configured feature extension (default `.ftr`).
5. The name **ends with** the configured shortcut extension (default `.cut`).

### Where it's parsed

`Filebrowser::is_hidden()` — `engine/application/libraries/Filebrowser.php:1025-1070`

```php
// lines 1025-1034: checks if first character is '-'
$pos = strpos($filename, '-');
if ($pos === 0) { $hidden = true; }

// lines 1036-1045: checks if first character is '.'
$pos = strpos($filename, '.');
if ($pos === 0) { $hidden = true; }

// lines 1055-1066: checks for .info, .ftr, .cut suffixes
$info_ext = Kohana::config('filebrowser.info_extension') ?: ".info";
$ftr_ext  = Kohana::config('filebrowser.feature_extension') ?: ".ftr";
$cut_ext  = Kohana::config('filebrowser.shortcut_extension') ?: ".cut";

if (substr($filename, (-1 * strlen($info_ext))) == $info_ext) { $hidden = true; }
else if (substr($filename, (-1 * strlen($ftr_ext))) == $ftr_ext) { $hidden = true; }
else if (substr($filename, (-1 * strlen($cut_ext))) == $cut_ext) { $hidden = true; }
```

### Behavior

Hidden files are skipped when building directory listings (`get_file_list`, `get_folder_list`, `get_parent_file_list`, `get_parent_file_folder_list`, `get_parent_folder_list`). They are included **only** when the caller explicitly passes `$hidden=true` (used for position embeds and for fetching `.ftr`/`.cut` files programmatically).

### Config knobs

| Config key | Default | Source |
|---|---|---|
| `filebrowser.info_extension` | `.info` | `filebrowser.php` (PHP config) |
| `filebrowser.feature_extension` | `.ftr` | `filebrowser.php` (PHP config) |
| `filebrowser.shortcut_extension` | `.cut` | `filebrowser.php` (PHP config) |

### Examples from `directory/examples/`

| Example path | Why hidden |
|---|---|
| `01_embedding_text_images/-t-introduction.txt` | Starts with `-` |
| `01_embedding_text_images/-b-footer.txt` | Starts with `-` |
| `01_embedding_text_images/-hidden/` | Starts with `-` |
| `05 display rss feed/-rss-enhancer.rss.cache` | Starts with `-` |
| `02_popups_links_shortcuts/internal-shortcut.cut` | Ends with `.cut` (configured hidden ext) |
| `03_featuring_content/featured-link.ftr` | Ends with `.ftr` (configured hidden ext) |
| `00_thumbnails.info` | Ends with `.info` (configured hidden ext) |

---

## 2. Position embeds (`-t-`, `-m-`, `-b-`)

### Rule

Files prefixed with `-t-`, `-m-`, or `-b-` are **inline content embeds** positioned at the top, middle, or bottom of a listing page. They are normally hidden (start with `-`) but fetched explicitly by the view helpers.

### Token → Meaning

| Prefix | Position | Where parsed |
|---|---|---|
| `-t-` | **Top** — rendered above the file listing | `SubfolioFiles::have_inline_images/texts/rss()` and `SubfolioFiles::inline_images/texts/rss()` in `Subfolio.php` |
| `-m-` | **Middle** — rendered between folders and files | Same as above |
| `-b-` | **Bottom** — rendered below the file listing | Same as above |

### Supported content types per position

Each position supports three kinds of embedded content:

| Content type | Kind filter | Have helper | Fetch helper | Source lines |
|---|---|---|---|---|
| Images | `img` | `have_inline_images($type)` | `inline_images($type)` | `Subfolio.php:556-599` |
| Text | `txt` | `have_inline_texts($type)` | `inline_texts($type)` | `Subfolio.php:602-639` |
| RSS feeds | `rss` | `have_inline_rss($type)` | `inline_rss($type)` | `Subfolio.php:643-698` |

### Where it's parsed

`SubfolioFiles` class in `engine/application/libraries/Subfolio.php:556-698`

The critical call pattern (example for images, top position):
```php
// Subfolio.php:559
$inline = Subfolio::$filebrowser->get_file_list("img", "-t-", true);
//                                                  ^kind  ^prefix  ^hidden=true
```

The `$hidden=true` parameter is required because the `-` prefix of `-t-` would otherwise cause `is_hidden()` to skip these files.

### Behavior

- **Images:** Each matching file is read with `getimagesize()`; an array of `{url, width, height}` is returned for template rendering.
- **Text:** Each matching file is read from disk and rendered through `format::get_rendered_text()` (respecting the `text_rendering` config: none/textile/markdown). Returns `[{body}]`.
- **RSS:** Each matching `.rss` file is parsed as YAML (Spyc); `{feedurl, count, cache}` are extracted. The feed is fetched and cached (see §3.8 below).

### Examples from `directory/examples/`

| File | Position | Type | Directory |
|---|---|---|---|
| `01_embedding_text_images/-t-top-image.png` | Top | img | `01_embedding_text_images/` |
| `01_embedding_text_images/-t-top-text.txt` | Top | txt | `01_embedding_text_images/` |
| `01_embedding_text_images/-m-middle-image.png` | Middle | img | `01_embedding_text_images/` |
| `01_embedding_text_images/-m-middle_text.txt` | Middle | txt | `01_embedding_text_images/` |
| `01_embedding_text_images/-b-bottom-image.png` | Bottom | img | `01_embedding_text_images/` |
| `01_embedding_text_images/-b-bottom-text.txt` | Bottom | txt | `01_embedding_text_images/` |
| `-t-introduction.txt` | Top | txt | `directory/examples/` |
| `-b-footer.txt` | Bottom | txt | `directory/examples/` |
| `01_embedding_text_images/-hidden/-t-top-image.png` | Top | img | Nested `-hidden` folder |
| `01_embedding_text_images/-hidden/-m-middle-image.png` | Middle | img | Nested `-hidden` folder |
| `01_embedding_text_images/-hidden/-b-bottom-image.png` | Bottom | img | Nested `-hidden` folder |

---

## 3. Enhancer extensions

Each enhancer is a file extension (or folder extension) that triggers special behavior beyond simple file serving. Listed in alphabetical order.

### 3.1 `.cut` — Shortcut

- **Type:** File (hidden by default)
- **Kind:** `cut` — `filekinds.sample.yml:280-283`
- **Hardcoded extension→kind:** `Filebrowser.php:794-795`
- **File format:** YAML (parsed by Spyc)

**Fields:**

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Display name for the shortcut |
| `directory` | Conditional | Path to a local folder/file to link to |
| `url` | Conditional | External URL to link to (alternative to `directory`) |

**Where parsed:**

- In `is_feature()` checks: `Filebrowser.php:592-627` — shortcut files are loaded to see if they reference the queried folder.
- As "related" items: `SubfolioFiles::related()` at `Subfolio.php:1326-1398`. This is the primary consumer — it fetches all `.cut` files in a directory (with `hidden=true`) and builds a "related" listing from them.

**Resolution logic** (`Subfolio.php:1337-1366`):
1. Read `url` from the YAML. If non-empty, use it as the link.
2. If `url` is empty, read `directory` field.
3. If `directory` starts with `/`, treat as absolute path from site root; split out the parent and folder name.
4. Otherwise, treat as relative to the current folder.
5. Construct a `FileFolder` object for the target and check access restrictions.

**Hiding:** Shortcuts are hidden from normal listings by `is_hidden()` at `Filebrowser.php:1062-1063`.

**Examples:**

`directory/examples/hiding_content.cut`:
```yaml
name: hiding content
directory: 02_enhancers/-hidden
```

`directory/examples/02_popups_links_shortcuts/internal-shortcut.cut`:
```yaml
name: internal shortcut
directory: -hidden
```

### 3.2 `.ftr` — Feature

- **Type:** File (hidden by default)
- **Kind:** `ftr` — `filekinds.sample.yml:285-288`
- **Hardcoded extension→kind:** `Filebrowser.php:886-887`
- **File format:** YAML (parsed by Spyc)
- **Display name:** "Feature" — `Filebrowser.php:985`

**Fields:**

| Field | Required | Description |
|---|---|---|
| `title` | No | Display title for the feature card |
| `folder` | Conditional | Path to a local folder to feature |
| `file` | Conditional | Path to a local file to feature |
| `link` | Conditional | External URL to feature (alternative to folder/file) |
| `image` | No | Path to thumbnail image (usually in `-thumbnails-custom/`) |
| `width` | No | Pixel width of the feature container |
| `height` | No | Pixel height of the feature container |
| `description` | No | Body text for the feature card |
| `target` | No | Link target attribute (e.g. `_blank`) |

**Where parsed:**

- `is_feature()` at `Filebrowser.php:592-627` — checks both folder-level `features` in `-properties` and all `.ftr` files. If a `.ftr` file references a folder/file, that folder/file is excluded from the normal listing.
- `SubfolioFiles::features()` at `Subfolio.php:707-751` — builds the feature array for the view. For each `.ftr` file:
  1. Parse the YAML.
  2. Build link from `link` (external), `folder` (local), or `file` (local).
  3. If `image` is set, read its dimensions with `getimagesize()`.
  4. Collect `{link, image_file, image_width, image_height, width, height, title, target, description}`.

**Hiding:** Features are hidden from normal listings by `is_hidden()` at `Filebrowser.php:1062-1063`.

**Interaction with `is_feature()`:** Files and folders referenced by a `.ftr`'s `folder:` or `file:` field are excluded from the normal file listing by `is_feature()` checks at `Subfolio.php:833, 851, 897, 1158`.

**Examples:**

`directory/examples/03_featuring_content/featured-link.ftr`:
```yaml
title: Featured Link
link: http://www.area17.com
image: -thumbnails-custom/link_thumbnail.png
width: 250
height: 230
description:>
 You can feature any local or offsite link. Also good for surfacing files and
 folders that are deep in your site.
```

`directory/examples/03_featuring_content/featured_folder.ftr`:
```yaml
title: Featured Folder
folder: featured_folder
image: -thumbnails-custom/folder_thumbnail.png
width: 250
height: 230
description:>
 You can feature a folder in the same folder. By doing so, the folder will not
 appear in the listing below.
```

`directory/examples/03_featuring_content/featured_file.ftr`:
```yaml
title: Featured File
file: featured-file.txt
image: -thumbnails-custom/file_thumbnail.png
width: 250
height: 230
description:>
 You can feature a file in the same folder. By doing so, the file will not
 appear in the listing below.
```

### 3.3 `.link` — Link (Internet Location)

- **Type:** File
- **Kind:** `link` (mapped in `filekinds.sample.yml:295-299`, extensions list includes `net, link, com, fr, net, org, me, us, biz, mobi, info, es, de`)
- **Hardcoded extension→kind:** `Filebrowser.php:768-774` maps `.link` → `net`
- **File format:** YAML (parsed by Spyc)
- **Display name:** "Internet Location" — `Filebrowser.php:957`

**Fields:**

| Field | Required | Description |
|---|---|---|
| `url` | Yes | Target URL |
| `target` | No | Link target attribute (default `_blank`) |
| `comment` | No | Description/comment displayed in listing |

**Where parsed:**

- `get_item_property()` at `Filebrowser.php:671-679` — `.link` files are YAML-parsed inline to retrieve properties like `url`.
- `SubfolioFiles::files()` at `Subfolio.php:1081-1085` — in the file listing switch statement, `kind == "link"` reads `url`, `target` from the file's properties. If `url` is empty, falls back to `http://<filename without extension>` (`Subfolio.php:1278` in `files_and_folders()`).
- `SubfolioFiles::files_and_folders()` at `Subfolio.php:1272-1281` — same pattern.

**Behavior:** In listings, a `.link` file renders as a hyperlink. The display name strips the `.link` extension (via `format::filename()` with `false` for extension display). The `target` field controls the anchor's `target` attribute.

**Examples:**

`directory/examples/02_popups_links_shortcuts/area17.com.link`:
```yaml
target: _blank
url: http://www.area17.com
comment: Example link to an external website.
```

### 3.4 `.oplx` — OmniPlan Archive

- **Type:** Folder
- **Kind:** `oplx` — `filekinds.sample.yml:199-204`
- **Hardcoded extension→kind:** Not in `__get_kind()` switch; relies entirely on `filekinds.yml`.
- **Display name:** "OmniPlan File" — `filekinds.sample.yml:202`

**Where parsed:**

- `Filebrowser_Controller::index()` at `filebrowser.php:169` — when the folder kind is `oplx`, the controller sets `single=true` and `is_folder=true`, causing Subfolio to render a detail/single-file view instead of a folder listing.
- `Filebrowser_Controller::access()` at `filebrowser.php:128-131` — when serving a folder whose extension is `oplx` via the `/directory/*` access route, Subfolio creates a ZIP archive of the entire folder and serves it as a download:
  ```php
  $ext = pathinfo($folder, PATHINFO_EXTENSION);
  if ($ext === 'oplx') {
      $archive = $this->filebrowser->create_archive(true);
      $archive->download($folder.".zip");
  }
  ```
- `Subfolio::current_file('archive')` at `Subfolio.php:193-197` — the `archive` template data key (used only for `.oplx` packages) returns the download path.

**Behavior:** Two modes:
1. **View:** Treated as a single item detail view (no directory listing of contents).
2. **Download (via `/directory/` access route):** The entire folder is zipped and served as a `.zip` download.

**Examples:** No `.oplx` folder in `directory/examples/`. Defined declaratively in `filekinds.sample.yml:199-204`.

### 3.5 `.pop` — Popup Window

- **Type:** File
- **Kind:** `pop` — `filekinds.sample.yml:290-293`
- **Hardcoded extension→kind:** `Filebrowser.php:777-778`
- **File format:** YAML (parsed by Spyc)
- **Display name:** "Popup Window" — `Filebrowser.php:962`

**Fields:**

| Field | Required | Default | Description |
|---|---|---|---|
| `url` | No | `http://www.subfolio.com` | URL to open in the popup |
| `width` | No | `800` | Popup window width in pixels |
| `height` | No | `600` | Popup window height in pixels |
| `name` | No | `POPUP` | Window name (passed to `window.open()`) |
| `style` | No | `POPSCROLL` | Window chrome style (WINDOW, POPSCROLL, etc.) |
| `comment` | No | — | Description/comment |

**Where parsed:**

- `SubfolioFiles::files()` at `Subfolio.php:1070-1079` — builds a JavaScript popup link:
  ```php
  $url = "javascript:A17.Helpers.pop('$url','$name',$width,$height,'$style');";
  ```
- `SubfolioFiles::files_and_folders()` at `Subfolio.php:1261-1270` — same pattern.
- On mobile (iPhone/iPod), pop kind is downgraded to `link` at `Subfolio.php:1062-1066` and `1262`.

**Behavior:** Generates a JavaScript link (`A17.Helpers.pop(...)`) that opens the target URL in a new window with the specified dimensions and chrome style. The display name strips the `.pop` extension.

**Examples:**

`directory/examples/02_popups_links_shortcuts/giant_step_jukebox.pop`:
```yaml
url: http://jukebox.giantstep.net/player
width: 494
height: 560
style: WINDOW
comment: Example link within a pop-up window.
```

### 3.6 `.rss` — RSS Feed

- **Type:** File
- **Kind:** `rss` — `filekinds.sample.yml:310-313`
- **Hardcoded extension→kind:** Not in `__get_kind()` switch; relies on `filekinds.yml` mapping (though RSS files are handled specially via position embeds and inline rendering, not general file listing).
- **File format:** YAML (parsed by Spyc)
- **Display name:** "RSS Feed" — `filekinds.sample.yml:312`
- **Extension hidden in display:** Yes — `FileFolder::fix_display_name()` at `FileFolder.php:211-214` always strips `.rss` from display names.

**Fields:**

| Field | Required | Default | Description |
|---|---|---|---|
| `feedurl` | Yes | — | URL of the RSS/Atom feed to fetch |
| `count` | No | `10` | Maximum number of feed items to display |
| `cache` | No | `3600` | Cache lifetime in seconds |

**Where parsed:**

- `SubfolioFiles::inline_rss()` at `Subfolio.php:666-698` — called for position embeds (`-t-`, `-m-`, `-b-` prefixed `.rss` files). Each file is parsed as YAML; `feedurl`, `count`, `cache` are extracted into `{feedurl, filename, count, cache}` arrays.
- `SubfolioFiles::fetch_rss()` at `Subfolio.php:1535-1579` — the actual feed-fetching logic:
  1. Checks for a cache file named `-<filename>.cache` (hidden; `-` prefix).
  2. If cache exists and is within the TTL, deserializes from cache.
  3. Otherwise, fetches the feed URL via `feed::parse()`, serializes to the cache file.
- `get_item_property()` at `Filebrowser.php:675` — `.rss` files are YAML-parsed inline for property lookup.
- `SubfolioFiles::have_inline_rss()` at `Subfolio.php:643-662` — checks for RSS files with position prefixes.

**Cache files:** Cache files are named `-<original-filename>.cache` (hidden by the `-` prefix). Stored as PHP-serialized arrays.

**Examples:**

`directory/examples/05 display rss feed/rss-enhancer.rss`:
```yaml
feedurl: http://feeds.feedburner.com/area17/news
count: 10
cache: 3600
```

Cache file: `directory/examples/05 display rss feed/-rss-enhancer.rss.cache`

### 3.7 `.site` — Mini Site (HTML Prototype)

- **Type:** Folder
- **Kind:** `site` — `filekinds.sample.yml:300-303`
- **Hardcoded extension→kind:** `Filebrowser.php:865-867`
- **Display name:** "Mini Site" — `Filebrowser.php:1011`
- **Extension hidden in display:** Yes — `FileFolder::fix_display_name()` at `FileFolder.php:211-214` always strips `.site` from display names.

**Where parsed:**

- `Filebrowser_Controller::index()` at `filebrowser.php:169` — when the folder kind is `site`, the controller sets `single=true` and `is_folder=true`, causing Subfolio to render a detail/single-file view instead of a folder listing.
- `SubfolioFiles::files()` at `Subfolio.php:933-934` — special-cases `site` kind folders to use the `site` filekind icon and metadata.

**Requirements:** The `.site` folder **must** contain an `index.html` file to function (confirmed by the example's own documentation).

**Behavior:** When a `.site` folder is accessed, Subfolio treats it as a single item (detail view) rather than listing its contents. The detail view renders using the filekind view for `site` (`pages/filekinds/site.php`). The typical use case is hosting HTML prototypes.

**Examples:**

`directory/examples/04_html_prototype/04_html_prototype.site/` — contains `index.html` with an HTML prototype page.

### 3.8 `.slide` — Slideshow

- **Type:** Folder
- **Kind:** `slide` — `filekinds.sample.yml:305-308`
- **Hardcoded extension→kind:** Not in `__get_kind()` switch; relies on `filekinds.yml`.
- **Display name:** "Slideshow" — `filekinds.sample.yml:307`
- **Extension hidden in display:** Yes — `FileFolder::fix_display_name()` at `FileFolder.php:211-214` always strips `.slide` from display names.

**Where parsed:**

- `Filebrowser_Controller::index()` at `filebrowser.php:172-182` — when the folder kind is `slide`, the controller finds the first file in the folder and redirects the browser to it:
  ```php
  $slide_files  = $this->filebrowser->get_file_list();
  $slide_files  = $this->filebrowser->sort($slide_files);
  if (sizeof($slide_files) > 0) {
      $url = Subfolio::$filebrowser->get_link($slide_files[0]->name);
      url::redirect($url);
  }
  ```
- `SubfolioFiles::files()` at `Subfolio.php:964-975` — in listing, a `.slide` folder links to the first file inside it.
- `SubfolioFiles::files_and_folders()` at `Subfolio.php:1248-1259` — same pattern.
- `SubfolioFiles::parent_link()` at `Subfolio.php:1411-1413` — when computing the parent link, if the parent ends with `.slide`, a special path strip is applied to undo the redirect.

**Behavior:** The `.slide` enhancer converts a folder into a slideshow. Instead of showing a folder listing (thumbnails), users are sent directly to the first file. Navigation happens via prev/next links within the detail view. This creates a linear "slideshow" browsing experience.

**Examples:**

`directory/examples/06 slideshow.slide/` — folder with `.slide` extension, containing subfolder `slideshow.slide/` with example images (`example.gif`, `example.jpg`, `example.png`).

---

## 4. Summary table — All naming tokens

| Token | Scope | Meaning | Example |
|---|---|---|---|
| `-` prefix | File/Folder | Hidden from listings | `-t-readme.txt`, `-hidden/`, `-access` |
| `.` prefix | File/Folder | Hidden from listings | `.htaccess`, `.DS_Store` |
| `-t-` prefix | File | Top position embed (image/text/rss) | `-t-introduction.txt`, `-t-top-image.png` |
| `-m-` prefix | File | Middle position embed (image/text/rss) | `-m-middle-image.png`, `-m-middle_text.txt` |
| `-b-` prefix | File | Bottom position embed (image/text/rss) | `-b-footer.txt`, `-b-bottom-image.png` |
| `.link` | File ext | External hyperlink (YAML body) | `area17.com.link` |
| `.cut` | File ext | Shortcut to folder/file (YAML body, hidden) | `internal-shortcut.cut` |
| `.pop` | File ext | JavaScript popup window (YAML body) | `giant_step_jukebox.pop` |
| `.ftr` | File ext | Feature card (YAML body, hidden) | `featured-link.ftr` |
| `.slide` | Folder ext | Slideshow (redirects to first file) | `06 slideshow.slide/` |
| `.site` | Folder ext | Mini site / HTML prototype (must have `index.html`) | `04_html_prototype.site/` |
| `.oplx` | Folder ext | OmniPlan archive (zip-downloadable) | (none in examples; defined in filekinds) |
| `.rss` | File ext | RSS feed embed (YAML body) | `rss-enhancer.rss` |
| `.info` | File ext | Metadata sidecar file (YAML, hidden) | `00_thumbnails.info` |
| `.cache` | File ext | RSS cache file (serialized PHP, hidden) | `-rss-enhancer.rss.cache` |
| `-properties` | Folder-level file | Folder properties (YAML) | — |
| `-access` | Folder-level file | Access control rules (YAML) | `07_protecting_a_folder/-access` |
| `-thumbnails/` | Folder-level dir | Auto-generated thumbnail cache | `00_thumbnails/-thumbnails/` |
| `-thumbnails-custom/` | Folder-level dir | Manually-provided override thumbnails | `03_featuring_content/-thumbnails-custom/` |
| `@2x` (retina) | Filename suffix | Retina-resolution image variant | — |
| `-s` (shadow) | Filename suffix | Image has shadow decoration | — |
| `-b` (browser) | Filename suffix | Image has browser-frame decoration | — |

---

## 5. Enhancer reference checklist (Content authoring)

Every enhancer from the task brief's Content authoring list, with cited source lines and examples:

| # | Enhancer | PHP source (trigger→kind) | Behavior source | Example file |
|---|---|---|---|---|
| 1 | `.link` | `Filebrowser.php:768-774` | `Subfolio.php:1081-1085`, `Subfolio.php:1272-1281` | `directory/examples/02_popups_links_shortcuts/area17.com.link` |
| 2 | `.cut` | `Filebrowser.php:794-795` | `Subfolio.php:1326-1398` (related), `Filebrowser.php:592-627` (is_feature) | `directory/examples/02_popups_links_shortcuts/internal-shortcut.cut` |
| 3 | `.pop` | `Filebrowser.php:777-778` | `Subfolio.php:1070-1079` (files), `Subfolio.php:1261-1270` (files_and_folders) | `directory/examples/02_popups_links_shortcuts/giant_step_jukebox.pop` |
| 4 | `.ftr` | `Filebrowser.php:886-887` | `Subfolio.php:707-751` (features), `Filebrowser.php:592-627` (is_feature) | `directory/examples/03_featuring_content/featured-link.ftr` |
| 5 | `.slide` | `filekinds.sample.yml:305-308` | `filebrowser.php:172-182` (redirect), `Subfolio.php:964-975` (listing link) | `directory/examples/06 slideshow.slide/` |
| 6 | `.site` | `Filebrowser.php:865-867` | `filebrowser.php:169` (single view) | `directory/examples/04_html_prototype/04_html_prototype.site/` |
| 7 | `.oplx` | `filekinds.sample.yml:199-204` | `filebrowser.php:128-131` (zip download), `filebrowser.php:169` (single view) | (none in examples; declared in filekinds config) |
| 8 | `.rss` | `filekinds.sample.yml:310-313` | `Subfolio.php:666-698` (inline_rss), `Subfolio.php:1535-1579` (fetch_rss) | `directory/examples/05 display rss feed/rss-enhancer.rss` |

---

## 6. Pseudocode: `is_hidden()` algorithm

```
function is_hidden(filename):
    // Rule 1: leading dash
    if filename starts with '-': return true

    // Rule 2: leading dot
    if filename starts with '.': return true

    // Rule 3: info extension suffix
    if filename ends with config.info_extension (default ".info"): return true

    // Rule 4: feature extension suffix
    if filename ends with config.feature_extension (default ".ftr"): return true

    // Rule 5: shortcut extension suffix
    if filename ends with config.shortcut_extension (default ".cut"): return true

    return false
```

## 7. Pseudocode: Position embed resolution

```
function get_inline_items(kind, position):
    // position is one of: "top", "middle", "bottom"
    // kind is one of: "img", "txt", "rss"
    prefix = map_position_to_prefix(position)  // "top"→"-t-", "middle"→"-m-", "bottom"→"-b-"
    files = filebrowser.get_file_list(kind, prefix, hidden=true)
    return parse_and_build_items(files, kind)
```
