# SPEC: Sorting, Properties & Thumbnails

> **Sources:** `engine/application/libraries/Filebrowser.php` (sorting, properties),
> `engine/application/libraries/FileFolder.php` (thumbnail generation, sort comparators),
> `engine/application/libraries/Subfolio.php` (listing assembly),
> `engine/application/config/filebrowser.php` (defaults),
> `config/settings/settings.sample.yml` (user-settable knobs),
> `config/themes/default/options.sample.yml` (theme-level knobs),
> `directory/examples/00_thumbnails/` (usage examples).

---

## 1. Sorting

### 1.1 Sort key → comparator mapping

The user-level sort keys are mapped to internal comparator function names by
`Filebrowser::mapSortingToFunc()` (`Filebrowser.php:51–58`):

| User key (`?sort=`) | Comparator base name |
|----------------------|----------------------|
| `filename`           | `listingNameCmp`     |
| `size`               | `listingSizeCmp`     |
| `date`               | `listingDateCmp`     |
| `kind`               | `listingKindCmp`     |

Each comparator has an `Asc` and `Desc` variant, producing the final callable name
`{base}{Asc|Desc}` (e.g. `listingNameCmpAsc`). These are static methods on
`FileFolder` (`FileFolder.php:256–355`).

### 1.2 Comparator details

All comparators operate on `FileFolder` objects.

| Comparator | Ascending behavior | Descending behavior |
|------------|-------------------|---------------------|
| `listingNameCmpAsc`  | `strcmp(strtolower($a->name), strtolower($b->name))` | Reversed order of Asc |
| `listingSizeCmpAsc`  | Lower `size` stat first (`$a->stats['size'] < $b->stats['size']` → −1) | Higher first |
| `listingDateCmpAsc`  | Older `mtime` first (`$a->stats['mtime'] < $b->stats['mtime']` → −1) | Newer first |
| `listingKindCmpAsc`  | Alphabetical by display name of the filekind (e.g. "Audio File", "Image"), resolving through `FileKind::get_kind_by_extension()` | Reversed |

The "kind" comparator resolves the display string through `FileKind::instance()->get_kind_by_extension()` using the `kind` attribute; folders are treated as the kind `dir`.

### 1.3 Sort order resolution

`Filebrowser::_sort_order()` (`Filebrowser.php:61–96`) resolves the active sort in this
order:

1. **Folder-level default** — if the current folder's `-properties` file defines a
   `default_sort` key, it is mapped through `mapSortingToFunc()` to a comparator name
   and used as the default. Falls back to `listingNameCmp` if absent. A companion
   `default_sort_order` key sets the initial direction (`Asc`/`Desc`), defaulting
   to `Asc`.
2. **Session override** — the session keys `sort_order` and `sort_order_direction`
   persist the user's last sort choice across page loads.
3. **Query-string trigger** — when `?sort=` appears in the URL, the code:
   - Maps the value to a comparator.
   - Stores it in the session.
   - If the user is clicking the same sort again, toggles direction
     (`Asc` → `Desc` or vice versa).
   - If switching to a *different* sort key, resets direction: `Desc` for `date`,
     `Asc` for everything else.
   - Redirects back to the referrer (to remove `?sort=` from the URL).
4. **Final values** are placed in `$this->sort_order` and `$this->sort_order_direction`.

### 1.4 Applying the sort

`Filebrowser::sort($list)` (`Filebrowser.php:98–101`) builds the comparator name as
`$this->sort_order . $this->sort_order_direction` (e.g. `listingNameCmpAsc`) and calls
`usort($list, array("FileFolder", $func))`.

### 1.5 Sort usage in listings

Every listing function in `Subfolio` follows this pattern (e.g. `Subfolio.php:884–887`):

```php
$folders = Subfolio::$filebrowser->get_folder_list();
$folders = Subfolio::$filebrowser->sort($folders);
$files   = Subfolio::$filebrowser->get_file_list();
$files   = Subfolio::$filebrowser->sort($files);
```

For `files_and_folders()` (`Subfolio.php:1130–1144`), folders and files are sorted
independently, then merged via `array_merge()`, then re-sorted together. This means
within a mixed listing, folders and files intermingle according to the sort key
(e.g. alphabetically by name).

### 1.6 Prev/next ordering

`Filebrowser::prev_next_sort()` (`Filebrowser.php:242–262`) is used for single-file
detail navigation. It *partitions* the list: all `img`-kind files first, then everything
else. Within each partition, the existing sort order is preserved. This means gallery
navigation (`get_prev()` / `get_next()`) traverses images before non-image files.

