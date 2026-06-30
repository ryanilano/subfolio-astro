/**
 * A11y gate — axe-core run against the built static site (the real contract).
 *
 * Serves dist/ over a tiny static HTTP server (so absolute /css/main.css and
 * /js/main.js resolve — axe needs real rendered CSS for contrast/visibility
 * rules; file:// would not work), drives each representative route in headless
 * Chromium, and asserts zero WCAG 2.0/2.1 A+AA violations.
 *
 * Prereq: a fresh build. Run via `npm run test:a11y` (build → this), or:
 *   npm run build && node --test tests/a11y.axe.test.mjs
 *
 * Complements the pure-node palette check in a11y.contrast.test.mjs.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

const DIST = resolve(fileURLToPath(new URL("../dist", import.meta.url)));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".xml": "application/xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** Resolve a request path to an on-disk file under dist/ (dir → index.html). */
function resolveFile(urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  let abs = join(DIST, rel);
  if (rel === "" || (existsSync(abs) && statSync(abs).isDirectory())) {
    abs = join(abs, "index.html");
  } else if (!existsSync(abs) && existsSync(join(DIST, rel, "index.html"))) {
    abs = join(DIST, rel, "index.html");
  }
  return abs;
}

let server;
let baseUrl;
let browser;
let context;

before(async () => {
  assert.ok(
    existsSync(join(DIST, "index.html")),
    "dist/ not built — run `npm run build` first (or use `npm run test:a11y`)",
  );
  server = createServer(async (req, res) => {
    try {
      const file = resolveFile(req.url);
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  context = await browser.newContext();
});

after(async () => {
  await context?.close();
  await browser?.close();
  await new Promise((r) => server.close(r));
});

// Representative route per route-kind (listing / embeds / gallery / file detail
// / .site / .oplx / .rss). Mirrors the set proven in smoke.routes.test.mjs.
const ROUTES = [
  "",
  "01_embedding_text_images",
  "00_thumbnails",
  "03_featuring_content",
  "markdown_cheat_sheet.txt",
  "04_html_prototype/04_html_prototype.site",
  "08_project_plan.oplx",
  "05 display rss feed",
];

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const route of ROUTES) {
  test(`no WCAG A/AA violations: "${route || "/"}"`, async () => {
    const page = await context.newPage();
    try {
      const url = `${baseUrl}/${route.split("/").map(encodeURIComponent).join("/")}`;
      const resp = await page.goto(url, { waitUntil: "networkidle" });
      assert.ok(resp?.ok(), `failed to load ${url} (status ${resp?.status()})`);

      const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

      const summary = violations
        .map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))\n` +
          v.nodes.slice(0, 3).map((n) => `      ${n.target.join(" ")}`).join("\n"))
        .join("\n");
      assert.equal(
        violations.length,
        0,
        `${violations.length} axe violation(s) on "${route || "/"}":\n${summary}`,
      );
    } finally {
      await page.close();
    }
  });
}
