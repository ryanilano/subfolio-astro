import { defineConfig } from "astro/config";

// Pipeline mirrors ilano-fyi's load-bearing tooling (Astro 6, static output,
// sharp image service, lightningcss + modern-compiler scss), trimmed to what
// Phase 1 needs. Integrations (mdx/sitemap/etc.) are deliberately omitted until
// later phases. See subfolio/plans/floating-percolating-honey.md.
export default defineConfig({
  output: "static",
  compressHTML: true,

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
