/**
 * Pre-build embed WebP generation — runs BEFORE `astro build` (see package.json).
 *
 * Position-prefixed embeds (`-t-`/`-m-`/`-b-`) are presentation banners composited
 * into the top/middle/bottom of a folder listing — directory chrome, not files a
 * visitor downloads. They're the heaviest assets shipped (1–2 MB PNGs), so we
 * re-encode each one to a high-quality WebP sibling the listing serves via
 * <picture>, keeping the original PNG/JPG as the fallback (and as the true
 * downloadable byte stream, untouched).
 *
 * Same two-phase rationale as gen-thumbs.mjs: the /directory route's
 * getStaticPaths() registers raw-byte routes before any component renders, so the
 * .webp must exist on disk up front or its route is never registered → 404 on a
 * cold build. So we generate every embed WebP into an out-of-tree cache the route
 * walker then sees.
 *
 * The cache lives at ./.embed-cache/ (gitignored) mirroring the content layout:
 *   .embed-cache/<relPath>.webp     e.g. flavorwire/-t-01-flavorwire.png.webp
 * The `<name>.webp` suffix matches gen-thumbs' sibling-naming convention, so
 * assetUrl(src + ".webp") resolves straight through. We never mutate
 * SUBFOLIO_CONTENT_DIR.
 *
 * Per the locked decisions for this pass: WebP only (no AVIF), FULL resolution
 * (no resize) — savings come purely from the PNG→WebP re-encode at high quality.
 */
import sharp from "sharp";
import { readdirSync, statSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { positionOf } from "../src/loaders/conventions.ts";

// --- Config -------------------------------------------------------------
const WEBP_QUALITY = 90; // high bar: embeds are hero imagery (thumbs use 80)
const WEBP_EFFORT = 6; // max compression effort; cache makes it a one-time cost
// .gif excluded: re-encoding to a single WebP frame would drop animation.
const IMG_EXTS = new Set([".png", ".jpg", ".jpeg"]);

const contentRoot = resolve(process.env.SUBFOLIO_CONTENT_DIR ?? "./content/examples");
export const cacheRoot = resolve(process.env.SUBFOLIO_EMBED_CACHE ?? "./.embed-cache");

/** Recursively collect position-prefixed embed images, "/"-relative to contentRoot. */
function walkEmbeds(relDir, out) {
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
      walkEmbeds(relPath, out);
    } else {
      // Only position-prefixed raster embeds (not .gif, not already .webp).
      if (!positionOf(name)) continue;
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
      if (IMG_EXTS.has(ext)) out.push(relPath);
    }
  }
}

/** Generate one embed WebP into the cache. Returns "created" | "fresh" | "skip". */
async function genOne(relPath) {
  const absSource = join(contentRoot, relPath);
  const absWebp = join(cacheRoot, relPath + ".webp");

  const srcStat = statSync(absSource);

  // Staleness: skip if cached WebP is newer than source.
  try {
    const webpStat = statSync(absWebp);
    if (webpStat.mtime > srcStat.mtime) return "fresh";
  } catch {
    /* missing → generate */
  }

  // Guard against unreadable images (no size guard — the big files are the point).
  try {
    await sharp(absSource).metadata();
  } catch {
    return "skip";
  }

  mkdirSync(dirname(absWebp), { recursive: true, mode: 0o755 });

  // Full resolution (no resize) — high-quality WebP re-encode only.
  await sharp(absSource).webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT }).toFile(absWebp);
  return "created";
}

async function main() {
  const embeds = [];
  walkEmbeds("", embeds);

  let created = 0;
  let fresh = 0;
  let skip = 0;
  for (const rel of embeds) {
    try {
      const r = await genOne(rel);
      if (r === "created") created++;
      else if (r === "fresh") fresh++;
      else skip++;
    } catch (err) {
      // Lenient, like the rest of the loader — one bad image won't break the build.
      console.warn(`[gen-embeds] skipped ${rel}: ${err.message}`);
      skip++;
    }
  }
  console.log(
    `[gen-embeds] ${embeds.length} embed(s) → ${created} generated, ${fresh} fresh, ${skip} skipped (cache: ${cacheRoot})`,
  );
}

main();
