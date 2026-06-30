/**
 * Performance budget harness — Milestone 6, Phase A (the Measurement Gate).
 *
 * Walks the static build in dist/ AFTER `astro build` and reports the byte
 * weight that actually ships: per-page HTML (incl. the inline <style>/<script>
 * repeated on every page), the shared linked assets (CSS/JS) each page pulls,
 * total font bytes broken down by format, total image bytes, and the largest
 * single assets. Prints a table and writes dist/perf-budget.json.
 *
 * WARN-ONLY by the locked milestone decision (plans/zippy-coalescing-rainbow.md
 * "Budgets: measure, don't block"): soft ceilings are logged as `WARN` lines but
 * this script NEVER exits non-zero. It is a scoreboard, not a CI gate.
 *
 * The JSON it writes is the source of truth for every phase's results block —
 * deltas are read from it, not hand-tallied. Run:  npm run perf
 */
import {
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve, join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = resolve(ROOT, "dist");

// Soft ceilings (bytes). Over-budget logs a WARN line; it never fails the run.
// These are the Phase-A baseline rounded up — later phases drive the actuals
// down and we tighten these as wins land.
const BUDGETS = {
  htmlPageMax: 20 * 1024, // largest single built HTML page
  cssTotal: 96 * 1024, // main.css + icons.css combined
  fontsTotal: 620 * 1024, // every weight × every format under fonts/
  jsLinkedTotal: 240 * 1024, // main.js (jQuery + A17), linked
};

const KB = (n) => `${(n / 1024).toFixed(1)} KB`;

/** Recursively collect every file under `dir` as absolute paths.
 * Skips dot-entries (e.g. a `.git/` that rode along inside a served content
 * tree, or the perf-budget.json we just wrote): they aren't referenced by any
 * page, so counting them would pollute "largest assets" with non-payload noise. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".ico",
]);
const FONT_EXT = new Set([".woff2", ".woff", ".ttf", ".eot", ".otf"]);
// fonts/*.svg are SVG fonts, not images — classified by directory below.

/**
 * Classify a built HTML page by lightweight markup heuristics. We can't import
 * routing.ts here (it resolves loader entries, not built HTML), so this is a
 * documented best-effort bucket purely for reporting HTML/inline-asset weight
 * per page *type*. Linked assets are shared and reported globally, not per type.
 */
function classifyPage(html) {
  if (/http-equiv=["']refresh["']/i.test(html)) return "redirect";
  if (/id=["']gallery["']/.test(html)) return "listing";
  return "detail";
}

/** Sum the byte length of inline <script> (no src) / <style> blocks. */
function inlineBytes(html, tag) {
  const re = new RegExp(`<${tag}(?![^>]*\\bsrc=)[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  let total = 0;
  let m;
  while ((m = re.exec(html))) total += Buffer.byteLength(m[1], "utf8");
  return total;
}

function main() {
  if (!existsSync(DIST)) {
    console.error("[perf-budget] dist/ not found — run `npm run build` first.");
    return; // warn-only: never throw/exit non-zero
  }

  const files = walk(DIST);
  const sizeOf = (abs) => statSync(abs).size;
  const rel = (abs) => relative(DIST, abs);

  // --- pages: every built index.html (and any stray .html) -------------------
  const htmlFiles = files.filter((f) => f.endsWith(".html"));
  const pageTypes = {}; // type -> { count, htmlBytes, inlineJs, inlineCss }
  const linkedRefs = new Map(); // dist-relative asset path -> #pages referencing
  let htmlBytesTotal = 0;
  let largest = { route: "", bytes: 0 };

  for (const abs of htmlFiles) {
    const html = readFileSync(abs, "utf8");
    const bytes = Buffer.byteLength(html, "utf8");
    htmlBytesTotal += bytes;
    const route = "/" + rel(abs).replace(/index\.html$/, "").replace(/\/$/, "");
    if (bytes > largest.bytes) largest = { route: route || "/", bytes };

    const type = classifyPage(html);
    const t = (pageTypes[type] ??= {
      count: 0,
      htmlBytes: 0,
      inlineJs: 0,
      inlineCss: 0,
    });
    t.count++;
    t.htmlBytes += bytes;
    t.inlineJs += inlineBytes(html, "script");
    t.inlineCss += inlineBytes(html, "style");

    // Any /css/*.css or /js/*.js reference, however it's pulled in (real <link>,
    // <script src>, or the JS-injected icons.css). Dedup per page.
    const seen = new Set();
    for (const m of html.matchAll(/["'(](\/[\w\-./]+\.(?:css|js))(?:\?[^"')]*)?["')]/g)) {
      const p = m[1].replace(/^\//, "");
      if (seen.has(p)) continue;
      seen.add(p);
      linkedRefs.set(p, (linkedRefs.get(p) ?? 0) + 1);
    }
  }

  const pageCount = htmlFiles.length;
  for (const t of Object.values(pageTypes)) {
    t.htmlBytesAvg = Math.round(t.htmlBytes / t.count);
    t.inlineJsAvg = Math.round(t.inlineJs / t.count);
    t.inlineCssAvg = Math.round(t.inlineCss / t.count);
  }

  // --- linked shared assets (CSS/JS the pages pull) --------------------------
  const linkedAssets = [...linkedRefs.entries()]
    .map(([p, refs]) => {
      const abs = join(DIST, p);
      const bytes = existsSync(abs) ? sizeOf(abs) : 0;
      return { path: p, bytes, type: extname(p).slice(1), referencedByPages: refs };
    })
    .sort((a, b) => b.bytes - a.bytes);

  const cssTotal = linkedAssets
    .filter((a) => a.type === "css")
    .reduce((s, a) => s + a.bytes, 0);
  const jsLinkedTotal = linkedAssets
    .filter((a) => a.type === "js")
    .reduce((s, a) => s + a.bytes, 0);

  // --- fonts (by format) -----------------------------------------------------
  const fontFiles = files.filter(
    (f) => rel(f).startsWith("fonts/") || FONT_EXT.has(extname(f).toLowerCase()),
  );
  const fontByFormat = {};
  let fontsTotal = 0;
  for (const abs of fontFiles) {
    const fmt = extname(abs).slice(1).toLowerCase();
    const b = sizeOf(abs);
    fontsTotal += b;
    fontByFormat[fmt] = (fontByFormat[fmt] ?? 0) + b;
  }

  // --- images ----------------------------------------------------------------
  // fonts/*.svg are SVG fonts (counted above), not images — exclude that dir.
  const imageFiles = files.filter(
    (f) =>
      IMAGE_EXT.has(extname(f).toLowerCase()) && !rel(f).startsWith("fonts/"),
  );
  const imageByExt = {};
  let imagesTotal = 0;
  for (const abs of imageFiles) {
    const ext = extname(abs).slice(1).toLowerCase();
    const b = sizeOf(abs);
    imagesTotal += b;
    imageByExt[ext] = (imageByExt[ext] ?? 0) + b;
  }

  // --- largest single assets overall (non-HTML) ------------------------------
  const largestAssets = files
    .filter((f) => !f.endsWith(".html"))
    .map((f) => ({ path: rel(f), bytes: sizeOf(f) }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);

  // --- soft budgets ----------------------------------------------------------
  const budgets = [
    { name: "html-page-max", actual: largest.bytes, ceiling: BUDGETS.htmlPageMax },
    { name: "css-total", actual: cssTotal, ceiling: BUDGETS.cssTotal },
    { name: "fonts-total", actual: fontsTotal, ceiling: BUDGETS.fontsTotal },
    { name: "js-linked-total", actual: jsLinkedTotal, ceiling: BUDGETS.jsLinkedTotal },
  ].map((b) => ({ ...b, status: b.actual > b.ceiling ? "WARN" : "OK" }));

  const report = {
    generatedAt: new Date().toISOString(),
    distDir: "dist",
    pages: {
      count: pageCount,
      htmlBytesTotal,
      htmlBytesAvg: Math.round(htmlBytesTotal / pageCount),
      largest,
      byType: pageTypes,
    },
    linkedAssets,
    fonts: { totalBytes: fontsTotal, byFormat: fontByFormat, count: fontFiles.length },
    images: { totalBytes: imagesTotal, byExt: imageByExt, count: imageFiles.length },
    largestAssets,
    budgets,
  };

  writeFileSync(join(DIST, "perf-budget.json"), JSON.stringify(report, null, 2));

  // --- print -----------------------------------------------------------------
  console.log("\n=== Perf budget (dist/) ===");
  console.log(
    `pages: ${pageCount}  ·  HTML total ${KB(htmlBytesTotal)}  ·  avg ${KB(report.pages.htmlBytesAvg)}  ·  largest ${largest.route} ${KB(largest.bytes)}`,
  );

  console.log("\nPage types (HTML + inline, per-page avg):");
  for (const [type, t] of Object.entries(pageTypes)) {
    console.log(
      `  ${type.padEnd(9)} ×${String(t.count).padStart(2)}  html ${KB(t.htmlBytesAvg).padStart(9)}  inline-js ${KB(t.inlineJsAvg).padStart(9)}  inline-css ${KB(t.inlineCssAvg).padStart(9)}`,
    );
  }

  console.log("\nLinked shared assets:");
  for (const a of linkedAssets) {
    console.log(
      `  ${a.path.padEnd(20)} ${KB(a.bytes).padStart(10)}  (×${a.referencedByPages} pages)`,
    );
  }

  console.log("\nFonts by format:");
  for (const [fmt, b] of Object.entries(fontByFormat).sort((a, c) => c[1] - a[1])) {
    console.log(`  ${fmt.padEnd(6)} ${KB(b).padStart(10)}`);
  }
  console.log(`  ${"total".padEnd(6)} ${KB(fontsTotal).padStart(10)}`);

  console.log("\nImages by ext:");
  for (const [ext, b] of Object.entries(imageByExt).sort((a, c) => c[1] - a[1])) {
    console.log(`  ${ext.padEnd(6)} ${KB(b).padStart(10)}`);
  }
  console.log(`  ${"total".padEnd(6)} ${KB(imagesTotal).padStart(10)}`);

  console.log("\nLargest assets:");
  for (const a of largestAssets) console.log(`  ${KB(a.bytes).padStart(10)}  ${a.path}`);

  console.log("\nBudgets (warn-only):");
  for (const b of budgets) {
    const tag = b.status === "WARN" ? "WARN" : "ok  ";
    console.log(
      `  [${tag}] ${b.name.padEnd(16)} ${KB(b.actual).padStart(10)} / ${KB(b.ceiling)}`,
    );
  }

  console.log(`\nWrote dist/perf-budget.json`);
}

main();
