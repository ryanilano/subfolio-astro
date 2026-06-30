# SPEC-theme-api — Theme View API & Options

> The helper surface that theme views (`config/themes/default/pages/**`) rely on.
> This becomes the template function map for Go `html/template`.

**Source files analysed:**
- `engine/application/libraries/MY_View.php` — View class with option/color loading, theme-aware file resolution
- `engine/application/libraries/Subfolio.php` — Static facade: `Subfolio`, `SubfolioTheme`, `SubfolioUser`, `SubfolioLanguage`, `SubfolioFiles`
- `config/themes/default/options.sample.yml` — Theme knobs

**Views audited (grep for `Subfolio::` / `SubfolioTheme::` / `view::`):**
- All files under `config/themes/default/pages/` and `config/themes/default/layouts/`.

---

## 1. Shared static state

`Subfolio` exposes four static properties that views reference (though rarely directly — typically via the subclass methods):

| Property | Type | Set by | Description |
|----------|------|--------|-------------|
| `Subfolio::$filebrowser` | `Filebrowser` | Controller | The current Filebrowser instance (directory walker, path resolver) |
| `Subfolio::$auth` | `Auth` | Controller | Auth subsystem (user session, login state) |
| `Subfolio::$template` | object | Controller | Template data: `->content`, `->page_title`, `->site_title` |
| `Subfolio::$filekind` | `FileKind` | Controller | File-kind registry (extension → kind mapping) |

**Go equivalent:** These become fields on a `TemplateData` struct passed to every template execution.

---

## 2. Function catalog — `Subfolio` base class

### 2.1 `Subfolio::link_to(text, url)`
- **Args:** `$text` string, `$url` string
- **Returns:** HTML `<a href="$url">$text</a>`
- **Used in:** `header.inc`, `footer.inc` for logout links

### 2.2 `Subfolio::mail_to(text, email, subject, body)`
- **Args:** `$text`, `$email`, `$subject`, `$body` strings
- **Returns:** HTML `<a href='mailto:$email?subject=$subject&body=$body'>$text</a>`
- **Used in:** Not directly referenced in current theme views

### 2.3 `Subfolio::current_url()`
- **Args:** none
- **Returns:** `"http://" . $_SERVER["SERVER_NAME"] . $_SERVER["REQUEST_URI"]`
- **Used in:** Not directly referenced in current theme views (possibly in `.site` enhancer)

### 2.4 `Subfolio::get_setting(name)`
- **Args:** `$name` string — config key under `filebrowser.*`
- **Returns:** `Kohana::config('filebrowser.' . $name)`
- **Used in:** `img.php` (`display_max_filesize`), `template.php` (`google_analytics_code`), `header.inc` (`site_domain`, `site_root`)

### 2.5 `Subfolio::current_file(data)`
- **Args:** `$data` string — field name (see table below)
- **Returns:** mixed — the computed value for the current file/folder
- **Source:** `Subfolio.php:42–313`
- **Used extensively** by every filekind view (`_download_box.php`, `img.php`, `link.php`, `oplx.php`, `rss.php`, `site.php`, `snd.php`, `swf.php`, `txt.php`, `vid.php`, `webloc.php`)

#### `current_file()` field reference

| `$data` | Returns | Logic summary |
|---------|---------|---------------|
| `width` | `int` | For `img` kind: `getimagesize()` width; otherwise reads item property `width`, defaults to `640` |
| `height` | `int` | For `img` kind: `getimagesize()` height; otherwise reads item property `height`, defaults to `480` |
| `icon` | `string` | `icon_set_grid` + `_` + icon filename; e.g. `grid_img` |
| `icon_name` | `string` | Raw icon filename without icon-set prefix; e.g. `img` |
| `tag` | `string` | `"new"` or `"updated"` if mtime > `get_updated_since_time()`, else `""` |
| `url` | `string` | `$filebrowser->get_file_url()` |
| `retina` | `?string` | For `img` kind: `$filebrowser->get_file_retina_url()`; else null |
| `is_retina` | `?bool` | For `img` kind: `$filebrowser->is_retina_url()`; else null |
| `has_shadow` | `bool` | For `img` kind: `$filebrowser->has_shadow_suffix()`; else `false` |
| `has_browser` | `bool` | For `img` kind: `$filebrowser->has_browser_suffix()`; else `false` |
| `link` | `string` | For `webloc`: reads `url` property; otherwise `get_file_url()` or folder index.html URL |
| `archive` | `string` | `"/directory/" . $filebrowser->get_path()` — used by `.oplx` for zip download |
| `target` | `string` | Item property `target` or folder property `target`, defaults to `'blank'` |
| `filename` | `string` | HTML-escaped file name (file) or `FileFolder::get_display_name()` (folder) |
| `lastmodified` | `string` | Formatted mtime via `format::filedate("M d, Y – H:i")`; `"—"` for folders |
| `size` | `string` | Formatted size via `format::filesize()`; `"—"` if missing |
| `rawsize` | `int` | Raw byte count from `stats['size']`; `0` if missing |
| `comment` | `string` | Item or folder property `comment`, rendered; `"—"` if missing |
| `autoplay` | `string` | Item property `autoplay`, defaults to `""` |
| `kind` | `string` | `$filekind['display']` — human-readable kind label; `"—"` if missing |
| `extension` | `string` | File extension (truncated to 3 chars if >6); empty string if missing |
| `feedurl` | `string` | Item property `feedurl`; empty string for folders |
| `count` | `string` | Item property `count`; empty string for folders |
| `cache` | `int/string` | Item property `cache`; defaults to `3600` |
| `instructions` | `string` | Filekind `instructions` field; empty string if missing |
| `body` | `string` | Rendered text from `file_get_contents()` of the file — used by `txt.php` |

