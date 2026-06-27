import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://subfolio.pages.dev",
  output: "static",
  compressHTML: true,
  integrations: [sitemap()],

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
