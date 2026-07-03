/**
 * Raw-bytes endpoint — serves the actual file contents under /directory/<path>,
 * mirroring the PHP Filebrowser_Controller::access() route that get_file_url()
 * points at. This is the second URL namespace (raw bytes), distinct from the
 * HTML pages served by [...path].astro.
 *
 * Honors SUBFOLIO_CONTENT_DIR the same way src/content.config.ts does, so no
 * copy step is needed — the same content the loader walks is served verbatim,
 * in both `astro dev` and `astro build` (static output).
 *
 * Deferred (Phase 4): -access enforcement. Everything served here is public —
 * which is exactly why repo/OS metadata is filtered below: pointing the content
 * root at a git checkout must never publish its .git/.github/.claude internals
 * (this happened — see README "Why .env.content"). The CI strip in the archive
 * deploy is the first line of defense; this filter is the engine-level one.
 */
import type { APIRoute } from "astro";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";

const contentRoot = resolve(process.env.SUBFOLIO_CONTENT_DIR ?? "./content/examples");
// Pre-generated auto thumbnails live out-of-tree (scripts/gen-thumbs.mjs). They
// are served under the same /directory/ namespace, so the route walker and GET
// handler fall back to this cache for any path not present in the content root.
const cacheRoot = resolve(process.env.SUBFOLIO_THUMB_CACHE ?? "./.thumb-cache");
// Pre-built .oplx zip artifacts (scripts/gen-oplx.mjs) live out-of-tree too,
// served under the same /directory/ namespace at `<oplxFolder>.zip`.
const oplxCacheRoot = resolve(process.env.SUBFOLIO_OPLX_CACHE ?? "./.oplx-cache");
// Pre-generated embed WebP siblings (scripts/gen-embeds.mjs), served under the
// same /directory/ namespace at `<embedPath>.webp`.
const embedCacheRoot = resolve(process.env.SUBFOLIO_EMBED_CACHE ?? "./.embed-cache");

/** Minimal extension → MIME map (mirrors the PHP mime_content_type table). */
const MIME: Record<string, string> = {
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".ico": "image/vnd.microsoft.icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".swf": "application/x-shockwave-flash",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

function mimeFor(name: string): string {
  return MIME[extname(name).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Names that must never be served, even when the content root is a live git
 * checkout:
 *
 * - Any dot-prefixed entry (.git, .github, .forgejo, .claude, .gitignore,
 *   .DS_Store, .env, …). Dot entries are repo/OS metadata, never Subfolio
 *   content — Subfolio's own hidden convention is the "-" prefix, and those
 *   ARE served on purpose (embeds, -thumbnails/, -t-* banner images).
 * - `-access` (and its .txt variant): its allow/deny rules leak user and group
 *   names, and enforcement is deferred to Phase 4. The PHP engine's htaccess
 *   blocked config/users and *.yml for the same reason.
 *
 * Applied in walkFiles (nothing blocked becomes a static route) AND in GET
 * (astro dev serves arbitrary paths live, so the walk-time filter alone is
 * not enough there).
 */
function isBlockedName(name: string): boolean {
  return name.startsWith(".") || name === "-access" || name === "-access.txt";
}

function isBlockedPath(relPath: string): boolean {
  return relPath.split("/").some(isBlockedName);
}

/** Recursively collect every real file under `root`, "/"-relative. */
function walkFiles(root: string, relDir: string, out: string[]): void {
  const absDir = join(root, relDir);
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (isBlockedName(name)) continue; // repo/OS metadata + -access: never served
    const relPath = relDir ? `${relDir}/${name}` : name;
    const abs = join(absDir, name);
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walkFiles(root, relPath, out);
    else out.push(relPath);
  }
}

export function getStaticPaths() {
  // Union of content files and pre-generated cache thumbnails. The cache may add
  // -thumbnails/ paths the content tree doesn't have; dedupe in case both carry
  // the same path (content wins at serve time below).
  const paths = new Set<string>();
  const contentFiles: string[] = [];
  walkFiles(contentRoot, "", contentFiles);
  contentFiles.forEach((p) => paths.add(p));
  const cacheFiles: string[] = [];
  walkFiles(cacheRoot, "", cacheFiles);
  cacheFiles.forEach((p) => paths.add(p));
  const oplxFiles: string[] = [];
  walkFiles(oplxCacheRoot, "", oplxFiles);
  oplxFiles.forEach((p) => paths.add(p));
  const embedFiles: string[] = [];
  walkFiles(embedCacheRoot, "", embedFiles);
  embedFiles.forEach((p) => paths.add(p));
  return [...paths].map((relPath) => ({ params: { path: relPath } }));
}

/** Resolve a "/"-relative request path against a root, rejecting traversal. */
function safeResolve(root: string, relPath: string): string | null {
  const abs = resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + "/")) return null;
  return abs;
}

export const GET: APIRoute = ({ params }) => {
  const relPath = params.path ?? "";
  // Blocked names 403 before any disk access — mirrors the htaccess [F] rules.
  // Matters in `astro dev`, where GET serves arbitrary live paths that never
  // went through getStaticPaths' filtered walk.
  if (isBlockedPath(relPath)) {
    return new Response("Forbidden", { status: 403 });
  }
  // Serve from content first, then the out-of-tree thumbnail cache. Both are
  // traversal-guarded; content wins if a path somehow exists in both.
  const absContent = safeResolve(contentRoot, relPath);
  const absCache = safeResolve(cacheRoot, relPath);
  const absOplx = safeResolve(oplxCacheRoot, relPath);
  const absEmbed = safeResolve(embedCacheRoot, relPath);
  if (absContent === null && absCache === null && absOplx === null && absEmbed === null) {
    return new Response("Forbidden", { status: 403 });
  }
  let body: Buffer;
  try {
    body = readFileSync(absContent as string);
  } catch {
    try {
      body = readFileSync(absCache as string);
    } catch {
      try {
        body = readFileSync(absOplx as string);
      } catch {
        try {
          body = readFileSync(absEmbed as string);
        } catch {
          return new Response("Not found", { status: 404 });
        }
      }
    }
  }
  // Copy into a fresh ArrayBuffer-backed view. node's Buffer is typed over
  // ArrayBufferLike (incl. SharedArrayBuffer), which astro check won't accept
  // as a BodyInit/BlobPart; a plain ArrayBuffer is unambiguous.
  const ab = new ArrayBuffer(body.byteLength);
  new Uint8Array(ab).set(body);
  return new Response(ab, {
    status: 200,
    headers: { "Content-Type": mimeFor(relPath) },
  });
};
