/**
 * Smoke test — sitemap follows the listing rules (audit finding F6, 2026-11-15).
 *
 * A sitemap is a machine-readable listing, so nothing hidden from listings may
 * appear in it: no URL with a "-" or "." path segment (-hidden folders, dot
 * folders) and nothing at or under a folder that carries an `-access` file.
 * The pages themselves are still built; they are just not advertised.
 *
 * Run:  npm run build && npm run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { distFile, pageExists } from "./_dist.mjs";

const locs = () =>
  [...distFile("sitemap-0.xml").toString("utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (m) => new URL(m[1]).pathname,
  );

test("sitemap has no -hidden or dot segments", () => {
  const bad = locs().filter((p) => p.split("/").some((s) => /^(-|\.|%2D)/i.test(s)));
  assert.deepEqual(bad, [], `hidden URLs advertised: ${bad.join(", ")}`);
});

test("sitemap leaves out folders with an -access file", () => {
  const bad = locs().filter((p) => p.startsWith("/07_protecting_a_folder/"));
  assert.deepEqual(bad, []);
  // Still built: -access is captured, not enforced (Phase 4).
  assert.ok(pageExists("07_protecting_a_folder"));
});

test("sitemap still lists ordinary pages", () => {
  const all = locs();
  for (const p of ["/", "/00_thumbnails/", "/05%20display%20rss%20feed/", "/markdown_cheat_sheet.txt/"]) {
    assert.ok(all.includes(p), `missing ${p}`);
  }
});
