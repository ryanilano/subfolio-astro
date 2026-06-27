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
 * Deferred (Phase 4): -access enforcement. Everything served here is public.
 */
import type { APIRoute } from "astro";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";

const contentRoot = resolve(process.env.SUBFOLIO_CONTENT_DIR ?? "./content/examples");

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

/** Recursively collect every real file under the content root, "/"-relative. */
function walkFiles(relDir: string, out: string[]): void {
  const absDir = join(contentRoot, relDir);
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return;
  }
  for (const name of entries) {
    const relPath = relDir ? `${relDir}/${name}` : name;
    const abs = join(absDir, name);
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walkFiles(relPath, out);
    else out.push(relPath);
  }
}

export function getStaticPaths() {
  const files: string[] = [];
  walkFiles("", files);
  return files.map((relPath) => ({ params: { path: relPath } }));
}

export const GET: APIRoute = ({ params }) => {
  const relPath = params.path ?? "";
  // Guard against path traversal — resolved target must stay under contentRoot.
  const abs = resolve(contentRoot, relPath);
  if (abs !== contentRoot && !abs.startsWith(contentRoot + "/")) {
    return new Response("Forbidden", { status: 403 });
  }
  let body: Buffer;
  try {
    body = readFileSync(abs);
  } catch {
    return new Response("Not found", { status: 404 });
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
