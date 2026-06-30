# SPEC-config — Configuration Schema

Extracted from the PHP engine (`engine/application/config/filebrowser.php`) and the
three sample YAML files under `config/settings/`.  Every key that the engine reads is
documented with its Go type, its PHP default, and what `settings.yml` (or the equivalent
YAML) contributes when present.

---

## 1. Overlay algorithm

`filebrowser.php` defines hard-coded PHP defaults, then loads `config/settings/settings.yml`
via Spyc and overlays each key using `isset()` checks:

```
1. Set PHP hard-coded defaults (Section 2 + Section 3 tables).
2. Load config/settings/settings.yml as a flat YAML map via Spyc.
3. For each key listed in the "YAML key" column of Section 2:
   if the key exists in the YAML map, overwrite the PHP default with the YAML value.
   Otherwise keep the PHP default.
4. Some path-type keys are joined with a folder prefix after overlay
   (see "Path resolution" below).
```

**Important**: Keys that exist in the PHP defaults but do NOT appear in
`settings.sample.yml` are never overlaid — they keep their PHP hard-coded value
regardless of what `settings.yml` contains.  They are listed in Section 3 for
completeness (a Go struct needs to carry them), but a user-facing settings file would
not normally set them.

**Path resolution**: The PHP code resolves several YAML keys relative to a base folder:

| YAML key | Base folder | Behavior |
|---|---|---|
| `users_yaml_file` | `config/users/` | YAML value is joined onto `config/users/` |
| `groups_yaml_file` | `config/users/` | YAML value is joined onto `config/users/` |
| `filekinds_yaml_file` | `config/settings/` | YAML value is joined onto `config/settings/` |
| `language_yaml_file` | `config/settings/` | YAML value is joined onto `config/settings/` |
| `directory` | site root (`$site_folder`) | YAML value is joined onto the site-root path |

The sample YAML files store only the filename (e.g. `users.yml`); the PHP code
prepends the folder at overlay time.

**Mobile theme override**: When the user agent contains `iPhone` or `iPod`, the
`mobile_theme` YAML key replaces the `theme` key.  There is no separate runtime config
key for `mobile_theme` — it is consumed only during this check.

---

## 2. `settings.yml` keys

Every key that can appear in `config/settings/settings.yml`, together with the PHP
hard-coded default (from `filebrowser.php`) and the sample value when one exists.

| # | YAML key | Go type | PHP default | Sample value | Meaning |
|---|---|---|---|---|---|
| 1 | `site_name` | `string` | `"Subfolio Portable"` | `"Subfolio"` | Appears in the HTML `<title>` and page header. |
| 2 | `site_root` | `string` | `"/"` | `"/"` | Base URL path the app is served from. **Note:** PHP hard-codes the default but never overlays this key from YAML (bug/gap). |
| 3 | `site_domain` | `string` | `"www.subfolio.com"` | `"www.subfolio.com"` | Shown in breadcrumb navigation. |
| 4 | `site_copyright` | `string` | `""` | `"&copy; AREA 17"` | Copyright string; displayed only when the theme option enables it. |
| 5 | `site_meta_description` | `string` | `""` | `"Subfolio provides an elegant…"` | `<meta name="description">` content for SEO. |
| 6 | `site_logo_url` | `string` | `""` | *(none in sample)* | URL/path to the site logo image. |
| 7 | `site_logo_width` | `int` | `256` | *(none in sample)* | Rendered width of the logo in px. |
| 8 | `site_logo_height` | `int` | `53` | *(none in sample)* | Rendered height of the logo in px. |
| 9 | `google_analytics_code` | `string` | `""` | `"UA-XXXXXX-X"` (commented out) | Google Analytics tracking ID. When empty, GA is disabled. |
| 10 | `theme` | `string` | `"default"` | `"default"` | Active desktop theme directory name (under `config/themes/`). |
| 11 | `mobile_theme` | `string` | `"mobile"` | `"mobile"` | Theme directory used when the user agent is iPhone/iPod (overrides `theme`). |
| 12 | `directory` | `string` (path) | `$site_folder."directory"` | `"directory"` | Path to the served content directory, resolved relative to the site root. |
| 13 | `text_rendering` | `string` | `"none"` | `"textile"` | Markup language for enhancer-file content. Allowed values: `"none"`, `"textile"`, `"markdown"`. |
| 14 | `listing_mode` | `string` | `"list"` | *(none in sample)* | Default listing layout. Allowed values: `"list"`, `"grid"`. |
| 15 | `thumbnail_max_filesize` | `int` (MB) | `1` | `5` | Images larger than this (in MB) are skipped during thumbnail generation. |
| 16 | `display_max_filesize` | `int` (MB) | `5` | *(none in sample)* | Files larger than this (in MB) are hidden from listings on desktop. |
| 17 | `display_max_filesize_mobile` | `int` (MB) | `3` | *(none in sample)* | Same as above, but applied when the mobile theme is active. |
| 18 | `thumbnail_width` | `int` (px) | `320` | *(none in sample)* | Thumbnail width in pixels. |
| 19 | `thumbnail_height` | `int` (px) | `240` | *(none in sample)* | Thumbnail height in pixels. |
| 20 | `access_file` | `string` | `"-access"` | `"-access"` | Basename of the per-directory access-control file. |
| 21 | `properties_file` | `string` | `"-properties"` | `"-properties"` | Basename of the per-directory properties file. |
| 22 | `users_yaml_file` | `string` (basename) | `"users.yml"` | `"users.yml"` | Filename of the users YAML file (resolved under `config/users/`). |
| 23 | `groups_yaml_file` | `string` (basename) | `"groups.yml"` | `"groups.yml"` | Filename of the groups YAML file (resolved under `config/users/`). |
| 24 | `filekinds_yaml_file` | `string` (basename) | `"filekinds.yml"` | `"filekinds.yml"` | Filename of the filekinds YAML file (resolved under `config/settings/`). |
| 25 | `language_yaml_file` | `string` (basename) | `"language.yml"` | `"language.yml"` | Filename of the language-label YAML file (resolved under `config/settings/`). |
| 26 | `auth_session` | `string` | `"1Gmo0pangF8FZ05R"` | *(none in sample)* | Secret used to sign/validate session cookies. **⚠️ Risk:** hard-coded PHP default; must be overridden per deployment. |
| 27 | `auth_salt` | `string` | `"W8Kivk5ykGhSrc11"` | *(none in sample)* | Salt used in the custom password hashing scheme (SHA-512 based). **⚠️ Risk:** hard-coded PHP default; replace with bcrypt in Go port. |