> **Go implication:** `current_file` becomes a method on the template data struct (or a template function) that takes a field name string. The `getimagesize` calls for width/height are replaced by pre-computed values on the file struct. The `auth`, `filebrowser`, `filekind`, and `template` lookups become struct field accesses.

---

## 3. Function catalog — `SubfolioTheme`

### 3.1 `SubfolioTheme::get_mobile_viewport()`
- **Returns:** `bool` — true if iPhone/iPod user agent
- **Used in:** `files_and_folders.php` (listing mode override), `Subfolio` internal logic
- **Source:** `Subfolio.php:324–328`

### 3.2 `SubfolioTheme::is_iphone()`
- **Returns:** `bool` — `strstr($_SERVER['HTTP_USER_AGENT'], 'iPhone') || strstr(..., 'iPod')`
- **Source:** `Subfolio.php:329–336`

### 3.3 `SubfolioTheme::get_page_title()`
- **Returns:** `string` — HTML-escaped `$template->page_title`; `""` if not set
- **Used in:** `template.php:13` (browser `<title>` tag)
- **Source:** `Subfolio.php:338–340`

### 3.4 `SubfolioTheme::get_site_title()`
- **Returns:** `string` — `$template->site_title`; `""` if not set
- **Used in:** `template.php:13` (browser `<title>` tag)
- **Source:** `Subfolio.php:342–344`

### 3.5 `SubfolioTheme::get_site_copyright()`
- **Returns:** `?string` — config `filebrowser.site_copyright` if `display_copyright` option is true; else `NULL`
- **Used in:** `footer.inc:4`
- **Source:** `Subfolio.php:346–353`

### 3.6 `SubfolioTheme::get_site_meta_description()`
- **Returns:** `?string` — config `filebrowser.site_meta_description`
- **Used in:** `template.php:8`
- **Source:** `Subfolio.php:356–358`

### 3.7 `SubfolioTheme::get_site_favicon_url()`
- **Returns:** `?string` — `view::get_option('site_favicon_url')`
- **Used in:** `template.php:15`
- **Source:** `Subfolio.php:360–362`

### 3.8 `SubfolioTheme::get_color_palette_name()`
- **Returns:** `?string` — `view::get_option('color_palette')`
- **Used in:** Not directly in views; informs color loading in `template_colors.php`
- **Source:** `Subfolio.php:364–366`

### 3.9 `SubfolioTheme::get_site_name()`
- **Returns:** `string` — site name text, or `<img>` tag if `site_logo_url` is set (with width/height from config/options)
- **Used in:** `header.inc:12` (logo area)
- **Source:** `Subfolio.php:368–386`

### 3.10 `SubfolioTheme::get_view_url()`
- **Returns:** `string` — `/config/themes/<theme_name>` — path to theme assets
- **Used in:** `template.php:21,64,104` (CSS/JS URLs), icon URL construction
- **Source:** `Subfolio.php:388–390` (delegates to `view::get_view_url()`)

### 3.11 `SubfolioTheme::get_listing_mode()`
- **Returns:** `string` — `'list'` or `'grid'` (or `'masonry'` if configured)
- **Resolution order:** config `filebrowser.listing_mode` → `view::get_option('listing_mode')` → folder property `listing_mode`. On iPhone/iPod: always `'grid'`.
- **Used in:** Every listing view (`files_and_folders.php`, `gallery.php`, `related.php`, `features.php`)
- **Source:** `Subfolio.php:392–399`

### 3.12 `SubfolioTheme::get_notice(name=null)`
- **Returns:** `?string` — session flash message; defaults to `'flash'` key if name is null
- **Used in:** `template.php:80,82,85,87` (flash and error notices)
- **Source:** `Subfolio.php:401–408`

