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
import { readdir, stat } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";

const contentRoot = resolve(process.env.SUBFOLIO_CONTENT_DIR ?? "./content/examples");
const cacheRoot = resolve(process.env.SUBFOLIO_THUMB_CACHE ?? "./.thumb-cache");

export interface ThumbnailResult {
  /** URL to the thumbnail, or "" if none exists (skipped at gen time). */
  url: string;
  /** "custom" for manual thumbnails, "auto" for pre-generated, "none" if absent. */
  kind: "custom" | "auto" | "none";
  /**
   * `srcset` values for `<picture>` <source>s, attached only for formats that
   * actually exist on disk. The `url` above always stays the PNG/JPEG/GIF
   * fallback.
   *
   * Two shapes, both valid srcset syntax:
   *  - auto thumbnails: a single URL with no width descriptor (one encode
   *    exists, so `sizes` is moot and the browser just takes it).
   *  - custom thumbnails: a multi-candidate list with `w` descriptors, from the
   *    right-sized ladder gen-thumbs.mjs writes into `.thumb-cache`. The
   *    user-authored original is never rewritten — only these derived siblings
   *    are generated, and the original remains the `<img>` fallback.
   *
   * Phase C (WebP/AVIF) — see plans/elegant-coalescing-bee.md.
   */
  sources?: { avif?: string; webp?: string };
}

/**
 * Ladder rungs are discovered by LISTING the cache dir rather than by probing a
 * hardcoded width list. gen-thumbs.mjs drops rungs wider than the source and
 * falls back to a single native-width rung for narrow sources, so the set of
 * widths on disk is not knowable in advance — and the filename is the only
 * honest source for the `w` descriptor, which must be the real encoded width.
 * One readdir per directory, memoised for the build.
 */
const dirListings = new Map<string, string[]>();

async function listCacheDir(absDir: string): Promise<string[]> {
  const hit = dirListings.get(absDir);
  if (hit) return hit;
  let names: string[];
  try {
    names = await readdir(absDir);
  } catch {
    names = []; // no ladder generated for this folder — degrade to no <source>s
  }
  dirListings.set(absDir, names);
  return names;
}

/**
 * Collect `<name>.<w>w.<fmt>` rungs for one custom thumbnail into srcset strings.
 * Returns undefined when nothing was generated.
 */
async function customThumbSources(
  parentDir: string,
  customDir: string,
  name: string,
  encParent: string,
): Promise<{ avif?: string; webp?: string } | undefined> {
  const absDir = resolve(cacheRoot, parentDir === "." ? customDir : `${parentDir}/${customDir}`);
  const names = await listCacheDir(absDir);
  if (names.length === 0) return undefined;

  const base = `${import.meta.env.BASE_URL}directory/${encParent}${encodeURIComponent(customDir)}/`;
  const byFormat: Record<string, { w: number; url: string }[]> = { avif: [], webp: [] };

  for (const file of names) {
    if (!file.startsWith(`${name}.`)) continue;
    const m = /^(\d+)w\.(avif|webp)$/.exec(file.slice(name.length + 1));
    if (!m) continue;
    byFormat[m[2]].push({ w: Number(m[1]), url: `${base}${encodeURIComponent(file)}` });
  }

  const out: { avif?: string; webp?: string } = {};
  for (const fmt of ["avif", "webp"] as const) {
    const rungs = byFormat[fmt].sort((a, b) => a.w - b.w);
    if (rungs.length === 0) continue;
    // A LONE candidate is emitted as a BARE URL with no `w` descriptor. With a
    // `w` descriptor present the browser derives a density-corrected intrinsic
    // size from `sizes` instead of the file's real pixel width, and since
    // _gallery.scss sets `img { width: auto }` — which beats the presentational
    // `width` attribute — that corrected width becomes the layout width and
    // upscales the thumbnail. There is nothing to choose between with one
    // candidate, so the descriptor buys nothing and costs a regression.
    out[fmt] =
      rungs.length === 1
        ? rungs[0].url
        : rungs.map((r) => `${r.url} ${r.w}w`).join(", ");
  }
  return out.avif || out.webp ? out : undefined;
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
    // `url` is the user's untouched original in the content tree and MUST stay
    // exactly this — it is the <img> fallback, the downloadable bytes, and what
    // tests/smoke.thumbnails.test.mjs matches on.
    const url = `${import.meta.env.BASE_URL}directory/${encParent}${encodeURIComponent(customDir)}/${encodeURIComponent(name)}`;
    const out: ThumbnailResult = { url, kind: "custom" };
    // Right-sized modern-format ladder from .thumb-cache (gen-thumbs.mjs). These
    // are derived siblings only; the original above is never rewritten.
    const sources = await customThumbSources(parentDir, customDir, name, encParent);
    if (sources) out.sources = sources;
    cache.set(relPath, out);
    return out;
  }

  // 2. Pre-generated auto thumbnail (lives in the cache). Use its ctime as the
  //    cache-buster, mirroring PHP's ?rnd={ctime} (SPEC §3.6).
  const thumbRel = parentDir === "." ? `-thumbnails/${name}` : `${parentDir}/-thumbnails/${name}`;
  try {
    const st = await stat(resolve(cacheRoot, thumbRel));
    const rnd = Math.floor(st.ctimeMs);
    const base = `${import.meta.env.BASE_URL}directory/${encParent}-thumbnails/${encodeURIComponent(name)}`;
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