---

## 3. PHP-only defaults (not in `settings.sample.yml`)

These keys are set in `filebrowser.php` and are never overlaid from `settings.yml`
(there is no `isset()` check for them).  They are listed here so the complete Go config
struct can be defined.  A few are also needed by the view layer.

| # | Config key | Go type | PHP default | Meaning |
|---|---|---|---|---|
| 28 | `retina_naming` | `string` | `"@2x"` | Suffix that marks a file as a retina-resolution variant. |
| 29 | `shadow_naming` | `string` | `"-s"` | Suffix that marks a file as a shadow overlay image. |
| 30 | `browser_naming` | `string` | `"-b"` | Suffix that marks a file as a browser-frame overlay image. |
| 31 | `shadow_style_css` | `string` | `"0 1px 10px rgba(0,0,0, .20)"` | CSS `box-shadow` value applied to shadow-overlaid elements. |
| 32 | `settings_yaml_file` | `string` (path) | `"config/settings/settings.yml"` | Where the engine loads `settings.yml` from. Not overlaid (circular). |
| 33 | `users_folder` | `string` (path) | `"config/users/"` | Folder containing `users.yml` and `groups.yml`. Not a config key per se, but defines path resolution. |
| 34 | `settings_folder` | `string` (path) | `"config/settings/"` | Folder containing settings YAML files. Not a config key per se, but defines path resolution. |

---

## 4. `filekinds.yml` schema

Each top-level key is a **kind name** (used in URLs, as a CSS class, and to look up
the view template).  The value is a map with the following fields:

| Field | Go type | Required | Meaning |
|---|---|---|---|
| `extensions` | `[]string` | Yes | File extensions (without dot) that belong to this kind. |
| `icon` | `string` | Yes | Icon slug; resolves to an icon image in the theme. |
| `display` | `string` | Yes | Human-readable label shown in the file detail panel. |
| `instructions` | `string` | No | HTML snippet shown in the "Instructions" section of the detail panel (may include `<a>` tags). |

