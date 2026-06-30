/**
 * Shared helpers for the structural smoke-test suite (tests/smoke.*.test.mjs).
 *
 * These tests are NOT visual — they assert against the static build in dist/.
 * Always build first:  npm run build && npm run test
 *
 * Read-only: Wave test files import these helpers; they don't modify this file.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DIST = resolve(ROOT, "dist");

/** Absolute path to a built page's index.html. route "" or "/" = site root. */
function pagePath(route) {
  const rel = route.replace(/^\/+/, "");
  return rel === "" ? join(DIST, "index.html") : join(DIST, rel, "index.html");
}

/** True if a built HTML page exists for this "/"-relative route. */
export function pageExists(route) {
  return existsSync(pagePath(route));
}

/**
 * Read a built page's HTML by "/"-relative route. Spaces are literal (the build
 * writes `dist/05 display rss feed/index.html`, not percent-encoded). Throws if
 * the page is missing, so an absent route fails loudly.
 */
export function page(route) {
  return readFileSync(pagePath(route), "utf8");
}

/** Read any file under dist/ by "/"-relative path (e.g. "css/main.css"). */
export function distFile(rel) {
  return readFileSync(join(DIST, rel.replace(/^\/+/, "")), "utf8");
}