### 3.13 `SubfolioTheme::get_breadcrumb()`
- **Returns:** `array` of `['name' => string, 'url' => string]` — breadcrumb trail from root to current path. Last item has empty `url`.
- **Respects options:** `replace_dash_space`, `replace_underscore_space`, `display_file_extensions`
- **Used in:** `header.inc:23,49` (desktop and mobile breadcrumbs)
- **Source:** `Subfolio.php:409–437`

### 3.14 `SubfolioTheme::subfolio_link()`
- **Returns:** `string` — HTML link to `http://www.subfolio.com`
- **Source:** `Subfolio.php:439–442`

### 3.15 `SubfolioTheme::get_collapse_header_button(wrap="")`
- **Returns:** `string` — HTML button to toggle header visibility. If `$wrap` is provided, wraps in that tag with class `collapseheader`.
- **Used in:** `header.inc:42`
- **Source:** `Subfolio.php:444–451`

### 3.16 `SubfolioTheme::get_tiny_url(name, wrap="")`
- **Returns:** `string` — HTML link that opens TinyURL create page with current URL
- **Used in:** Not referenced in current default theme views; exposed for custom themes
- **Source:** `Subfolio.php:453–459`

### 3.17 Icon URL helpers
Each returns a URL to the appropriate icon image from the theme:
- `get_locked_icon_url(mode='list')` → `…/icons/{icon_set}/{lock}.png`
- `get_unlocked_icon_url(mode='list')` → `…/icons/{icon_set}/{unlocked}.png`
- `get_updated_icon_url(mode='list')` → `…/icons/{icon_set}/{updated}.png`
- `get_new_icon_url(mode='list')` → `…/icons/{icon_set}/{new}.png`
- **Source:** `Subfolio.php:463–475`

### 3.18 `SubfolioTheme::get_option(option_name, default_value=null)`
- **Returns:** `mixed` — delegates to `view::get_option(…)`
- **Used in:** Every view that checks display settings (e.g. `display_info`, `display_icons`, `display_name`)
- **Source:** `Subfolio.php:481–484`

### 3.19 `SubfolioTheme::get_color(color_name, default_value=NULL)`
- **Returns:** `string` — color value from the loaded color palette
- **Used in:** `template_colors.php` (all color variables)
- **Source:** `Subfolio.php:489–491` (delegates to `view::get_color`)

---

## 4. Function catalog — `SubfolioUser`

### 4.1 `SubfolioUser::is_logged_in()`
- **Returns:** `bool` — `$auth->logged_in()`
- **Used in:** `header.inc:7` (logout link), `footer.inc:20` (logout link), `denied.php:3`
- **Source:** `Subfolio.php:511–513`

### 4.2 `SubfolioUser::is_admin()`
- **Returns:** `?bool` — `$auth->get_user()->admin` if logged in; `NULL` otherwise
- **Used in:** `footer.inc:28` (search endpoint access)
- **Source:** `Subfolio.php:515–523`

### 4.3 `SubfolioUser::current_user_name()`
- **Returns:** `?string` — `$auth->get_user()->name` (login username)
- **Used in:** Not directly in current default views
- **Source:** `Subfolio.php:525–531`

### 4.4 `SubfolioUser::current_user_fullname()`
- **Returns:** `?string` — `$auth->get_user()->fullname`
- **Used in:** `header.inc:8` (logged-in user display)
- **Source:** `Subfolio.php:533–539`

---

## 5. Function catalog — `SubfolioLanguage`

### 5.1 `SubfolioLanguage::get_text(name, args=[])`
- **Returns:** `string` — localised text from `Kohana::lang("filebrowser.$name", $args)`
- **Used in:** Nearly every view for UI labels
- **Source:** `Subfolio.php:546–549`

**Known `name` values used in views:**

| `name` key | Used in | Example English text |
|-----------|---------|---------------------|
| `kind` | `_download_box.php`, `files_and_folders.php` | "Kind" |
| `lastmodified` | `_download_box.php` | "Last Modified" |
| `size` | `_download_box.php`, `files_and_folders.php` | "Size" |
| `comment` | `_download_box.php`, `files_and_folders.php` | "Comment" |
| `downloadfile` | `_download_box.php` | "Download File" |
| `downloadzip` | `oplx.php` | "Download Zip" |
| `viewsite` | `site.php` | "View Site" |
| `seealso` | `related.php` | "See Also" |
| `filename` | `files_and_folders.php` | "Filename" |
| `date` | `files_and_folders.php` | "Date" |
| `emptyfolder` | `files_and_folders.php` | (empty folder message) |
| `accessdenied` | `denied.php` | "Access Denied" |
| `loginasadifferentuser` | `denied.php` | "Login as a different user" |
| `notfound` | `notfound.php` | "Not Found" |
| `check_url_go_back` | `notfound.php` | "Check the URL or go back to …" |
| `authenticationrequired_title` | `login.php` | "Authentication Required" |
| `authenticationrequired_subtitle` | `login.php` | (subtitle) |
| `username` | `login.php` | "Username" |
| `password` | `login.php` | "Password" |
| `remember_my_login` | `login.php` | "Remember my login" |
| `submit` | `login.php` | "Submit" |
| `logout` | `header.inc`, `footer.inc` | "Logout" |
| `indexof` | `header.inc` | "Index of" |
| `updated_since` | `footer.inc` | "Updated since" |
| `last_week` | `footer.inc` | "Last week" |
| `last_month` | `footer.inc` | "Last month" |
| `my_last_visit` | `footer.inc` | "My last visit" |
| `collapseheader` | `header.inc` | (collapse header label) |

