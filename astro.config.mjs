import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { readdirSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentTree } from "./src/lib/contentWalk.ts";
import { fromParam, hasStandIn, withRealNames } from "./src/lib/routeParam.ts";

// Deploy knobs (content-free): the archive deploy (archive.ilano.fyi) overrides
// the site URL and opts out of indexing via env vars; both default to the public
// demo's behavior when unset.
const siteUrl = process.env.SUBFOLIO_SITE_URL ?? "https://subfolio-astro.ilano.fyi";
// Base-path toggle: unset (default "/") keeps Cloudflare + local dev byte-identical.
// The GitHub Pages workflow is the only caller that sets this, to "/subfolio-astro/"
// (leading + trailing slash — must stay top-level here, never under `vite:`).
const basePath = process.env.SUBFOLIO_BASE_PATH ?? "/";
const noindex = process.env.SUBFOLIO_NOINDEX === "1";
const contentDir = process.env.SUBFOLIO_CONTENT_DIR ?? "./content/examples";

/**
 * Folders that carry an `-access` file, "/"-relative. `-access` is captured,
 * not enforced (Phase 4), so these pages are still built; they are just not
 * advertised in the sitemap.
 */
function accessFolders(root) {
  const tree = new ContentTree(root);
  const out = [];
  const walk = (rel) => {
    if (!tree.enterDir(rel)) return;
    if (tree.readMeta(rel ? `${rel}/-access` : "-access") !== null) out.push(rel);
    for (const e of tree.list(rel)) if (e.isDir) walk(e.relPath);
  };
  walk("");
  return out;
}

/**
 * Sitemap policy: a sitemap is a machine-readable listing, so it follows the
 * listing rules. No URL with a "-" or "." segment (-hidden, -thumbnails, dot
 * folders), and nothing at or under a folder with an `-access` file.
 */
function sitemapFilter() {
  // Compare in NFC: Astro normalizes URLs to NFC, while names written by macOS
  // Finder are NFD, so a "Café" folder with -access would otherwise slip through.
  const locked = accessFolders(contentDir).map((l) => l.normalize("NFC"));
  const baseDir = basePath.endsWith("/") ? basePath : `${basePath}/`;
  return (page) => {
    let path = new URL(page).pathname;
    if (baseDir !== "/" && (path === basePath || path.startsWith(baseDir))) path = path.slice(baseDir.length - 1);
    const segs = path.split("/").filter(Boolean).map((s) => {
      try {
        return fromParam(decodeURIComponent(s));
      } catch {
        return s;
      }
    });
    if (segs.some((s) => s.startsWith("-") || s.startsWith("."))) return false;
    const rel = segs.join("/").normalize("NFC");
    return !locked.some((l) => l === "" || rel === l || rel.startsWith(`${l}/`));
  };
}

/** Sitemap URLs carry route params; map the stand-ins back to the real names. */
function sitemapSerialize(item) {
  return { ...item, url: withRealNames(item.url) };
}

/**
 * After the build, rename every dist/ path that carries a routeParam stand-in
 * back to the real filename ("%", "#", "?"), deepest first so parents rename
 * after their children. See src/lib/routeParam.ts.
 */
function distNames() {
  return {
    name: "subfolio-dist-names",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const hits = [];
        const walk = (abs, depth) => {
          for (const e of readdirSync(abs, { withFileTypes: true })) {
            const p = join(abs, e.name);
            if (e.isDirectory()) walk(p, depth + 1);
            if (hasStandIn(e.name)) hits.push({ abs, name: e.name, depth });
          }
        };
        walk(root, 0);
        hits.sort((a, b) => b.depth - a.depth);
        for (const h of hits) {
          const to = join(h.abs, fromParam(h.name));
          if (existsSync(to)) throw new Error(`subfolio-dist-names: ${to} already exists`);
          renameSync(join(h.abs, h.name), to);
        }
        if (hits.length) logger.info(`renamed ${hits.length} path(s) with "%", "#" or "?" to their real names`);
      },
    },
  };
}

export default defineConfig({
  site: siteUrl,
  base: basePath,
  output: "static",
  compressHTML: true,
  // A noindex build ships no sitemap — don't advertise private URLs in a
  // machine-readable index.
  integrations: noindex
    ? [distNames()]
    : [sitemap({ filter: sitemapFilter(), serialize: sitemapSerialize }), distNames()],

  image: {
    service: { entrypoint: "astro/assets/services/sharp" },
  },

  vite: {
    css: {
      transformer: "lightningcss",
      preprocessorOptions: {
        scss: {
          api: "modern-compiler",
        },
      },
    },
  },
});
