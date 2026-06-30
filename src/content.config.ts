import { defineCollection } from "astro:content";
import { fileURLToPath } from "node:url";
import { subfolioLoader } from "./loaders/index.ts";
import type { Renderer } from "./loaders/embeds.ts";

/**
 * Registers the custom Subfolio loader as a content collection. The content root
 * and renderer come from env (see .env): SUBFOLIO_CONTENT_DIR defaults to the
 * bundled fixture so the repo is standalone; Phase 3 overrides it to point at a
 * live install's directory/.
 */

const contentDir = process.env.SUBFOLIO_CONTENT_DIR ?? "./content/examples";
const renderer = (process.env.SUBFOLIO_TEXT_RENDERING ?? "textile") as Renderer;

// filekinds.yml is bundled at <repo>/config/filekinds.yml.
const filekindsPath = fileURLToPath(new URL("../config/filekinds.yml", import.meta.url));

const folders = defineCollection({
  loader: subfolioLoader({ contentDir, filekindsPath, renderer }),
});

export const collections = { folders };
