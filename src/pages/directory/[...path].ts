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
import { readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { ContentTree, hasUnpublishableSegment } from "../../lib/contentWalk.ts";
import { imageStripMode } from "../../lib/site.ts";
import { publishedBytes } from "../../lib/stripMetadata.ts";

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
 * Metadata policy for published images (settings.yml `strip_location`, default
 * true; `strip_all_metadata`, default false). null = serve bytes unchanged.
 */
const stripMode = imageStripMode;

/**
 * What may be served is decided by the shared publication policy in
 * src/lib/contentWalk.ts, the same one the loader and gen-* scripts use:
 *
 * - Any dot-prefixed entry (.git, .github, .forgejo, .claude, .gitignore,
 *   .DS_Store, .env, …) is never served. Dot entries are repo/OS metadata,
 *   never Subfolio content — Subfolio's own hidden convention is the "-"
 *   prefix, and those ARE served on purpose (embeds, -thumbnails/, -t-* banner
 *   images).
 * - `-access` (and its .txt variant) is never served: its allow/deny rules leak
 *   user and group names, and enforcement is deferred to Phase 4. The PHP
 *   engine's htaccess blocked config/users and *.yml for the same reason.
 * - A symlink is served only when its real path stays inside its root, so a
 *   link to ~/.ssh or ../outside publishes nothing. Folders are entered once by
 *   real identity, so a link cycle cannot loop the walk.
 *
 * Applied in getStaticPaths (nothing blocked becomes a static route) AND in GET
 * (astro dev serves arbitrary paths live, so the walk-time filter alone is not
 * enough there).
 */
const trees = [contentRoot, cacheRoot, oplxCacheRoot, embedCacheRoot].map((r) => new ContentTree(r));

export function getStaticPaths() {
  // Union of content files and the pre-generated caches (thumbnails, .oplx
  // zips, embed WebPs). A cache may add paths the content tree doesn't have;
  // dedupe in case two carry the same path (content wins at serve time below).
  const paths = new Set<string>();
  for (const tree of trees) tree.walkFiles().forEach((p) => paths.add(p));
  return [...paths].map((relPath) => ({ params: { path: relPath } }));
}

export const GET: APIRoute = ({ params }) => {
  const relPath = params.path ?? "";
  // Blocked names 403 before any disk access — mirrors the htaccess [F] rules.
  // Matters in `astro dev`, where GET serves arbitrary live paths that never
  // went through getStaticPaths' filtered walk.
  if (hasUnpublishableSegment(relPath) || relPath.split("/").includes("..")) {
    return new Response("Forbidden", { status: 403 });
  }
  // Serve from content first, then the caches. resolveFile() rejects traversal
  // and anything whose real path leaves its root (a symlink out of the tree);
  // content wins if a path somehow exists in more than one.
  let body: Buffer | null = null;
  for (const tree of trees) {
    const abs = tree.resolveFile(relPath);
    if (abs === null) continue;
    try {
      body = readFileSync(abs);
      break;
    } catch {
      /* unreadable → try the next root */
    }
  }
  if (body === null) return new Response("Not found", { status: 404 });
  body = publishedBytes(relPath, body, stripMode);
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
