/**
 * Folder sidecar `image:` → a content path for og:image.
 *
 * A folder's own `.info` sidecar may set `image:` (see src/loaders/index.ts).
 * This turns the raw string into something safe to publish. It never throws:
 * a bad value returns null and the caller falls back to the first-thumbnail
 * og:image, so one bad sidecar can't break the build.
 *
 * Accepted forms:
 *  - an absolute http(s) URL, kept as is if URL.canParse accepts it
 *  - "/directory/<path>", the raw-bytes URL form, read as content-relative
 *  - "/<path>", content-root relative
 *  - "<name>" or "sub/<name>", relative to the folder that owns the sidecar
 * A content path must stay inside the content root (no ".."), must not pass
 * through a name the raw route blocks (dot segments, -access), and the file
 * must exist; otherwise null.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

export type PageImage = { kind: "url"; url: string } | { kind: "content"; relPath: string };

export function resolvePageImage(raw: string | undefined, relDir: string, contentRoot: string): PageImage | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) {
    // Only http(s) URLs pass, and only well-formed ones.
    return /^https?:\/\//i.test(v) && URL.canParse(v) ? { kind: "url", url: v } : null;
  }
  const joined = v.startsWith("/directory/")
    ? v.slice("/directory/".length)
    : v.startsWith("/")
      ? v.slice(1)
      : relDir
        ? `${relDir}/${v}`
        : v;
  const parts = joined.split("/").filter((s) => s !== "" && s !== ".");
  // Same names the raw /directory route never publishes (isBlockedName in
  // src/pages/directory/[...path].ts): dot segments and -access. A blocked path
  // would return a thumbnail URL that 404s and skip the fallback.
  const blocked = (s: string) => s.startsWith(".") || s === "-access" || s === "-access.txt";
  if (parts.length === 0 || parts.includes("..") || parts.some(blocked)) return null;
  const relPath = parts.join("/");
  try {
    if (!existsSync(join(contentRoot, relPath)) || !statSync(join(contentRoot, relPath)).isFile()) return null;
  } catch {
    return null;
  }
  return { kind: "content", relPath };
}
