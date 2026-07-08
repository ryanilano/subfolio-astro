import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// Deploy knobs (content-free): the archive deploy (archive.ilano.fyi) overrides
// the site URL and opts out of indexing via env vars; both default to the public
// demo's behavior when unset.
const siteUrl = process.env.SUBFOLIO_SITE_URL ?? "https://subfolio-astro.ilano.fyi";
// Base-path toggle: unset (default "/") keeps Cloudflare + local dev byte-identical.
// The GitHub Pages workflow is the only caller that sets this, to "/subfolio-astro/"
// (leading + trailing slash — must stay top-level here, never under `vite:`).
const basePath = process.env.SUBFOLIO_BASE_PATH ?? "/";
const noindex = process.env.SUBFOLIO_NOINDEX === "1";

export default defineConfig({
  site: siteUrl,
  base: basePath,
  output: "static",
  compressHTML: true,
  // A noindex build ships no sitemap — don't advertise private URLs in a
  // machine-readable index.
  integrations: noindex ? [] : [sitemap()],

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
