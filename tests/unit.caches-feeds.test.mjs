/**
 * Build caches and feed links — unit tests, no site build needed.
 *
 * Regression tests for audit findings F5 and F3 (2026-11-15):
 *  - F5: a deleted image's thumbnails, a deleted embed's WebP ladder and a
 *    deleted .oplx folder's zip stayed in the caches, and the raw-file route
 *    kept publishing them. Each gen-* script now sweeps what the current content
 *    would not produce, and each default cache is keyed by its content root.
 *  - F3: a feed item's `javascript:` link reached an href. Only absolute
 *    http(s) links survive, both when gen-rss writes and when the cache is read.
 *
 * Run:  node --test tests/unit.caches-feeds.test.mjs   (also part of `npm run test`)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync, utimesSync, renameSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { cacheRoot, contentKey, sweepCache, canSweep } from "../src/lib/cachePaths.ts";
import { webLink } from "../src/lib/rssFeed.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
let tmp;
let content;
let caches;

const envFor = (over = {}) => ({
  ...process.env,
  SUBFOLIO_CONTENT_DIR: content,
  SUBFOLIO_THUMB_CACHE: join(caches, "thumb"),
  SUBFOLIO_EMBED_CACHE: join(caches, "embed"),
  SUBFOLIO_OPLX_CACHE: join(caches, "oplx"),
  ...over,
});
const run = (script, over) =>
  execFileSync(process.execPath, [join(ROOT, "scripts", script)], {
    cwd: ROOT,
    env: envFor(over),
    encoding: "utf8",
    timeout: 60_000,
  });
const solid = (width, height) =>
  sharp({ create: { width, height, channels: 3, background: "#369" } }).png().toBuffer();

before(async () => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "subfolio-caches-")));
  content = join(tmp, "content");
  caches = join(tmp, "caches");
  mkdirSync(join(content, "gal"), { recursive: true });
  mkdirSync(join(content, "plan.oplx"));
  writeFileSync(join(content, "plan.oplx", "Actual.xml"), "<x/>");
  mkdirSync(join(content, "keep.oplx"));
  writeFileSync(join(content, "keep.oplx", "Actual.xml"), "<y/>");
  mkdirSync(join(content, "gal", "-thumbnails-custom"), { recursive: true });
  const png = await solid(800, 600);
  writeFileSync(join(content, "gal", "keep.png"), png);
  writeFileSync(join(content, "gal", "gone.png"), png);
  writeFileSync(join(content, "gal", "shrinks.png"), png);
  writeFileSync(join(content, "gal", "-t-banner.png"), await solid(1200, 400));
  writeFileSync(join(content, "gal", "-t-gone.png"), png);
  writeFileSync(join(content, "gal", "-thumbnails-custom", "cover.png"), await solid(1200, 900));
});

after(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test("gen-* sweep: deleted sources lose their cached artifacts, kept ones stay", async () => {
  for (const s of ["gen-thumbs.mjs", "gen-embeds.mjs", "gen-oplx.mjs"]) run(s);
  const thumb = (n) => join(caches, "thumb", "gal", "-thumbnails", n);
  const embed = (n) => join(caches, "embed", "gal", n);
  const zip = join(caches, "oplx", "plan.oplx.zip");
  for (const p of [thumb("gone.png"), thumb("gone.png.webp"), thumb("keep.png.avif"), embed("-t-gone.png.webp"), embed("-t-banner.png.768w.avif"), zip]) {
    assert.ok(existsSync(p), `expected after first run: ${p}`);
  }

  const custom = (n) => join(caches, "thumb", "gal", "-thumbnails-custom", n);
  for (const p of [embed("-t-banner.png.1024w.webp"), thumb("shrinks.png"), custom("cover.png.1024w.avif")]) {
    assert.ok(existsSync(p), `expected after first run: ${p}`);
  }

  rmSync(join(content, "gal", "gone.png"));
  rmSync(join(content, "gal", "-t-gone.png"));
  rmSync(join(content, "plan.oplx"), { recursive: true });
  // Replaced sources (newer mtime): a narrower banner and custom thumbnail, and
  // an image now too small to need a thumbnail at all.
  const later = new Date(Date.now() + 5000);
  const replace = async (rel, buf) => {
    writeFileSync(join(content, rel), buf);
    utimesSync(join(content, rel), later, later);
  };
  await replace("gal/-t-banner.png", await solid(600, 200));
  await replace("gal/-thumbnails-custom/cover.png", await solid(500, 375));
  await replace("gal/shrinks.png", await solid(300, 200));
  const out = ["gen-thumbs.mjs", "gen-embeds.mjs", "gen-oplx.mjs"].map((s) => run(s)).join("\n");

  for (const p of [thumb("gone.png"), thumb("gone.png.webp"), thumb("gone.png.avif"), embed("-t-gone.png.webp"), embed("-t-gone.png.480w.webp"), zip, join(caches, "oplx", ".plan.oplx.zip.strip"),
    embed("-t-banner.png.768w.webp"), embed("-t-banner.png.1024w.avif"), custom("cover.png.640w.webp"), custom("cover.png.1024w.avif"),
    thumb("shrinks.png"), thumb("shrinks.png.webp")]) {
    assert.ok(!existsSync(p), `orphan or stale rung survived: ${p}`);
  }
  for (const p of [thumb("keep.png"), thumb("keep.png.webp"), thumb("keep.png.avif"), embed("-t-banner.png.webp"), embed("-t-banner.png.480w.avif"),
    custom("cover.png.320w.webp"), join(caches, "oplx", "keep.oplx.zip"), join(caches, "oplx", ".keep.oplx.zip.strip")]) {
    assert.ok(existsSync(p), `kept artifact removed: ${p}`);
  }
  assert.match(out, /orphan\(s\) removed/);
});

test("no sweep when a cache folder overlaps the content root or another cache", () => {
  writeFileSync(join(content, "gal", "notes.txt"), "CANARY_CONTENT");
  // Cache = content root (in-tree thumbnails, as PHP Subfolio did).
  run("gen-thumbs.mjs", { SUBFOLIO_THUMB_CACHE: content });
  assert.ok(existsSync(join(content, "gal", "notes.txt")), "content file deleted by the sweep");
  assert.ok(existsSync(join(content, "gal", "keep.png")), "source image deleted by the sweep");
  // All three caches in one folder.
  const shared = join(tmp, "shared");
  const over = { SUBFOLIO_THUMB_CACHE: shared, SUBFOLIO_EMBED_CACHE: shared, SUBFOLIO_OPLX_CACHE: shared };
  for (const s of ["gen-thumbs.mjs", "gen-embeds.mjs", "gen-oplx.mjs"]) run(s, over);
  assert.ok(existsSync(join(shared, "gal", "-thumbnails", "keep.png")), "thumbnails deleted by another generator's sweep");
  assert.ok(existsSync(join(shared, "gal", "-t-banner.png.webp")), "embeds deleted by another generator's sweep");
  const saved = { ...process.env };
  try {
    Object.assign(process.env, over);
    for (const k of ["thumb", "embed", "oplx"]) assert.equal(canSweep(k, content), false, k);
  } finally {
    for (const k of Object.keys(over)) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  }
});

test("sweep is skipped when the content root is missing (a typo can't wipe a cache)", () => {
  const keep = [join(caches, "thumb", "gal", "-thumbnails", "keep.png"), join(caches, "embed", "gal", "-t-banner.png.webp"), join(caches, "oplx", "keep.oplx.zip")];
  for (const p of keep) assert.ok(existsSync(p), p);
  for (const s of ["gen-thumbs.mjs", "gen-embeds.mjs", "gen-oplx.mjs"]) run(s, { SUBFOLIO_CONTENT_DIR: join(tmp, "no-such-dir") });
  for (const p of keep) assert.ok(existsSync(p), `cache wiped by a run against a missing content root: ${p}`);
});

test("sweepCache removes only what keep() rejects, then empty folders", () => {
  const root = join(tmp, "sweep");
  mkdirSync(join(root, "a", "b"), { recursive: true });
  writeFileSync(join(root, "a", "keep.txt"), "k");
  writeFileSync(join(root, "a", "b", "drop.txt"), "d");
  assert.equal(sweepCache(root, (rel) => rel === "a/keep.txt"), 1);
  assert.ok(existsSync(join(root, "a", "keep.txt")));
  assert.ok(!existsSync(join(root, "a", "b")), "empty folder left behind");
  assert.equal(sweepCache(join(tmp, "missing"), () => false), 0);
});

test("default caches are keyed by content root; an explicit env path is used as given", () => {
  const saved = process.env.SUBFOLIO_THUMB_CACHE;
  try {
    delete process.env.SUBFOLIO_THUMB_CACHE;
    const a = cacheRoot("thumb", content);
    const b = cacheRoot("thumb", join(ROOT, "content/examples"));
    assert.notEqual(a, b, "two content roots must not share a cache");
    assert.equal(a, join(resolve(".thumb-cache"), contentKey(content)));
    assert.equal(contentKey(content), createHash("sha1").update(realpathSync(content)).digest("hex").slice(0, 12));
    process.env.SUBFOLIO_THUMB_CACHE = join(tmp, "explicit");
    assert.equal(cacheRoot("thumb", content), join(tmp, "explicit"));
  } finally {
    if (saved === undefined) delete process.env.SUBFOLIO_THUMB_CACHE;
    else process.env.SUBFOLIO_THUMB_CACHE = saved;
  }
});

test("webLink keeps only absolute http(s) links", () => {
  assert.equal(webLink("https://example.com/a?b=c#d"), "https://example.com/a?b=c#d");
  assert.equal(webLink("http://example.com"), "http://example.com/");
  assert.equal(webLink("  https://example.com/x  "), "https://example.com/x");
  for (const bad of ["javascript:alert(document.domain)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)", "/relative/path", "//example.com/x", "mailto:a@b.c", "https:example.com", "https:/evil.com", "ht\ntps://a.b", "\u0001https://a.b/",
    "", null, undefined, 42, {}]) {
    assert.equal(webLink(bad), "", String(bad));
  }
});

test("rssItemsFor cleans links in a cache written before the fix", async () => {
  const rss = join(tmp, "rss");
  mkdirSync(rss, { recursive: true });
  const feedurl = "https://feed.invalid/x.xml";
  const hash = createHash("sha1").update(feedurl).digest("hex");
  writeFileSync(join(rss, `${hash}.json`), JSON.stringify({
    feedurl,
    fetchedAt: Date.now(),
    items: [
      { title: "bad", description: "d", link: "javascript:alert(document.domain)" },
      { title: "good", description: "d", link: "https://example.com/post" },
    ],
  }));
  process.env.SUBFOLIO_RSS_CACHE = rss;
  const { rssItemsFor } = await import(`../src/lib/rssFeed.ts?fresh=${Date.now()}`);
  const items = rssItemsFor(feedurl);
  assert.deepEqual(items.map((i) => i.link), ["", "https://example.com/post"]);
});

test("a case-only rename renames its artifacts to the new case on a case-insensitive disk", async (t) => {
  const { caseInsensitive } = await import("../src/lib/cachePaths.ts");
  if (!caseInsensitive(tmp)) return t.skip("case-sensitive disk");
  renameSync(join(content, "gal", "keep.png"), join(content, "gal", "Keep.png"));
  run("gen-thumbs.mjs");
  // existsSync ignores case here, so compare the names actually on disk.
  const names = readdirSync(join(caches, "thumb", "gal", "-thumbnails"));
  for (const n of ["Keep.png", "Keep.png.webp", "Keep.png.avif"]) assert.ok(names.includes(n), `missing ${n}: ${names.join(", ")}`);
  assert.ok(!names.some((n) => n.startsWith("keep.png")), `old-case name kept: ${names.join(", ")}`);
});

test("an explicit cache folder that already holds other files is never swept", () => {
  const foreign = join(tmp, "foreign");
  mkdirSync(join(foreign, "project"), { recursive: true });
  writeFileSync(join(foreign, "notes.txt"), "important");
  writeFileSync(join(foreign, "project", "main.c"), "x");
  for (const s of ["gen-thumbs.mjs", "gen-embeds.mjs", "gen-oplx.mjs"]) {
    const key = { "gen-thumbs.mjs": "SUBFOLIO_THUMB_CACHE", "gen-embeds.mjs": "SUBFOLIO_EMBED_CACHE", "gen-oplx.mjs": "SUBFOLIO_OPLX_CACHE" }[s];
    // Refusing is right, but it must not be silent: each script warns on stderr.
    const r = spawnSync(process.execPath, [join(ROOT, "scripts", s)], { cwd: ROOT, env: envFor({ [key]: foreign }), encoding: "utf8", timeout: 60_000 });
    assert.ifError(r.error); // a spawn failure or timeout names its cause
    assert.equal(r.status, 0, r.stderr);
    const name = s.replace(/\.mjs$/, "");
    assert.match(r.stderr, new RegExp(`\\[${name}\\].*not swept`), `${s} refused the folder without a warning`);
    assert.equal(readFileSync(join(foreign, "notes.txt"), "utf8"), "important", `${s} swept a foreign folder`);
    assert.ok(existsSync(join(foreign, "project", "main.c")), `${s} swept a foreign folder`);
  }
  assert.ok(!readdirSync(foreign).some((n) => n.startsWith(".subfolio-cache-")), "foreign folder was claimed");
});

test("a source that fails to decode keeps its previous outputs", () => {
  const thumbDir = join(caches, "thumb", "gal", "-thumbnails");
  const before = readdirSync(thumbDir).filter((n) => /^keep\.png/i.test(n));
  assert.ok(before.length >= 3, `need keep.png thumbnails first: ${before}`);
  const src = readdirSync(join(content, "gal")).find((n) => /^keep\.png$/i.test(n));
  const later = new Date(Date.now() + 10_000);
  writeFileSync(join(content, "gal", src), "not an image");
  utimesSync(join(content, "gal", src), later, later);
  run("gen-thumbs.mjs");
  const after = readdirSync(thumbDir).filter((n) => /^keep\.png/i.test(n));
  assert.deepEqual(after.sort(), before.sort(), "a decode failure swept the previous thumbnails");
});

test("an empty content root (unmounted volume) sweeps nothing", () => {
  const empty = join(tmp, "empty-mount");
  mkdirSync(empty);
  const zip = join(caches, "oplx", "keep.oplx.zip");
  assert.ok(existsSync(zip));
  run("gen-oplx.mjs", { SUBFOLIO_CONTENT_DIR: empty });
  assert.ok(existsSync(zip), "cache swept against an empty content root");
});

test("a content root holding only unpublishable entries (.git, -access) sweeps nothing", () => {
  const dotOnly = join(tmp, "dot-only");
  mkdirSync(join(dotOnly, ".git"), { recursive: true });
  writeFileSync(join(dotOnly, "-access"), "users: [a]\n");
  const zip = join(caches, "oplx", "keep.oplx.zip");
  assert.ok(existsSync(zip));
  assert.equal(canSweep("oplx", dotOnly), false);
  run("gen-oplx.mjs", { SUBFOLIO_CONTENT_DIR: dotOnly });
  assert.ok(existsSync(zip), "cache swept against a root with only .git and -access");
});
