/**
 * ST4 — Thumbnail / gallery structure smoke test.
 *
 * Asserts the 00_thumbnails page renders a correctly-structured gallery:
 *   - Three gallery_thumbnail blocks (gif/jpg/png)
 *   - Each <img src> points at a -thumbnails/ URL (generated thumbnail)
 *   - Gallery filenames render under each thumb
 *   - Each gallery <img> carries width/height attributes
 *   - Gallery markup wrapper is intact (regression guard)
 *
 * Mirrors the reference test tests/smoke.routes.test.mjs.
 *
 * Run:  npm run build && npm run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { page } from "./_dist.mjs";

const html = page("00_thumbnails");

test("00_thumbnails page contains exactly three gallery_thumbnail blocks (gif/jpg/png)", () => {
  const matches = html.match(/class="gallery_thumbnail"/g);
  assert.ok(matches, "no gallery_thumbnail blocks found");
  assert.equal(matches.length, 3, `expected 3 gallery_thumbnail blocks, got ${matches.length}`);
});

test("each gallery <img src> points at a -thumbnails/ URL", () => {
  // Extract all <img> tags inside gallery_thumbnail divs
  const imgs = html.match(/<div class="gallery_thumbnail[^"]*"[^>]*>[\s\S]*?<img[^>]*>/g);
  assert.ok(imgs, "no gallery <img> tags found");
  assert.equal(imgs.length, 3, `expected 3 gallery <img> tags, got ${imgs.length}`);
  for (const img of imgs) {
    assert.match(img, /src="[^"]*-thumbnails\/[^"]*"/, `gallery <img> src does not point at -thumbnails/: ${img}`);
  }
});

test("gallery filenames appear under each thumb", () => {
  assert.match(html, /<p>example\.gif<\/p>/, "missing filename for example.gif");
  assert.match(html, /<p>example\.jpg<\/p>/, "missing filename for example.jpg");
  assert.match(html, /<p>example\.png<\/p>/, "missing filename for example.png");
});

test("each gallery <img> carries width and height attributes", () => {
  // Match <img> tags within the gallery (not the header logo)
  const imgs = html.match(/<div class="gallery_thumbnail[^"]*"[^>]*>[\s\S]*?<img[^>]*>/g);
  assert.ok(imgs, "no gallery <img> tags found");
  for (const img of imgs) {
    assert.match(img, /\bwidth="\d+"/, `gallery <img> missing width attribute: ${img}`);
    assert.match(img, /\bheight="\d+"/, `gallery <img> missing height attribute: ${img}`);
  }
});

test("gallery markup wrapper is intact (regression guard)", () => {
  assert.match(html, /<div class="gallery gallery--list">/, "missing gallery markup wrapper");
  assert.match(html, /<!-- gallery -->/, "missing gallery closing comment");
});
