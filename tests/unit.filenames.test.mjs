/**
 * Filenames with "%", "#", "?" and a literal "%20" — a real build, no network.
 *
 * Regression test for audit finding F4 (2026-11-15): one file named
 * `50% off.txt` failed every build, `a%20b.txt` published the bytes of
 * `a b.txt`, and `c#d.txt` published a "Not found" stub. Builds a throwaway
 * content folder into a temp output dir (the example content is untouched),
 * then checks each raw file and detail page holds its own bytes under its real
 * name, and that the sitemap encodes each name once.
 *
 * Run:  node --test tests/unit.filenames.test.mjs   (also part of `npm run test`)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { toParam, fromParam } from "../src/lib/routeParam.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FILES = {
  "50% off.txt": "CANARY_PCT",
  "a b.txt": "CANARY_SPACE",
  "a%20b.txt": "CANARY_LITERAL_PCT20",
  "c#d.txt": "CANARY_HASH",
  "q?x.txt": "CANARY_QUESTION",
};
let tmp;
let out;

before(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "subfolio-names-")));
  const content = join(tmp, "content");
  mkdirSync(join(content, "50% folder"), { recursive: true });
  for (const [name, body] of Object.entries(FILES)) writeFileSync(join(content, name), body);
  writeFileSync(join(content, "50% folder", "inner #1.txt"), "CANARY_NESTED");
  out = join(tmp, "dist");
  execFileSync(process.execPath, [join(ROOT, "node_modules/astro/bin/astro.mjs"), "build", "--outDir", out], {
    cwd: ROOT,
    env: {
      ...process.env,
      ASTRO_TELEMETRY_DISABLED: "1",
      SUBFOLIO_CONTENT_DIR: content,
      SUBFOLIO_THUMB_CACHE: join(tmp, "thumb"),
      SUBFOLIO_OPLX_CACHE: join(tmp, "oplx"),
      SUBFOLIO_EMBED_CACHE: join(tmp, "embed"),
      SUBFOLIO_RSS_CACHE: join(tmp, "rss"),
    },
    stdio: "pipe",
    timeout: 240_000,
  });
});

after(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test("each raw file is published under its real name with its own bytes", () => {
  for (const [name, body] of Object.entries(FILES)) {
    const p = join(out, "directory", name);
    assert.ok(existsSync(p), `missing dist/directory/${name}`);
    assert.equal(readFileSync(p, "utf8"), body, name);
  }
  assert.equal(readFileSync(join(out, "directory", "50% folder", "inner #1.txt"), "utf8"), "CANARY_NESTED");
});

test("each detail page sits at its real name and shows its own file", () => {
  for (const [name, body] of Object.entries(FILES)) {
    const p = join(out, name, "index.html");
    assert.ok(existsSync(p), `missing dist/${name}/index.html`);
    assert.match(readFileSync(p, "utf8"), new RegExp(body), name);
  }
  assert.ok(existsSync(join(out, "50% folder", "index.html")), "folder with % in its name");
});

test("no routing stand-in characters reach dist (names, HTML, sitemap)", () => {
  const leak = /[]|%EE%80%A[35]|%EE%80%BF/i;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      assert.ok(!leak.test(e.name), `stand-in in a dist name: ${p}`);
      if (e.isDirectory()) walk(p);
      else if (/\.(html|xml)$/.test(e.name)) assert.ok(!leak.test(readFileSync(p, "utf8")), `stand-in in ${p}`);
    }
  };
  walk(out);
});

test("canonical and og:url on each detail page name the real file", () => {
  for (const name of Object.keys(FILES)) {
    const html = readFileSync(join(out, name, "index.html"), "utf8");
    const want = `https://subfolio-astro.ilano.fyi/${encodeURIComponent(name)}/`;
    assert.ok(html.includes(`<link rel="canonical" href="${want}"`), `canonical for ${name}`);
    assert.ok(html.includes(`property="og:url" content="${want}"`), `og:url for ${name}`);
  }
});

test("toParam round-trips and refuses a name that already holds a stand-in", () => {
  for (const name of [...Object.keys(FILES), "50% folder/inner #1.txt", "plain/name.txt"]) {
    assert.equal(fromParam(toParam(name)), name);
    assert.ok(!/[%#?]/.test(toParam(name)), `no %, # or ? left in ${toParam(name)}`);
  }
  assert.throws(() => toParam("cd.txt"), /private-use character/);
});

test("listing links and sitemap encode each name exactly once", () => {
  const html = readFileSync(join(out, "index.html"), "utf8");
  const sitemap = readFileSync(join(out, "sitemap-0.xml"), "utf8");
  for (const name of Object.keys(FILES)) {
    const enc = encodeURIComponent(name);
    assert.ok(html.includes(`href="/${enc}"`), `listing link for ${name} (expected /${enc})`);
    assert.ok(sitemap.includes(`/${enc}/</loc>`), `sitemap entry for ${name}`);
  }
});