### 1.7 Sort configuration summary

| Source | Key | Values | Default |
|--------|-----|--------|---------|
| Theme `options.yml` | `default_sort` | `filename`, `size`, `date`, `kind` | `filename` |
| Theme `options.yml` | `default_sort_order` | `Asc`, `Desc` | `Desc` |
| Folder `-properties` | `default_sort` | `filename`, `size`, `date`, `kind` | (inherited from theme) |
| Folder `-properties` | `default_sort_order` | `Asc`, `Desc` | (inherited from theme) |
| Session | `sort_order` | comparator name | (from defaults above) |
| Session | `sort_order_direction` | `Asc` / `Desc` | (from defaults above) |

Theme options are read via `view::get_option('default_sort', ...)`. Folder-level
`-properties` overrides are read via `$this->properties['default_sort']`.

---

## 2. Properties

### 2.1 Overview

"Properties" are key-value metadata attached to the current folder and to individual
items. They are read from YAML files at multiple levels with a defined precedence.

### 2.2 Folder-level properties

Loaded in `Filebrowser::set_path()` (`Filebrowser.php:200–208`) when the browser navigates
to a folder:

1. Determine the properties file name: `Kohana::config('filebrowser.properties_file')`
   (default: `-properties`, from `filebrowser.php:17`).
2. Look for `-properties` in the current directory. If not found, try
   `-properties.txt`.
3. Parse with Spyc (YAML→PHP array) and store in `$this->properties`.
4. Immediately call `_sort_order()` to apply any `default_sort` / `default_sort_order`
   from the properties.

Access via `get_folder_property($propertyname, $default=null)` (`Filebrowser.php:629–635`).
Returns the property value or `$default` if not set.

### 2.3 Per-item properties

`Filebrowser::get_item_property($filename, $propertyname)` (`Filebrowser.php:637–694`)
implements a multi-source resolution:

**Step 1.** Non-hidden `.info` file
Look for `{filename}.info_ext` where `info_ext` defaults to `.info`
(config: `filebrowser.info_extension`). Parse with Spyc. Return the key if found.

**Step 2.** Hidden `-.info` file
Look for `-{filename}.info_ext`. Parse with Spyc. Return the key if found.

**Step 3.** Folder-level fallback
Check `$this->properties[$filename][$propertyname]` (the folder's `-properties` can
contain per-file entries keyed by filename).

**Step 4.** Content-derived properties
For specific filekinds, properties are extracted from the file content itself:

| Filekind(s) | Properties parsed from |
|-------------|----------------------|
| `rss`, `cut`, `pop`, `net`, `link` | File is parsed as YAML; the requested key is read from the parsed array |
| `webloc` | `.webloc` files are XML plist; `url` property is read from `dict > string`, other properties fall through |

If no source matches, returns `null`.

### 2.4 Property name ↔ meaning reference

Properties used by the codebase (found in `Subfolio.php`, `Filebrowser.php`,
and view templates):

| Property name | Scope | Meaning | Used in |
|---------------|-------|---------|---------|
| `default_sort` | folder | Override default sort key | `_sort_order()` |
| `default_sort_order` | folder | Override default sort direction | `_sort_order()` |
| `listing_mode` | folder | Override listing mode for this folder (`list` / `grid`) | `get_listing_mode()`, listing functions |
| `comment` | item | Description/comment text shown beside the item | `files()`, `files_and_folders()` |
| `name` | item (`.pop`) | Display name for popup window | `files()`, `files_and_folders()` |
| `url` | item (`.pop`, `.link`, `.webloc`) | Target URL | `files()`, `files_and_folders()` |
| `width` | item (`.pop`) | Popup window width (px) | `files()` |
| `height` | item (`.pop`) | Popup window height (px) | `files()` |
| `style` | item (`.pop`) | Popup window style (e.g. `POPSCROLL`) | `files()` |
| `target` | item (`.link`, `.webloc`) | Link target (`_blank`, etc.) | `files()` |
| `features` | folder | Array of featured items | `is_feature()` |
| `hide_locked_folders` | folder | Boolean; hide restricted folders in listing | `files_and_folders()` |

### 2.5 Properties file schema

The `-properties` file is a YAML mapping. Top-level keys are either folder-wide
settings (e.g. `default_sort`) or per-filename maps:

```yaml
# Folder-wide
default_sort: date
default_sort_order: Desc

# Per-item
my-image.jpg:
  comment: "A beautiful sunset"
```

Per-item `.info` files are a flat YAML mapping:
```yaml
comment: "This file's description"
width: 1024
```

---

## 3. Thumbnail Pipeline

