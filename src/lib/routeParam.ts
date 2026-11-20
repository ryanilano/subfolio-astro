/**
 * Route params that survive Astro's static build for any filename.
 *
 * Astro 6 turns a getStaticPaths param into a URL and then decodes it again in
 * a loop until it stops changing (core/util/pathname.js). A real filename that
 * contains "%" therefore cannot round-trip: `50% off.txt` fails the build with
 * "Invalid URL encoding", and `a%20b.txt` decodes to `a b.txt` and collides with
 * that file. "#" and "?" are re-encoded as %23 / %3F and written to disk with
 * those three characters, so the file a browser asks for (`c#d.txt`) is missing.
 *
 * The fix keeps those three characters out of params entirely: toParam() swaps
 * each for a private-use stand-in that no decode step touches, the real path
 * travels in `props`, and the subfolio-dist-names integration (astro.config.mjs)
 * renames the stand-ins back in dist/ after the build. Links never see the
 * stand-ins: assetUrl()/pageUrl() encode the real name once, which is exactly
 * what a static host decodes back to the file on disk.
 *
 * Plain TypeScript with erasable syntax only (astro.config.mjs imports it).
 */
const SWAPS: [string, string][] = [
  ["%", ""],
  ["#", ""],
  ["?", ""],
];

/**
 * Real "/"-relative path → a param Astro can route. Throws (failing the build
 * with the file's name) when a real name already holds a stand-in character:
 * renaming it back would publish it under the wrong name.
 */
export function toParam(relPath: string): string {
  if (hasStandIn(relPath)) {
    throw new Error(
      `"${relPath}" contains a private-use character (U+E023, U+E025 or U+E03F) that subfolio reserves for routing. Rename the file.`,
    );
  }
  let out = relPath;
  for (const [real, stand] of SWAPS) out = out.split(real).join(stand);
  return out;
}

/** Undo toParam() on a name or path (dist file names, sitemap URLs). */
export function fromParam(value: string): string {
  let out = value;
  for (const [real, stand] of SWAPS) out = out.split(stand).join(real);
  return out;
}

/** Does a name or path still carry a stand-in? */
export function hasStandIn(value: string): boolean {
  return SWAPS.some(([, stand]) => value.includes(stand));
}

/**
 * Route key for getStaticPaths. Builds use toParam(). `astro dev` decodes each
 * request to the real name and matches it against the keys, and it writes no
 * files, so dev keys are the real paths (stand-ins there would 404 every name
 * with "%", "#" or "?").
 */
export function routeKey(relPath: string, dev: boolean): string {
  return dev ? relPath : toParam(relPath);
}

/** An absolute or root-relative URL with any encoded stand-in mapped back. */
export function withRealNames(url: string): string {
  let out = url;
  for (const [stand, real] of ENCODED_STAND_INS) out = out.split(stand).join(real);
  return out;
}

/** URL-encoded form of each stand-in, as it appears inside a URL. */
export const ENCODED_STAND_INS: [string, string][] = SWAPS.map(([real, stand]) => [
  encodeURIComponent(stand),
  encodeURIComponent(real),
]);
