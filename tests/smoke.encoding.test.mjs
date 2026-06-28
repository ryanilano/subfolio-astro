/**
 * Smoke test — URL encoding & raw-byte route (ST3).
 *
 * Asserts that:
 *   1. Space-named directory routes are built to dist/.
 *   2. Percent-encoding is used where the routing layer produces URLs:
 *      prev/next nav renders %20, and the .slide meta-refresh target is encoded.
 *   3. The /directory/<path> (raw-byte) namespace exists and serves file bytes.
 *
 * Run:  npm run build && npm run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageExists, page, distFile } from "./_dist.mjs";

// ── space-named routes ──────────────────────────────────────────────

test("space-named directory routes are built", () => {
  assert.ok(pageExists("05 display rss feed"), "missing: 05 display rss feed");
  assert.ok(pageExists("06 slideshow.slide"), "missing: 06 slideshow.slide");
});

// ── percent-encoding in generated HTML ──────────────────────────────

test("prev/next nav encodes space paths with %20", () => {
  // The "05 display rss feed" page has a prev link to 04_html_prototype
  // (no encoding needed) and a next link to "06 slideshow.slide" which
  // must be %20-encoded.
  const html = page("05 display rss feed");
  assert.match(
    html,
    /href="\/06%20slideshow\.slide"/,
    "next nav link should encode spaces as %20",
  );
});

test(".slide redirect target is percent-encoded", () => {
  // The inner .slide page emits a <meta http-equiv="refresh"> whose
  // url= must encode spaces in the redirect path.
  const html = page("06 slideshow.slide/slideshow.slide");
  assert.match(html, /<meta http-equiv="refresh"[^>]+url=/);
  assert.match(
    html,
    /url=\/06%20slideshow\.slide\/slideshow\.slide\/example\.gif/,
    ".slide redirect url= should encode spaces as %20",
  );
});

// ── raw-byte /directory/ namespace ──────────────────────────────────

test("/directory/<path> serves raw file bytes", () => {
  // distFile() reads from dist/ — the /directory/<path> namespace places
  // raw files directly under dist/directory/.
  const content = distFile("directory/markdown_cheat_sheet.txt");
  assert.ok(content.length > 0, "raw-byte file should be non-empty");

  // Another fixture: the zip bundle for .oplx folders.
  const zip = distFile("directory/08_project_plan.oplx.zip");
  assert.ok(zip.length > 0, "raw .oplx.zip should be non-empty");
});
