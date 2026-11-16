/**
 * SVG and WebP as images — unit tests, no site build needed.
 *
 * Covers the kind table (config/filekinds.yml), the shared thumbnail name rule
 * (src/lib/thumbName.ts), position embeds, image dimensions, and a real run of
 * scripts/gen-thumbs.mjs against a throwaway content folder in the OS temp dir.
 * The fixture images are generated here, so the repo carries no binaries.
 *
 * Run:  node --test tests/unit.svg-webp.test.mjs   (also part of `npm run test`)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { loadFileKinds, kindByFile } from "../src/loaders/filekinds.ts";
import { collectEmbeds } from "../src/loaders/embeds.ts";
import { autoThumbName } from "../src/lib/thumbName.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const kinds = loadFileKinds(join(ROOT, "config/filekinds.yml"));

// An 800×600 SVG that also carries a <script> and an onload handler. Rasterizing
// must never execute or re-serve them; the thumbnail is pixels only.
const BOARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" onload="alert(1)">
  <script>alert(2)</script>
  <rect width="800" height="600" fill="#0a7"/>
</svg>`;
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/></svg>`;

let content;
let cache;

before(async () => {
  content = mkdtempSync(join(tmpdir(), "sf-svgwebp-content-"));
  cache = mkdtempSync(join(tmpdir(), "sf-svgwebp-cache-"));
  writeFileSync(join(content, "board.svg"), BOARD_SVG);
  writeFileSync(join(content, "icon.svg"), ICON_SVG);
  await sharp({ create: { width: 800, height: 600, channels: 3, background: "#c33" } })
    .webp()
    .toFile(join(content, "photo.webp"));
});

after(() => {
  rmSync(content, { recursive: true, force: true });
  rmSync(cache, { recursive: true, force: true });
});

const isPng = (abs) =>
  readFileSync(abs).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

// --- Kind table -----------------------------------------------------------------

test("svg and webp are image files, any letter case", () => {
  for (const name of ["a.svg", "b.webp", "C.SVG", "D.WebP"]) {
    assert.equal(kindByFile(name, kinds)?.kind, "img", name);
  }
});

test("the existing image kinds are unchanged", () => {
  for (const name of ["a.gif", "b.png", "c.jpg"]) assert.equal(kindByFile(name, kinds)?.kind, "img", name);
  assert.equal(kindByFile("d.tiff", kinds)?.kind, "tiff");
  assert.equal(kindByFile("e.eps", kinds)?.kind, "eps");
});

// --- Thumbnail name rule ----------------------------------------------------------

test("SVG and WebP sources get a PNG base thumbnail; others keep their name", () => {
  assert.equal(autoThumbName("logo.svg"), "logo.svg.png");
  assert.equal(autoThumbName("photo.webp"), "photo.webp.png");
  assert.equal(autoThumbName("LOGO.SVG"), "LOGO.SVG.png");
  assert.equal(autoThumbName("photo.jpg"), "photo.jpg");
  assert.equal(autoThumbName("anim.gif"), "anim.gif");
  assert.equal(autoThumbName("README"), "README");
});

// --- Position embeds ----------------------------------------------------------------

test("a -t- SVG embed is an image, never read as text and inlined", () => {
  const out = collectEmbeds([{ name: "-t-logo.svg", relPath: "-t-logo.svg" }], {
    contentRoot: content,
    kinds,
    renderer: "markdown",
  });
  assert.equal(out.top.length, 1);
  assert.equal(out.top[0].type, "img");
  assert.equal(out.top[0].src, "-t-logo.svg");
  assert.equal("rawText" in out.top[0], false, "SVG markup must not reach the text renderer");
});

test("a -m- WebP embed is an image", () => {
  const out = collectEmbeds([{ name: "-m-photo.webp", relPath: "-m-photo.webp" }], {
    contentRoot: content,
    kinds,
    renderer: "markdown",
  });
  assert.equal(out.middle[0]?.type, "img");
});

// --- Dimensions ------------------------------------------------------------------------

test("image dimensions are read from SVG and WebP", async () => {
  process.env.SUBFOLIO_CONTENT_DIR = content;
  const { imageMetaFor } = await import("../src/lib/imageMeta.ts");
  assert.deepEqual(
    { ...(await imageMetaFor("board.svg")) },
    { width: 800, height: 600, isRetina: false, hasShadow: false, hasBrowser: false },
  );
  const webp = await imageMetaFor("photo.webp");
  assert.equal(webp.width, 800);
  assert.equal(webp.height, 600);
  // viewBox-only SVG: dimensions come from the viewBox.
  const icon = await imageMetaFor("icon.svg");
  assert.equal(icon.width, 64);
  assert.equal(icon.height, 64);
});

// --- Thumbnail generation (scripts/gen-thumbs.mjs) -------------------------------------

test("gen-thumbs writes PNG base + WebP/AVIF thumbnails for SVG and WebP", () => {
  execFileSync(process.execPath, ["scripts/gen-thumbs.mjs"], {
    cwd: ROOT,
    env: { ...process.env, SUBFOLIO_CONTENT_DIR: content, SUBFOLIO_THUMB_CACHE: cache },
    stdio: "pipe",
  });
  const thumbs = join(cache, "-thumbnails");

  for (const name of ["board.svg.png", "photo.webp.png"]) {
    const abs = join(thumbs, name);
    assert.ok(existsSync(abs), `${name} missing`);
    assert.ok(isPng(abs), `${name} is not a PNG`);
    assert.ok(existsSync(`${abs}.webp`), `${name}.webp missing`);
    assert.ok(existsSync(`${abs}.avif`), `${name}.avif missing`);
  }
  // Same sizing rule as every other image: 480px tall (2× the 240px display).
  return Promise.all([
    sharp(join(thumbs, "board.svg.png")).metadata().then((m) => assert.equal(m.height, 480)),
    sharp(join(thumbs, "photo.webp.png")).metadata().then((m) => assert.equal(m.height, 480)),
  ]);
});

test("gen-thumbs: no thumbnail for an SVG already at thumbnail size, and no SVG copied", () => {
  const names = readdirSync(join(cache, "-thumbnails"));
  assert.ok(!names.some((n) => n.startsWith("icon.svg")), "64px icon needs no thumbnail");
  assert.ok(!names.some((n) => n.endsWith(".svg")), "a thumbnail must never be SVG markup");
  for (const n of names) {
    assert.doesNotMatch(readFileSync(join(cache, "-thumbnails", n)).toString("latin1"), /<script/i, n);
  }
});

test("gen-thumbs never writes into the content folder", () => {
  assert.deepEqual(readdirSync(content).sort(), ["board.svg", "icon.svg", "photo.webp"]);
});
