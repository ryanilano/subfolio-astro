/**
 * File-level computed properties — replaces `Subfolio::current_file()` lookups
 * that filekind views depend on (SPEC-theme-api §2.5).
 *
 * Phase 2: width/height are defaults (sharp → Phase 3), body rendering is
 * deferred (Textile/MD → Phase 5), retina/shadow/browser detection deferred
 * (sharp → Phase 3).
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ChildFile } from "../loaders/schema.ts";
import type { FileKind } from "../loaders/filekinds.ts";
import { parseSubfolioYaml, asNumber, asString } from "../loaders/yaml.ts";
import { assetUrl } from "./routing.ts";
import { imageMetaFor } from "./imageMeta.ts";
import { renderText, type Renderer } from "./renderText.ts";

/** The complete shape a filekind view receives — ChildFile + computed extras. */
export interface FileViewData {
  // From ChildFile
  name: string;
  displayName: string;
  ext: string;
  kind: string;
  icon: string;
  display: string;
  enhancer: string | null;
  /** Parsed .link enhancer payload (if file is a .link). */
  linkPayload?: { url: string; target: string; comment?: string };
  /** Parsed .pop enhancer payload (if file is a .pop). */
  popupPayload?: { url: string; width: number; height: number; name: string; style: string; comment?: string };

  // Computed
  /** Width. For images: deferred to Phase 3 sharp (returns 0). */
  width: number;
  /** Height. For images: deferred to Phase 3 sharp (returns 0). */
  height: number;
  /** Icon with icon-set grid prefix, e.g. "grid_img". */
  iconGrid: string;
  /** Raw icon name (no icon-set prefix). */
  iconName: string;
  /** "new" or "updated" tag, or empty string. */
  tag: string;
  /** File URL relative to content root. */
  url: string;
  /** Resolved link URL for the clickable zone (enhancer-resolved or file url). */
  link: string;
  /** Retina variant URL (Phase 3). */
  retina: string | null;
  /** is_retina suffix (Phase 3). */
  isRetina: boolean;
  /** has_shadow suffix (Phase 3). */
  hasShadow: boolean;
  /** has_browser suffix (Phase 3). */
  hasBrowser: boolean;
  /** Primary link target (download or external). */
  target: string;
  /** Display filename (HTML-safe). */
  filename: string;
  /** Formatted last-modified date. */
  lastmodified: string;
  /** Formatted file size. */
  size: string;
  /** Raw byte count. */
  rawsize: number;
  /** Comment text. */
  comment: string;
  /** Autoplay flag (for vid/snd). */
  autoplay: string;
  /** Human-readable kind label from filekinds.yml. */
  kindLabel: string;
  /** File extension (truncated to 3 chars if >6). */
  extension: string;
  /** RSS feed URL (for .rss files). */
  feedurl: string;
  /** RSS item count. */
  count: number;
  /** RSS cache TTL. */
  cache: number;
  /** Filekind instructions HTML. */
  instructions: string;
  /** Raw file body (for .txt views). */
  body: string;
  /** Archive path (for .oplx zip download). */
  archive: string;
}

const DEFAULT_TARGET = "_blank";

