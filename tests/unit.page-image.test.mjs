/**
 * Folder sidecar `image:` resolution (src/lib/pageImage.ts) — unit tests, no
 * site build needed. A throwaway content folder is made in the OS temp dir.
 *
 * Run:  node --test tests/unit.page-image.test.mjs   (also part of `npm run test`)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePageImage } from "../src/lib/pageImage.ts";

let root;
before(() => {
  root = mkdtempSync(join(tmpdir(), "page-image-"));
  mkdirSync(join(root, "work", "-images"), { recursive: true });
  mkdirSync(join(root, "work", ".stills"), { recursive: true });
  writeFileSync(join(root, "work", ".stills", "og.jpg"), "x");
  writeFileSync(join(root, "work", "hero.jpg"), "x");
  writeFileSync(join(root, "work", "-images", "og.jpg"), "x");
});
after(() => rmSync(root, { recursive: true, force: true }));

test("folder-relative name resolves inside the folder", () => {
  assert.deepEqual(resolvePageImage("hero.jpg", "work", root), { kind: "content", relPath: "work/hero.jpg" });
});
test("/directory/ URL form and root-relative form both resolve", () => {
  assert.deepEqual(resolvePageImage("/directory/work/-images/og.jpg", "other", root), { kind: "content", relPath: "work/-images/og.jpg" });
  assert.deepEqual(resolvePageImage("/work/hero.jpg", "other", root), { kind: "content", relPath: "work/hero.jpg" });
});
test("missing file, folder, traversal and empty values fall back (null)", () => {
  assert.equal(resolvePageImage("nope.jpg", "work", root), null);
  assert.equal(resolvePageImage("-images", "work", root), null);
  assert.equal(resolvePageImage("../work/hero.jpg", "work", root), null);
  assert.equal(resolvePageImage("", "work", root), null);
  assert.equal(resolvePageImage(undefined, "work", root), null);
});
test("valid http(s) URLs pass; malformed or other schemes don't, and nothing throws", () => {
  assert.deepEqual(resolvePageImage("https://example.com/og.png", "work", root), { kind: "url", url: "https://example.com/og.png" });
  assert.equal(resolvePageImage("http://", "work", root), null);
  assert.equal(resolvePageImage("javascript:alert(1)", "work", root), null);
  assert.equal(resolvePageImage("ftp://example.com/a.png", "work", root), null);
});

test("paths the raw route blocks (dot segments, -access) fall back even when the file exists", () => {
  assert.equal(resolvePageImage(".stills/og.jpg", "work", root), null);
  assert.equal(resolvePageImage("/directory/work/.stills/og.jpg", "x", root), null);
  assert.equal(resolvePageImage("-access/og.jpg", "work", root), null);
});
