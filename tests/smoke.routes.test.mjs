/**
 * REFERENCE smoke test (the Gate). Wave test files mirror this pattern:
 *   - import helpers from ./_dist.mjs
 *   - use node:test + node:assert/strict
 *   - assert against the static build (run `npm run build` first)
 *
 * Run:  npm run build && npm run test
 *
 * This file proves every expected fixture route is built. Per-feature assertions
 * (listing partials, filekind dispatch, URL encoding) live in sibling
 * smoke.*.test.mjs files.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageExists, page, distFile } from "./_dist.mjs";

// One built page per fixture route. "" = site root. Spaces are literal.
const EXPECTED_PAGES = [
  "", // root listing
  "00_thumbnails",
  "01_embedding_text_images",
  "02_popups_links_shortcuts",
  "03_featuring_content",
  "04_html_prototype",
  "04_html_prototype/04_html_prototype.site", // .site single view
  "05 display rss feed",
  "05 display rss feed/rss-enhancer.rss", // .rss detail view
  "06 slideshow.slide",
  "06 slideshow.slide/slideshow.slide", // inner .slide → redirect page
  "07_protecting_a_folder",
  "08_project_plan.oplx", // .oplx single view
  "markdown_cheat_sheet.txt", // markdown detail view
];

test("every expected fixture route is built to dist/<route>/index.html", () => {
  for (const route of EXPECTED_PAGES) {
    assert.ok(pageExists(route), `missing built page for route: "${route || "/"}"`);
  }
});

test("hidden directory does not leak into the root listing", () => {
  // -hidden/ may still produce a raw route, but the root LISTING must omit it.
  const html = page("");
  assert.ok(!/href="\/-hidden"/.test(html), "-hidden leaked into the root listing");
});

test("gallery <img> keeps the aspect-ratio guard (Findings #1 regression)", () => {
  // The gallery img rule must keep width:auto, or source-sized width attributes
  // squish the thumbnails. See docs/TESTING.md Findings #1.
  const css = distFile("css/main.css");
  // \s* before the brace: B1 (Phase B) minifies main.css, so the rule is
  // `.gallery li a img{...}` with no space. Match both minified and unminified.
  const rule = css.match(/\.gallery li a img\s*\{[^}]*\}/);
  assert.ok(rule, "missing .gallery li a img rule in main.css");
  assert.match(rule[0], /width:\s*auto/, "gallery img lost width:auto (Findings #1 regression)");
});
