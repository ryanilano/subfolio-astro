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
import { readdirSync, statSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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

/**
 * Encode / refresh one format's ladder for a single source, then DROP any rung
 * that is byte-dominated: encoded size >= the size of a WIDER rung of the same
 * format. Such a rung is strictly worse on both axes — a narrower image for more
 * bytes — so serving it makes mobile pay extra for less. (Real case:
 * `-t-01-darko.png.768w.avif` came out larger than its own 1024w sibling.)
 *
 * Stale rungs are encoded to a BUFFER first so a dominated one is never written
 * at all; a rung already on disk that becomes dominated is removed. Rungs that
 * are fresh keep their bytes untouched — the mtime staleness contract is intact.
 *
 * `rungs` is [{ w, absOut, encode }] where `encode` returns a sharp pipeline.
 * Returns the number of files written.
 */
async function writeLadder(label, relPath, fmt, rungs, srcStat) {
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
        `[${label}] pruned ${relPath}.${r.w}w.${fmt} (${r.size} B ≥ a wider rung's ${smallestWider} B)`,
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
  const widths = ladderFor(srcWidth);
  const ladder = {
    webp: widths.map((w) => ({
      w,
      absOut: join(cacheRoot, `${relPath}.${w}w.webp`),
      encode: () =>
        sharp(absSource)
          .resize({ width: w, withoutEnlargement: true })
          .webp({ quality: LADDER_WEBP_QUALITY, effort: WEBP_EFFORT }),
    })),
    avif: widths.map((w) => ({
      w,
      absOut: join(cacheRoot, `${relPath}.${w}w.avif`),
      encode: () =>
        sharp(absSource)
          .resize({ width: w, withoutEnlargement: true })
          .avif({ quality: LADDER_AVIF_QUALITY }),
    })),
  };

  // writeLadder always runs, even on a fully warm cache: it encodes nothing for
  // fresh rungs (one statSync each), and it is what removes a rung that a newer
  // encode has made byte-dominated. Gating it on staleness would leave such a
  // rung on disk forever.
  mkdirSync(dirname(absWebp), { recursive: true, mode: 0o755 });
  const [, ...ladderWritten] = await Promise.all([
    Promise.all(jobs.map(([absOut, make]) => make().toFile(absOut))),
    writeLadder("gen-embeds", relPath, "webp", ladder.webp, srcStat),
    writeLadder("gen-embeds", relPath, "avif", ladder.avif, srcStat),
  ]);
  return jobs.length > 0 || ladderWritten.some((n) => n > 0) ? "created" : "fresh";
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
