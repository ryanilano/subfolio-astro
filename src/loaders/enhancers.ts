import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSubfolioYaml, asNumber, asString } from "./yaml.ts";
import type { Feature, Related } from "./schema.ts";

/**
 * Enhancer file parsers, per SPEC-conventions §3. Each reads a YAML body and
 * returns a typed payload. Phase 1 resolves the payloads; behaviors needing
 * runtime (.oplx zip build, .pop client JS) are recorded as intent only.
 */

function read(contentRoot: string, relPath: string): string {
  try {
    return readFileSync(join(contentRoot, relPath), "utf8");
  } catch {
    return "";
  }
}

/** `.link` → Internet Location (SPEC §3.3). url falls back to http://<basename>. */
export function parseLink(
  contentRoot: string,
  relPath: string,
  fileBaseName: string,
): { url: string; target: string; comment?: string } {
  const doc = parseSubfolioYaml(read(contentRoot, relPath));
  const url = asString(doc.url) || `http://${fileBaseName}`;
  const target = asString(doc.target) || "_blank";
  const comment = asString(doc.comment);
  return comment ? { url, target, comment } : { url, target };
}

/** `.pop` → Popup Window (SPEC §3.5). Defaults mirror the PHP engine. */
export function parsePop(
  contentRoot: string,
  relPath: string,
): { url: string; width: number; height: number; name: string; style: string; comment?: string } {
  const doc = parseSubfolioYaml(read(contentRoot, relPath));
  const comment = asString(doc.comment);
  const base = {
    url: asString(doc.url) || "http://www.subfolio.com",
    width: asNumber(doc.width, 800),
    height: asNumber(doc.height, 600),
    name: asString(doc.name) || "POPUP",
    style: asString(doc.style) || "POPSCROLL",
  };
  return comment ? { ...base, comment } : base;
}

/**
 * `.ftr` → Feature card (SPEC §3.2). Resolves the link from link|folder|file
 * and reports which local folder/file it references so the caller can exclude
 * that item from the plain listing (is_feature). Returns the feature plus the
 * referenced local name (or null for external links).
 */
export function parseFeature(
  contentRoot: string,
  relPath: string,
): { feature: Feature; referencedName: string | null } {
  const doc = parseSubfolioYaml(read(contentRoot, relPath));
  const title = asString(doc.title);
  const image = asString(doc.image);
  const description = asString(doc.description);
  const target = asString(doc.target);
  const width = doc.width !== undefined ? asNumber(doc.width, 0) : undefined;
  const height = doc.height !== undefined ? asNumber(doc.height, 0) : undefined;

  const link = asString(doc.link);
  const folder = asString(doc.folder);
  const file = asString(doc.file);

  let kind: Feature["kind"] = "link";
  let resolvedLink = "";
  let referencedName: string | null = null;
  if (link) {
    kind = "link";
    resolvedLink = link;
  } else if (folder) {
    kind = "folder";
    resolvedLink = folder;
    referencedName = folder;
  } else if (file) {
    kind = "file";
    resolvedLink = file;
    referencedName = file;
  }

  const feature: Feature = { kind, link: resolvedLink };
  if (title) feature.title = title;
  if (image) feature.image = image;
  if (description) feature.description = description;
  if (target) feature.target = target;
  if (width !== undefined) feature.width = width;
  if (height !== undefined) feature.height = height;

  return { feature, referencedName };
}

/**
 * `.cut` → Shortcut / related item (SPEC §3.1). url wins; otherwise `directory`
 * is treated as a path (absolute from site root if it starts with "/", else
 * relative to the current folder). Phase 1 records the resolved path without a
 * FileFolder access check (deferred Phase-4).
 */
export function parseCut(contentRoot: string, relPath: string, currentFolder: string): Related {
  const doc = parseSubfolioYaml(read(contentRoot, relPath));
  const name = asString(doc.name) || "";
  const url = asString(doc.url);
  if (url) {
    return { name, url, isExternal: true };
  }
  const dir = asString(doc.directory) || "";
  let resolved: string;
  if (dir.startsWith("/")) {
    resolved = dir;
  } else {
    resolved = currentFolder ? `${currentFolder}/${dir}` : dir;
  }
  return { name, url: resolved, isExternal: false };
}