### 3.1 Cache directories

Thumbnails are stored in two hidden directories, both relative to the content folder:

| Directory | Purpose | Created |
|-----------|---------|---------|
| `-thumbnails/` | Auto-generated thumbnails | Created automatically by `mkdir("-thumbnails", 0755, true)` when needed (`FileFolder.php:150`) |
| `-thumbnails-custom/` | User-provided custom thumbnails | Created manually by the user |

Both directories are hidden from listings (filenames begin with `-`).

### 3.2 Thumbnail configuration

| Config key | Default | Source | Description |
|------------|---------|--------|-------------|
| `thumbnail_width` | 320 | `filebrowser.php:24`, overridable in `settings.yml`, overridable in theme `options.yml` | Max thumbnail width (pixels) |
| `thumbnail_height` | 240 | `filebrowser.php:25`, overridable in `settings.yml`, overridable in theme `options.yml` | Max thumbnail height (pixels) |
| `thumbnail_max_filesize` | 1 | `filebrowser.php:31`, overridable in `settings.yml` | Max source file size in MB; files larger than this are skipped for thumbnail generation |

Theme-level overrides are read via `SubfolioTheme::get_option('thumbnail_width', ...)`
which checks the active theme's `options.yml` first (`FileFolder.php:69–70`).

### 3.3 Thumbnail resolution (does an image *need* a thumbnail?)

`FileFolder::needs_thumbnail()` (`FileFolder.php:67–78`):

1. Get the configured `thumbnail_height`.
2. Call `getimagesize()` on the source file to get `$info[1]` (natural height).
3. If `$info[1] <= thumbnail_height` → the source is already thumbnail-sized (or smaller)
   → `needs_thumbnail()` returns `false`.
4. Otherwise returns `true`.

Images that are smaller than the thumbnail height are served directly (their original
URL) rather than being resized. They are also excluded from listings when the rest of
the pass determines they shouldn't appear.

### 3.4 Thumbnail existence check

`FileFolder::has_thumbnail()` (`FileFolder.php:90–109`):

1. **Check custom first:** if `-thumbnails-custom/{filename}` exists → `true`.
2. **Check auto-generated:** if `-thumbnails/{filename}` exists:
   - Compare `mtime` of the thumbnail to `mtime` of the source file.
   - If thumbnail is **newer** than source → `true`.
   - If thumbnail is **older** than source → `false` (stale, needs regeneration).
3. Otherwise → `false`.

This staleness check means thumbnails are auto-regenerated when the source file is
modified.

### 3.5 Custom thumbnail detection

`FileFolder::has_custom_thumbnail()` (`FileFolder.php:137–140`):
Simply checks if `-thumbnails-custom/{filename}` exists. No size or staleness check.

### 3.6 Thumbnail URL construction and generation

`FileFolder::get_thumbnail_url($listing_mode='list')` (`FileFolder.php:142–189`):

#### Path A: Custom thumbnail exists

Returns:
```
/directory/{parent}/-thumbnails-custom/{urlencoded-filename}
```
No generation happens. Custom thumbnails are served as-is.

#### Path B: Auto-generated thumbnail

1. Ensure `-thumbnails/` directory exists (create with `0755` if not).
2. Build URL template: `/directory/{parent}/-thumbnails/{urlencoded-filename}`.
3. **Decide whether to generate:**
   - If `has_thumbnail()` returns `false` (missing or stale) → set `$build_thumbnail = true`.
4. **If building:**
   a. **Size check:** `stat()` the source file. If `size > thumbnail_max_filesize * 1024 * 1024` (default 1 MB), skip generation, return `''`.
   b. **Dimension check:** `getimagesize()` the source. If `$info[1]` (height) is not set or `<= thumbnail_height`, skip generation (image is already small enough).
   c. **Resize:** Create a new `Image` object from the source file.
      - **Gallery/masonry mode** (`$listing_mode == "masonry"`): `$image->resize($thumbnail_width, $thumbnail_height, Image::WIDTH)` — constrains to width, height follows proportion.
      - **Default/list mode**: `$image->resize($thumbnail_width, $thumbnail_height, Image::HEIGHT)` — constrains to height, width follows proportion.
   d. **Save:** `$image->save($thumbnail)` — writes to `-thumbnails/{filename}`.
5. **Return:** If the thumbnail file exists, append `?rnd={ctime}` as a cache-buster query parameter.

#### No-op cases (return `''`):

- Source file exceeds `thumbnail_max_filesize`.
- Source image height is already ≤ thumbnail height and no thumbnail file exists.
- The `Image` class fails to process the file.