> **Go implication:** This becomes a template function map. The language strings are loaded from YAML at startup; `get_text` looks up by key with sprintf-style args.

---

## 6. Function catalog — `SubfolioFiles`

### 6.1 Inline content helpers

| Function | Args | Returns | Side effect |
|----------|------|---------|-------------|
| `have_inline_images(type)` | `'top'` / `'middle'` / `'bottom'` | `bool` | Calls `$filebrowser->get_file_list("img", "-{t/m/b}-", true)` |
| `inline_images(type)` | `'top'` / `'middle'` / `'bottom'` | `array` of `['url', 'width', 'height']` | Uses `getimagesize()` per image |
| `have_inline_texts(type)` | `'top'` / `'middle'` / `'bottom'` | `bool` | Calls `$filebrowser->get_file_list("txt", "-{t/m/b}-", true)` |
| `inline_texts(type)` | `'top'` / `'middle'` / `'bottom'` | `array` of `['body' => rendered_text]` | Reads each .txt file, renders via `format::get_rendered_text()` |
| `have_inline_rss(type)` | `'top'` / `'middle'` / `'bottom'` | `bool` | Calls `$filebrowser->get_file_list("rss", "-{t/m/b}-", true)` |
| `inline_rss(type)` | `'top'` / `'middle'` / `'bottom'` | `array` of `['feedurl', 'filename', 'count'=10, 'cache'=3600]` | Parses each .rss file as YAML |

- **Used in:** `inline_top.php`, `inline_middle.php`, `inline_bottom.php`
- **Source:** `Subfolio.php:556–698`

### 6.2 Feature helpers

| Function | Args | Returns |
|----------|------|---------|
| `have_features()` | none | `bool` — true if any `.ftr` files in folder |
| `features()` | none | `array` of `['link', 'image_file'?, 'image_width'?, 'image_height'?, 'width'?, 'height'?, 'title', 'target'?, 'description']` |

- **Used in:** `features.php`
- **Source:** `Subfolio.php:700–751`
- **Note:** Each `.ftr` file is YAML; `link` is resolved from `link` → `folder` → `file` keys.

### 6.3 Gallery helpers

| Function | Args | Returns |
|----------|------|---------|
| `have_gallery_images()` | none | `bool` — true if any `img` files in folder |
| `gallery_images(listing_mode)` | `'list'` / `'grid'` / `'masonry'` | `array` of `['class', 'link', 'filename', 'url', 'width', 'height', 'shadow', 'browser', 'container_width', 'container_height']` |

- **Used in:** `gallery.php`
- **Source:** `Subfolio.php:753–811`
- **Details:** Each image item includes thumbnail vs. custom-thumbnail logic. `container_height` comes from `thumbnail_height` option for generated thumbnails.

### 6.4 File listing helpers

| Function | Args | Returns |
|----------|------|---------|
| `is_empty_folder()` | none | `bool` |
| `have_files()` | none | `bool` — true if any visible (non-thumbnail-filtered) files/folders |
| `files()` | none | `array` — folders then files, each with: `target`, `url`, `icon_name`, `icon`, `icon_grid`, `filename`, `size`, `date`, `kind`, `comment`, `restricted`, `have_access`, `new`, `updated` |
| `have_files_and_folders()` | none | `bool` — delegates to `have_files()` |
| `files_and_folders()` | none | `array` — merged folder+file list (sorted together), each with: `empty`, `target`, `url`, `icon`, `icon_grid`, `filename`, `size`, `date`, `kind`, `comment`, `restricted`, `have_access`, `new`, `updated` |
| `have_related()` | none | `bool` — true if any `.cut` files in folder |
| `related()` | none | `array` of `['link', 'filename', 'icon', 'icon_grid', 'restricted'?, 'have_access'?]` |
| `is_root()` | none | `bool` — true if at site root (`get_path()` == `""`) |
| `parent_link(name)` | `string` | HTML `<a>` to parent directory; `NULL` if at root |
| `previous_link_or_span(name, dir_name, link_id, class)` | strings | HTML `<a>` (if previous exists) or `<span>` (if not) |
| `next_link_or_span(name, dir_name, link_id, class)` | strings | HTML `<a>` (if next exists) or `<span>` (if not) |
| `updated_since_link_or_span(type)` | `'lastweek'`/`'lastmonth'`/`'lastvisit'` | HTML `<a>` or `<span>` depending on current `updated_since` state |

