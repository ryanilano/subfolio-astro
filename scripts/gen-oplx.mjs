/**
 * Pre-build .oplx zip generation — runs BEFORE `astro build` (see package.json),
 * alongside gen-thumbs.mjs, gen-css.mjs, and gen-rss.mjs.
 *
 * Why a separate pass: Astro's static build is two-phase and zip archive creation
 * must not happen lazily during render. We create every .oplx zip up front into
 * an out-of-tree cache that the /directory route then serves as a single source
 * of truth — the same pattern gen-thumbs.mjs uses for thumbnails.
 *
 * The cache lives at ./.oplx-cache/ (gitignored) mirroring the content layout:
 *   .oplx-cache/<parent>/<folderName>.zip
 * mirroring the tree so the served path is exactly `<relPath>.zip` (the
 * /directory route resolves requests by relative path). This keeps generated
 * artifacts out of the (possibly live) content directory — we never mutate
 * SUBFOLIO_CONTENT_DIR.
 *
 * Location stripping: every file goes into the zip through publishedBytes(),
 * the same filter the /directory route applies, so a GPS-tagged photo inside an
 * .oplx folder ships without its location (settings.yml strip_location /
 * strip_all_metadata). The strip mode and STRIP_VERSION are recorded next to
 * each zip (a dot file, never served); a zip made under another mode, or before
 * this record existed, is rebuilt. A file the stripper can't make safe stops
 * the build, like it does in the route.
 */