/** Read a file as UTF-8, "" on any error (lenient, like the loader). */
function safeReadText(abs: string): string {
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

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

export interface FileViewContext {
  /** Absolute path to the content root. */
  contentRoot: string;
  /** Relative folder path from content root ("/" separators). */
  folderPath: string;
  /** The filekinds table (for instructions). */
  kinds: FileKind[];
  /** Relative file path from content root. */
  relPath: string;
  /** Text render engine for the file body (none|textile|markdown). */
  renderer: Renderer;
}

/**
 * Build the full FileViewData from a ChildFile + disk context.
 * Mirrors Subfolio::current_file() for each key.
 */
export async function buildFileViewData(
  file: ChildFile,
  ctx: FileViewContext,
): Promise<FileViewData> {
  const absPath = join(ctx.contentRoot, ctx.relPath);
  // Raw bytes live under /directory/ (mirrors Filebrowser::get_file_url()).
  const url = assetUrl(ctx.relPath);

  // Stat for size/date
  let rawsize = 0;
  let lastmodified = "—";
  try {
    const st = statSync(absPath);
    rawsize = st.size;
    lastmodified = formatDate(st.mtime);
  } catch { /* file may not exist */ }

  // Filekind instructions
  const fk = ctx.kinds.find((k) => k.kind === file.kind);
  const instructions = fk?.instructions ?? "";

  // Extension display (truncated to 3 if >6 chars)
  const ext = file.ext;
  const extension = ext.length > 6 ? ext.slice(0, 3) : ext;

  // Comment from enhancer payloads
  const comment = file.link?.comment ?? file.popup?.comment ?? "";

  // Link / target resolution
  let link: string;
  let target: string;
  if (file.enhancer === "link") {
    link = file.link?.url ?? `http://${file.displayName}`;
    target = file.link?.target ?? DEFAULT_TARGET;
  } else if (file.enhancer === "pop") {
    const p = file.popup;
    link = p
      ? `javascript:A17.Helpers.pop('${p.url}','${p.name}',${p.width},${p.height},'${p.style}');`
      : "#";
    target = "_self";
  } else {
    link = url;
    target = DEFAULT_TARGET;
  }

  // Tag: "new" if less than 7 days old, else ""
  let tag = "";
  try {
    const age = Date.now() - statSync(absPath).mtimeMs;
    if (age < 7 * 24 * 60 * 60 * 1000) tag = "new";
  } catch { /* */ }

  // Image dimensions + retina/shadow/browser suffixes (sharp, build-time).
  // Non-image kinds get zeroed dimensions and false flags, same as before.
  const img =
    file.kind === "img"
      ? await imageMetaFor(ctx.relPath)
      : { width: 0, height: 0, isRetina: false, hasShadow: false, hasBrowser: false };

  // RSS feed params from the .rss file body (YAML). The feed itself is fetched
  // in the pre-build pass (scripts/gen-rss.mjs); here we surface the params the
  // route uses to look the cached items up via rssItemsFor().
  let feedurl = "";
  let count = 10;
  let cache = 3600;
  if (file.kind === "rss") {
    const doc = parseSubfolioYaml(safeReadText(absPath));
    feedurl = asString(doc.feedurl) ?? "";
    count = asNumber(doc.count, 10);
    cache = asNumber(doc.cache, 3600);
  }

  return {
    name: file.name,
    displayName: file.displayName,
    ext: file.ext,
    kind: file.kind,
    icon: file.icon,
    display: file.display,
    enhancer: file.enhancer,
    linkPayload: file.link,
    popupPayload: file.popup,

    width: img.width,
    height: img.height,
    iconGrid: `grid_${file.icon}`,
    iconName: file.icon,
    tag,
    url,
    retina: img.isRetina ? url : null,
    isRetina: img.isRetina,
    hasShadow: img.hasShadow,
    hasBrowser: img.hasBrowser,
    link,
    target,
    filename: file.displayName,
    lastmodified,
    size: formatSize(rawsize),
    rawsize,
    comment,
    autoplay: "",
    kindLabel: file.display,
    extension,
    feedurl,
    count,
    cache,
    instructions,
    // Rendered file body for txt views (ports format::get_rendered_text()).
    // Only text kinds carry a body; others stay empty.
    body: file.kind === "txt" ? renderText(safeReadText(absPath), ctx.renderer) : "",
    // .oplx download → the pre-built zip artifact (scripts/gen-oplx.mjs),
    // served under /directory/<folder>.zip. Other kinds don't use `archive`.
    archive: file.kind === "oplx" ? assetUrl(`${ctx.relPath}.zip`) : `${import.meta.env.BASE_URL}${ctx.folderPath}`,
  };
}
