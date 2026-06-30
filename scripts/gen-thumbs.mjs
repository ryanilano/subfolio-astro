/**
 * Pre-build thumbnail generation — runs BEFORE `astro build` (see package.json).
 *
 * Why a separate pass: Astro's static build is two-phase. The /directory route's
 * getStaticPaths() walks the content tree to register raw-byte routes, and that
 * runs *before* any component renders. If a thumbnail were generated lazily
 * during Gallery render (as the PHP engine does at runtime), its /directory
 * route would never be registered → 404 in production on a cold build. So we
 * generate every thumbnail up front, into an out-of-tree cache the route walker
 * then sees as a single source of truth.
 *
 * The cache lives at ./.thumb-cache/ (gitignored) mirroring the content layout:
 *   .thumb-cache/<parent>/-thumbnails/<name>
 * This keeps generated artifacts out of the (possibly live) content directory —
 * we never mutate SUBFOLIO_CONTENT_DIR.
 *
 * Mirrors FileFolder::get_thumbnail_url() generation rules (SPEC-thumbnails §3).
 */
import sharp from "sharp";
import { readdirSync, statSync, mkdirSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";

// --- Config (SPEC-thumbnails §3.2, §3.10) -------------------------------
const THUMB_WIDTH = 320;
const THUMB_HEIGHT = 240;
const MAX_FILESIZE_BYTES = 1 * 1024 * 1024; // thumbnail_max_filesize = 1 MB
const IMG_EXTS = new Set([".gif", ".png", ".jpg", ".jpeg"]);
const LISTING_MODE = process.env.SUBFOLIO_LISTING_MODE ?? "list";

const contentRoot = resolve(process.env.SUBFOLIO_CONTENT_DIR ?? "./content/examples");
export const cacheRoot = resolve(process.env.SUBFOLIO_THUMB_CACHE ?? "./.thumb-cache");

/** Recursively collect candidate source images, "/"-relative to contentRoot. */
function walkImages(relDir, out) {
  const absDir = join(contentRoot, relDir);
  let names;
  try {
    names = readdirSync(absDir);
  } catch {
    return;
  }
  for (const name of names) {
    const relPath = relDir ? `${relDir}/${name}` : name;
    const abs = join(absDir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // Skip the thumbnail caches themselves — they aren't sources.
      if (name === "-thumbnails" || name === "-thumbnails-custom" || name === "-thumbnails_custom") {
        continue;
      }
      walkImages(relPath, out);
    } else {
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
      if (IMG_EXTS.has(ext)) out.push(relPath);
    }
  }
}

/** Generate one thumbnail into the cache. Returns "created" | "fresh" | "skip". */
async function genOne(relPath) {
  const parent = dirname(relPath);
  const name = basename(relPath);
  const absSource = join(contentRoot, relPath);

  const thumbRel = parent === "." ? `-thumbnails/${name}` : `${parent}/-thumbnails/${name}`;
  const absThumb = join(cacheRoot, thumbRel);

  const srcStat = statSync(absSource);

  // Staleness: skip if cached thumb is newer than source (SPEC §3.4).
  try {
    const thumbStat = statSync(absThumb);
    if (thumbStat.mtime > srcStat.mtime) return "fresh";
  } catch {
    /* missing → generate */
  }

  // Size guard (SPEC §3.10).
  if (srcStat.size > MAX_FILESIZE_BYTES) return "skip";

  // Dimension check: source already thumbnail-sized → no thumb (SPEC §3.3).
  let meta;
  try {
    meta = await sharp(absSource).metadata();
  } catch {
    return "skip";
  }
  const h = meta.height ?? 0;
  const w = meta.width ?? 0;
  if (h <= 0 || w <= 0 || h <= THUMB_HEIGHT) return "skip";

  // Resize: masonry constrains width, list/grid constrains height (SPEC §3.6).
  const resizeOpts =
    LISTING_MODE === "masonry"
      ? { width: THUMB_WIDTH, withoutEnlargement: true }
      : { height: THUMB_HEIGHT, withoutEnlargement: true };

  mkdirSync(dirname(absThumb), { recursive: true, mode: 0o755 });
  await sharp(absSource).resize(resizeOpts).toFile(absThumb);
  return "created";
}

async function main() {
  const images = [];
  walkImages("", images);

  let created = 0;
  let fresh = 0;
  let skip = 0;
  for (const rel of images) {
    try {
      const r = await genOne(rel);
      if (r === "created") created++;
      else if (r === "fresh") fresh++;
      else skip++;
    } catch (err) {
      // Lenient, like the rest of the loader — one bad image won't break the build.
      console.warn(`[gen-thumbs] skipped ${rel}: ${err.message}`);
      skip++;
    }
  }
  console.log(
    `[gen-thumbs] ${images.length} image(s) → ${created} generated, ${fresh} fresh, ${skip} skipped (cache: ${cacheRoot})`,
  );
}

main();
