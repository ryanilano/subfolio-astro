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
import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
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

/** Dot-prefixed ownership marker a generator leaves in its cache folder (never published). */
export function markerName(kind: CacheKind): string {
  return `.subfolio-cache-${kind}`;
}

/**
 * Claim this kind's cache folder before writing to it: leave the ownership
 * marker when the folder is the default keyed one, or is new, or is empty.
 * An explicit SUBFOLIO_*_CACHE that already holds other files is never
 * claimed, so it is never swept (canSweep() requires the marker).
 */
export function claimCache(kind: CacheKind, root: string = contentDir()): boolean {
  const dir = cacheRoot(kind, root);
  const marker = join(dir, markerName(kind));
  if (existsSync(marker)) return true;
  const explicit = Boolean(process.env[SETTINGS[kind].env]);
  let empty = true;
  try {
    empty = readdirSync(dir).length === 0;
  } catch {
    empty = true; // missing → ours to create
  }
  if (explicit && !empty) return false;
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  writeFileSync(marker, `subfolio ${kind} cache: a gen-* script may delete anything here that the content does not produce.\n`);
  return true;
}

/**
 * May a gen-* script sweep this kind's cache? Only when the folder carries this
 * kind's ownership marker (claimCache), the content root exists and is not
 * empty (an unmounted volume would otherwise read as "everything deleted"), and
 * the cache folder does not overlap the content root or another kind's cache.
 */
export function canSweep(kind: CacheKind, root: string = contentDir()): boolean {
  if (!existsSync(root)) return false;
  try {
    if (readdirSync(root).length === 0) return false;
  } catch {
    return false;
  }
  const dir = cacheRoot(kind, root);
  if (!existsSync(join(dir, markerName(kind)))) return false;
  const cache = realish(dir);
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
 * There a case-only rename leaves the cached file under its old name.
 */
export function caseInsensitive(dir: string): boolean {
  const real = realish(dir);
  const flipped = real.replace(/[a-z]/i, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
  if (flipped === real || !existsSync(real)) return false;
  return existsSync(flipped);
}

/**
 * On a case-insensitive disk, rename cache folders and files whose names match
 * an expected path only without case (a case-only rename of the source) to the
 * exact expected case, folders first. Otherwise the generator sees the old file
 * as fresh and the raw route publishes it under its old name, which 404s on a
 * case-sensitive host.
 */
function fixCase(root: string, expected: Set<string>): void {
  const files = new Map<string, string>();
  const dirs = new Map<string, string>();
  for (const p of expected) {
    files.set(p.toLowerCase(), p);
    const segs = p.split("/");
    for (let i = 1; i < segs.length; i++) {
      const d = segs.slice(0, i).join("/");
      dirs.set(d.toLowerCase(), d);
    }
  }
  const walk = (relDir: string) => {
    let entries;
    try {
      entries = readdirSync(relDir ? join(root, relDir) : root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      const want = (e.isDirectory() ? dirs : files).get(rel.toLowerCase());
      let next = rel;
      if (want !== undefined && want !== rel) {
        renameSync(join(root, rel), join(root, want));
        next = want;
      }
      if (e.isDirectory()) walk(next);
    }
  };
  walk("");
}

/**
 * Sweep a generator's cache down to exactly `expected` ("/"-relative paths),
 * plus anything under a `protect` prefix (sources that failed this run keep
 * their previous outputs) and the ownership marker. Fixes letter case first on
 * a case-insensitive disk. Returns the number of files removed. Callers check
 * canSweep() first.
 */
export function sweepExpected(root: string, expected: Set<string>, protect: string[] = []): number {
  if (caseInsensitive(root)) fixCase(root, expected);
  return sweepCache(
    root,
    (rel) => expected.has(rel) || rel.startsWith(".subfolio-cache-") || protect.some((pre) => rel.startsWith(pre)),
  );
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

