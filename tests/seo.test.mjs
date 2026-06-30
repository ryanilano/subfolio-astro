/**
 * SEO / Open Graph head test — Milestone 6, Phase E.
 *
 * Asserts the head-meta contract added in Phase E:
 *   (a) every page carries a canonical link + Open Graph + Twitter Card tags
 *       with ABSOLUTE urls (resolved against astro.config `site`);
 *   (b) folder/listing routes are og:type=website; file detail routes are
 *       og:type=article;
 *   (c) a gallery folder exposes og:image pointing at its first thumbnail in a
 *       crawler-safe base format (NOT the .webp/.avif sibling), and upgrades the
 *       twitter:card to summary_large_image;
 *   (d) a no-image detail page omits og:image and stays twitter:card=summary.
 *
 * Depends on a full build in dist/.
 * Run:  npm run build && node --test tests/seo.test.mjs
 *
 * Mirrors tests/picture.test.mjs conventions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { page } from "./_dist.mjs";

// Must match astro.config.mjs `site`.
const SITE = "https://subfolio-astro.ilano.fyi";

/** Grab a meta/link tag's content/href by property|name|rel attribute value. */
function attrContent(html, sel) {
  // sel like 'property="og:title"' or 'name="twitter:card"' or 'rel="canonical"'
  const re = new RegExp(`<(?:meta|link)[^>]*\\b${sel}[^>]*>`, "i");
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  return tag.match(/\b(?:content|href)="([^"]*)"/i)?.[1] ?? null;
}

// --- (a) canonical + core OG present, absolute -----------------------------

test("root page has absolute canonical + og:url", () => {
  const html = page("/");
  assert.equal(attrContent(html, 'rel="canonical"'), `${SITE}/`);
  assert.equal(attrContent(html, 'property="og:url"'), `${SITE}/`);
  assert.equal(attrContent(html, 'property="og:site_name"'), "Subfolio");
  assert.equal(attrContent(html, 'property="og:title"'), "Subfolio");
});

// --- (b) og:type per route kind --------------------------------------------

test("listing routes are og:type=website", () => {
  assert.equal(attrContent(page("/"), 'property="og:type"'), "website");
  assert.equal(
    attrContent(page("/00_thumbnails"), 'property="og:type"'),
    "website",
  );
});

test("file detail routes are og:type=article", () => {
  assert.equal(
    attrContent(page("/markdown_cheat_sheet.txt"), 'property="og:type"'),
    "article",
  );
});

// --- (c) gallery folder og:image, crawler-safe base format -----------------

test("gallery folder exposes absolute og:image in a base (non-modern) format", () => {
  const html = page("/00_thumbnails");
  const img = attrContent(html, 'property="og:image"');
  assert.ok(img, "00_thumbnails missing og:image");
  assert.ok(img.startsWith(`${SITE}/`), `og:image not absolute: ${img}`);
  // Crawler-safe: the fallback thumbnail, not a .webp/.avif sibling. (A ?rnd=
  // cache-bust query may follow the extension, so test the path part only.)
  const pathPart = img.split("?")[0];
  assert.ok(
    !/\.(webp|avif)$/i.test(pathPart),
    `og:image should be base format, got ${pathPart}`,
  );
  // With an image present, the twitter card upgrades to the large variant.
  assert.equal(
    attrContent(html, 'name="twitter:card"'),
    "summary_large_image",
  );
});

// --- (d) no-image detail page omits og:image -------------------------------

test("image-less detail page omits og:image and stays twitter summary", () => {
  const html = page("/markdown_cheat_sheet.txt");
  assert.equal(attrContent(html, 'property="og:image"'), null);
  assert.equal(attrContent(html, 'name="twitter:card"'), "summary");
});