**Kind resolution flow** (see also SPEC-filekinds.md):
1. Split the filename to get the extension (e.g. `photo.jpg` → `jpg`).
2. Walk every kind in `filekinds.yml`; if the extension is in the kind's `extensions` list, that's the kind.
3. If no match: use the `default` filekind handler (no entry in the YAML — it's the implicit fallback).
4. Look up the view at `pages/filekinds/{kind}.php`; if missing, use `pages/filekinds/default.php`.

**All defined kinds** (from `filekinds.sample.yml`):

| Kind | Extensions | Icon | Display | Has instructions? |
|---|---|---|---|---|
| `img` | `gif, png, jpg` | `img` | Image File | Yes |
| `tiff` | `tiff, tif` | `img` | TIFF Image | Yes |
| `eps` | `eps, ps` | `eps` | Postscript File | Yes |
| `bmp` | `bmp` | `img` | Bitmap Image | Yes |
| `raw` | `3fr, arw, srf, sr2, bay, crw, cr2, cap, iiq, eip, dng, erf, fff, mef, mos, mrw, nef, nrw, orf, ptx, pef, pxn, r3d, raf, raw, rw2, rwz, k25, kdc, dcs, drf, x3f` | `img` | RAW Image | Yes |
| `indd` | `indd` | `indd` | InDesign Document | Yes |
| `psd` | `psd` | `psd` | Photoshop File | Yes |
| `ai` | `ai` | `ai` | Illustrator File | Yes |
| `indb` | `indb` | `indd` | InDesign Book | Yes |
| `ase` | `ase` | `ase` | Adobe Swatch File | Yes |
| `snd` | `mp3, wav` | `snd` | Audio File | Yes |
| `vid` | `avi, mov, mp4, mpg, mpeg, wmv, flv` | `vid` | Movie File | Yes |
| `fla` | `fla` | `fla` | Flash Document | Yes |
| `swf` | `swf` | `swf` | Flash Movie | Yes |
| `dcr` | `dcr` | `dcr` | Shockwave Movie | Yes |
| `ae` | `ae, aep` | `ae` | After Effect File | Yes |
| `pdf` | `pdf` | `pdf` | PDF Document | Yes |
| `doc` | `doc, docx` | `doc` | Word Document | Yes |
| `xls` | `xls, xlsx` | `xls` | Excel Document | Yes |
| `ppt` | `ppt, pptx, pps` | `ppt` | Powerpoint Document | Yes |
| `pages` | `pages` | `pages` | Pages Document | Yes |
| `numbers` | `numbers` | `numbers` | Numbers Document | Yes |
| `key` | `key` | `key` | Keynote Document | Yes |
| `csv` | `csv` | `sql` | CSV File | Yes |
| `txt` | `txt` | `txt` | Text File | Yes |
| `rtf` | `rtf` | `txt` | Rich Text File | Yes |
| `merlin` | `merlin, merlin2` | `merlin` | Merlin File | Yes |
| `oplx` | `oplx` | `merlin` | OmniPlan File | Yes |
| `zip` | `zip, str, tar, gz` | `zip` | Archive | Yes |
| `dmg` | `dmg` | `dmg` | DMG Installer | Yes |
| `fnt` | `fnt, ttf, bmap, afm, otf` | `fnt` | Font | Yes |
| `suit` | `suit` | `fnt` | Font Suitcase | Yes |
| `html` | `htm, html, rhtml` | `html` | HTML File | Yes |
| `css` | `css` | `gen` | Stylesheet | Yes |
| `php` | `php` | `gen` | PHP File | Yes |
| `yml` | `yml` | `sql` | YAML File | Yes |
| `sql` | `sql` | `sql` | MySql Dump | Yes |
| `dir` | `dir` | `dir` | Folder | No |
| `cut` | `cut` | `cut` | Shortcut | No |
| `ftr` | `ftr` | `ftr` | Feature | No |
| `pop` | `pop` | `pop` | Popup Window | No |
| `link` | `net, link, com, fr, net, org, me, us, biz, mobi, info, es, de` | `net` | Internet Location | No |
| `site` | `site` | `site` | Mini Site | No |
| `slide` | `slide` | `slide` | Slideshow | No |
| `rss` | `rss` | `txt` | RSS Feed | No |
| `webloc` | `webloc` | `net` | Web Location | No |

Note: `net` appears twice in the `link` kind extensions list in the sample YAML — this
is a duplicate bug in the original data.  The Go loader should de-duplicate extensions
when building the extension→kind index.

---

## 5. `language.yml` schema

A flat `map[string]string` of UI-label tokens to their display strings.  The engine
reads this file and makes every token available to views as a translatable label.

The sample `language.sample.yml` groups labels by area in comments, but the YAML itself
is a single flat map.  Every value is a plain string (some contain `%s` printf verbs).

**Navigation group**:

| Token | English text |
|---|---|
| `browsing` | `"browsing"` |
| `indexof` | `"index of"` |
| `sendpage` | `"send page"` |
| `generatetinyurl` | `"generate tiny url"` |
| `collapseheader` | `"collapse header"` |
| `expandheader` | `"expand header"` |
| `parent_directory` | `"Parent Directory"` |
| `previous_directory` | `"Previous Directory"` |
| `next_directory` | `"Next Directory"` |
| `previous` | `"Previous"` |
| `next` | `"Next"` |
| `seealso` | `"See also:"` |

**Listing group**:

| Token | English text |
|---|---|
| `filename` | `"Filename"` |
| `size` | `"Size"` |
| `date` | `"Date"` |
| `kind` | `"Kind"` |
| `comment` | `"Comment"` |
| `emptyfolder` | `"This folder is empty"` |

**Access-control group**:

| Token | English text |
|---|---|
| `accessdenied` | `"Access Denied"` |
| `loginasadifferentuser` | `"Log in as a different user"` |
| `youdonthaveaccesstothisdirectory` | `"You don't have access to this directory."` |

**404 group**:

| Token | English text |
|---|---|
| `notfound` | `"The item that you are looking for was not found."` |
| `check_url_go_back` | `"Please check the URL or go to the %s for a file listing."` |

**Login group**:

| Token | English text |
|---|---|
| `username` | `"Username"` |
| `password` | `"Password"` |
| `authenticationrequired_title` | `"Hello."` |
| `authenticationrequired_subtitle` | `"Please login."` |
| `enter_user_password` | `"Enter your username and password"` |
| `remember_my_login` | `"Remember my login"` |
| `submit` | `"Submit"` |
| `invalid_user_password` | `"Invalid username or password."` |
| `error` | `"Error"` |
| `logout` | `"Logout"` |
| `login_complete` | `"Login complete"` |
| `logout_complete` | `"Logout complete"` |
| `login_failed` | `"Login Failed"` |

**Footer group**:

| Token | English text |
|---|---|
| `updated_since` | `"Updated since:"` |
| `last_week` | `"last week"` |
| `last_month` | `"last month"` |
| `my_last_visit` | `"my last visit"` |

**Detail page group**:

| Token | English text |
|---|---|
| `lastmodified` | `"Last Modified"` |
| `instructions` | `"Instructions:"` |
| `downloadfile` | `"Download File"` |
| `downloadzip` | `"Download as zip"` |
| `viewfile` | `"View File"` |
| `viewsite` | `"Launch Site"` |

---

## 6. Go config struct sketch

From this document a Go config package can be built directly:

```go
type AppConfig struct {
    // --- settings.yml keys (Section 2) ---
    SiteName              string `yaml:"site_name"`
    SiteRoot              string `yaml:"site_root"`
    SiteDomain            string `yaml:"site_domain"`
    SiteCopyright         string `yaml:"site_copyright"`
    SiteMetaDescription   string `yaml:"site_meta_description"`
    SiteLogoURL           string `yaml:"site_logo_url"`
    SiteLogoWidth         int    `yaml:"site_logo_width"`
    SiteLogoHeight        int    `yaml:"site_logo_height"`
    GoogleAnalyticsCode   string `yaml:"google_analytics_code"`
    Theme                 string `yaml:"theme"`
    MobileTheme           string `yaml:"mobile_theme"`
    Directory             string `yaml:"directory"`
    TextRendering         string `yaml:"text_rendering"`
    ListingMode           string `yaml:"listing_mode"`
    ThumbnailMaxFilesize  int    `yaml:"thumbnail_max_filesize"`
    DisplayMaxFilesize    int    `yaml:"display_max_filesize"`
    DisplayMaxFilesizeMobile int `yaml:"display_max_filesize_mobile"`
    ThumbnailWidth        int    `yaml:"thumbnail_width"`
    ThumbnailHeight       int    `yaml:"thumbnail_height"`
    AccessFile            string `yaml:"access_file"`
    PropertiesFile        string `yaml:"properties_file"`
    UsersYamlFile         string `yaml:"users_yaml_file"`
    GroupsYamlFile        string `yaml:"groups_yaml_file"`
    FilekindsYamlFile     string `yaml:"filekinds_yaml_file"`
    LanguageYamlFile      string `yaml:"language_yaml_file"`
    AuthSession           string `yaml:"auth_session"`
    AuthSalt              string `yaml:"auth_salt"`

    // --- PHP-only defaults (Section 3) ---
    RetinaNaming          string `yaml:"retina_naming"`
    ShadowNaming          string `yaml:"shadow_naming"`
    BrowserNaming         string `yaml:"browser_naming"`
    ShadowStyleCSS        string `yaml:"shadow_style_css"`

    // --- Resolved paths (computed, not in YAML) ---
    UsersFolder           string
    SettingsFolder        string
    SettingsYamlFile      string
}

type FileKind struct {
    Extensions   []string `yaml:"extensions"`
    Icon         string   `yaml:"icon"`
    Display      string   `yaml:"display"`
    Instructions string   `yaml:"instructions"`
}

type LanguageLabels = map[string]string
type FileKinds      = map[string]FileKind
```

The factory function loads `settings.yml` with a YAML library, applies the defaults
from Section 2 for any missing keys, resolves path-type keys against the site root and
`config/users/` / `config/settings/` folders, and sets the Section 3 constants to their
PHP defaults (they are not overlaid).
