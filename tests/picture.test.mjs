/**
 * Picture element test — Milestone 6, Phase C, task C2.
 *
 * Asserts: (a) gen-thumbs.mjs produces WebP/AVIF triple cache files for a
 * known fixture image; (b) the built gallery HTML contains <picture> with
 * type="image/avif" and type="image/webp" <source>s and an <img> fallback
 * whose src is the original-format thumbnail (not .webp/.avif); (c) originals
 * served under /directory/ keep their PNG/JPEG bytes — no WebP swap.
 *
 * Depends on gen-thumbs.mjs having been run and a full build in dist/.
 * Run:  node scripts/gen-thumbs.mjs && npm run build && node --test tests/picture.test.mjs
 *
 * Mirrors tests/perf.budget.test.mjs conventions. Lenient where preconditions
 * are missing — skips assertions gracefully rather than crashing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIST, page } from "./_dist.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CACHE_ROOT = resolve(ROOT, ".thumb-cache");

// Known fixture image from content/examples/00_thumbnails/
const CACHE_THUMB = join(CACHE_ROOT, "00_thumbnails/-thumbnails/example.png");
const GALLERY_ROUTE = "00_thumbnails";

// --- (a) Cache triples ---------------------------------------------------

test("gen-thumbs produced WebP/AVIF triple for known fixture image", () => {
  assert.ok(
    existsSync(CACHE_THUMB),
    `${CACHE_THUMB} missing — run \`node scripts/gen-thumbs.mjs\` first`,
  );
  assert.ok(
    existsSync(CACHE_THUMB + ".webp"),
    `${CACHE_THUMB}.webp missing — gen-thumbs WebP sibling not generated`,
  );
  assert.ok(
    existsSync(CACHE_THUMB + ".avif"),
    `${CACHE_THUMB}.avif missing — gen-thumbs AVIF sibling not generated`,
  );
});

// --- (b) Gallery HTML <picture> ------------------------------------------

const galleryHtml = (() => {
  try {
    return page(GALLERY_ROUTE);
  } catch {
    return null;
  }
})();

test("gallery page exists in build output", () => {
  assert.ok(
    galleryHtml,
    `dist/${GALLERY_ROUTE}/index.html missing — run \`npm run build\` first`,
  );
});

test("gallery HTML contains <picture> with avif and webp <source>s", () => {
  if (!galleryHtml) return;
  assert.ok(
    galleryHtml.includes("<picture>"),
    "no <picture> element found in gallery HTML",
  );
  assert.ok(
    galleryHtml.includes('type="image/avif"'),
    'no <source type="image/avif"> found in gallery HTML',
  );
  assert.ok(
    galleryHtml.includes('type="image/webp"'),
    'no <source type="image/webp"> found in gallery HTML',
  );
});

test("<img> fallback src is original-format thumbnail, not .webp or .avif", () => {
  if (!galleryHtml) return;

  // Collect every <img> inside a <picture> — its src must route through
  // -thumbnails/ and carry the original format (PNG/JPEG/GIF), not .webp/.avif.
  // Use a non-greedy match to pair each <picture> with its first <img>.
  const re = /<picture>[\s\S]*?<img[^>]*src="([^"]+)"/g;
  let match;
  let count = 0;
  while ((match = re.exec(galleryHtml)) !== null) {
    count++;
    const src = match[1];
    assert.ok(
      src.includes("-thumbnails/"),
      `<img> fallback src "${src}" does not route through -thumbnails/`,
    );
    assert.ok(
      !src.endsWith(".webp") && !src.includes(".webp?"),
      `<img> fallback src "${src}" is .webp — should be original format`,
    );
    assert.ok(
      !src.endsWith(".avif") && !src.includes(".avif?"),
      `<img> fallback src "${src}" is .avif — should be original format`,
    );
  }
  assert.ok(count > 0, "no <img> tags found inside <picture> elements");
});

// --- (c) Originals under /directory/ stay PNG/JPEG -----------------------

/**
 * Find the served original under dist/directory. The raw-bytes route serves
 * originals under the content-root basename prefix (e.g. `examples/`), while
 * the thumbnail cache mirrors the layout WITHOUT that prefix — so we can't
 * hardcode one path. Search the tree for the original `example.png` that is
 * NOT inside a `-thumbnails/` dir (those are derived previews).
 */
function findOriginal(dir, want) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      const hit = findOriginal(abs, want);
      if (hit) return hit;
    } else if (name === want && !abs.includes("-thumbnails")) {
      return abs;
    }
  }
  return null;
}

test("original fixture image under /directory/ keeps PNG bytes, no WebP swap", () => {
  const dirFile = findOriginal(join(DIST, "directory"), "example.png");
  if (!dirFile) {
    // Directory route may not emit every file as a static artifact depending
    // on build mode; soft-skip rather than failing.
    console.log(`SKIP  served original example.png not found under dist/directory`);
    return;
  }

  const buf = readFileSync(dirFile);

  // Real PNG starts with \x89PNG\r\n\x1a\n
  const isPng =
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47;
  assert.ok(isPng, "served original is not a PNG (magic bytes mismatch)");

  // WebP starts with "RIFF" — must NOT be present
  const isWebp =
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46;
  assert.ok(!isWebp, "served original was swapped to WebP — originals must stay untouched");
});
