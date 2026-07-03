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
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { page } from "./_dist.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// Read expectations from the same sources the build reads, so a config change
// (rebrand, domain move) can't silently diverge from a hardcoded test value —
// this test gates the deploy (.github/workflows/deploy.yml).
//
// astro.config.mjs resolves `site` as SUBFOLIO_SITE_URL ?? "<default>" (the
// archive deploy overrides it via env). Mirror that resolution exactly: honor
// the env var if set, else parse the string default out of the config source.
const SITE_DEFAULT = readFileSync(join(ROOT, "astro.config.mjs"), "utf8").match(
  /SUBFOLIO_SITE_URL\s*\?\?\s*["']([^"']+)["']/,
)?.[1];
const SITE = (process.env.SUBFOLIO_SITE_URL ?? SITE_DEFAULT)?.replace(/\/+$/, "");
const SITE_NAME = String(
  parse(readFileSync(join(ROOT, "config/settings.yml"), "utf8"))?.site_name ?? "",
);

test("config sources resolve (site url + site name)", () => {
  assert.ok(SITE, "could not read `site` from astro.config.mjs");
  assert.ok(SITE_NAME, "could not read `site_name` from config/settings.yml");
});

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
  assert.equal(attrContent(html, 'property="og:site_name"'), SITE_NAME);
  assert.equal(attrContent(html, 'property="og:title"'), SITE_NAME);
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
