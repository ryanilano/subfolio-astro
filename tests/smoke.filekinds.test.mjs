/**
 * ST2 — Filekind detail dispatch smoke test.
 *
 * Asserts that each filekind's detail view is dispatched to the correct
 * component and renders the expected structural markers.
 *
 * Run:  npm run build && npm run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { page, pageExists } from "./_dist.mjs";

test("image detail renders <img> pointing at the file bytes", () => {
  const html = page("00_thumbnails/example.png");
  assert.match(html, /<img[^>]*src="\/directory\/00_thumbnails\/example\.png"/,
    "image detail missing <img> pointing at the raw file");
});

test("link enhancer exposes external href in folder listing", () => {
  const html = page("02_popups_links_shortcuts");
  assert.match(html, /href="http:\/\/www\.area17\.com"/,
    "folder listing missing external link http://www.area17.com");
});

test(".site folder renders single view with icon__site marker", () => {
  const html = page("04_html_prototype/04_html_prototype.site");
  assert.match(html, /icon__site/,
    ".site single view missing icon__site");
});

test(".oplx folder renders as a detail view, not a folder listing", () => {
  assert.ok(pageExists("08_project_plan.oplx"),
    "missing built page for .oplx detail route");
  const html = page("08_project_plan.oplx");
  // The detail view carries the download-box markup
  assert.match(html, /download_box/,
    ".oplx detail view missing download-box markup");
});

test("markdown .txt renders formatted HTML, not raw # source", () => {
  const html = page("markdown_cheat_sheet.txt");
  assert.match(html, /<h1[>\s]/, "markdown page missing <h1> (formatted heading)");
  assert.match(html, /<strong>/, "markdown page missing <strong> (formatted bold)");
  assert.match(html, /<code>/, "markdown page missing <code> (formatted code)");
  // Content headings exist beyond the logo <h1> — proves markdown → HTML conversion
  const contentH1s = html.match(/<h1[>\s]/g);
  assert.ok(contentH1s && contentH1s.length > 1,
    `expected multiple <h1> tags (content headings), got ${contentH1s?.length ?? 0}`);
});

test(".slide inner folder renders a meta-refresh redirect to the first image", () => {
  const html = page("06 slideshow.slide/slideshow.slide");
  assert.match(html, /<meta\s+http-equiv="refresh"[^>]*url=[^>]*example\.gif/,
    ".slide inner page missing meta-refresh redirect to example.gif");
});
