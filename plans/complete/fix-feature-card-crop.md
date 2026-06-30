# Fix: Feature card crops content under the photo (03 Featuring Content)

## Context

On the **03 Featuring Content** listing, each feature card clips the title/description
that should sit *under* the thumbnail. The card has a fixed box height (`height: 230`
from the `.ftr`) and the anchor is `overflow: hidden`, so anything past 230px is cut off.

**Root cause** — not CSS (our `_features.scss` is byte-identical to upstream). The port
in [Features.astro](src/components/listing/Features.astro) sets the `<img>` `width`/`height`
attributes from the **feature box** dimensions (250×230 from the `.ftr`) instead of the
**image's own** dimensions (the thumbnails are 249×159). With CSS `max-width:100%;
height:auto`, the browser computes the rendered height from the attribute aspect ratio, so
the 250:230 ratio makes the image render far too tall (~193px in a ~210px column vs. the
correct ~134px), pushing the title + description below the 230px box where `overflow:hidden`
crops them.

Upstream PHP keeps these separate: [Subfolio.php:733-740](../../subfolio/engine/application/libraries/Subfolio.php#L733-L740)
runs `getimagesize()` on the actual image file to get `image_width`/`image_height`, distinct
from the box `width`/`height`, and the view emits the *image* dims on the `<img>`. Our port
collapsed the two into one. This restores the separation faithfully.

This is the first entry in a running site-QA pass; it also establishes a CHANGELOG.

## Approach

Read each feature image's real dimensions at build time with `sharp` (already a dependency,
used by `scripts/gen-thumbs.mjs`), store them on the `Feature` as `imageWidth`/`imageHeight`,
and emit *those* on the `<img>` — leaving the box `width`/`height` on the anchor's inline
style untouched.

The loader's `walk` is synchronous and image decoding was deliberately deferred, so dimensions
are resolved in a **post-walk async enrichment pass** rather than inside the sync recursion.

### Changes

1. **[src/loaders/schema.ts](src/loaders/schema.ts)** — add two optional fields to the `feature`
   Zod object (after `width`/`height`):
   ```ts
   imageWidth: z.number().optional(),
   imageHeight: z.number().optional(),
   ```

2. **[src/loaders/index.ts](src/loaders/index.ts)** — after `walk("")` completes, before the
   final `logger.info`, run an async enrichment pass:
   - During `walk`, keep a list of `{ id, entry }` for every stored entry (the parsed `entry`
     object is what we re-store). Currently the code does `store.set({ id, data: entry })`
     inline — capture each `{ id, entry }` into an array first.
   - After the walk, for each entry, for each `feature` that has an `image`, resolve the
     absolute path (`join(contentRoot, feature-folder, feature.image)` — folder is the entry's
     `path`), read `await sharp(abs).metadata()`, and set `feature.imageWidth = meta.width`,
     `feature.imageHeight = meta.height`. Mutate the feature object in place, then
     re-`store.set({ id, data: entry })`.
   - Wrap each read in try/catch and skip on failure (lenient, matching `@getimagesize` and
     the rest of the loader). A feature with no resolvable image simply gets no img dims.
   - Mirror upstream's fallback: if the image can't be read, leave `imageWidth`/`imageHeight`
     unset so the view falls back to the box dims (see step 4) — same as PHP's
     `image_width = feature.width` fallback.

   *Note:* `sharp` is currently imported only in scripts. Add `import sharp from "sharp";` to
   the loader. Confirm `astro check` is happy with the types (`metadata()` returns
   `width?/height?: number`).

3. **[src/components/listing/Features.astro](src/components/listing/Features.astro)** — change the
   `<img>` to use the image's own dims, not the box dims (lines 53-57):
   ```astro
   <img
     src={imageSrc}
     width={feature.imageWidth ?? feature.width ?? undefined}
     height={feature.imageHeight ?? feature.height ?? undefined}
   />
   ```
   The anchor's inline `style` (box `width`/`height`) at lines 47-51 stays exactly as-is.

4. **[docs/CHANGELOG.md](docs/CHANGELOG.md)** — create, Keep-a-Changelog format. First entry under
   `## [Unreleased]` → `### Fixed`:
   > **03 Featuring Content: feature cards no longer crop the title/description under the
   > thumbnail.** The `<img>` was emitting the feature *box* dimensions instead of the image's
   > own, so `height:auto` over-scaled the photo past the fixed-height card. The loader now
   > reads real image dimensions via sharp (faithful to upstream `getimagesize()`), and the
   > view emits those.

## Verification

1. `npm run build` — must pass `astro check` (new schema fields typed) and `astro build`.
2. `npm run preview`, browse to **03 Featuring Content**. Confirm all three cards (Featured
   File, Featured Folder, Featured Link) show the full thumbnail **plus** the title and
   description, with nothing clipped at the bottom of the card.
3. Inspect a feature `<img>` in devtools: `width="249" height="159"` (the image's real dims),
   while the parent `<a>` still carries `style="width: 250px; height: 230px;"`.
4. Cross-check against the live PHP app on the same fixture — cards should match.
5. Sanity: a feature whose image is missing/unreadable still renders (falls back to box dims,
   no build break).

## Out of scope

Other site features flagged for this QA pass — logged separately in `docs/CHANGELOG.md` as they
are fixed. This plan covers **03 Featuring Content** only.