### 3.7 Gallery image assembly

`Subfolio::gallery_images()` (`Subfolio.php:762–811`) assembles the gallery data
array used by gallery views:

1. Get all `img`-kind files from the current folder.
2. For each image:
   - **If `needs_thumbnail()`** → use `get_thumbnail_url()` (triggers generation if needed).
   - **If NOT `needs_thumbnail()`** → use the direct file URL (image is already thumbnail-sized).
   - Fetch width/height via `get_gallery_width_height()`.
   - **Shadow/browser detection:** check if the filename has `@2x-s` (shadow) or `@2x-b` (browser) naming suffixes.
   - **Custom vs auto:** if `has_custom_thumbnail()`, set class to `"gallery_thumbnail custom"` and use natural dimensions; otherwise class is `"gallery_thumbnail"` and container height is set from `thumbnail_height` config.
3. Skip any image where the image source resolves to `''`.

### 3.8 Listing suppression for small images

Both `Subfolio::files()` (`Subfolio.php:1019–1031`) and `Subfolio::files_and_folders()`
(`Subfolio.php:1159–1210`) skip `img`-kind items that don't need thumbnails
(`continue`). The logic:

```
if (kind == "img" && !file->needs_thumbnail()) → skip
```

This prevents small images (below thumbnail height) from appearing in standard
listings, since they'd be served at original size and disrupt the visual grid.

### 3.9 Thumbnail cache layout diagram

```
{directory}/
├── photos/
│   ├── sunset.jpg                    (source, 1920×1280)
│   ├── icon.png                      (source, 16×16 — below thumbnail height)
│   ├── -properties                   (optional folder metadata)
│   ├── -thumbnails/                  (auto-generated, hidden)
│   │   └── sunset.jpg                (resized to 320×~213 or ~360×240)
│   └── -thumbnails-custom/           (manual, hidden)
│       └── hero.jpg                   (overrides auto-gen for hero.jpg)
```

### 3.10 Config defaults table

For a Go reimplementation, these are the hardcoded config defaults from
`filebrowser.php` before any YAML overlay:

| Config key | Hardcoded default | Type | Notes |
|------------|-------------------|------|-------|
| `thumbnail_width` | `320` | int (px) | Theme `options.yml` overrides via `SubfolioTheme::get_option()` |
| `thumbnail_height` | `240` | int (px) | Theme `options.yml` overrides; resize uses Image::HEIGHT or Image::WIDTH |
| `thumbnail_max_filesize` | `1` | int (MB) | Override in `settings.yml` only |
| `properties_file` | `-properties` | string | Fallback to `-properties.txt` |
| `info_extension` | `.info` | string | Not set in code; only applied when config key exists |
| `feature_extension` | `.ftr` | string | Not set in code; only applied when config key exists |
| `shortcut_extension` | `.cut` | string | Not set in code; only applied when config key exists |
| `retina_naming` | `@2x` | string | Suffix for retina image variants |
| `shadow_naming` | `-s` | string | Combined with retina (@2x-s) for shadow images |
| `browser_naming` | `-b` | string | Combined with retina (@2x-b) for browser images |

---

## 4. Reimplementation Checklist

To reimplement without rereading the PHP, you need:

1. **Sort comparators** — four keys × two directions = eight `usort` callbacks
   operating on `stats['mtime']`, `stats['size']`, `name` (lowercase), and
   kind display name.
2. **Sort resolution** — check `-properties` for `default_sort`/`default_sort_order`,
   then session, then `?sort=` query param with toggle logic.
3. **Properties** — multi-source YAML resolution: per-item `.info` → hidden `-.info`
   → folder `-properties` per-file entry → content-derived (YAML for link/cut/pop/rss/net,
   XML plist for webloc).
4. **Thumbnail dirs** — `-thumbnails/` auto-created with `0755`, `-thumbnails-custom/`
   user-managed, both hidden.
5. **Thumbnail staleness** — compare `mtime` of cached thumb to source; regenerate
   if older.
6. **Thumbnail generation** — skip if source > `thumbnail_max_filesize` MB or source
   height ≤ `thumbnail_height`; otherwise resize to `thumbnail_height` (list mode)
   or `thumbnail_width` (masonry mode) using the configured dimensions.
7. **URL scheme** — `/directory/{parent}/-thumbnails/{urlencoded-name}?rnd={ctime}`
   for auto, `/directory/{parent}/-thumbnails-custom/{urlencoded-name}` for custom.
8. **Small image suppression** — `img`-kind items where source height ≤ `thumbnail_height`
   are hidden from non-gallery listings and served at original URL in galleries.