- **Used in:** `files_and_folders.php`, `related.php`, `gallery.php`, `prev_next.inc`, `footer.inc`, `notfound.php`
- **Source:** `Subfolio.php:813–1533`

### 6.5 `SubfolioFiles::fetch_rss(url, quantity, cache_name, cache)`
- **Args:** `$url` (feed URL), `$quantity=10` (items to fetch), `$cache_name` (optional, used to create cache file `-{name}.cache`), `$cache=3600` (TTL in seconds)
- **Returns:** `array` of feed items (deserialized from SimpleXML, cached with `serialize()`/`file_put_contents()`)
- **Used in:** `rss.php:7`, `_inline_rss.php:7`
- **Source:** `Subfolio.php:1535–1579`
- **Note:** Cache files are local filesystem files with `-*.cache` naming. The function is **static** (unlike most `SubfolioFiles` methods).

---

## 7. Function catalog — `View` class (`MY_View.php`)

### 7.1 `view::get_option(name, default=null)`
- **Returns:** `mixed` — the option value from the theme's `options.yml`, or `$default` if not set
- **Static** — usable as `view::get_option(...)` anywhere
- **Source:** `MY_View.php:39–48`

### 7.2 `view::get_color(name, default=null)`
- **Returns:** `string` — color hex value from the loaded color palette, or `$default`
- **Instance** method (called on a View object)
- **Source:** `MY_View.php:50–59`

### 7.3 `view::view_exists(name)`
- **Returns:** `bool` — whether a view file exists in the current theme or the `default` fallback
- **Static**
- **Source:** `MY_View.php:22–32`

### 7.4 `view::get_view_url()`
- **Returns:** `string` — `/config/themes/<theme_name>` — theme asset root URL
- **Instance** method
- **Source:** `MY_View.php:34–37`

### 7.5 `view::load_options()`
- **Returns:** `void` — loads `options.yml` (and its referenced color palette file) once into static cache
- **Source:** `MY_View.php:61–83`

#### Options loading flow
1. On first call, reads `/config/themes/{theme}/options.yml` via Spyc YAML loader
2. Stores parsed array in `self::$options`
3. If `color_palette` key is set, loads `/config/themes/{theme}/colors/{palette}.yml` into `self::$colors`
4. Subsequent calls use cached arrays (no reload)
5. If `options.yml` doesn't exist, stores empty array

**Theme file resolution (`set_filename`):**
1. Look in current theme directory: `config/themes/{theme}/`
2. Fall back to default theme: `config/themes/default/`
3. Final fallback: `config/themes/{theme}/` (errors if missing)

---

## 8. Theme options (`options.yml`)

All keys from `config/themes/default/options.sample.yml`. Each is read via `view::get_option(key, default)` or `SubfolioTheme::get_option(key, default)`.

### 8.1 Branding

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `site_logo_url` | `string` | `/config/themes/default/images/logos/area17_logo.svg` | Path to logo image. Set empty to show text site name instead. |
| `site_logo_width` | `int` | `100` | Logo image width in pixels |
| `site_logo_height` | `int` | `53` | Logo image height in pixels |
| `site_favicon_url` | `string` | `/config/themes/default/images/favicon.ico` | Favicon URL |

### 8.2 Styling

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `color_palette` | `string` | `"default"` | Color palette name — loads `colors/{name}.yml` |
| `thumbnail_height` | `int` | `240` | Thumbnail height in pixels (width is proportional) |

### 8.3 File name display

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `replace_underscore_space` | `bool` | `true` | Replace `_` with space in displayed file names |
| `replace_dash_space` | `bool` | `true` | Replace `-` with space in displayed file names |
| `display_file_extensions` | `bool` | `true` | Show file extensions in listing |
| `display_file_names_in_gallery` | `bool` | `true` | Show file names under gallery thumbnails |

### 8.4 Listing layout

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `listing_mode` | `string` | `"list"` | Default listing mode: `list`, `grid`, or `masonry` |
| `icon_set_list` | `string` | `"list"` | Icon set for list view (`list`, `list1`, `list24`) |
| `icon_set_grid` | `string` | `"grid"` | Icon set for grid view (`grid`, `grid1`, `grid24`) |

### 8.5 Column visibility (list view)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `display_icons` | `bool` | `true` | Show icon column |
| `display_name` | `bool` | `true` | Show name column |
| `display_size` | `bool` | `true` | Show size column |
| `display_date` | `bool` | `true` | Show date column |
| `display_kind` | `bool` | `true` | Show kind column |
| `display_comment` | `bool` | `false` | Show comment column |

