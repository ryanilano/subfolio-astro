# SPEC-filekinds — Extension → Kind → View Mapping

How Subfolio maps a file's extension to a "kind" label and then to a detail-page view.

---

## 1. Resolution algorithm

### Step 1 — Extract extension

`FileKind::get_kind_by_file($file)` calls `pathinfo($file)` to extract the file's
extension ([FileKind.php:46-50](../../engine/application/libraries/FileKind.php#L46)).

### Step 2 — Lowercase & match

`get_kind_by_extension($ext)` lowercases the extension via `strtolower()`, then walks
the kinds loaded from `filekinds.sample.yml` in order. It returns the **first** kind
whose `extensions` array contains the extension
([FileKind.php:56-63](../../engine/application/libraries/FileKind.php#L56)).

The returned array is the kind's YAML block, with one extra key:
- `kind` — the YAML key (e.g. `"img"`, `"pdf"`) set at
  [FileKind.php:61](../../engine/application/libraries/FileKind.php#L61).

If no kind matches, `$kind` stays empty (empty array → falsy).

### Step 3 — Resolve view

The controller reads the kind key:

```php
$fkind = $this->filekind->get_kind_by_file($file->name);
$kind  = isset($fkind['kind']) ? $fkind['kind'] : '';
```
([filebrowser.php:194-195](../../engine/application/controllers/filebrowser.php#L194))

When `$kind` is set:

**a.** If a view file exists at
   `config/themes/{theme}/pages/filekinds/{kind}.php` — checked by
   `View::view_exists('pages/filekinds/'.$kind)`
   ([MY_View.php:25](../../engine/application/libraries/MY_View.php#L25)) — that view is
   rendered and receives `$file` (and `$folder` if applicable).

**b.** If the named view does not exist (either `$kind` is empty or the file is
   missing), the controller falls back to
   `pages/filekinds/default.php`
   ([filebrowser.php:203](../../engine/application/controllers/filebrowser.php#L203)).

The `default.php` fallback itself renders the `_download_box.php` partial:
```php
<?php require("_download_box.php"); ?>
```
([default.php:1](../../config/themes/default/pages/filekinds/default.php#L1))

### Step 4 — View data passed

Views receive:
- `$file` — the `FileFolder` object for the current file
- `$folder` — the containing folder path (when available)

The view accesses file metadata via `Subfolio::current_file($key)`, not directly on
`$file`. Keys include: `icon`, `kind`, `width`, `height`, `url`, `link`, `target`,
`filename`, `comment`, `tag`, `rawsize`, `is_retina`, `has_shadow`, `has_browser`.

---

## 2. Kind table

Each row maps a YAML kind key → its extensions → the icon name → the dedicated view
file (or `default.php` fallback) → the display name → brief instructions.

### Image kinds

| Kind  | Extensions                                      | Icon  | View        | Display             | Instructions                                                        |
|-------|-------------------------------------------------|-------|-------------|---------------------|---------------------------------------------------------------------|
| img   | `gif, png, jpg`                                 | img   | `img.php`   | Image File          | Most Image files are natively recognized by your computer.          |
| tiff  | `tiff, tif`                                     | img   | default     | TIFF Image          | Need Adobe Photoshop or similar.                                    |
| eps   | `eps, ps`                                       | eps   | default     | Postscript File     | Need Adobe Illustrator or similar.                                  |
| bmp   | `bmp`                                           | img   | default     | Bitmap Image        | Need Adobe Photoshop or similar.                                    |
| raw   | `3fr, arw, srf, sr2, bay, crw, cr2, cap, iiq, eip, dng, erf, fff, mef, mos, mrw, nef, nrw, orf, ptx, pef, pxn, r3d, raf, raw, rw2, rwz, k25, kdc, dcs, drf, x3f` | img | default | RAW Image | Need Adobe Photoshop or similar. |
| indd  | `indd`                                          | indd  | default     | InDesign Document   | Need Adobe InDesign or similar.                                     |
| psd   | `psd`                                           | psd   | default     | Photoshop File      | Need Adobe Photoshop or similar.                                    |
| ai    | `ai`                                            | ai    | default     | Illustrator File    | Need Adobe Illustrator or similar.                                  |
| indb  | `indb`                                          | indd  | default     | InDesign Book       | Need Adobe InDesign or similar.                                     |
| ase   | `ase`                                           | ase   | default     | Adobe Swatch File   | Need Adobe Creative Suite or similar.                               |

### Audio / video kinds

| Kind  | Extensions                                      | Icon  | View        | Display             | Instructions                                                        |
|-------|-------------------------------------------------|-------|-------------|---------------------|---------------------------------------------------------------------|
| snd   | `mp3, wav`                                      | snd   | `snd.php`   | Audio File          | Need QuickTime, Windows Media Player or similar.                    |
| vid   | `avi, mov, mp4, mpg, mpeg, wmv, flv`            | vid   | `vid.php`   | Movie File          | Need QuickTime, Windows Media Player or similar.                    |
| fla   | `fla`                                           | fla   | default     | Flash Document      | Need Adobe Flash player.                                            |
| swf   | `swf`                                           | swf   | `swf.php`   | Flash Movie         | Need Adobe Flash player.                                            |
| dcr   | `dcr`                                           | dcr   | default     | Shockwave Movie     | Need Adobe Flash player.                                            |
| ae    | `ae, aep`                                       | ae    | default     | After Effect File   | Need Adobe After Effects.                                           |

### Document kinds

| Kind    | Extensions              | Icon    | View        | Display              | Instructions                                                   |
|---------|-------------------------|---------|-------------|----------------------|----------------------------------------------------------------|
| pdf     | `pdf`                   | pdf     | default     | PDF Document         | Need free Adobe Acrobat Reader or similar.                     |
| doc     | `doc, docx`             | doc     | default     | Word Document        | Need Microsoft Word or similar.                                |
| xls     | `xls, xlsx`             | xls     | default     | Excel Document       | Need Microsoft Excel or similar.                               |
| ppt     | `ppt, pptx, pps`        | ppt     | default     | Powerpoint Document  | Need Microsoft PowerPoint or similar.                          |
| pages   | `pages`                 | pages   | default     | Pages Document       | Need Apple iWorks.                                             |
| numbers | `numbers`               | numbers | default     | Numbers Document     | Need Apple iWorks.                                             |
| key     | `key`                   | key     | default     | Keynote Document     | Need Apple iWorks.                                             |
| csv     | `csv`                   | sql     | default     | CSV File             | Can be opened with a spreadsheet application.                  |
| txt     | `txt`                   | txt     | `txt.php`   | Text File            | Need any standard text editor.                                 |
| rtf     | `rtf`                   | txt     | default     | Rich Text File       | Need any standard text editor.                                 |
| merlin  | `merlin, merlin2`       | merlin  | default     | Merlin File          | Need Merlin.                                                   |
| oplx    | `oplx`                  | merlin  | `oplx.php`  | OmniPlan File        | Need OmniPlan.                                                 |

### Packages & fonts

| Kind  | Extensions                      | Icon  | View    | Display         | Instructions                                          |
|-------|---------------------------------|-------|---------|-----------------|-------------------------------------------------------|
| zip   | `zip, str, tar, gz`             | zip   | default | Archive         | Most archive formats are natively recognized.         |
| dmg   | `dmg`                           | dmg   | default | DMG Installer   | Disc images for Mac application installation.         |
| fnt   | `fnt, ttf, bmap, afm, otf`      | fnt   | default | Font            | Need FontCreator (PC) or Font Book (Mac).             |
| suit  | `suit`                          | fnt   | default | Font Suitcase   | Need a Mac.                                           |

### Web kinds

| Kind  | Extensions              | Icon  | View    | Display         | Instructions                              |
|-------|-------------------------|-------|---------|-----------------|-------------------------------------------|
| html  | `htm, html, rhtml`      | html  | default | HTML File       | Need a standard text editor.              |
| css   | `css`                   | gen   | default | Stylesheet      | Need a standard text editor.              |
| php   | `php`                   | gen   | default | PHP File        | Need a standard text editor.              |
| yml   | `yml`                   | sql   | default | YAML File       | Need a standard text editor.              |
| sql   | `sql`                   | sql   | default | MySql Dump      | Need MySQL.                               |
| dir   | `dir`                   | dir   | default | Folder          | —                                         |

### Enhancer kinds

| Kind   | Extensions                                              | Icon  | View         | Display            | Instructions |
|--------|---------------------------------------------------------|-------|--------------|--------------------|--------------|
| cut    | `cut`                                                   | cut   | default      | Shortcut           | —            |
| ftr    | `ftr`                                                   | ftr   | default      | Feature            | —            |
| pop    | `pop`                                                   | pop   | default      | Popup Window       | —            |
| link   | `net, link, com, fr, net, org, me, us, biz, mobi, info, es, de` | net | `link.php` | Internet Location | —            |
| site   | `site`                                                  | site  | `site.php`   | Mini Site          | —            |
| slide  | `slide`                                                 | slide | default      | Slideshow          | —            |
| rss    | `rss`                                                   | txt   | `rss.php`    | RSS Feed           | —            |
| webloc | `webloc`                                                | net   | `webloc.php` | Web Location       | —            |

---

## 3. Total summary

| Metric                         | Count |
|--------------------------------|-------|
| Total kinds defined            |  46   |
| Kinds with a dedicated view    |  10   (`img`, `snd`, `vid`, `swf`, `txt`, `oplx`, `link`, `site`, `rss`, `webloc`) |
| Kinds falling back to default  |  36   |
| Extension-to-view path base    | `config/themes/{theme}/pages/filekinds/{kind}.php` |
| Fallback view                  | `config/themes/{theme}/pages/filekinds/default.php` |
| View partials (shared)         | `_download_box.php`, `_hideable_download_box.php` |

---

## 4. Quick reference: resolution in pseudocode

```
function resolve_view(filename):
    ext      = lowercase(pathinfo(filename)['extension'])
    kind_key = null

    for (key, definition) in loaded_kinds:          // first-match, YAML order
        if ext in definition['extensions']:
            kind_key = key
            break

    if kind_key is not null AND view_exists("pages/filekinds/" + kind_key):
        return "pages/filekinds/" + kind_key + ".php"
    else:
        return "pages/filekinds/default.php"
```

## 5. Source citations

| Source | What it provides |
|--------|------------------|
| [`FileKind.php`](../../engine/application/libraries/FileKind.php) | Extension extraction (`pathinfo`), extension→kind lookup (linear scan, first match), `get_icon_by_file()` returning the `icon` field (default `"gen"`) |
| [`filekinds.sample.yml`](../../config/settings/filekinds.sample.yml) | The canonical kind definitions: key → `extensions`, `icon`, `display`, `instructions` |
| [`filebrowser.php` (controller)](../../engine/application/controllers/filebrowser.php#L194-L205) | View resolution: `View::view_exists()` check → dedicated view or `default.php` fallback |
| [`MY_View.php:22-31`](../../engine/application/libraries/MY_View.php#L22) | `view_exists()` checks current theme first, then `default` theme |
| [`Subfolio.php`](../../engine/application/libraries/Subfolio.php) | `current_file()` exposes kind metadata to views (icon, width/height, etc.); `set_filekind()` wires the `FileKind` singleton |
| [`default.php`](../../config/themes/default/pages/filekinds/default.php) | Fallback view: renders `_download_box.php` partial |
| [`img.php`](../../config/themes/default/pages/filekinds/img.php) | Example dedicated view: conditionally inlines image or shows download box based on `display_max_filesize` setting |
| [`link.php`](../../config/themes/default/pages/filekinds/link.php) | Example dedicated view: renders clickable zone with `current_file('link')` target URL |
