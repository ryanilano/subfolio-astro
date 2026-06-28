# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This log tracks the
ongoing site-QA pass over each Subfolio feature as it's verified against the live
PHP app on the same content fixture.

## [Unreleased]

### Fixed

- **03 Featuring Content: feature cards no longer crop the title/description under
  the thumbnail.** The `<img>` was emitting the feature *box* dimensions (e.g.
  250×230 from the `.ftr`) instead of the image's own (249×159), so CSS
  `height:auto` over-scaled the photo past the fixed-height, `overflow:hidden`
  card and clipped the text below it. The loader now reads real image dimensions
  via sharp — faithful to upstream `getimagesize()`
  ([Subfolio.php:733-740](../../subfolio/engine/application/libraries/Subfolio.php#L733-L740))
  — and the view emits those on the `<img>`, leaving the box dims on the anchor.
