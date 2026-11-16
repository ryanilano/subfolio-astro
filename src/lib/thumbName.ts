/**
 * File name of an auto thumbnail inside `-thumbnails/`, shared by the generator
 * (scripts/gen-thumbs.mjs) and the URL resolver (src/lib/thumbnailPipeline.ts)
 * so the two always agree.
 *
 * Most sources keep their own name and format (`photo.jpg` → `photo.jpg`).
 * SVG and WebP sources get a PNG base thumbnail (`logo.svg` → `logo.svg.png`):
 *  - sharp can rasterize SVG but can't write it, and a raster thumbnail means
 *    the gallery never loads a large vector file just to show a preview;
 *  - the base thumbnail is the `<img>` fallback and the og:image, which stay
 *    PNG/JPEG/GIF everywhere (social crawlers' WebP support is uneven).
 * Both still get the usual `.webp` / `.avif` siblings next to the base.
 */
const PNG_BASE = new Set([".svg", ".webp"]);

export function autoThumbName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  return PNG_BASE.has(ext) ? `${name}.png` : name;
}
