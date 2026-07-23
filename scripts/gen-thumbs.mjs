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
 *   .thumb-cache/<parent>/-thumbnails/<name>                    auto thumb (+ .webp/.avif)
 *   .thumb-cache/<parent>/-thumbnails-custom/<name>.<w>w.webp   custom-thumb ladder
 *   .thumb-cache/<parent>/-thumbnails-custom/<name>.<w>w.avif   custom-thumb ladder
 * This keeps generated artifacts out of the (possibly live) content directory —
 * we never mutate SUBFOLIO_CONTENT_DIR. Custom thumbnails are user-authored
 * originals, so they get modern-format ladder siblings ONLY; no base-format file
 * is written and the content-tree original stays the <img> fallback.
 *
 * Mirrors FileFolder::get_thumbnail_url() generation rules (SPEC-thumbnails §3).
 */
import sharp from "sharp";
import { readdirSync, statSync, mkdirSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { loadSettings } from "../src/loaders/settings.ts";
import { asNumber } from "../src/loaders/yaml.ts";

// --- Config (SPEC-thumbnails §3.2, §3.10) -------------------------------
const THUMB_WIDTH = 320;
const THUMB_HEIGHT = 240;
const IMG_EXTS = new Set([".gif", ".png", ".jpg", ".jpeg"]);
const LISTING_MODE = process.env.SUBFOLIO_LISTING_MODE ?? "list";

// Custom-thumbnail directory names: canonical (SPEC §3.5) + legacy fixture spelling.
const CUSTOM_THUMB_DIRS = new Set(["-thumbnails-custom", "-thumbnails_custom"]);
// Responsive ladder for user-authored custom thumbnails. They are displayed at
// ~50% of a mobile viewport (gallery li is 50% wide below 639px — see
// modules/content/_gallery.scss) yet are commonly shipped at full source size,
// which is the single heaviest item on a project listing page. We emit RESIZED
// modern-format siblings only — never a base-format file — so the user's
// original stays the <img> fallback and the true downloadable byte stream.
const CUSTOM_LADDER_WIDTHS = [320, 640, 1024];
const CUSTOM_WEBP_QUALITY = 80;
const CUSTOM_AVIF_QUALITY = 55;

// Source-size cap from settings.yml (SPEC-config §15): images larger than
// `thumbnail_max_filesize` MB are skipped. Read from the same merged config the
// loaders use (honors SUBFOLIO_CONFIG_DIR); PHP baseline is 1 MB when unset.
// site.ts deliberately excludes this key — this script is its dedicated source.
const configDir = process.env.SUBFOLIO_CONFIG_DIR ?? "./config";
const THUMB_MAX_MB = asNumber(loadSettings(configDir).thumbnail_max_filesize, 1);
const MAX_FILESIZE_BYTES = THUMB_MAX_MB * 1024 * 1024;

const contentRoot = resolve(process.env.SUBFOLIO_CONTENT_DIR ?? "./content/examples");
export const cacheRoot = resolve(process.env.SUBFOLIO_THUMB_CACHE ?? "./.thumb-cache");

/**
 * Recursively collect candidate source images, "/"-relative to contentRoot.
 *
 * `out` gets ordinary sources (auto-thumbnail candidates). `customOut` gets
 * images that live inside a `-thumbnails-custom` / `-thumbnails_custom` dir —
 * they are NOT auto-thumbnail sources (they already ARE the thumbnail), but they
 * do need right-sized modern-format siblings, so they are collected separately
 * rather than dropped.
 */
function walkImages(relDir, out, customOut) {
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
      // The auto-thumbnail cache is generated output, never a source.
      if (name === "-thumbnails") continue;
      if (CUSTOM_THUMB_DIRS.has(name)) {
        walkCustomThumbs(relPath, customOut);
        continue;
      }
      walkImages(relPath, out, customOut);
    } else {
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
      if (IMG_EXTS.has(ext)) out.push(relPath);
    }
  }
}

/** Collect images directly inside a custom-thumbnail dir (non-recursive by design). */
function walkCustomThumbs(relDir, out) {
  const absDir = join(contentRoot, relDir);
  let names;
  try {
    names = readdirSync(absDir);
  } catch {
    return;
  }
  for (const name of names) {
    const abs = join(absDir, name);
    try {
      if (statSync(abs).isDirectory()) continue;
    } catch {
      continue;
    }
    const dot = name.lastIndexOf(".");
    const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
    if (IMG_EXTS.has(ext)) out.push(`${relDir}/${name}`);
  }
}

