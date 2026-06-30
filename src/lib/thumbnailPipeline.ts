/**
 * Thumbnail URL resolution (read-only) — ports FileFolder::get_thumbnail_url()'s
 * URL logic (SPEC-thumbnails §3.5–3.6) WITHOUT generating anything.
 *
 * Generation is a separate pre-build pass (scripts/gen-thumbs.mjs) that runs
 * before `astro build`. That pass writes auto thumbnails into an out-of-tree
 * cache (./.thumb-cache, mirroring the content layout). Doing it up front means
 * the /directory route walker registers every thumbnail's static route — a
 * thumbnail generated lazily during component render would have no route and
 * 404 on a cold build. Keeping this module read-only also means we never mutate
 * a live SUBFOLIO_CONTENT_DIR.
 *
 * This function only decides which URL to emit, by checking what already exists
 * on disk: a user's custom thumbnail (in content), then the pre-generated auto
 * thumbnail (in cache), else "" (suppress — source was too big / already small).
 */
import { stat } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";

const contentRoot = resolve(process.env.SUBFOLIO_CONTENT_DIR ?? "./content/examples");
const cacheRoot = resolve(process.env.SUBFOLIO_THUMB_CACHE ?? "./.thumb-cache");

export interface ThumbnailResult {
  /** URL to the thumbnail, or "" if none exists (skipped at gen time). */
  url: string;
  /** "custom" for manual thumbnails, "auto" for pre-generated, "none" if absent. */
  kind: "custom" | "auto" | "none";
  /**
   * Modern-format sibling URLs for `<picture>` <source>s, present ONLY for
   * auto-generated thumbnails that have them on disk. The `url` above stays the
   * PNG/JPEG/GIF fallback. Custom thumbnails are user-authored originals and
   * never get sources. Phase C (WebP/AVIF) — see plans/elegant-coalescing-bee.md.
   */
  sources?: { avif?: string; webp?: string };
}

/** Encode each segment of a "/"-relative path, preserving separators. */
function encodeParts(p: string): string {
  return p
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
}

const cache = new Map<string, ThumbnailResult>();

/**
 * Check "-thumbnails-custom" (canonical, SPEC §3.5) and "-thumbnails_custom"
 * (legacy fixture variant). Returns the dir name that matched, or null.
 */
async function customThumbDir(parentDir: string, name: string): Promise<string | null> {
  for (const dir of ["-thumbnails-custom", "-thumbnails_custom"]) {
    const p = resolve(contentRoot, parentDir, dir, name);
    try {
      await stat(p);
      return dir;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Resolve the thumbnail URL for a "/"-relative image path. Read-only: assumes
 * scripts/gen-thumbs.mjs already populated the cache.
 */
export async function thumbnailFor(
  relPath: string,
  _contentRoot?: string,
  _listingMode: string = "list",
): Promise<ThumbnailResult> {
  const cached = cache.get(relPath);
  if (cached) return cached;

  const parentDir = dirname(relPath); // "." for root-level files
  const name = basename(relPath);
  const encParent = parentDir === "." ? "" : `${encodeParts(parentDir)}/`;

  // 1. Custom thumbnail (lives in the content tree, served verbatim — SPEC §3.5).
  const customDir = await customThumbDir(parentDir, name);
  if (customDir !== null) {
    const url = `/directory/${encParent}${encodeURIComponent(customDir)}/${encodeURIComponent(name)}`;
    const out: ThumbnailResult = { url, kind: "custom" };
    cache.set(relPath, out);
    return out;
  }

  // 2. Pre-generated auto thumbnail (lives in the cache). Use its ctime as the
  //    cache-buster, mirroring PHP's ?rnd={ctime} (SPEC §3.6).
  const thumbRel = parentDir === "." ? `-thumbnails/${name}` : `${parentDir}/-thumbnails/${name}`;
  try {
    const st = await stat(resolve(cacheRoot, thumbRel));
    const rnd = Math.floor(st.ctimeMs);
    const base = `/directory/${encParent}-thumbnails/${encodeURIComponent(name)}`;
    const url = `${base}?rnd=${rnd}`;

    // Modern-format siblings (Phase C). gen-thumbs.mjs writes `<name>.webp` /
    // `<name>.avif` next to the base thumbnail. Attach each only if it exists on
    // disk — a missing sibling (e.g. an older cache) just degrades to fewer
    // <source>s. Originals are never touched; this is the derived preview only.
    const sources: { avif?: string; webp?: string } = {};
    for (const fmt of ["avif", "webp"] as const) {
      try {
        await stat(resolve(cacheRoot, `${thumbRel}.${fmt}`));
        sources[fmt] = `${base}.${fmt}?rnd=${rnd}`;
      } catch {
        /* sibling not generated — skip this format */
      }
    }

    const out: ThumbnailResult = { url, kind: "auto" };
    if (sources.avif || sources.webp) out.sources = sources;
    cache.set(relPath, out);
    return out;
  } catch {
    /* no thumbnail was generated (too big / already small) — suppress */
  }

  const out: ThumbnailResult = { url: "", kind: "none" };
  cache.set(relPath, out);
  return out;
}
