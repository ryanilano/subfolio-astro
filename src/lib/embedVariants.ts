/**
 * Embed variant resolution (read-only) — mirrors the posture of
 * src/lib/thumbnailPipeline.ts: it decides which URLs to emit by checking what
 * scripts/gen-embeds.mjs already wrote, and generates nothing itself.
 *
 * gen-embeds.mjs writes a responsive ladder next to each embed's legacy
 * full-resolution sibling, inside the out-of-tree embed cache:
 *   .embed-cache/<relPath>.<w>w.webp
 *   .embed-cache/<relPath>.<w>w.avif
 * Doing the generation up front matters because the /directory route's
 * getStaticPaths() registers raw-byte routes BEFORE any component renders — a
 * variant produced lazily at render time would have no route and 404 on a cold
 * build. Keeping this module read-only also means we never mutate a live
 * SUBFOLIO_CONTENT_DIR.
 *
 * A missing rung is not an error: it just degrades to fewer srcset candidates
 * (and no candidates at all degrades to the plain single-source <picture> the
 * loader's `hasWebp` flag already gates).
 */
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { assetUrl } from "./routing.ts";

const cacheRoot = resolve(process.env.SUBFOLIO_EMBED_CACHE ?? "./.embed-cache");

/**
 * Candidate widths to probe. Must be a superset of gen-embeds.mjs' LADDER_WIDTHS;
 * anything absent from disk is simply skipped, so listing extra widths is safe.
 * Narrow sources get a single native-width rung instead, which is discovered by
 * the `nativeWidth` probe below rather than by guessing.
 */
const PROBE_WIDTHS = [480, 768, 1024];

export interface EmbedVariants {
  /** `srcset` value for the AVIF <source>, or "" when no AVIF rung exists. */
  avifSrcset: string;
  /** `srcset` value for the WebP <source>, or "" when no WebP rung exists. */
  webpSrcset: string;
}

const EMPTY: EmbedVariants = { avifSrcset: "", webpSrcset: "" };

// Build-time cache: a given embed is probed once per build.
const cache = new Map<string, EmbedVariants>();

/**
 * Join ladder rungs into a `srcset` value.
 *
 * A LONE candidate is emitted as a BARE URL with no `w` descriptor. With a `w`
 * descriptor present the browser derives a density-corrected intrinsic size from
 * `sizes` rather than from the file's real pixel width, which can change layout
 * wherever CSS lets the intrinsic size through. There is nothing to choose
 * between with one candidate, so the descriptor buys nothing.
 */
function joinCandidates(rungs: { url: string; w: number }[]): string {
  if (rungs.length === 0) return "";
  if (rungs.length === 1) return rungs[0].url;
  return rungs.map((r) => `${r.url} ${r.w}w`).join(", ");
}

/** Does `<relPath>.<w>w.<fmt>` exist in the embed cache? */
async function rungExists(relPath: string, w: number, fmt: string): Promise<boolean> {
  try {
    await stat(resolve(cacheRoot, `${relPath}.${w}w.${fmt}`));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve srcset strings for an embed's "/"-relative content path.
 *
 * `nativeWidth` is the source's intrinsic width (from imageMetaFor). It is
 * probed in addition to the standard ladder because gen-embeds.mjs falls back to
 * a single native-width rung for sources narrower than the smallest ladder step,
 * so a 249px-wide banner still gets an AVIF candidate.
 */
export async function embedVariantsFor(
  relPath: string,
  nativeWidth = 0,
): Promise<EmbedVariants> {
  const key = `${relPath}|${nativeWidth}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const widths = [...new Set([...PROBE_WIDTHS, ...(nativeWidth > 0 ? [nativeWidth] : [])])].sort(
    (a, b) => a - b,
  );

  const avif: { url: string; w: number }[] = [];
  const webp: { url: string; w: number }[] = [];
  for (const w of widths) {
    // The `w` descriptor must be the REAL encoded pixel width — gen-embeds names
    // each file after the width it actually resized to, so the filename is the
    // source of truth here.
    if (await rungExists(relPath, w, "avif")) {
      avif.push({ url: assetUrl(`${relPath}.${w}w.avif`), w });
    }
    if (await rungExists(relPath, w, "webp")) {
      webp.push({ url: assetUrl(`${relPath}.${w}w.webp`), w });
    }
  }

  const out: EmbedVariants =
    avif.length === 0 && webp.length === 0
      ? EMPTY
      : { avifSrcset: joinCandidates(avif), webpSrcset: joinCandidates(webp) };
  cache.set(key, out);
  return out;
}
