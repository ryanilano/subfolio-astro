import type { Loader } from "astro/loaders";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  isHidden,
  positionOf,
  displayName,
  fileEnhancerOf,
  folderEnhancerOf,
  extOf,
  DEFAULT_CONVENTION_CONFIG,
} from "./conventions.ts";
import { loadFileKinds, kindByFile } from "./filekinds.ts";
import { collectEmbeds, type EmbedInput, type Renderer } from "./embeds.ts";
import { parseLink, parsePop, parseFeature, parseCut } from "./enhancers.ts";
import { parseAccess } from "./access.ts";
import { folderEntrySchema, type ChildFile, type ChildFolder, type Feature, type Related } from "./schema.ts";

/**
 * The Subfolio content loader — a from-scratch TypeScript port of what
 * Filebrowser.php + Subfolio.php did at request time. Walks SUBFOLIO_CONTENT_DIR
 * recursively and emits one entry per folder (the unit that renders as a listing
 * page), with conventions fully interpreted. See
 * subfolio/plans/floating-percolating-honey.md and plans/spec/SPEC-conventions.md.
 *
 * Pure build-time interpretation: no network, no image decoding. Deferred work
 * (sharp thumbnails, RSS fetch, Textile/MD rendering, access enforcement) is
 * captured as parsed intent, not executed.
 */

export interface SubfolioLoaderOptions {
  /** Absolute or cwd-relative path to the content root. */
  contentDir: string;
  /** Path to filekinds.yml. */
  filekindsPath: string;
  /** Text renderer recorded on text embeds (none|textile|markdown). */
  renderer: Renderer;
}

const cfg = DEFAULT_CONVENTION_CONFIG;

export function subfolioLoader(opts: SubfolioLoaderOptions): Loader {
  const contentRoot = resolve(opts.contentDir);
  return {
    name: "subfolio-loader",
    schema: folderEntrySchema,
    async load({ store, logger }) {
      store.clear();
      const kinds = loadFileKinds(opts.filekindsPath);
      const ctx = { contentRoot, kinds, renderer: opts.renderer };
      let count = 0;

      const walk = (relDir: string) => {
        const absDir = join(contentRoot, relDir);
        let dirents: string[];
        try {
          dirents = readdirSync(absDir);
        } catch {
          return;
        }

        const visibleFiles: ChildFile[] = [];
        const visibleFolders: ChildFolder[] = [];
        const embedInputs: EmbedInput[] = [];
        const features: Feature[] = [];
        const related: Related[] = [];
        const excluded = new Set<string>();
        let access = null as ReturnType<typeof parseAccess> | null;
        const subdirsToWalk: string[] = [];

        for (const name of dirents.sort()) {
          const relPath = relDir ? `${relDir}/${name}` : name;
          const isDir = safeIsDir(join(absDir, name));

          // -access metadata (parsed, not enforced).
          if (name === "-access") {
            access = parseAccess(readSafe(join(absDir, name)));
            continue;
          }

          // Position embeds are hidden but collected for this folder.
          if (positionOf(name) && !isDir) {
            embedInputs.push({ name, relPath });
            continue;
          }

          // .ftr features are hidden but collected; they exclude their target.
          if (fileEnhancerOf(name) === "ftr") {
            const { feature, referencedName } = parseFeature(contentRoot, relPath);
            features.push(feature);
            if (referencedName) excluded.add(referencedName);
            continue;
          }

          // .cut shortcuts are hidden but collected as related items.
          if (fileEnhancerOf(name) === "cut") {
            related.push(parseCut(contentRoot, relPath, relDir));
            continue;
          }

          // Any other hidden item: recurse if it's a real subfolder (so nested
          // listings still get pages), but keep it out of THIS listing.
          if (isHidden(name, cfg)) {
            if (isDir) subdirsToWalk.push(relPath);
            continue;
          }

          if (isDir) {
            const fEnh = folderEnhancerOf(name);
            const single = fEnh === "site" || fEnh === "oplx";
            let slideTarget: string | null = null;
            if (fEnh === "slide") slideTarget = firstChild(join(absDir, name), relPath);
            visibleFolders.push({
              name,
              displayName: displayName(name),
              path: relPath,
              enhancerFolder: fEnh,
              slideTarget,
              single,
            });
            subdirsToWalk.push(relPath);
          } else {
            visibleFiles.push(buildFile(name, relPath, contentRoot, kinds));
          }
        }

        // Apply .ftr exclusions to the plain listing.
        const files = visibleFiles.filter((f) => !excluded.has(f.name));
        const folders = visibleFolders.filter((f) => !excluded.has(f.name));

        const embeds = collectEmbeds(embedInputs, ctx);
        const self = folderEnhancerOf(relDir.split("/").pop() ?? "");
        const entry = folderEntrySchema.parse({
          path: relDir || ".",
          name: relDir.split("/").pop() || ".",
          displayName: displayName(relDir.split("/").pop() || "."),
          enhancerFolder: self,
          single: self === "site" || self === "oplx",
          slideTarget: null,
          folders,
          files,
          embeds,
          features,
          related,
          access,
          excluded: [...excluded],
        });

        const id = relDir || ".";
        store.set({ id, data: entry });
        count++;

        for (const sub of subdirsToWalk) walk(sub);
      };

      walk("");
      logger.info(`subfolio-loader: indexed ${count} folder(s) from ${contentRoot}`);
    },
  };
}

function buildFile(name: string, relPath: string, contentRoot: string, kinds: ReturnType<typeof loadFileKinds>): ChildFile {
  const fk = kindByFile(name, kinds);
  const enhancer = fileEnhancerOf(name);
  const base: ChildFile = {
    name,
    displayName: displayName(name),
    ext: extOf(name),
    kind: fk?.kind ?? (enhancer ?? ""),
    icon: fk?.icon ?? "gen",
    display: fk?.display ?? "",
    enhancer,
  };
  if (enhancer === "link") {
    const baseName = name.slice(0, name.lastIndexOf("."));
    base.link = parseLink(contentRoot, relPath, baseName);
  } else if (enhancer === "pop") {
    base.popup = parsePop(contentRoot, relPath);
  }
  return base;
}

/** First non-hidden child name (for .slide redirect target), "/"-relative. */
function firstChild(absFolder: string, relFolder: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(absFolder).sort();
  } catch {
    return null;
  }
  for (const e of entries) {
    if (isHidden(e, cfg)) continue;
    return `${relFolder}/${e}`;
  }
  return null;
}

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readSafe(p: string): string {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
