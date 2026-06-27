import { z } from "astro/zod";

/**
 * Zod schema for a Subfolio folder entry — the unit the loader emits (one per
 * folder, the thing that renders as a listing page). Also the single source of
 * the TypeScript types used across the loader modules (via z.infer below).
 *
 * Phase 1 captures *parsed intent* for deferred behaviors rather than executing
 * them: image embeds carry `src` but no dimensions (sharp → Phase 3), text
 * embeds carry `rawText` + `renderer` but are not rendered (Textile/MD → Phase
 * 5), rss embeds carry feed params but are not fetched (→ Phase 3).
 */

const embedTxt = z.object({
  position: z.enum(["top", "middle", "bottom"]),
  type: z.literal("txt"),
  name: z.string(),
  /** Raw file body. Rendering deferred to Phase 5. */
  rawText: z.string(),
  /** Chosen renderer from config (none|textile|markdown). Recorded, not applied. */
  renderer: z.enum(["none", "textile", "markdown"]),
});

const embedImg = z.object({
  position: z.enum(["top", "middle", "bottom"]),
  type: z.literal("img"),
  name: z.string(),
  /** Path relative to content root. Dimensions deferred to Phase 3 (sharp). */
  src: z.string(),
});

const embedRss = z.object({
  position: z.enum(["top", "middle", "bottom"]),
  type: z.literal("rss"),
  name: z.string(),
  feedurl: z.string(),
  count: z.number(),
  cache: z.number(),
});

const embed = z.discriminatedUnion("type", [embedTxt, embedImg, embedRss]);

const childFile = z.object({
  name: z.string(),
  displayName: z.string(),
  ext: z.string(),
  /** Filekind key (img, txt, link, pop, ...) or "" if unknown. */
  kind: z.string(),
  icon: z.string(),
  /** Human display label from filekinds.yml. */
  display: z.string(),
  /** Enhancer kind if this file is an enhancer (link|pop|cut|ftr|rss), else null. */
  enhancer: z.string().nullable(),
  /** Resolved .link payload. */
  link: z
    .object({
      url: z.string(),
      target: z.string(),
      comment: z.string().optional(),
    })
    .optional(),
  /** Resolved .pop payload. */
  popup: z
    .object({
      url: z.string(),
      width: z.number(),
      height: z.number(),
      name: z.string(),
      style: z.string(),
      comment: z.string().optional(),
    })
    .optional(),
});

const childFolder = z.object({
  name: z.string(),
  displayName: z.string(),
  path: z.string(),
  /** Folder enhancer kind if the folder name carries one (.slide/.site/.oplx). */
  enhancerFolder: z.enum(["slide", "site", "oplx"]).nullable(),
  /** For .slide: relative path of the first child the listing links/redirects to. */
  slideTarget: z.string().nullable(),
  /** site/oplx render as a single detail view rather than a listing. */
  single: z.boolean(),
});

const feature = z.object({
  /** What the feature points at. */
  kind: z.enum(["link", "folder", "file"]),
  title: z.string().optional(),
  link: z.string(),
  /** Raw image path from the .ftr (usually under -thumbnails-custom/). */
  image: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  description: z.string().optional(),
  target: z.string().optional(),
});

const related = z.object({
  name: z.string(),
  /** External url, or the resolved internal link path. */
  url: z.string(),
  isExternal: z.boolean(),
});

const accessRules = z.object({
  allow_users: z.array(z.string()).optional(),
  allow_groups: z.array(z.string()).optional(),
  deny_users: z.array(z.string()).optional(),
  deny_groups: z.array(z.string()).optional(),
  /** Per-folder overrides that don't apply to sub-folders (SPEC-access). */
  current_folder: z.record(z.string(), z.any()).optional(),
});

export const folderEntrySchema = z.object({
  /** Relative path from content root with "/" separators (== collection id). */
  path: z.string(),
  name: z.string(),
  displayName: z.string(),
  enhancerFolder: z.enum(["slide", "site", "oplx"]).nullable(),
  single: z.boolean(),
  slideTarget: z.string().nullable(),
  folders: z.array(childFolder),
  files: z.array(childFile),
  embeds: z.object({
    top: z.array(embed),
    middle: z.array(embed),
    bottom: z.array(embed),
  }),
  features: z.array(feature),
  related: z.array(related),
  access: accessRules.nullable(),
  /** Names excluded from the plain listing because a .ftr features them (debug aid). */
  excluded: z.array(z.string()),
});

export type FolderEntry = z.infer<typeof folderEntrySchema>;
export type ChildFile = z.infer<typeof childFile>;
export type ChildFolder = z.infer<typeof childFolder>;
export type Embed = z.infer<typeof embed>;
export type Feature = z.infer<typeof feature>;
export type Related = z.infer<typeof related>;
export type AccessRules = z.infer<typeof accessRules>;
