# Plan: Remove Redundant Filename-Based Alt Text from Content Images

## Context

Currently, content images (in the image detail view, inline embeds, and gallery listings) use the file's display name as their `alt` attribute. File names like `IMG_1234.jpg` or `photo-2024.png` are not meaningful descriptions — they add auditory clutter for screen reader users without conveying the image's content. Per WCAG 2.1 guidance, decorative or non-informative images should use empty alt text (`alt=""`) so assistive technology skips them entirely.

Images in the header (logo) are excluded from this change — the logo already uses `siteConfig.site_title` which is genuinely semantic. The footer and navigation areas don't contain images, so they're unaffected.

## Scope

Only images that are **not** in header/navigation/footer and currently fall back to the filename:

| File | Current `alt` | Change |
|---|---|---|
| `src/components/filekinds/Img.astro` | `f.displayName` (×4) | `alt=""` |
| `src/components/listing/InlineEmbeds.astro` | `image.name` | `alt=""` |
| `src/components/listing/Gallery.astro` | `image.filename` (×2) | `alt=""` |

**Not changed** (already correct or no images):
- `src/layouts/Header.astro` — logo uses `siteConfig.site_title` ✅
- `src/layouts/Footer.astro` — no images ✅
- `src/components/listing/Features.astro` — uses `feature.title ?? ""`, already empty fallback ✅

## Implementation

Three files, one pattern per file:

1. **`src/components/filekinds/Img.astro`** — Replace all four occurrences of `alt={f.displayName}` with `alt=""`. All four branches (shadow, browser, retina, default) use the same expression.

2. **`src/components/listing/InlineEmbeds.astro`** — Replace `alt={image.name}` with `alt=""` on the inline embed image.

3. **`src/components/listing/Gallery.astro`** — Replace both occurrences of `alt={image.filename}` with `alt=""` (one in the masonry branch, one in the list/grid branch).

No schema changes, no new fields, no new logic — this is a straightforward replacement of filename-derived alt text with empty alt across content images.

## Verification

1. **Build**: `npm run build` — confirm no build errors (empty alt is valid HTML, Astro won't complain).
2. **Preview**: `npm run preview` — browse listing and detail pages that contain images.
3. **Visual diff**: Inspect rendered HTML source to confirm `<img ... alt="">` on content images and `<img ... alt="Subfolio">` on the header logo.
4. **Gate**: Run the gate if available (`npm run gate` or equivalent) to catch regressions.
