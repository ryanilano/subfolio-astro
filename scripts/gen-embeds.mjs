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
 *   .embed-cache/<relPath>.webp          full-res legacy sibling
 *   .embed-cache/<relPath>.<w>w.webp     responsive ladder rung
 *   .embed-cache/<relPath>.<w>w.avif     responsive ladder rung
 * e.g. flavorwire/-t-01-flavorwire.png.768w.avif. The sibling-suffix naming
 * matches gen-thumbs' convention, so assetUrl(src + suffix) resolves straight
 * through. We never mutate SUBFOLIO_CONTENT_DIR.
 *
 * Formats: this pass emits a multi-width AVIF + WebP ladder. The earlier
 * "WebP only (no AVIF), FULL resolution (no resize)" note described the
 * superseded first pass and is no longer true — AVIF was already established in
 * this codebase by gen-thumbs.mjs (gallery thumbnails, Milestone 6 Phase C), and
 * it is the only lever that brings the eager embeds on a project page under the
 * transfer-weight budget. The full-resolution `<relPath>.webp` is STILL emitted:
 * src/loaders/index.ts stats exactly that filename to set `hasWebp`, which gates
 * whether InlineEmbeds renders a <picture> at all.
 */
import sharp from "sharp";
import { readdirSync, statSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { positionOf } from "../src/loaders/conventions.ts";

// --- Config -------------------------------------------------------------
const WEBP_QUALITY = 90; // high bar: embeds are hero imagery (thumbs use 80)
const WEBP_EFFORT = 6; // max compression effort; cache makes it a one-time cost
// Responsive ladder. 768w is what a Lighthouse-mobile viewport selects
// (412 CSS px × 1.75 DPR against the derived `sizes`); 1024w covers desktop and
// high-DPR phones; 480w covers small/low-DPR. Rungs wider than the source are
// skipped so no duplicate encodes are produced.
const LADDER_WIDTHS = [480, 768, 1024];
const LADDER_WEBP_QUALITY = 82; // measured: visually indistinguishable from q90
const LADDER_AVIF_QUALITY = 55; // matches gen-thumbs' AVIF quality
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

/**
 * Is `absOut` missing, or older than the source? Checked PER OUTPUT FILE, not
 * once for the whole embed: a legacy `<name>.webp` left over from the previous
 * pass is newer than the source, and a single shared check would let it suppress
 * generation of every new ladder rung.
 */
function isStale(absOut, srcStat) {
  try {
    return !(statSync(absOut).mtime > srcStat.mtime);
  } catch {
    return true; // missing → generate
  }
}

/**
 * Ladder rungs to emit for a source of `srcWidth` px. Never upscales; a source
 * narrower than the smallest configured rung gets exactly one native-width rung
 * so it still receives a modern-format candidate. The returned widths are the
 * REAL encoded pixel widths, which is what the `w` descriptor in srcset means.
 */
function ladderFor(srcWidth) {
  if (srcWidth <= 0) return LADDER_WIDTHS;
  const fitting = LADDER_WIDTHS.filter((w) => w <= srcWidth);
  return fitting.length > 0 ? fitting : [srcWidth];
}

/** Generate one embed's cache outputs. Returns "created" | "fresh" | "skip". */
async function genOne(relPath) {
  const absSource = join(contentRoot, relPath);
  const absWebp = join(cacheRoot, relPath + ".webp");

  const srcStat = statSync(absSource);

  // Guard against unreadable images (no size guard — the big files are the
  // point). Also gives us the source width so we can drop over-wide rungs.
  let meta;
  try {
    meta = await sharp(absSource).metadata();
  } catch {
    return "skip";
  }
  const srcWidth = meta.width ?? 0;

  // Build the full output plan first, then encode only the stale entries.
  const jobs = [];

  // Full-resolution legacy sibling. MUST keep being emitted: the loader stats
  // exactly this filename to set `hasWebp`, which gates the <picture>.
  if (isStale(absWebp, srcStat)) {
    jobs.push([absWebp, () => sharp(absSource).webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT })]);
  }

  // Responsive ladder. Drop rungs wider than the source: withoutEnlargement
  // would emit a duplicate of the native-width encode under a lying `w`
  // descriptor. If the source is narrower than every rung, fall back to a single
  // native-width rung so even small embeds still get an AVIF candidate.
  for (const w of ladderFor(srcWidth)) {
    const resizeOpts = { width: w, withoutEnlargement: true };
    const absLadderWebp = join(cacheRoot, `${relPath}.${w}w.webp`);
    const absLadderAvif = join(cacheRoot, `${relPath}.${w}w.avif`);
    if (isStale(absLadderWebp, srcStat)) {
      jobs.push([
        absLadderWebp,
        () =>
          sharp(absSource)
            .resize(resizeOpts)
            .webp({ quality: LADDER_WEBP_QUALITY, effort: WEBP_EFFORT }),
      ]);
    }
    if (isStale(absLadderAvif, srcStat)) {
      jobs.push([
        absLadderAvif,
        () => sharp(absSource).resize(resizeOpts).avif({ quality: LADDER_AVIF_QUALITY }),
      ]);
    }
  }

  if (jobs.length === 0) return "fresh";

  mkdirSync(dirname(absWebp), { recursive: true, mode: 0o755 });
  await Promise.all(jobs.map(([absOut, make]) => make().toFile(absOut)));
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
