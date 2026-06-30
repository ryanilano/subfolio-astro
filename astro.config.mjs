import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// Deploy knobs (content-free): the archive deploy (archive.ilano.fyi) overrides
// the site URL and opts out of indexing via env vars; both default to the public
// demo's behavior when unset.
const siteUrl = process.env.SUBFOLIO_SITE_URL ?? "https://subfolio-astro.ilano.fyi";
const noindex = process.env.SUBFOLIO_NOINDEX === "1";

export default defineConfig({
  site: siteUrl,
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
