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
  readdirSync,
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

// --- Config ---------------------------------------------------------------
const contentRoot = resolve(process.env.SUBFOLIO_CONTENT_DIR ?? "./content/examples");
export const cacheRoot = resolve(process.env.SUBFOLIO_OPLX_CACHE ?? "./.oplx-cache");
/** What a cached zip must have been built with to be reused. */
const stripTag = `strip-v${STRIP_VERSION}:${imageStripMode ?? "none"}`;

/** Dot-prefixed record of the strip mode a zip was built with (never served). */
function stripRecord(absZip) {
  return join(dirname(absZip), `.${basename(absZip)}.strip`);
}

class StripFailure extends Error {}

/**
 * Collect the folder's entries, each file passed through the strip filter.
 * Sorted, dot files included (archive.directory did the same).
 */
function collectEntries(absDir, relPath, prefix, out) {
  for (const name of readdirSync(absDir).sort()) {
    const abs = join(absDir, name);
    const st = statSync(abs);
    const zipName = prefix ? `${prefix}/${name}` : name;
    if (st.isDirectory()) {
      out.push({ name: `${zipName}/`, dir: true, date: st.mtime, mode: st.mode });
      collectEntries(abs, relPath, zipName, out);
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
    entries = collectEntries(absSource, relPath, "", []);
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
  console.log(
    `[gen-oplx] ${folders.length} folder(s) → ${created} created, ${fresh} fresh, ${skipped} skipped (cache: ${cacheRoot})`,
  );
}

main();
