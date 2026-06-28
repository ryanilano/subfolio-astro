/**
 * Routing helpers — the wiring between loader entries and page routes.
 *
 * Replaces the path-resolution + view-dispatch logic from the PHP
 * Filebrowser_Controller::index() (engine/application/controllers/filebrowser.php)
 * and the get_file_url()/get_link() URL builders (Filebrowser.php).
 *
 * PHP runs two URL namespaces, both preserved here for side-by-side diffing:
 *   - /<path>            → HTML listing/detail pages
 *   - /directory/<path>  → raw file bytes (get_file_url)
 */
import type { AstroComponentFactory } from "astro/runtime/server/index.js";
import { displayName } from "../loaders/conventions.ts";
import type { FolderEntry, ChildFile } from "../loaders/schema.ts";

import Default from "../components/filekinds/Default.astro";
import Img from "../components/filekinds/Img.astro";
import Snd from "../components/filekinds/Snd.astro";
import Vid from "../components/filekinds/Vid.astro";
import Swf from "../components/filekinds/Swf.astro";
import Txt from "../components/filekinds/Txt.astro";
import Rss from "../components/filekinds/Rss.astro";
import Site from "../components/filekinds/Site.astro";
import Oplx from "../components/filekinds/Oplx.astro";
import Webloc from "../components/filekinds/Webloc.astro";
import Link from "../components/filekinds/Link.astro";

/**
 * Map a filekind key (from filekinds.yml, stored on ChildFile.kind) to its
 * detail-view component. Falls back to Default (download box) for any kind
 * without a specialized view — mirrors PHP's View::view_exists() fallback.
 */
const KIND_COMPONENTS: Record<string, AstroComponentFactory> = {
  img: Img,
  snd: Snd,
  vid: Vid,
  swf: Swf,
  txt: Txt,
  rss: Rss,
  site: Site,
  oplx: Oplx,
  webloc: Webloc,
  link: Link,
};

export function componentForKind(kind: string): AstroComponentFactory {
  return KIND_COMPONENTS[kind] ?? Default;
}

/** Encode a "/"-relative path per segment, preserving separators. */
function encodePathParts(relPath: string): string {
  return relPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/**
 * URL for raw file bytes — mirrors Filebrowser::get_file_url()
 * ("/directory/" + urlencode_parts(filepath)). Single source of truth for the
 * raw-bytes prefix; every <img src>/download href routes through here.
 */
export function assetUrl(relPath: string): string {
  return `/directory/${encodePathParts(relPath)}`;
}

/** Detail/listing page URL for a "/"-relative content path. */
export function pageUrl(relPath: string): string {
  if (relPath === "" || relPath === ".") return "/";
  return `/${encodePathParts(relPath)}`;
}

export interface Crumb {
  name: string;
  url: string;
}

/**
 * Breadcrumb trail from root to the given content path — mirrors
 * SubfolioTheme::get_breadcrumb(). Each segment links to its cumulative folder
 * page; the last crumb has an empty url (rendered as current — see Header.astro).
 * The root ("." / "") yields an empty trail (Header shows the site root itself).
 */
export function buildBreadcrumb(
  path: string,
  /**
   * Ports the PHP "HACK FOR SLIDE" (Subfolio::parent_link). A `.slide` folder
   * with direct files renders a redirect, not a listing — so a breadcrumb crumb
   * pointing at it would bounce the user through a meta-refresh back to the first
   * image. Map any such folder path → its redirect target (the first image's
   * detail page) so the crumb links straight there instead of looping.
   */
  slideRedirects?: Map<string, string>,
): Crumb[] {
  if (path === "" || path === ".") return [];
  const segments = path.split("/");
  const crumbs: Crumb[] = [];
  let cumulative = "";
  segments.forEach((seg, i) => {
    cumulative = cumulative ? `${cumulative}/${seg}` : seg;
    const isLast = i === segments.length - 1;
    const slideTarget = slideRedirects?.get(cumulative);
    crumbs.push({
      name: displayName(seg),
      url: isLast ? "" : (slideTarget ?? pageUrl(cumulative)),
    });
  });
  return crumbs;
}

export interface SiblingNav {
  prevLink: string | null;
  nextLink: string | null;
}

/**
 * Prev/next folder-page links for a listing — mirrors
 * SubfolioFiles::previous_link_or_span()/next_link_or_span(). Derived from the
 * parent entry's child folders in loader (sorted) order. Root has no siblings.
 */
export function folderSiblingNav(
  entry: FolderEntry,
  allEntries: FolderEntry[],
): SiblingNav {
  if (entry.path === ".") return { prevLink: null, nextLink: null };
  const slash = entry.path.lastIndexOf("/");
  const parentPath = slash === -1 ? "." : entry.path.slice(0, slash);
  const parent = allEntries.find((e) => e.path === parentPath);
  if (!parent) return { prevLink: null, nextLink: null };

  const siblings = parent.folders.map((f) => f.path);
  const idx = siblings.indexOf(entry.path);
  if (idx === -1) return { prevLink: null, nextLink: null };
  return {
    prevLink: idx > 0 ? pageUrl(siblings[idx - 1]) : null,
    nextLink: idx < siblings.length - 1 ? pageUrl(siblings[idx + 1]) : null,
  };
}

/**
 * Prev/next file-detail links within a folder — used by file detail pages.
 * Derived from the folder's regular (non-enhancer) files in loader order.
 */
export function fileSiblingNav(
  entry: FolderEntry,
  fileName: string,
): SiblingNav {
  const detailFiles = entry.files.filter((f) => f.enhancer === null);
  const idx = detailFiles.findIndex((f) => f.name === fileName);
  if (idx === -1) return { prevLink: null, nextLink: null };
  const detailPath = (f: ChildFile) =>
    entry.path === "." ? pageUrl(f.name) : pageUrl(`${entry.path}/${f.name}`);
  return {
    prevLink: idx > 0 ? detailPath(detailFiles[idx - 1]) : null,
    nextLink:
      idx < detailFiles.length - 1 ? detailPath(detailFiles[idx + 1]) : null,
  };
}
