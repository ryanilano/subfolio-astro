/**
 * Pre-build CSS generation — runs BEFORE `astro build`/`astro dev` (see package.json),
 * alongside gen-thumbs.mjs.
 *
 * Theme model: the `default` theme IS the base stylesheet. Its editable SCSS lives in
 * config/themes/default/css/ and compiles to public/css/main.css + icons.css. Every
 * OTHER theme (config/themes/<name>/css/main.scss) is a thin override layer compiled to
 * public/css/theme-<name>.css and <link>ed AFTER main.css for the active theme
 * (Layout.astro), so its rules win the cascade. SUBFOLIO_CONFIG_DIR overrides the
 * config root (mirrors src/lib/site.ts).
 *
 * Why a separate pass: the base entrypoints `@import 'icon-map'` — a Sass map of SVG
 * data-URIs that the *upstream grunt pipeline* generated (the `svgcss` task) and never
 * checked in. Without it, compiling main.scss fails with "Can't find stylesheet to
 * import". So this script reproduces that step: it builds src/img/_icon-map.scss from
 * the vendored SVG sources (resolved via load path, so it can't collide with the
 * icons.scss entrypoint), then compiles the entrypoints with dart-sass and adds vendor
 * prefixes (mirroring upstream's autoprefixer step).
 *
 * Modernized pipeline (was: grunt svgcss + hand-encoded autoprefixer "last 5 versions"):
 *   - SVGs are optimized with SVGO (drops Illustrator cruft, shortens paths) and
 *     embedded with mini-svg-data-uri's minimal escaping — far smaller than the old
 *     `charset=US-ASCII` + full encodeURIComponent() form, pixel-identical rendering.
 *   - Vendor prefixing targets come from a single `browserslist` query (package.json
 *     "browserslist": ["defaults"]) via lightningcss's browserslistToTargets() — no
 *     more hand-encoded version ints, and IE/dead-browser prefixes are gone.
 *
 * Generated artifacts (gitignored): src/img/_icon-map.scss, public/css/main.css,
 * public/css/icons.css, public/css/theme-*.css. The SVG sources in src/img/svg_source/
 * ARE committed (real source). Layout.astro's <link href="/css/main.css"> is unchanged —
 * we write to those exact paths.
 */
import * as sass from "sass";
import { transform, browserslistToTargets } from "lightningcss";
import browserslist from "browserslist";
import { optimize as svgo } from "svgo";
import svgToTinyDataUri from "mini-svg-data-uri";
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { resolve, join, basename } from "node:path";

const root = resolve(import.meta.dirname, "..");
// Config root, honoring SUBFOLIO_CONFIG_DIR like src/lib/site.ts. Theme CSS lives under
// <configDir>/themes/<name>/css/; the `default` theme holds the base stylesheet.
const configDir = process.env.SUBFOLIO_CONFIG_DIR
  ? resolve(process.env.SUBFOLIO_CONFIG_DIR)
  : join(root, "config");
const themesDir = join(configDir, "themes");
const baseDir = join(themesDir, "default", "css"); // base stylesheet (= default theme)
const imgDir = join(root, "src/img");
const svgSourceDir = join(imgDir, "svg_source");
const iconsPartial = join(imgDir, "_icon-map.scss");
const outDir = join(root, "public/css");

// Upstream svgcss defaults (grunt/svgcss.js): defaultWidth/Height = 16px.
const DEFAULT_DIM = 16;

// Vendor-prefix targets from the package.json `browserslist` query. One source of
// truth, also discoverable by any other browserslist-aware tooling.
const targets = browserslistToTargets(browserslist());

/**
 * Parse a `width="20px"`/`height="14px"` attribute off the <svg> tag. Run against the
 * RAW source before SVGO so icon sizing is robust even if optimization ever drops the
 * dimension attributes (SVGO's preset-default keeps them today, but don't depend on it).
 */
function dimOf(svg, attr) {
  const m = svg.match(new RegExp(`<svg[^>]*\\b${attr}\\s*=\\s*"([0-9.]+)`, "i"));
  return m ? Math.round(parseFloat(m[1])) : DEFAULT_DIM;
}

