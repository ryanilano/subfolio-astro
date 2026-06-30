/**
 * Image metadata — the Phase 3 keystone. Reads natural pixel dimensions at
 * build time via `sharp`, and decodes the retina / shadow / browser filename
 * suffixes the PHP engine used (`@2x`, `@2x-s`, `@2x-b` — SPEC-thumbnails §3.10,
 * §3.7). Everything here is offline and deterministic: it stats/decodes files
 * already on disk, no network, no cache directory writes.
 *
 * Actual thumbnail *generation* (resize-and-write into `-thumbnails/`) is the
 * remaining Phase 3 slice and is deferred — it needs the build-to-serve wiring
 * settled alongside the Cloudflare Pages deploy. The dimensions this module
 * surfaces are what the listing/gallery/detail views were stubbing as 0.
 */
import sharp from "sharp";
import { resolve } from "node:path";

const contentRoot = resolve(process.env.SUBFOLIO_CONTENT_DIR ?? "./content/examples");

/** Naming suffixes, mirroring filebrowser.php retina/shadow/browser_naming. */
const RETINA = "@2x";
const SHADOW = "@2x-s";
const BROWSER = "@2x-b";

export interface ImageMeta {
  /** Natural width in pixels, or 0 if undecodable. */
  width: number;
  /** Natural height in pixels, or 0 if undecodable. */
  height: number;
  /** Filename carries the `@2x` retina suffix. */
  isRetina: boolean;
  /** Filename carries the `@2x-s` shadow suffix. */
  hasShadow: boolean;
  /** Filename carries the `@2x-b` browser-chrome suffix. */
  hasBrowser: boolean;
}

const EMPTY: ImageMeta = {
  width: 0,
  height: 0,
  isRetina: false,
  hasShadow: false,
  hasBrowser: false,
};

/**
 * Decode retina/shadow/browser flags from the basename (before the extension).
 * `@2x-s`/`@2x-b` both imply retina; check the longer suffixes first so the
 * bare `@2x` test doesn't swallow them.
 */
function suffixFlags(name: string): Pick<ImageMeta, "isRetina" | "hasShadow" | "hasBrowser"> {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const hasShadow = stem.endsWith(SHADOW);
  const hasBrowser = stem.endsWith(BROWSER);
  const isRetina = hasShadow || hasBrowser || stem.endsWith(RETINA);
  return { isRetina, hasShadow, hasBrowser };
}

// Build-time cache: a given source file is decoded once per build.
const cache = new Map<string, ImageMeta>();

/**
 * Resolve image metadata for a "/"-relative content path. Returns zeroed
 * dimensions (but still-valid suffix flags) when the file is missing or sharp
 * can't decode it — the same lenient posture the rest of the loader takes.
 */
export async function imageMetaFor(relPath: string): Promise<ImageMeta> {
  const cached = cache.get(relPath);
  if (cached) return cached;

  const flags = suffixFlags(relPath);
  const abs = resolve(contentRoot, relPath);
  // Guard against traversal — stay under the content root.
  if (abs !== contentRoot && !abs.startsWith(contentRoot + "/")) {
    const out = { ...EMPTY, ...flags };
    cache.set(relPath, out);
    return out;
  }

  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(abs).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch {
    /* undecodable / missing — fall through with zeroed dimensions */
  }

  const out: ImageMeta = { width, height, ...flags };
  cache.set(relPath, out);
  return out;
}
