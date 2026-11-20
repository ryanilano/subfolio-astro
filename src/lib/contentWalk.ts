/**
 * One publication policy for every walk over a content (or cache) tree: the
 * loader, the /directory raw-file route and the gen-* scripts all list folders
 * through ContentTree, so they agree on what can ever reach dist/.
 *
 * Rules, applied to every entry:
 *
 * 1. Unpublishable names are dropped entirely, never walked or read as
 *    content: any dot-prefixed name (.git, .github, .claude, .DS_Store, .env)
 *    and `-access` / `-access.txt` (any letter case, for case-insensitive
 *    disks). Dot entries are repo or OS metadata, never Subfolio content
 *    (Subfolio's own hidden convention is the "-" prefix, and those are still
 *    listed). `-access` holds user and group names; the loader reads it
 *    explicitly through readMeta(), it is never published.
 * 2. Symlinks are followed only when their real path stays inside the tree's
 *    real root and passes rule 1 itself (`x -> .git` is refused). A link that
 *    leaves the root, or that cannot be resolved, is dropped as if it did not
 *    exist.
 * 3. Cycles: a folder link whose real path is the folder it sits in, or any
 *    folder above it, would make the walk loop forever, so list() drops it and
 *    enterDir() refuses it. Any other in-root folder link is an ordinary folder:
 *    two paths to the same folder both get walked, as before.
 *
 * Plain TypeScript with erasable syntax only: the gen-* scripts import it
 * directly under Node's type stripping, the same way they import site.ts.
 */
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/** Names that never publish and are never walked (rule 1). */
export function isUnpublishable(name: string): boolean {
  if (name.startsWith(".")) return true;
  const lower = name.toLowerCase();
  return lower === "-access" || lower === "-access.txt";
}

/** True when any "/"-separated segment of relPath is unpublishable. */
export function hasUnpublishableSegment(relPath: string): boolean {
  return relPath.split("/").some(isUnpublishable);
}

export interface TreeEntry {
  /** Entry name inside its folder. */
  name: string;
  /** "/"-relative path from the tree root. */
  relPath: string;
  /** Absolute path as reached through the tree (may run through a symlink). */
  absPath: string;
  /** True for a directory (or an in-root link to one). */
  isDir: boolean;
  /** True for a regular file (or an in-root link to one). */
  isFile: boolean;
}

function realOrNull(abs: string): string | null {
  try {
    return realpathSync(abs);
  } catch {
    return null;
  }
}

export class ContentTree {
  /** Absolute root as given (not resolved through symlinks). */
  readonly root: string;
  private cachedRealRoot: string | null = null;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /**
   * Real path of the root, or null while it does not exist. Looked up again
   * until it exists, so a cache folder created after this tree (gen-* rerun
   * under `astro dev`) is still served without a restart.
   */
  get realRoot(): string | null {
    if (this.cachedRealRoot === null) this.cachedRealRoot = realOrNull(this.root);
    return this.cachedRealRoot;
  }

  /**
   * Is an absolute real path the root itself, or inside it with every segment
   * publishable? The segment check matters for links: `x -> .git` stays inside
   * the root but would otherwise publish .git's children under the name `x`.
   */
  private inside(realPath: string): boolean {
    const r = this.realRoot;
    if (r === null) return false;
    if (realPath === r) return true;
    const prefix = r.endsWith(sep) ? r : r + sep;
    if (!realPath.startsWith(prefix)) return false;
    return !realPath.slice(prefix.length).split(sep).some(isUnpublishable);
  }

  /** Real path of a "/"-relative folder, or null when missing or not contained. */
  private realDir(relDir: string): string | null {
    if (relDir && hasUnpublishableSegment(relDir)) return null;
    const real = realOrNull(join(this.root, relDir));
    if (real === null || !this.inside(real)) return null;
    return real;
  }

  /** Real paths of relDir and every folder above it, up to the root. */
  private chain(relDir: string): string[] {
    const segs = relDir ? relDir.split("/") : [];
    const out: string[] = [];
    for (let i = 0; i <= segs.length; i++) {
      const real = this.realDir(segs.slice(0, i).join("/"));
      if (real !== null) out.push(real);
    }
    return out;
  }

