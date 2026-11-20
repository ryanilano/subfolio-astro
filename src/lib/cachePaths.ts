/**
 * Where each build cache lives, and how it drops what no longer has a source.
 *
 * The thumbnail, embed and .oplx caches are published under /directory/ by the
 * raw-file route, so anything left in them reaches dist/. Two rules keep them
 * honest (audit finding F5, 2026-11-15):
 *
 * 1. Each default cache is keyed by its content root: ./.thumb-cache (and the
 *    others) get one subfolder per content root, named from a hash of the
 *    root's real path. A build of live content (dev-content.sh) and a build of
 *    the example content never share artifacts, so a live thumbnail cannot ship
 *    on the public demo. An explicit SUBFOLIO_THUMB_CACHE (etc.) is used as
 *    given: whoever sets it has chosen that folder for that build.
 * 2. Each gen-* script sweeps its cache after a run: any file the current
 *    content would not produce (a deleted image's thumbnails, a deleted .oplx
 *    folder's zip) is removed, and empty folders with it.
 *
 * The RSS cache is not here: it is keyed by feed URL and never published.
 *
 * Plain TypeScript with erasable syntax only: the gen-* scripts import it
 * directly under Node's type stripping.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, realpathSync, rmdirSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export type CacheKind = "thumb" | "embed" | "oplx";

const SETTINGS: Record<CacheKind, { env: string; fallback: string }> = {
  thumb: { env: "SUBFOLIO_THUMB_CACHE", fallback: "./.thumb-cache" },
  embed: { env: "SUBFOLIO_EMBED_CACHE", fallback: "./.embed-cache" },
  oplx: { env: "SUBFOLIO_OPLX_CACHE", fallback: "./.oplx-cache" },
};

/** The content root every stage reads (same default as src/content.config.ts). */
export function contentDir(): string {
  return resolve(process.env.SUBFOLIO_CONTENT_DIR ?? "./content/examples");
}

/** Short stable key for a content root: sha1 of its real path, 12 hex chars. */
export function contentKey(root: string = contentDir()): string {
  let real: string;
  try {
    real = realpathSync(root);
  } catch {
    real = resolve(root);
  }
  return createHash("sha1").update(real).digest("hex").slice(0, 12);
}

/**
 * Absolute cache folder for one kind: the explicit env value as given, or the
 * default folder plus a subfolder for the current content root.
 */
export function cacheRoot(kind: CacheKind, root: string = contentDir()): string {
  const { env, fallback } = SETTINGS[kind];
  const explicit = process.env[env];
  if (explicit) return resolve(explicit);
  return join(resolve(fallback), contentKey(root));
}

function realish(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** Is a the same folder as b, or inside it? */
function within(a: string, b: string): boolean {
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
}

/**
 * May a gen-* script sweep this kind's cache? Only when the cache folder is its
 * own: not the content root, not inside it, not holding it, and not overlapping
 * another kind's cache (an explicit SUBFOLIO_*_CACHE can point anywhere, and a
 * sweep there would delete content or another cache's files). Also false when
 * the content root is missing, so a typo can't wipe a cache.
 */
export function canSweep(kind: CacheKind, root: string = contentDir()): boolean {
  if (!existsSync(root)) return false;
  const cache = realish(cacheRoot(kind, root));
  const content = realish(root);
  if (within(cache, content) || within(content, cache)) return false;
  for (const other of Object.keys(SETTINGS) as CacheKind[]) {
    if (other === kind) continue;
    const o = realish(cacheRoot(other, root));
    if (within(cache, o) || within(o, cache)) return false;
  }
  return true;
}

/**
 * True when the disk under `dir` ignores letter case (macOS, Windows default).
 * There a case-only rename leaves the old cache file serving the new name, so
 * the sweep must compare names without case.
 */
export function caseInsensitive(dir: string): boolean {
  const real = realish(dir);
  const flipped = real.replace(/[a-z]/i, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
  if (flipped === real || !existsSync(real)) return false;
  return existsSync(flipped);
}

/**
 * Keep-test over an exact set of "/"-relative paths, folding case when the
 * cache sits on a case-insensitive disk.
 */
export function keepOnly(root: string, expected: Set<string>): (relPath: string) => boolean {
  if (!caseInsensitive(root)) return (rel) => expected.has(rel);
  const folded = new Set([...expected].map((p) => p.toLowerCase()));
  return (rel) => folded.has(rel.toLowerCase());
}

/**
 * Delete every file under `root` for which keep("/"-relative path) is false,
 * then every folder left empty. Returns the number of files removed. A missing
 * root sweeps nothing. Callers check canSweep() first.
 */
export function sweepCache(root: string, keep: (relPath: string) => boolean): number {
  let removed = 0;
  const walk = (relDir: string): boolean => {
    const abs = relDir ? join(root, relDir) : root;
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return false;
    }
    let empty = true;
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (walk(rel)) {
          try {
            rmdirSync(join(root, rel));
          } catch {
            empty = false;
          }
        } else {
          empty = false;
        }
      } else if (keep(rel)) {
        empty = false;
      } else {
        rmSync(join(root, rel), { force: true });
        removed++;
      }
    }
    return empty;
  };
  walk("");
  return removed;
}

