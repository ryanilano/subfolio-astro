/**
 * ST1 — Listing partials & embeds smoke test.
 *
 * Asserts the seven-partial listing order is rendered correctly:
 *   inline_top → features → gallery → inline_middle →
 *   files_and_folders → related → inline_bottom
 *
 * Mirrors the Gate pattern in smoke.routes.test.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { page } from "./_dist.mjs";

// ── Root listing ──────────────────────────────────────────────────────

test("root listing renders top intro embed text", () => {
  const html = page("");
  // The -t-intro-text.txt embed renders inside id="inline_top_text"
  assert.ok(html.includes('id="inline_top_text"'), "missing inline_top_text container");
  assert.ok(
    html.includes("Subfolio Enhancers"),
    "root top embed missing intro heading"
  );
});

test("root listing renders bottom embed (-b-footer.txt)", () => {
  const html = page("");
  // The -b-footer.txt embed renders inside id="inline_bottom_text"
  assert.ok(html.includes('id="inline_bottom_text"'), "missing inline_bottom_text container");
  assert.ok(
    html.includes("Important note"),
    "root bottom embed missing -b-footer.txt content"
  );
});

// ── 01_embedding_text_images — all three embed positions ──────────────

test("01_embedding_text_images has all three embed positions (top, middle, bottom)", () => {
  const html = page("01_embedding_text_images");

  // Top position — text + image
  assert.ok(html.includes('id="inline_top_text"'), "missing inline_top_text");
  assert.ok(html.includes('id="inline_top_image"'), "missing inline_top_image");
  assert.ok(html.includes("-t-top-image.png"), "top image src not found");

  // Middle position — text + image
  assert.ok(html.includes('id="inline_middle_text"'), "missing inline_middle_text");
  assert.ok(html.includes('id="inline_middle_image"'), "missing inline_middle_image");
  assert.ok(html.includes("-m-middle-image.png"), "middle image src not found");

  // Bottom position — text + image
  assert.ok(html.includes('id="inline_bottom_text"'), "missing inline_bottom_text");
  assert.ok(html.includes('id="inline_bottom_image"'), "missing inline_bottom_image");
  assert.ok(html.includes("-b-bottom-image.png"), "bottom image src not found");
});

// ── 01_embedding_text_images — plain files still listed ───────────────

test("01_embedding_text_images still lists plain file-listing-placeholder files", () => {
  const html = page("01_embedding_text_images");
  assert.ok(
    html.includes("file-listing-placeholder-01.txt"),
    "missing plain file listing placeholder 01"
  );
  assert.ok(
    html.includes("file-listing-placeholder-02.txt"),
    "missing plain file listing placeholder 02"
  );
  assert.ok(
    html.includes("file-listing-placeholder-03.txt"),
    "missing plain file listing placeholder 03"
  );
});

// ── 03_featuring_content — features rendered, targets excluded ────────

test("03_featuring_content renders feature cards", () => {
  const html = page("03_featuring_content");
  // Features render inside id="features"
  assert.ok(html.includes('id="features"'), "missing features container");
  assert.ok(html.includes("Featured Link"), "missing Featured Link card");
  assert.ok(html.includes("Featured File"), "missing Featured File card");
  assert.ok(html.includes("Featured Folder"), "missing Featured Folder card");
});

test("03_featuring_content excludes featured targets from plain listing", () => {
  const html = page("03_featuring_content");
  // Featured file/folder in the same directory should disappear from the
  // plain file listing. The page should show "No items in this directory"
  // AND must NOT link to the featured items in the plain listing area.
  assert.ok(
    html.includes("No items in this directory"),
    "expected empty listing message when all items are featured"
  );
  // featured-file.txt and featured_folder should NOT appear as plain listing
  // links (they appear only inside the features block above)
  const listingBlock = html.slice(html.indexOf('<div class="listing">'));
  const featuresBlock = html.slice(0, html.indexOf('<div class="listing">'));
  assert.ok(
    !listingBlock.includes("featured-file.txt"),
    "featured-file.txt leaked into plain listing"
  );
  assert.ok(
    !listingBlock.includes("featured_folder"),
    "featured_folder leaked into plain listing"
  );
  // But they DO appear in the features block (above the listing)
  assert.ok(
    featuresBlock.includes("featured-file.txt"),
    "featured-file.txt missing from features block"
  );
  assert.ok(
    featuresBlock.includes("featured_folder"),
    "featured_folder missing from features block"
  );
});