### 8.6 Sort defaults

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `default_sort` | `string` | `"filename"` | Default sort field: `filename`, `size`, `date`, or `kind` |
| `default_sort_order` | `string` | `"Desc"` | Default sort direction: `Asc` or `Desc` |

### 8.7 UI chrome

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `display_header` | `bool` | `true` | Show page header |
| `display_collapse_header` | `bool` | `true` | Show collapse-header toggle |
| `display_send_page` | `bool` | `true` | Show "send page" link |
| `display_tiny_url` | `bool` | `false` | Show TinyURL link |
| `display_breadcrumb` | `bool` | `true` | Show breadcrumb trail |
| `display_navigation` | `bool` | `true` | Show prev/next navigation |
| `display_file_listing_header` | `bool` | `true` | Show column headers in listing |
| `display_updated_since` | `bool` | `true` | Show "updated since" filter in footer |
| `display_copyright` | `bool` | `true` | Show copyright line |
| `display_info` | `bool` | `true` | Show info/download box on detail pages |

### 8.8 Access

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `hide_locked_folders` | `bool` | `false` | Hide folders the user cannot access |

### 8.9 Search (extension)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `search_endpoint` | `string` | _(not in sample)_ | External search endpoint URL |
| `search_autocomplete_endpoint` | `string` | _(not in sample)_ | External search autocomplete endpoint URL |

---

## 9. Color palette (`colors/{name}.yml`)

Loaded when `options.yml` specifies a `color_palette`. Keys below are from `template_colors.php`:

| Color key | Default | CSS variable / usage |
|-----------|---------|---------------------|
| `back` | `white` | Page background |
| `main_link` | `#1a1a1a` | Primary link color |
| `main_link_hover` | `#999` | Primary link hover |
| `main_link_back_color` | `#ffffff` | Link background |
| `main_link_back_hover` | `#ffffff` | Link hover background |
| `flash` | `red` | Flash/notice color |
| `text_strong` | `#1a1a1a` | Strong text |
| `text` | `#333` | Body text |
| `text_light` | `#808080` | Light text |
| `text_dimmed` | `#999` | Dimmed text |
| `line` | `#ddd` | Line/separator color |
| `border` | `$line_color` | Border color (defaults to `line`) |
| `gallery_link` | `$main_link_color` | Gallery link |
| `gallery_link_hover` | `$main_link_hover_color` | Gallery link hover |
| `gallery_back` | `$main_link_back_color` | Gallery item background |
| `gallery_back_hover` | `$main_link_back_hover_color` | Gallery item hover background |
| `feature_link` | `$main_link_color` | Feature link |
| `feature_link_hover` | `$back_color` | Feature link hover |
| `feature_text_hover` | `$text_color` | Feature text hover |
| `feature_back` | `$main_link_back_hover_color` | Feature background |
| `feature_back_hover` | `$main_link_hover_color` | Feature hover background |
| `sub_link` | `$text_color` | Sub-link color |
| `sub_link_hover` | `$main_link_hover_color` | Sub-link hover |
| `sub_link_back_hover` | `$main_link_back_hover_color` | Sub-link hover background |
| `back_shift` | `$main_link_back_hover_color` | Shifted background |

---

## 10. Go `html/template` function map

This is the target mapping — the function set the Go template engine must provide.

### 10.1 File/single-item context functions
(These replace `Subfolio::current_file(...)` — in Go they operate on the current `File` or `Folder` struct in the template context.)

| Template function | PHP equivalent | Go return type |
|-------------------|----------------|----------------|
| `FileWidth` | `current_file('width')` | `int` |
| `FileHeight` | `current_file('height')` | `int` |
| `FileIcon` | `current_file('icon')` | `string` |
| `FileIconName` | `current_file('icon_name')` | `string` |
| `FileTag` | `current_file('tag')` | `string` |
| `FileURL` | `current_file('url')` | `string` |
| `FileRetina` | `current_file('retina')` | `string` |
| `FileIsRetina` | `current_file('is_retina')` | `bool` |
| `FileHasShadow` | `current_file('has_shadow')` | `bool` |
| `FileHasBrowser` | `current_file('has_browser')` | `bool` |
| `FileLink` | `current_file('link')` | `string` |
| `FileArchive` | `current_file('archive')` | `string` |
| `FileTarget` | `current_file('target')` | `string` |
| `FileName` | `current_file('filename')` | `string` |
| `FileLastModified` | `current_file('lastmodified')` | `string` |
| `FileSize` | `current_file('size')` | `string` |
| `FileRawSize` | `current_file('rawsize')` | `int64` |
| `FileComment` | `current_file('comment')` | `string` |
| `FileAutoplay` | `current_file('autoplay')` | `string` |
| `FileKind` | `current_file('kind')` | `string` |
| `FileExtension` | `current_file('extension')` | `string` |
| `FileFeedURL` | `current_file('feedurl')` | `string` |
| `FileCount` | `current_file('count')` | `int` |
| `FileCache` | `current_file('cache')` | `int` |
| `FileInstructions` | `current_file('instructions')` | `string` |
| `FileBody` | `current_file('body')` | `template.HTML` |

