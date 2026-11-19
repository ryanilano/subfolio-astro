# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This log tracks the
ongoing site-QA pass over each Subfolio feature as it's verified against the live
PHP app on the same content fixture.

## [Unreleased]

### Added

- **Location data is removed from published images, on by default.** The `/directory/`
  route used to copy content files byte for byte, so photos shipped with their GPS
  EXIF. Every published file whose bytes are a JPEG, PNG, WebP, GIF, TIFF (DNG
  included) or HEIF/AVIF, whatever its extension, now has its EXIF GPS, XMP place
  fields, IPTC place datasets, GeoTIFF tags and motion-photo movie position blanked in
  place, without re-encoding: pixels, ICC profile and Orientation are unchanged. Images
  inside generated `.oplx` zips get the same treatment. New `settings.yml` keys
  `strip_location` (default `true`) and `strip_all_metadata` (default `false`, removes
  all metadata except ICC and Orientation); any value other than true/false stops the
  build. A recognised image whose metadata can't be parsed safely stops the build with
  its path. Pure TypeScript, no new dependency, no system binaries. See SPEC-config §2b.

- **Textile text rendering.** `SUBFOLIO_TEXT_RENDERING=textile` now renders Textile
  instead of falling back to plain text with a warning, so folders written for
  original Subfolio (which defaulted to Textile) show `h1. Field Notes - Summer Edition` as a
  heading. Uses `textile-js` 2.1.1 (MIT). Covers headings, `p.`, `bq.`, lists,
  `*strong*`, `_em_`, links, images, line breaks and block HTML, with PHP-Textile's
  typography (` - ` → en dash, `--` → em dash, curly quotes, `...` → ellipsis,
  (c) (r) (tm)); unknown syntax stays literal text. `markdown` and `none` output is unchanged. Details in
  [SPEC-config §2a](spec/SPEC-config.md#2a-text_rendering-in-the-astro-port).

- **SVG and WebP display as images.** Both were missing from `config/filekinds.yml`,
  so they showed a download box, and a `-t-` SVG embed was read as text and its markup
  inlined into the page. They are now `img` files: image detail view, gallery
  thumbnails (PNG base + WebP/AVIF siblings; SVGs rasterized by sharp) and image
  embeds. SVGs are only shown through `<img>`, so their scripts never run. Output for
  sites without SVG/WebP files is unchanged. Details in
  [SPEC-filekinds §2](spec/SPEC-filekinds.md#2-kind-table).

### Fixed

- **03 Featuring Content: feature cards no longer crop the title/description under
  the thumbnail.** The `<img>` was emitting the feature *box* dimensions (e.g.
  250×230 from the `.ftr`) instead of the image's own (249×159), so CSS
  `height:auto` over-scaled the photo past the fixed-height, `overflow:hidden`
  card and clipped the text below it. The loader now reads real image dimensions
  via sharp — faithful to upstream `getimagesize()`
  ([Subfolio.php:733-740](../../subfolio/engine/application/libraries/Subfolio.php#L733-L740))
  — and the view emits those on the `<img>`, leaving the box dims on the anchor.