  /**
   * Classify one absolute path: null when it is missing, a symlink that leaves
   * the root, or neither a file nor a directory (sockets, FIFOs, devices).
   */
  private classify(abs: string): { isDir: boolean; isFile: boolean; real: string | null } | null {
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      return null;
    }
    let real: string | null = null;
    if (st.isSymbolicLink()) {
      real = realOrNull(abs); // null: dangling, or a loop the OS refused (ELOOP)
      if (real === null || !this.inside(real)) return null;
      try {
        st = statSync(abs);
      } catch {
        return null;
      }
    }
    if (st.isDirectory()) return { isDir: true, isFile: false, real };
    if (st.isFile()) return { isDir: false, isFile: true, real };
    return null;
  }

  /**
   * Publishable children of relDir, sorted by name. Never throws: a missing,
   * unreadable or uncontained folder lists as empty, matching the lenient
   * walkers this replaces. A folder link back to relDir or a folder above it
   * (rule 3) is left out, so every listed folder can be walked.
   */
  list(relDir: string): TreeEntry[] {
    const here = this.realDir(relDir);
    if (here === null) return [];
    let names: string[];
    try {
      names = readdirSync(here);
    } catch {
      return [];
    }
    let ancestors: string[] | null = null; // computed only when a folder link appears
    const absDir = join(this.root, relDir);
    const out: TreeEntry[] = [];
    for (const name of names.sort()) {
      if (isUnpublishable(name)) continue;
      const absPath = join(absDir, name);
      const kind = this.classify(absPath);
      if (kind === null) continue;
      if (kind.isDir && kind.real !== null) {
        ancestors ??= this.chain(relDir);
        if (ancestors.includes(kind.real)) continue;
      }
      const relPath = relDir ? `${relDir}/${name}` : name;
      out.push({ name, relPath, absPath, isDir: kind.isDir, isFile: kind.isFile });
    }
    return out;
  }

  /**
   * May a walker descend into relDir? False when it is missing, not a contained
   * directory, or a cycle: its real path equals the real path of a folder above
   * it (rule 3). Stateless, so any number of walks can share one tree.
   */
  enterDir(relDir: string): boolean {
    const real = this.realDir(relDir);
    if (real === null) return false;
    try {
      if (!statSync(real).isDirectory()) return false;
    } catch {
      return false;
    }
    if (!relDir) return true;
    const parent = relDir.includes("/") ? relDir.slice(0, relDir.lastIndexOf("/")) : "";
    return !this.chain(parent).includes(real);
  }

  /**
   * Absolute path of a publishable regular file at relPath, or null. Rejects
   * traversal ("../"), unpublishable segments, and any path whose real location
   * leaves the root, including through a symlinked parent folder.
   */
  resolveFile(relPath: string): string | null {
    if (!relPath || hasUnpublishableSegment(relPath)) return null;
    if (relPath.split("/").some((s) => s === ".." || s === "")) return null;
    const abs = resolve(this.root, relPath);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) return null;
    const real = realOrNull(abs);
    if (real === null || !this.inside(real)) return null;
    try {
      if (!statSync(real).isFile()) return null;
    } catch {
      return null;
    }
    return abs;
  }

  /**
   * Read a metadata file the walk itself skips (today only `-access`), with the
   * same containment check: null when it is missing or a symlink out of the
   * root, "" when it exists but cannot be read. Never use this for anything
   * that gets published.
   */
  readMeta(relPath: string): string | null {
    const abs = resolve(this.root, relPath);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) return null;
    const real = realOrNull(abs);
    if (real === null) return null;
    // Containment only: the meta file's own name is unpublishable by design, so
    // check its folders against the full rule and leave the name out.
    const r = this.realRoot;
    if (r === null) return null;
    const prefix = r.endsWith(sep) ? r : r + sep;
    if (!real.startsWith(prefix)) return null;
    if (real.slice(prefix.length).split(sep).slice(0, -1).some(isUnpublishable)) return null;
    try {
      return readFileSync(real, "utf8");
    } catch {
      return "";
    }
  }

  /**
   * Depth-first walk of every publishable regular file under relDir. `skipDir`
   * can prune a directory by entry.
   */
  walkFiles(relDir = "", skipDir?: (e: TreeEntry) => boolean): string[] {
    const out: string[] = [];
    const go = (dir: string) => {
      if (!this.enterDir(dir)) return;
      for (const e of this.list(dir)) {
        if (e.isDir) {
          if (skipDir && skipDir(e)) continue;
          go(e.relPath);
        } else if (e.isFile) {
          out.push(e.relPath);
        }
      }
    };
    go(relDir);
    return out;
  }
}