### 10.2 Site/theme context functions

| Template function | PHP equivalent | Go return type |
|-------------------|----------------|----------------|
| `SiteTitle` | `SubfolioTheme::get_site_title()` | `string` |
| `PageTitle` | `SubfolioTheme::get_page_title()` | `string` |
| `SiteName` | `SubfolioTheme::get_site_name()` | `template.HTML` |
| `SiteCopyright` | `SubfolioTheme::get_site_copyright()` | `string` |
| `SiteMetaDescription` | `SubfolioTheme::get_site_meta_description()` | `string` |
| `SiteFaviconURL` | `SubfolioTheme::get_site_favicon_url()` | `string` |
| `ThemeURL` | `SubfolioTheme::get_view_url()` | `string` |
| `ListingMode` | `SubfolioTheme::get_listing_mode()` | `string` |
| `Notice` | `SubfolioTheme::get_notice(name)` | `string` |
| `Breadcrumb` | `SubfolioTheme::get_breadcrumb()` | `[]Crumb` |
| `IsMobile` | `SubfolioTheme::get_mobile_viewport()` | `bool` |
| `ColorPaletteName` | `SubfolioTheme::get_color_palette_name()` | `string` |

### 10.3 Option access

| Template function | PHP equivalent | Go return type |
|-------------------|----------------|----------------|
| `Option` | `SubfolioTheme::get_option(name, default)` | `interface{}` |
| `Color` | `SubfolioTheme::get_color(name, default)` | `string` |

### 10.4 User/auth context

| Template function | PHP equivalent | Go return type |
|-------------------|----------------|----------------|
| `IsLoggedIn` | `SubfolioUser::is_logged_in()` | `bool` |
| `IsAdmin` | `SubfolioUser::is_admin()` | `bool` |
| `CurrentUserName` | `SubfolioUser::current_user_name()` | `string` |
| `CurrentUserFullName` | `SubfolioUser::current_user_fullname()` | `string` |

### 10.5 Language

| Template function | PHP equivalent | Go return type |
|-------------------|----------------|----------------|
| `T` | `SubfolioLanguage::get_text(name, args…)` | `string` |

### 10.6 Listing/content data

| Template function | PHP equivalent | Go return type |
|-------------------|----------------|----------------|
| `Setting` | `Subfolio::get_setting(name)` | `string` |
| `LinkTo` | `Subfolio::link_to(text, url)` | `template.HTML` |
| `IsRoot` | `SubfolioFiles::is_root()` | `bool` |
| `IsEmptyFolder` | `SubfolioFiles::is_empty_folder()` | `bool` |
| `HaveFiles` | `SubfolioFiles::have_files()` | `bool` |
| `HaveFilesAndFolders` | `SubfolioFiles::have_files_and_folders()` | `bool` |
| `HaveGalleryImages` | `SubfolioFiles::have_gallery_images()` | `bool` |
| `HaveFeatures` | `SubfolioFiles::have_features()` | `bool` |
| `HaveRelated` | `SubfolioFiles::have_related()` | `bool` |
| `HaveInlineImages` | `SubfolioFiles::have_inline_images(type)` | `bool` |
| `HaveInlineTexts` | `SubfolioFiles::have_inline_texts(type)` | `bool` |
| `HaveInlineRSS` | `SubfolioFiles::have_inline_rss(type)` | `bool` |

### 10.7 Data-returning functions (used in `foreach` loops)

| Template function | PHP equivalent | Returns |
|-------------------|----------------|---------|
| `Files` | `SubfolioFiles::files()` | `[]FileItem` |
| `FilesAndFolders` | `SubfolioFiles::files_and_folders()` | `[]FileItem` |
| `GalleryImages` | `SubfolioFiles::gallery_images(mode)` | `[]GalleryImage` |
| `Features` | `SubfolioFiles::features()` | `[]Feature` |
| `Related` | `SubfolioFiles::related()` | `[]RelatedItem` |
| `InlineImages` | `SubfolioFiles::inline_images(type)` | `[]InlineImage` |
| `InlineTexts` | `SubfolioFiles::inline_texts(type)` | `[]InlineText` |
| `InlineRSS` | `SubfolioFiles::inline_rss(type)` | `[]InlineRSSItem` |

### 10.8 Navigation helpers

