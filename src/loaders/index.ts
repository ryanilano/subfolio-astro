import type { Loader } from "astro/loaders";
import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import {
  isHidden,
  isThumbnailDir,
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
import { parseSubfolioYaml, asString } from "./yaml.ts";
import { parseAccess } from "./access.ts";
import { ContentTree } from "../lib/contentWalk.ts";
import { cacheRoot } from "../lib/cachePaths.ts";
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

// Out-of-tree WebP cache for position embeds (scripts/gen-embeds.mjs). Mirrors
// that script's env default so the loader and the encoder agree on the location.
const embedCacheRoot = cacheRoot("embed");

export function subfolioLoader(opts: SubfolioLoaderOptions): Loader {
  const contentRoot = resolve(opts.contentDir);
  return {
    name: "subfolio-loader",
    schema: folderEntrySchema,
    async load({ store, logger }) {
      store.clear();
      const kinds = loadFileKinds(opts.filekindsPath);
      const ctx = { contentRoot, kinds, renderer: opts.renderer };
      // One publication policy (src/lib/contentWalk.ts): dot names and -access
      // are never walked, symlinks only count when they stay inside the root,
      // and each real folder is entered once, so a link cycle cannot loop.
      const tree = new ContentTree(contentRoot);
      let count = 0;
      // Captured for the post-walk async image-dimension enrichment pass.
      const entries: { id: string; data: ReturnType<typeof folderEntrySchema.parse> }[] = [];

      const walk = (relDir: string) => {
        if (!tree.enterDir(relDir)) return;
        const absDir = join(contentRoot, relDir);
        const dirents = tree.list(relDir);

        const visibleFiles: ChildFile[] = [];
        const visibleFolders: ChildFolder[] = [];
        const embedInputs: EmbedInput[] = [];
        const features: Feature[] = [];
        const related: Related[] = [];
        const infoComments = new Map<string, string>();
        const infoAlts = new Map<string, string>();
        const excluded = new Set<string>();
        // -access metadata (parsed, not enforced). The walk never lists it
        // (it is unpublishable), so it is read here explicitly.
        const accessRaw = tree.readMeta(relDir ? `${relDir}/-access` : "-access");
        const access = accessRaw === null ? null : parseAccess(accessRaw);
        const subdirsToWalk: string[] = [];

        for (const { name, relPath, isDir } of dirents) {

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

          // .info sidecars are hidden but their comment attaches to the sibling
          // item named by the filename minus the extension (SPEC-theme-api:
          // item/folder property `comment`; fixture: 00_thumbnails.info).
          if (!isDir && name.endsWith(cfg.infoExtension)) {
            const doc = parseSubfolioYaml(readSafe(join(absDir, name)));
            const comment = asString(doc.comment);
            const base = name.slice(0, -cfg.infoExtension.length);
            if (comment) infoComments.set(base, comment);
            // Optional `alt:` key: alt text for an image file (extension, opt-in per file).
            const alt = asString(doc.alt);
            if (alt) infoAlts.set(base, alt);
            continue;
          }

          // Any other hidden ("-") item: recurse if it's a real subfolder (so
          // nested listings still get pages), but keep it out of THIS listing.
          // Dot-prefixed names never get here: the tree drops them, so .git and
          // friends get no pages at all.
          // Exception: build-managed thumbnail dirs are served as raw bytes via
          // the /directory route only — walking them would emit a pointless
          // listing page plus a detail page for every generated thumbnail.
          if (isHidden(name, cfg)) {
            if (isDir && !isThumbnailDir(name)) subdirsToWalk.push(relPath);
            continue;
          }

          if (isDir) {
            const fEnh = folderEnhancerOf(name);
            const single = fEnh === "site" || fEnh === "oplx";
            let slideTarget: string | null = null;
            if (fEnh === "slide") slideTarget = firstChild(tree, relPath);
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

        // .ftr exclusions apply to the plain LISTING only — the listing view
        // (buildListingItems) and the gallery honor `entry.excluded` at render
        // time. Featured FILES must STAY in entry.files so their detail route is
        // still generated ([...path].astro builds file routes from entry.files);
        // dropping them here 404s any feature card that points at a file, since a
        // file has no independent collection entry the way a folder does.
        // Featured FOLDERS already route as their own entries, so keep them out of
        // the parent's folder list to avoid duplicate sibling-nav.
        const files = visibleFiles;
        const folders = visibleFolders.filter((f) => !excluded.has(f.name));

        // Attach .info comments after the walk: dirent order must not matter
        // (the sidecar can sort before or after its item).
        for (const f of folders) {
          const c = infoComments.get(f.name);
          if (c) f.comment = c;
        }
        for (const f of files) {
          const c = infoComments.get(f.name);
          if (c) f.comment = c;
          const a = infoAlts.get(f.name);
          if (a) f.alt = a;
        }

        const embeds = collectEmbeds(embedInputs, ctx);
        const self = folderEnhancerOf(relDir.split("/").pop() ?? "");
        // This folder's own sidecar (`<parent>/<name>.info`): optional page meta.
        // Read through the tree, so a sidecar that is a link out of the root
        // (or into a dot folder) is ignored like any other escaping link.
        const selfInfoPath = relDir ? tree.resolveFile(relDir + cfg.infoExtension) : null;
        const selfInfo = selfInfoPath ? parseSubfolioYaml(readSafe(selfInfoPath)) : {};
        const pageTitle = asString(selfInfo.title) || undefined;
        const pageDescription = asString(selfInfo.description) || undefined;
        const pageImage = asString(selfInfo.image) || undefined;
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
          pageTitle,
          pageDescription,
          pageImage,
        });

        const id = relDir || ".";
        entries.push({ id, data: entry });
        count++;

        for (const sub of subdirsToWalk) walk(sub);
      };

      walk("");

      // Async enrichment: read each feature image's real pixel dimensions via
      // sharp, mirroring the PHP engine's getimagesize() on the actual file.
      // Image decoding is deferred out of the synchronous walk above. Lenient —
      // an unreadable image just leaves img dims unset (view falls back to box).
      for (const { id, data } of entries) {
        for (const feature of data.features) {
          if (!feature.image) continue;
          const abs = join(contentRoot, data.path === "." ? "" : data.path, feature.image);
          try {
            const meta = await sharp(abs).metadata();
            if (meta.width) feature.imageWidth = meta.width;
            if (meta.height) feature.imageHeight = meta.height;
          } catch {
            /* unreadable → leave unset, view falls back to box dims */
          }
        }
        // Mark image embeds that got a WebP sibling (scripts/gen-embeds.mjs), so
        // InlineEmbeds emits a <picture><source> only when one actually exists.
        for (const group of [data.embeds.top, data.embeds.middle, data.embeds.bottom]) {
          for (const e of group) {
            if (e.type !== "img") continue;
            try {
              await stat(join(embedCacheRoot, e.src + ".webp"));
              e.hasWebp = true;
            } catch {
              /* no sibling (e.g. .gif or unreadable) → plain <img> */
            }
          }
        }
        store.set({ id, data });
      }

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

/** First non-hidden child (for .slide redirect target), "/"-relative. */
function firstChild(tree: ContentTree, relFolder: string): string | null {
  for (const e of tree.list(relFolder)) {
    if (isHidden(e.name, cfg)) continue;
    return e.relPath;
  }
  return null;
}

function readSafe(p: string): string {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
