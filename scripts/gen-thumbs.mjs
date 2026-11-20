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
import { statSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { loadSettings } from "../src/loaders/settings.ts";
import { asNumber } from "../src/loaders/yaml.ts";
import { autoThumbName } from "../src/lib/thumbName.ts";
import { ContentTree } from "../src/lib/contentWalk.ts";
import { cacheRoot as cacheRootFor, sweepExpected, canSweep, claimCache } from "../src/lib/cachePaths.ts";

// --- Config (SPEC-thumbnails §3.2, §3.10) -------------------------------
const THUMB_WIDTH = 320;
const THUMB_HEIGHT = 240;
// .webp and .svg: sharp reads both. Their base thumbnail is written as PNG (see
// src/lib/thumbName.ts); an SVG is rasterized, never copied as markup.
const IMG_EXTS = new Set([".gif", ".png", ".jpg", ".jpeg", ".webp", ".svg"]);
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
export const cacheRoot = cacheRootFor("thumb");
// Shared publication policy (src/lib/contentWalk.ts): no dot names, no
// -access, no symlinks out of the root, each real folder walked once.
const tree = new ContentTree(contentRoot);
// Every cache file this run wants to exist, "/"-relative to cacheRoot. The
// sweep at the end deletes everything else (src/lib/cachePaths.ts, audit F5).
const expected = new Set();
// Prefixes whose existing files the sweep must leave alone: a source that
// failed this run (unreadable, sharp error) keeps its previous outputs rather
// than losing them to one bad run.
const protect = [];

/** Cache path of a source's auto thumbnail, "/"-relative. */
function thumbRelFor(relPath) {
  const parent = dirname(relPath);
  const thumbName = autoThumbName(basename(relPath));
  return parent === "." ? `-thumbnails/${thumbName}` : `${parent}/-thumbnails/${thumbName}`;
}

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
  if (!tree.enterDir(relDir)) return;
  for (const { name, relPath, isDir } of tree.list(relDir)) {
    if (isDir) {
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
  if (!tree.enterDir(relDir)) return;
  for (const { name, isFile } of tree.list(relDir)) {
    if (!isFile) continue;
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

/**
 * Encode / refresh one format's ladder for a single source, then DROP any rung
 * that is byte-dominated: encoded size >= the size of a WIDER rung of the same
 * format. Such a rung is strictly worse on both axes — a narrower image for more
 * bytes — so serving it makes narrow viewports pay extra for less.
 *
 * Stale rungs are encoded to a BUFFER first so a dominated one is never written
 * at all; a rung already on disk that becomes dominated is removed. Fresh rungs
 * keep their bytes untouched — the mtime staleness contract is intact.
 *
 * Mirrors the identical pass in scripts/gen-embeds.mjs (these two generators
 * deliberately stay standalone). `rungs` is [{ w, absOut, encode }] where
 * `encode` returns a sharp pipeline. Returns the number of files written.
 */
async function writeLadder(relPath, fmt, rungs, srcStat) {
  const resolved = await Promise.all(
    rungs.map(async (r) => {
      if (!isStale(r.absOut, srcStat)) {
        return { ...r, size: statSync(r.absOut).size, buf: null };
      }
      const buf = await r.encode().toBuffer();
      return { ...r, size: buf.length, buf };
    }),
  );
  resolved.sort((a, b) => a.w - b.w);

  let written = 0;
  // Walk widest → narrowest, tracking the smallest byte size seen so far among
  // WIDER rungs. Any rung at or above that is dominated.
  let smallestWider = Infinity;
  for (let i = resolved.length - 1; i >= 0; i--) {
    const r = resolved[i];
    if (r.size >= smallestWider) {
      console.log(
        `[gen-thumbs] pruned ${relPath}.${r.w}w.${fmt} (${r.size} B ≥ a wider rung's ${smallestWider} B)`,
      );
      if (r.buf === null) rmSync(r.absOut, { force: true });
      continue;
    }
    smallestWider = Math.min(smallestWider, r.size);
    if (r.buf !== null) {
      writeFileSync(r.absOut, r.buf);
      written++;
    }
  }
  return written;
}

/** Generate one thumbnail into the cache. Returns "created" | "fresh" | "skip". */
async function genOne(relPath) {
  const parent = dirname(relPath);
  const name = basename(relPath);
  const absSource = join(contentRoot, relPath);

  const thumbName = autoThumbName(name);
  const thumbRel = parent === "." ? `-thumbnails/${thumbName}` : `${parent}/-thumbnails/${thumbName}`;
  const absThumb = join(cacheRoot, thumbRel);

  const srcStat = statSync(absSource);

  // Staleness: skip if cached thumb is newer than source (SPEC §3.4).
  try {
    const thumbStat = statSync(absThumb);
    if (thumbStat.mtime > srcStat.mtime) {
      expected.add(thumbRel).add(`${thumbRel}.webp`).add(`${thumbRel}.avif`);
      return "fresh";
    }
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
    protect.push(thumbRel);
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

  // Base thumbnail (original format; PNG for SVG/WebP sources, from the .png
  // name autoThumbName gave it) + WebP + AVIF siblings (same resize pipeline).
  await Promise.all([
    sharp(absSource).resize(resizeOpts).toFile(absThumb),
    sharp(absSource).resize(resizeOpts).webp({ quality: 80 }).toFile(absThumb + ".webp"),
    sharp(absSource).resize(resizeOpts).avif({ quality: 55 }).toFile(absThumb + ".avif"),
  ]);
  expected.add(thumbRel).add(`${thumbRel}.webp`).add(`${thumbRel}.avif`);
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
    protect.push(`${relPath}.`);
    return "skip";
  }
  const srcWidth = meta.width ?? 0;
  if (srcWidth <= 0) return "skip";

  // Drop rungs wider than the source: withoutEnlargement would emit a duplicate
  // under a lying `w` descriptor. A source narrower than every rung still gets
  // one native-width rung so it receives a modern-format candidate.
  const fitting = CUSTOM_LADDER_WIDTHS.filter((w) => w <= srcWidth);
  const widths = fitting.length > 0 ? fitting : [srcWidth];
  // Exactly these rungs, so a replaced, narrower original drops its old wide
  // rungs instead of serving the old picture in the srcset.
  for (const w of widths) expected.add(`${relPath}.${w}w.webp`).add(`${relPath}.${w}w.avif`);

  const ladder = {
    webp: widths.map((w) => ({
      w,
      absOut: join(cacheRoot, `${relPath}.${w}w.webp`),
      encode: () =>
        sharp(absSource)
          .resize({ width: w, withoutEnlargement: true })
          .webp({ quality: CUSTOM_WEBP_QUALITY }),
    })),
    avif: widths.map((w) => ({
      w,
      absOut: join(cacheRoot, `${relPath}.${w}w.avif`),
      encode: () =>
        sharp(absSource)
          .resize({ width: w, withoutEnlargement: true })
          .avif({ quality: CUSTOM_AVIF_QUALITY }),
    })),
  };

  // writeLadder always runs, even on a fully warm cache: it encodes nothing for
  // fresh rungs (one statSync each), and it is what removes a rung that a newer
  // encode has made byte-dominated. Gating it on staleness would leave such a
  // rung on disk forever.
  mkdirSync(dirname(join(cacheRoot, relPath)), { recursive: true, mode: 0o755 });
  const written = await Promise.all([
    writeLadder(relPath, "webp", ladder.webp, srcStat),
    writeLadder(relPath, "avif", ladder.avif, srcStat),
  ]);
  return written.some((n) => n > 0) ? "created" : "fresh";
}

async function main() {
  // Mark the cache folder as ours (or learn it is someone else's: an explicit
  // SUBFOLIO_THUMB_CACHE that already holds other files is never swept).
  claimCache("thumb", contentRoot);
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
      protect.push(thumbRelFor(rel));
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
      protect.push(`${rel}.`);
      cSkip++;
    }
  }

  // Drop anything this run did not ask for: a deleted image's thumbnails, a
  // source now skipped (too small, too big, unreadable), a replaced custom
  // thumbnail's old rungs (src/lib/cachePaths.ts, audit F5). canSweep() refuses
  // a missing content root or a cache folder that overlaps content or another
  // cache.
  let swept = 0;
  if (canSweep("thumb", contentRoot)) swept = sweepExpected(cacheRoot, expected, protect);

  console.log(
    `[gen-thumbs] ${images.length} image(s) → ${created} generated, ${fresh} fresh, ${skip} skipped, ${swept} orphan(s) removed (cap: ${THUMB_MAX_MB} MB, cache: ${cacheRoot})`,
  );
  console.log(
    `[gen-thumbs] ${customThumbs.length} custom thumb(s) → ${cCreated} generated, ${cFresh} fresh, ${cSkip} skipped (variants only; originals untouched)`,
  );
}

main();