| Template function | PHP equivalent | Go return type |
|-------------------|----------------|----------------|
| `ParentLink` | `SubfolioFiles::parent_link(name)` | `template.HTML` |
| `PrevLinkOrSpan` | `SubfolioFiles::previous_link_or_span(…)` | `template.HTML` |
| `NextLinkOrSpan` | `SubfolioFiles::next_link_or_span(…)` | `template.HTML` |
| `UpdatedSinceLinkOrSpan` | `SubfolioFiles::updated_since_link_or_span(type)` | `template.HTML` |
| `CollapseHeaderButton` | `SubfolioTheme::get_collapse_header_button(wrap)` | `template.HTML` |
| `TinyURL` | `SubfolioTheme::get_tiny_url(name, wrap)` | `template.HTML` |
| `SubfolioLink` | `SubfolioTheme::subfolio_link()` | `template.HTML` |

### 10.9 Misc

| Template function | PHP equivalent | Go return type |
|-------------------|----------------|----------------|
| `FetchRSS` | `SubfolioFiles::fetch_rss(url, qty, cacheName, cache)` | `[]RSSItem` |
| `LockedIconURL` | `SubfolioTheme::get_locked_icon_url(mode)` | `string` |
| `UnlockedIconURL` | `SubfolioTheme::get_unlocked_icon_url(mode)` | `string` |
| `UpdatedIconURL` | `SubfolioTheme::get_updated_icon_url(mode)` | `string` |
| `NewIconURL` | `SubfolioTheme::get_new_icon_url(mode)` | `string` |

---

## 11. Key data structures (Go)

```go
// Crumb — breadcrumb trail entry
type Crumb struct {
    Name string
    URL  string // empty for last item
}

// FileItem — one row in files_and_folders listing
type FileItem struct {
    Target     string
    URL        string
    IconName   string
    Icon       string // e.g. "list_img"
    IconGrid   string // e.g. "grid_img"
    FileName   string
    Size       string
    Date       string
    Kind       string
    Comment    string
    Restricted bool
    HaveAccess bool
    New        bool
    Updated    bool
    Empty      bool // only in files_and_folders
}

// GalleryImage — one image in gallery view
type GalleryImage struct {
    Class           string // "gallery_thumbnail" or "gallery_thumbnail custom"
    Link            string
    FileName        string
    URL             string
    Width           int
    Height          int
    Shadow          bool
    Browser         bool
    ContainerWidth  int
    ContainerHeight int
}

// Feature — a .ftr file entry
type Feature struct {
    Link         string
    ImageFile    string
    ImageWidth   int
    ImageHeight  int
    Width        int
    Height       int
    Title        string
    Target       string
    Description  string
}

// RelatedItem — a .cut file entry
type RelatedItem struct {
    Link       string
    FileName   string
    Icon       string
    IconGrid   string
    Restricted bool
    HaveAccess bool
}

// InlineImage — an inline (-t-, -m-, -b-) image
type InlineImage struct {
    URL    string
    Width  int
    Height int
}

// InlineText — an inline text file
type InlineText struct {
    Body template.HTML
}

// InlineRSSItem — an inline RSS feed
type InlineRSSItem struct {
    FeedURL  string
    FileName string
    Count    int
    Cache    int
}

// RSSItem — a fetched RSS feed entry
type RSSItem struct {
    Title       string
    Link        string
    Description string
    // … other feed fields …
}
```

---

## 12. Design decisions for Go port

1. **`current_file()` becomes fields on the File struct.** The big switch in PHP is a code smell. In Go, pre-compute width, height, icon, tag, etc. when loading the file entry, store them as struct fields, and let the template access them directly (`{{ .File.Width }}` instead of `Subfolio::current_file('width')`).

2. **Options become a typed struct.** Load `options.yml` into a `type Options struct` with all bool/int/string fields. Pass to templates as `{{ .Options.DisplayInfo }}`.

3. **Color palette becomes a `map[string]string`.** The theme system loads `colors/{name}.yml` and the template accesses individual colors via a template function `{{ color "text" }}`.

4. **Language strings: `map[string]string`.** All view labels come from `language.yml`. A `T` (translate) template function does the lookup: `{{ T "kind" }}`.

5. **Listing data is pre-computed, not called from templates.** Rather than calling `SubfolioFiles::files_and_folders()` inside the template, the Go controller builds the `[]FileItem` slice and passes it as `{{ .Items }}`.

6. **Icon URLs are pre-computed.** The icon-set and icon-name are combined into a single `Icon` / `IconGrid` string before the template sees it. The template just outputs the string.

7. **`SubfolioFiles::fetch_rss` → server-side HTTP call.** The Go version fetches and parses the RSS feed before template execution, caching the result. The template receives a pre-parsed `[]RSSItem`.

8. **Theme file resolution (fallback to `default`) is kept.** The Go engine should mirror the PHP logic: check the active theme directory first, then fall back to `default` for any missing template file.
