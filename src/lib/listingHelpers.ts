/**
 * Listing-level computed properties — replaces `SubfolioFiles::files_and_folders()`
 * lookups that the files_and_folders listing view depends on.
 *
 * Phase 2: size/date come from fs stat when possible; access/restricted are
 * deferred (Phase 4); new/updated tags are deferred (Phase 3).
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import type { FolderEntry, ChildFile, ChildFolder } from "../loaders/schema.ts";
import type { Options } from "./site.ts";
import { defaultOptions } from "./site.ts";

/** One row in the files-and-folders listing — mirrors the PHP $item array. */
export interface ListingItem {
  empty: boolean;
  target: string;
  url: string;
  icon: string;
  iconGrid: string;
  filename: string;
  size: string;
  date: string;
  kind: string;
  comment: string;
  restricted: boolean;
  haveAccess: boolean;
  isNew: boolean;
  isUpdated: boolean;
}

const DEFAULT_TARGET = "_blank";

/** Format bytes as human-readable size (mirrors PHP format::filesize). */
function formatSize(bytes: number): string {
  if (bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Format a Date as "M D, Y – H:i" (mirrors PHP format::filedate). */
function formatDate(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} – ${h}:${m}`;
}

export interface ListingContext {
  /** Absolute path to the content root. */
  contentRoot: string;
  /** Relative folder path from content root ("/" separators). */
  folderPath: string;
}

function iconForFolder(name: string): string {
  // Mirrors PHP: if icon would be "gen" for a folder, use "dir"
  const lower = name.toLowerCase();
  if (lower.startsWith(".") || lower.includes("-hidden")) return "dir";
  return "dir";
}

function urlForFolder(
  folder: ChildFolder,
  ctx: ListingContext,
): string {
  // .slide: link to first child file if slideTarget is set
  if (folder.enhancerFolder === "slide" && folder.slideTarget) {
    return `/${ctx.folderPath}${folder.name}/${folder.slideTarget}`;
  }
  return `/${ctx.folderPath}${folder.name}/`;
}

function urlForFile(
  file: ChildFile,
  ctx: ListingContext,
): string {
  if (file.enhancer === "link") {
    return file.link?.url ?? `http://${file.displayName}`;
  }
  if (file.enhancer === "pop") {
    const p = file.popup;
    if (p) {
      return `javascript:A17.Helpers.pop('${p.url}','${p.name}',${p.width},${p.height},'${p.style}');`;
    }
    return "#";
  }
  return `/${ctx.folderPath}${file.name}`;
}

function targetForItem(
  file: ChildFile,
  folder: ChildFolder | null,
): string {
  if (folder) return ""; // folders open in same tab
  if (file.enhancer === "link") {
    return file.link?.target ?? DEFAULT_TARGET;
  }
  if (file.enhancer === "pop") return "_self";
  return DEFAULT_TARGET;
}

function displayForItem(
  file: ChildFile,
  folder: ChildFolder | null,
  opts: Options,
): string {
  const replaceDash = opts.replace_dash_space;
  const replaceUnderscore = opts.replace_underscore_space;
  const showExt = opts.display_file_extensions;

  if (folder) {
    let name = folder.displayName;
    if (replaceDash) name = name.replace(/-/g, " ");
    if (replaceUnderscore) name = name.replace(/_/g, " ");
    return name;
  }

  let name = file.displayName;
  if (replaceDash) name = name.replace(/-/g, " ");
  if (replaceUnderscore) name = name.replace(/_/g, " ");
  if (showExt && file.ext) {
    // extension already in displayName per loader displayName logic
  }
  return name;
}

/**
 * Build listing items from a FolderEntry — mirrors SubfolioFiles::files_and_folders().
 */
export function buildListingItems(
  entry: FolderEntry,
  ctx: ListingContext,
  opts?: Partial<Options>,
): ListingItem[] {
  const opt: Options = { ...defaultOptions, ...opts };
  const iconSet = opt.icon_set_list;
  const iconSetGrid = opt.icon_set_grid;
  const items: ListingItem[] = [];

  // Folders first (PHP: folders then files, merged, then sorted)
  for (const folder of entry.folders) {
    // Skip features (files targeted by .ftr — excluded in entry.excluded)
    if (entry.excluded.includes(folder.name)) continue;

    const iconFile = iconForFolder(folder.name);
    const url = urlForFolder(folder, ctx);
    const displayName = displayForItem({} as ChildFile, folder, opt);

    items.push({
      empty: false,       // Phase 3: detect empty folders via stat
      target: targetForItem({} as ChildFile, folder),
      url,
      icon: `${iconSet}_${iconFile}`,
      iconGrid: `${iconSetGrid}_${iconFile}`,
      filename: displayName,
      size: "—",          // Phase 3: stat folder contents
      date: "—",          // Phase 3: stat folder
      kind: "",            // PHP: folders have no kind label
      comment: "",         // folders don't have enhancer comments
      restricted: false,   // Phase 4: access check
      haveAccess: true,    // Phase 4: access check
      isNew: false,        // Phase 3: mtime-based
      isUpdated: false,    // Phase 3: mtime-based
    });
  }

  // Files
  for (const file of entry.files) {
    // Skip features (files targeted by .ftr — excluded in entry.excluded)
    if (entry.excluded.includes(file.name)) continue;

    const iconFile = file.icon || "gen";
    // PHP: if icon is "gen" for a folder, use "dir" — not applicable to files
    const url = urlForFile(file, ctx);
    const displayName = displayForItem(file, null, opt);

    // Stat for size/date
    let size = "—";
    let date = "—";
    let isNew = false;
    let isUpdated = false;
    try {
      const absPath = join(ctx.contentRoot, ctx.folderPath, file.name);
      const st = statSync(absPath);
      size = formatSize(st.size);
      date = formatDate(st.mtime);
      // Phase 3: proper new/updated detection from config
    } catch { /* file may not exist */ }

    const comment = file.link?.comment ?? file.popup?.comment ?? "";
    const kindLabel = file.display;

    items.push({
      empty: false,
      target: targetForItem(file, null),
      url,
      icon: `${iconSet}_${iconFile}`,
      iconGrid: `${iconSetGrid}_${iconFile}`,
      filename: displayName,
      size,
      date,
      kind: kindLabel,
      comment,
      restricted: false,   // Phase 4
      haveAccess: true,    // Phase 4
      isNew,
      isUpdated,
    });
  }

  return items;
}