/** Build the $icons Sass map partial from every SVG in svg_source/. */
function generateIconsPartial() {
  const files = readdirSync(svgSourceDir)
    .filter((f) => f.endsWith(".svg"))
    .sort();

  const entries = files.map((file) => {
    const name = basename(file, ".svg");
    const raw = readFileSync(join(svgSourceDir, file), "utf8");
    // Dimensions come from the raw markup, before SVGO touches the <svg> tag.
    const width = dimOf(raw, "width");
    const height = dimOf(raw, "height");
    // SVGO strips the XML prolog, DOCTYPE, generator comments, Illustrator ids, and
    // collapses path precision. mini-svg-data-uri then emits the minimally-escaped
    // `data:image/svg+xml,...` form (" → ', only reserved chars percent-encoded).
    const { data: optimized } = svgo(raw, { multipass: true, plugins: ["preset-default"] });
    // mini-svg-data-uri uses single quotes for SVG attrs (smaller than %22), so the
    // Sass string MUST be double-quoted to avoid a quote collision.
    const datauri = svgToTinyDataUri(optimized);
    return `  ${name}: ( datauri:"${datauri}", width:${width}px, height:${height}px ),`;
  });

  const out =
    `/*!\n * Generated by scripts/gen-css.mjs — DON'T EDIT THIS FILE\n */\n` +
    `$icons: (\n${entries.join("\n")}\n);\n`;

  mkdirSync(imgDir, { recursive: true });
  writeFileSync(iconsPartial, out);
  return files.length;
}

/**
 * Compile one SCSS entrypoint (absolute path) → prefixed, minified CSS at
 * public/css/<outName>.css. outName defaults to the entry's basename; pass it to
 * rename the output (e.g. theme entrypoints land at theme-<name>.css). loadPaths
 * defaults to the base dir + src/img so `@import 'resets'` / `@import 'icon-map'`
 * resolve; theme overrides pass their own dir ahead of the base.
 *
 * Returns the byte length written, or 0 when the compiled output is empty (a
 * comment-only override) — in that case no sheet is written and any stale prior
 * output is removed, so the cascade never gains an empty <link>.
 */
function compile(entry, outName = basename(entry, ".scss"), loadPaths = [baseDir, imgDir]) {
  const result = sass.compile(entry, {
    loadPaths,
    silenceDeprecations: ["import", "global-builtin", "color-functions", "slash-div"],
    quietDeps: true,
  });
  const { code } = transform({
    filename: `${outName}.css`,
    code: Buffer.from(result.css),
    targets,
    minify: true,
  });
  const outPath = join(outDir, `${outName}.css`);
  if (code.length === 0) {
    if (existsSync(outPath)) rmSync(outPath);
    return 0;
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, code);
  return code.length;
}

/**
 * Compile each NON-default theme's override at <configDir>/themes/<name>/css/main.scss
 * → public/css/theme-<name>.css. These are thin layers <link>ed AFTER main.css for the
 * active theme (Layout.astro), so they win the cascade. The file is SCSS, but plain CSS
 * pasted in works too (SCSS is a CSS superset); loadPaths expose the base theme + src/img
 * so an override may `@use`/`@import` the shared variables, mixins and $icons map.
 *
 * `default` is skipped — it's the base, already compiled to main.css/icons.css. A theme
 * dir without css/main.scss, and a comment-only (empty-output) override, emit nothing.
 */
function compileThemes() {
  if (!existsSync(themesDir)) return [];
  return readdirSync(themesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "default")
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const themeCssDir = join(themesDir, name, "css");
      const entry = join(themeCssDir, "main.scss");
      if (!existsSync(entry)) return null;
      const bytes = compile(entry, `theme-${name}`, [themeCssDir, baseDir, imgDir]);
      return { name, bytes };
    })
    .filter((t) => t && t.bytes > 0);
}

function main() {
  const iconCount = generateIconsPartial();
  const mainBytes = compile(join(baseDir, "main.scss"), "main");
  const iconsBytes = compile(join(baseDir, "icons.scss"), "icons");
  const themes = compileThemes();
  const themeSummary = themes
    .map((t) => `theme-${t.name}.css ${(t.bytes / 1024).toFixed(1)}KB`)
    .join(", ");
  console.log(
    `[gen-css] ${iconCount} icon(s) → _icon-map.scss; ` +
      `main.css ${(mainBytes / 1024).toFixed(1)}KB, icons.css ${(iconsBytes / 1024).toFixed(1)}KB` +
      (themeSummary ? `; ${themeSummary}` : ""),
  );
}

main();