/**
 * Is `absOut` missing, or older than the source? Checked PER OUTPUT FILE so a
 * fresh sibling from an earlier pass can never suppress a newly added rung.
 */
function isStale(absOut, srcStat) {
  try {
    return !(statSync(absOut).mtime > srcStat.mtime);
  } catch {
    return true; // missing → generate
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

  // Resize: masonry constrains width, list/grid constrains height.
  // Targets doubled (480/640) for retina crispness at the 240px display size.
  const resizeOpts =
    LISTING_MODE === "masonry"
      ? { width: THUMB_WIDTH * 2, withoutEnlargement: true }
      : { height: THUMB_HEIGHT * 2, withoutEnlargement: true };

  mkdirSync(dirname(absThumb), { recursive: true, mode: 0o755 });

  // Base thumbnail (original format) + WebP + AVIF siblings (same resize pipeline).
  await Promise.all([
    sharp(absSource).resize(resizeOpts).toFile(absThumb),
    sharp(absSource).resize(resizeOpts).webp({ quality: 80 }).toFile(absThumb + ".webp"),
    sharp(absSource).resize(resizeOpts).avif({ quality: 55 }).toFile(absThumb + ".avif"),
  ]);
  return "created";
}

/**
 * Generate the responsive modern-format ladder for ONE user-authored custom
 * thumbnail. `relPath` already includes the custom dir segment, so the cache
 * mirrors the content layout verbatim and whichever dir spelling matched is
 * preserved:
 *   .thumb-cache/<parent>/-thumbnails-custom/<name>.<w>w.{webp,avif}
 *
 * No base-format file is written: the original in the content tree remains both
 * the <img> fallback and the downloadable bytes, and is never touched.
 * Returns "created" | "fresh" | "skip".
 */
async function genCustomOne(relPath) {
  const absSource = join(contentRoot, relPath);
  const srcStat = statSync(absSource);

  // Same size guard as the auto pass (SPEC §3.10).
  if (srcStat.size > MAX_FILESIZE_BYTES) return "skip";

  // Same unreadable-image leniency; width also tells us which rungs to drop.
  let meta;
  try {
    meta = await sharp(absSource).metadata();
  } catch {
    return "skip";
  }
  const srcWidth = meta.width ?? 0;
  if (srcWidth <= 0) return "skip";

  // Drop rungs wider than the source: withoutEnlargement would emit a duplicate
  // under a lying `w` descriptor. A source narrower than every rung still gets
  // one native-width rung so it receives a modern-format candidate.
  const fitting = CUSTOM_LADDER_WIDTHS.filter((w) => w <= srcWidth);
  const widths = fitting.length > 0 ? fitting : [srcWidth];

  const jobs = [];
  for (const w of widths) {
    const resizeOpts = { width: w, withoutEnlargement: true };
    const absWebp = join(cacheRoot, `${relPath}.${w}w.webp`);
    const absAvif = join(cacheRoot, `${relPath}.${w}w.avif`);
    if (isStale(absWebp, srcStat)) {
      jobs.push([
        absWebp,
        () => sharp(absSource).resize(resizeOpts).webp({ quality: CUSTOM_WEBP_QUALITY }),
      ]);
    }
    if (isStale(absAvif, srcStat)) {
      jobs.push([
        absAvif,
        () => sharp(absSource).resize(resizeOpts).avif({ quality: CUSTOM_AVIF_QUALITY }),
      ]);
    }
  }

  if (jobs.length === 0) return "fresh";

  mkdirSync(dirname(join(cacheRoot, relPath)), { recursive: true, mode: 0o755 });
  await Promise.all(jobs.map(([absOut, make]) => make().toFile(absOut)));
  return "created";
}

async function main() {
  const images = [];
  const customThumbs = [];
  walkImages("", images, customThumbs);

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

  let cCreated = 0;
  let cFresh = 0;
  let cSkip = 0;
  for (const rel of customThumbs) {
    try {
      const r = await genCustomOne(rel);
      if (r === "created") cCreated++;
      else if (r === "fresh") cFresh++;
      else cSkip++;
    } catch (err) {
      console.warn(`[gen-thumbs] skipped custom ${rel}: ${err.message}`);
      cSkip++;
    }
  }

  console.log(
    `[gen-thumbs] ${images.length} image(s) → ${created} generated, ${fresh} fresh, ${skip} skipped (cap: ${THUMB_MAX_MB} MB, cache: ${cacheRoot})`,
  );
  console.log(
    `[gen-thumbs] ${customThumbs.length} custom thumb(s) → ${cCreated} generated, ${cFresh} fresh, ${cSkip} skipped (variants only; originals untouched)`,
  );
}

main();