import { ZipArchive } from "archiver";
import {
  statSync,
  mkdirSync,
  createWriteStream,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { publishedBytes, STRIP_VERSION } from "../src/lib/stripMetadata.ts";
import { imageStripMode } from "../src/lib/site.ts";
import { ContentTree } from "../src/lib/contentWalk.ts";
import { cacheRoot as cacheRootFor, sweepExpected, canSweep, claimCache } from "../src/lib/cachePaths.ts";

// --- Config ---------------------------------------------------------------
const contentRoot = resolve(process.env.SUBFOLIO_CONTENT_DIR ?? "./content/examples");
export const cacheRoot = cacheRootFor("oplx");
// Shared publication policy (src/lib/contentWalk.ts): a zip never carries dot
// files, -access, or the target of a symlink that leaves the content root.
const tree = new ContentTree(contentRoot);
/** What a cached zip must have been built with to be reused. */
// `walk-v1`: zips made before the shared publication policy may carry dot files
// or symlink targets, so bumping it rebuilds every cached zip once.
const stripTag = `strip-v${STRIP_VERSION}:${imageStripMode ?? "none"}:walk-v1`;

/** Dot-prefixed record of the strip mode a zip was built with (never served). */
function stripRecord(absZip) {
  return join(dirname(absZip), `.${basename(absZip)}.strip`);
}

class StripFailure extends Error {}

/**
 * Collect the folder's entries, each file passed through the strip filter.
 * Sorted. Only what the shared publication policy allows: no dot files (the
 * old archive.directory() call zipped them), no -access, nothing reached
 * through a symlink that leaves the content root, and no folder twice.
 */
function collectEntries(relPath, prefix, out) {
  const relDir = prefix ? `${relPath}/${prefix}` : relPath;
  if (!tree.enterDir(relDir)) return out;
  for (const { name, absPath: abs, isDir } of tree.list(relDir)) {
    const st = statSync(abs);
    const zipName = prefix ? `${prefix}/${name}` : name;
    if (isDir) {
      out.push({ name: `${zipName}/`, dir: true, date: st.mtime, mode: st.mode });
      collectEntries(relPath, zipName, out);
    } else {
      let data;
      try {
        data = publishedBytes(`${relPath}/${zipName}`, readFileSync(abs), imageStripMode);
      } catch (err) {
        throw new StripFailure(err.message);
      }
      out.push({ name: zipName, data, date: st.mtime, mode: st.mode });
    }
  }
  return out;
}

/**
 * Newest mtime among the files a zip of this folder would contain (recursive,
 * same publication policy as collectEntries).
 */
function newestMtime(relDir) {
  let newest = 0;
  for (const rel of tree.walkFiles(relDir)) {
    try {
      const m = statSync(join(contentRoot, rel)).mtimeMs;
      if (m > newest) newest = m;
    } catch {
      /* vanished mid-walk → ignore */
    }
  }
  return newest;
}

/** Recursively collect .oplx folder paths, "/"-relative to contentRoot. */
function walkOplx(relDir, out) {
  if (!tree.enterDir(relDir)) return;
  for (const { name, relPath, isDir } of tree.list(relDir)) {
    if (isDir) {
      // Skip the cache dirs — they aren't source folders.
      if (
        name === "-thumbnails" ||
        name === "-thumbnails-custom" ||
        name === "-thumbnails_custom"
      ) {
        continue;
      }
      if (name.endsWith(".oplx")) {
        out.push(relPath);
      } else {
        walkOplx(relPath, out);
      }
    }
  }
}

/** Generate one .oplx zip into the cache. Returns "created" | "fresh" | "skip". */
async function genOne(relPath) {
  // Mirror the content tree so the served URL is exactly `<relPath>.zip`
  // (the /directory route resolves requests by relative path against the cache).
  const absZip = join(cacheRoot, `${relPath}.zip`);

  const sourceMtime = newestMtime(relPath);

  // Staleness: reuse the cached zip only if it is newer than the source folder
  // AND was built with the current strip mode.
  try {
    const zipStat = statSync(absZip);
    const tag = readFileSync(stripRecord(absZip), "utf8");
    if (zipStat.mtimeMs > sourceMtime && tag === stripTag) return "fresh";
  } catch {
    /* missing zip or record → generate */
  }

  // Read and strip everything before touching the cache, so a failure never
  // leaves a half-written zip. On a strip failure the old zip is removed too:
  // it may predate stripping.
  let entries;
  try {
    entries = collectEntries(relPath, "", []);
  } catch (err) {
    if (err instanceof StripFailure) {
      rmSync(absZip, { force: true });
      rmSync(stripRecord(absZip), { force: true });
    }
    throw err;
  }

  mkdirSync(dirname(absZip), { recursive: true, mode: 0o755 });
  rmSync(stripRecord(absZip), { force: true });

  await new Promise((resolvePromise, rejectPromise) => {
    const output = createWriteStream(absZip);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on("close", () => resolvePromise());
    archive.on("error", (err) => rejectPromise(err));

    archive.pipe(output);

    // Append the CONTENTS of the .oplx folder — NOT the folder wrapper.
    for (const e of entries) {
      if (e.dir) archive.append(null, { name: e.name, type: "directory", date: e.date, mode: e.mode });
      else archive.append(e.data, { name: e.name, date: e.date, mode: e.mode });
    }
    archive.finalize();
  });

  writeFileSync(stripRecord(absZip), stripTag);
  return "created";
}

async function main() {
  if (!claimCache("oplx", contentRoot)) {
    console.warn(`[gen-oplx] cache folder has no subfolio marker and already holds files, so it was not swept (stale files can keep publishing). Empty it once to opt in.`);
  }
  const folders = [];
  walkOplx("", folders);

  let created = 0;
  let fresh = 0;
  let skipped = 0;
  for (const rel of folders) {
    try {
      const r = await genOne(rel);
      if (r === "created") created++;
      else if (r === "fresh") fresh++;
      else skipped++;
    } catch (err) {
      if (err instanceof StripFailure) {
        // Not lenient: publishing this folder could leak a location.
        console.error(`[gen-oplx] ${err.message}`);
        process.exitCode = 1;
        skipped++;
        continue;
      }
      // Lenient — one bad folder won't break the build.
      console.warn(`[gen-oplx] skipped ${rel}: ${err.message}`);
      skipped++;
    }
  }
  // Drop zips (and their strip records) whose .oplx folder is gone, so a
  // deleted folder's full contents stop shipping (src/lib/cachePaths.ts, F5).
  let swept = 0;
  if (canSweep("oplx", contentRoot)) {
    const keep = new Set();
    for (const rel of folders) {
      keep.add(`${rel}.zip`);
      const slash = rel.lastIndexOf("/");
      keep.add(slash < 0 ? `.${rel}.zip.strip` : `${rel.slice(0, slash)}/.${rel.slice(slash + 1)}.zip.strip`);
    }
    swept = sweepExpected(cacheRoot, keep);
  }
  console.log(
    `[gen-oplx] ${folders.length} folder(s) → ${created} created, ${fresh} fresh, ${skipped} skipped, ${swept} orphan(s) removed (cache: ${cacheRoot})`,
  );
}

main();
