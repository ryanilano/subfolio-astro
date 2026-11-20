/**
 * Shared publication walker — unit tests, no site build needed.
 *
 * Covers src/lib/contentWalk.ts directly, the loader and the gen-* scripts that
 * now walk through it, against throwaway content folders in the OS temp dir:
 * dot folders and -access are never walked or published, symlinks only count
 * when they stay inside the content root, and a symlink cycle cannot hang a
 * walk. Regression tests for audit findings F1 and F2 (2026-11-15).
 *
 * Run:  node --test tests/unit.content-walk.test.mjs   (also part of `npm run test`)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ContentTree, isUnpublishable } from "../src/lib/contentWalk.ts";
import { subfolioLoader } from "../src/loaders/index.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
let tmp; // scratch dir holding content/, outside/ and caches
let content;

before(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "subfolio-walk-")));
  content = join(tmp, "content");
  const outside = join(tmp, "outside");
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "secret.txt"), "CANARY_OUTSIDE");
  mkdirSync(join(outside, "dir"), { recursive: true });
  writeFileSync(join(outside, "dir", "inner.txt"), "CANARY_OUTSIDE_DIR");

  mkdirSync(content, { recursive: true });
  writeFileSync(join(content, "visible.txt"), "CANARY_VISIBLE");
  // F1: a dot folder with a .txt and a ref-like path; a dot file.
  mkdirSync(join(content, ".git", "refs", "heads"), { recursive: true });
  writeFileSync(join(content, ".git", "notes.txt"), "CANARY_GIT_TXT");
  writeFileSync(join(content, ".git", "refs", "heads", "canary-branch"), "0");
  writeFileSync(join(content, ".env"), "CANARY_ENV");
  // -hidden stays walkable (Subfolio's own convention); -access never lists.
  mkdirSync(join(content, "-hidden-dir"));
  writeFileSync(join(content, "-hidden-dir", "inner.txt"), "CANARY_HIDDEN");
  mkdirSync(join(content, "locked"));
  writeFileSync(join(content, "locked", "-access"), "users:\n  allow: [alice]\n");
  writeFileSync(join(content, "locked", "page.txt"), "CANARY_LOCKED_PAGE");
  // F2: links out of the root (file and folder), a link into a dot folder,
  // a dangling link, and an in-root file link that is allowed.
  symlinkSync("../outside/secret.txt", join(content, "escape.txt"));
  symlinkSync("../outside/dir", join(content, "escdir"));
  symlinkSync(".git", join(content, "gitalias"));
  symlinkSync("nowhere.txt", join(content, "dangling.txt"));
  symlinkSync("visible.txt", join(content, "alias.txt"));
  // F2b: two self links make a cycle.
  mkdirSync(join(content, "loop"));
  writeFileSync(join(content, "loop", "f.txt"), "CANARY_LOOP");
  symlinkSync(".", join(content, "loop", "x"));
  symlinkSync(".", join(content, "loop", "y"));
  // F1 in zips: an .oplx folder holding a dot file and an escaping link.
  mkdirSync(join(content, "plan.oplx"));
  writeFileSync(join(content, "plan.oplx", "Actual.xml"), "<x/>");
  writeFileSync(join(content, "plan.oplx", ".secret"), "CANARY_OPLX_DOT");
  symlinkSync("../../outside/secret.txt", join(content, "plan.oplx", "leak.txt"));
  writeFileSync(join(content, "plan.oplx", "-access"), "users:\n  allow: [bob]\n");
  // In-root folder links are ordinary folders: both paths get walked.
  mkdirSync(join(content, "zeta"));
  writeFileSync(join(content, "zeta", "z.txt"), "CANARY_ZETA");
  symlinkSync("zeta", join(content, "a-alias"));
  symlinkSync("../zeta", join(content, "plan.oplx", "assets"));
  // A two-folder cycle: m1/to2 -> m2, m2/to1 -> m1.
  mkdirSync(join(content, "m1"));
  mkdirSync(join(content, "m2"));
  writeFileSync(join(content, "m1", "one.txt"), "1");
  symlinkSync("../m2", join(content, "m1", "to2"));
  symlinkSync("../m1", join(content, "m2", "to1"));
  // A folder's own .info sidecar that links out of the root.
  writeFileSync(join(tmp, "outside", "meta.info"), "title: CANARY_OUTSIDE_TITLE\n");
  symlinkSync("../outside/meta.info", join(content, "zeta.info"));
});

after(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test("isUnpublishable: dot names and -access only", () => {
  for (const n of [".git", ".env", ".DS_Store", "-access", "-access.txt", "-Access", "-ACCESS.TXT"]) assert.ok(isUnpublishable(n), n);
  for (const n of ["-hidden", "-t-banner.png", "a.txt", "-thumbnails", "access"]) assert.ok(!isUnpublishable(n), n);
});

test("list(): drops dot names, -access and links out of the root", () => {
  const tree = new ContentTree(content);
  const names = tree.list("").map((e) => e.name);
  assert.ok(names.includes("visible.txt"));
  assert.ok(names.includes("-hidden-dir"), "-hidden folders stay listed");
  assert.ok(names.includes("alias.txt"), "an in-root file link is allowed");
  for (const banned of [".git", ".env", "escape.txt", "escdir", "gitalias", "dangling.txt"]) {
    assert.ok(!names.includes(banned), `${banned} must not be listed`);
  }
  assert.deepEqual(tree.list("locked").map((e) => e.name), ["page.txt"]);
  assert.deepEqual(tree.list(".git"), [], "a dot folder lists as empty even when asked directly");
  assert.deepEqual(tree.list("escdir"), [], "a folder link out of the root lists as empty when asked directly");
  assert.ok(!tree.list("loop").some((e) => e.name === "x" || e.name === "y"), "self links are not listed as folders");
  assert.ok(tree.list("").some((e) => e.name === "a-alias" && e.isDir));
});

test("walkFiles(): a symlink cycle is walked once and ends", () => {
  const tree = new ContentTree(content);
  const files = tree.walkFiles();
  assert.equal(files.filter((f) => f.endsWith("f.txt")).length, 1, `one copy of loop/f.txt, got ${files.join(", ")}`);
  assert.ok(files.includes("zeta/z.txt") && files.includes("a-alias/z.txt"), "both paths to an in-root folder");
  assert.ok(files.includes("m1/one.txt") && files.includes("m2/to1/one.txt"), "a two-folder cycle walks each side once");
  assert.ok(!files.some((f) => f.split("/").length > 4), `no runaway depth: ${files.filter((f) => f.split("/").length > 4)}`);
  assert.ok(!files.some((f) => /CANARY|secret|notes|canary-branch|\.env/.test(f)));
  assert.ok(!files.some((f) => f.startsWith(".") || f.includes("/.")), "no dot paths");
  // A second walk on the same tree starts clean.
  assert.deepEqual(tree.walkFiles(), files);
});

test("resolveFile(): traversal, dot segments, -access and escaping links are refused", () => {
  const tree = new ContentTree(content);
  assert.ok(tree.resolveFile("visible.txt"));
  assert.ok(tree.resolveFile("alias.txt"));
  for (const bad of ["../outside/secret.txt", "escape.txt", "escdir/inner.txt", ".git/notes.txt",
    "gitalias/notes.txt", "locked/-access", "locked/-Access", "dangling.txt", "loop", "", "a//b"]) {
    assert.equal(tree.resolveFile(bad), null, bad);
  }
});

test("readMeta(): reads -access, null when missing or escaping", () => {
  const tree = new ContentTree(content);
  assert.match(tree.readMeta("locked/-access") ?? "", /alice/);
  assert.equal(tree.readMeta("-access"), null);
  assert.equal(tree.readMeta("escape.txt/-access"), null);
});

test("loader: no entry for dot folders, no escaping links, -access still parsed", async () => {
  const set = new Map();
  const store = { clear: () => set.clear(), set: ({ id, data }) => set.set(id, data) };
  const logger = { info() {}, warn() {}, error() {} };
  await subfolioLoader({ contentDir: content, filekindsPath: join(ROOT, "config/filekinds.yml"), renderer: "none" })
    .load({ store, logger });
  const ids = [...set.keys()];
  assert.ok(!ids.some((id) => id !== "." && (id.startsWith(".") || id.includes("/."))), `no dot entries: ${ids.join(", ")}`);
  assert.ok(!ids.includes("gitalias") && !ids.includes("escdir"), "no folder through a link that leaves or hides");
  assert.equal(ids.filter((id) => id.startsWith("loop")).length, 1, `loop entered once: ${ids.join(", ")}`);
  assert.ok(ids.includes("zeta") && ids.includes("a-alias"), "both paths to an in-root folder get a page");
  // Every folder a listing links to has its own entry (no dead folder links).
  for (const [id, data] of set) {
    for (const f of data.folders) assert.ok(set.has(f.path), `${id} lists ${f.path}, which has no entry`);
  }
  assert.notEqual(set.get("zeta").pageTitle, "CANARY_OUTSIDE_TITLE", "a folder .info linked out of the root is ignored");
  const rootFiles = set.get(".").files.map((f) => f.name);
  assert.ok(rootFiles.includes("visible.txt"));
  assert.ok(!rootFiles.includes("escape.txt") && !rootFiles.includes("dangling.txt"));
  assert.ok(set.get("locked").access, "-access rules still parsed");
  assert.equal(set.get(".").access, null, "no -access file → null");
});

test("gen-thumbs: finishes on a symlink cycle (was killed at the timeout)", () => {
  const out = execFileSync(process.execPath, [join(ROOT, "scripts/gen-thumbs.mjs")], {
    cwd: ROOT,
    env: { ...process.env, SUBFOLIO_CONTENT_DIR: content, SUBFOLIO_THUMB_CACHE: join(tmp, "thumb") },
    timeout: 30_000,
    encoding: "utf8",
  });
  assert.match(out, /\[gen-thumbs\]/);
});

test("gen-oplx: the zip carries no dot file and no escaping link target", () => {
  const cache = join(tmp, "oplx");
  execFileSync(process.execPath, [join(ROOT, "scripts/gen-oplx.mjs")], {
    cwd: ROOT,
    env: { ...process.env, SUBFOLIO_CONTENT_DIR: content, SUBFOLIO_OPLX_CACHE: cache },
    timeout: 30_000,
    encoding: "utf8",
  });
  const zip = join(cache, "plan.oplx.zip");
  assert.ok(existsSync(zip));
  // Entry names sit uncompressed in a zip's headers, so a byte search is exact.
  const bytes = readFileSync(zip).toString("latin1");
  assert.ok(bytes.includes("Actual.xml"));
  assert.ok(!bytes.includes(".secret"), "dot file zipped");
  assert.ok(!bytes.includes("leak.txt"), "escaping link zipped");
  assert.ok(!bytes.includes("-access"), "-access zipped");
  assert.ok(bytes.includes("assets/z.txt"), "an in-root linked subfolder is zipped with its files");
});
