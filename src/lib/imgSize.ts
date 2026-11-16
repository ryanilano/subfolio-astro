/**
 * `width`/`height` attributes for an `<img>`, or none when the size is unknown.
 *
 * imageMetaFor() returns 0×0 when sharp can't read a file (a malformed SVG, an
 * SVG with zero or unusual dimensions). `<img width="0" height="0">` would make
 * the image invisible, so the attributes are left off and the browser uses the
 * image's own size, the same way InlineEmbeds.astro treats a 0 dimension.
 */
export function sizeAttrs(width: number, height: number): { width?: number; height?: number } {
  return width > 0 && height > 0 ? { width, height } : {};
}
