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
 */

import { ZipArchive } from "archiver";
import { readdirSync, statSync, mkdirSync, createWriteStream } from "node:fs";
import { resolve, join, dirname } from "node:path";

// --- Config ---------------------------------------------------------------
const contentRoot = resolve(process.env.SUBFOLIO_CONTENT_DIR ?? "./content/examples");
export const cacheRoot = resolve(process.env.SUBFOLIO_OPLX_CACHE ?? "./.oplx-cache");

/** Get the newest file mtime within a directory (recursive). */
function newestMtime(absDir) {
  let newest = 0;
  function walk(d) {
    let names;
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      const abs = join(d, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(abs);
      } else {
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      }
    }
  }
  walk(absDir);
  return newest;
}

/** Recursively collect .oplx folder paths, "/"-relative to contentRoot. */
function walkOplx(relDir, out) {
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
  const absSource = join(contentRoot, relPath);
  // Mirror the content tree so the served URL is exactly `<relPath>.zip`
  // (the /directory route resolves requests by relative path against the cache).
  const absZip = join(cacheRoot, `${relPath}.zip`);

  const sourceMtime = newestMtime(absSource);

  // Staleness: skip if cached zip is newer than source folder.
  try {
    const zipStat = statSync(absZip);
    if (zipStat.mtimeMs > sourceMtime) return "fresh";
  } catch {
    /* missing → generate */
  }

  mkdirSync(dirname(absZip), { recursive: true, mode: 0o755 });

  await new Promise((resolvePromise, rejectPromise) => {
    const output = createWriteStream(absZip);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on("close", () => resolvePromise());
    archive.on("error", (err) => rejectPromise(err));

    archive.pipe(output);

    // Append the CONTENTS of the .oplx folder — NOT the folder wrapper.
    archive.directory(absSource, false);
    archive.finalize();
  });

  return "created";
}

async function main() {
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
      // Lenient — one bad folder won't break the build.
      console.warn(`[gen-oplx] skipped ${rel}: ${err.message}`);
      skipped++;
    }
  }
  console.log(
    `[gen-oplx] ${folders.length} folder(s) → ${created} created, ${fresh} fresh, ${skipped} skipped (cache: ${cacheRoot})`,
  );
}

main();
