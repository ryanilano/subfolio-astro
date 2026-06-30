/**
 * Site configuration — replaces `Subfolio::get_setting()` and
 * `Kohana::config('filebrowser.*')` lookups from the PHP engine.
 *
 * The exported `siteConfig` / `defaultOptions` are built at build time by merging
 * hard-coded defaults (the PHP baseline) under the committed `config/settings.yml`
 * and the active theme's `config/themes/<theme>/options.yml`. Point
 * `SUBFOLIO_CONFIG_DIR` elsewhere (parallel to `SUBFOLIO_CONTENT_DIR`) to supply
 * real deploy-time config; missing/malformed files fall back to the defaults
 * below, lenient like the rest of the loaders.
 */
import { asNumber, asString } from "../loaders/yaml.ts";
import { loadSettings, loadThemeOptions, THEME_DEFAULT } from "../loaders/settings.ts";

/** Hard-coded site-wide baseline (PHP defaults). Overridden by settings.yml. */
const DEFAULT_SITE_CONFIG = {
  /** Root path of the site, e.g. "/". Used for breadcrumb root link. */
  site_root: "/",
  /** Domain shown in the breadcrumb root. */
  site_domain: "subfolio.local",
  /** Site title used in <title> tag. */
  site_title: "Subfolio",
  /** Logo URL. Set empty string to show text site name instead. */
  site_logo_url: "/images/logos/area17_logo.svg",
  /** Logo dimensions. */
  site_logo_width: 100,
  site_logo_height: 53,
  /** Favicon URL. */
  site_favicon_url: "/images/favicon.ico",
  /** Meta description. */
  site_meta_description: "",
  /** Google Analytics code. Empty = disabled. */
  google_analytics_code: "",
  /** Copyright text. */
  site_copyright: "© Subfolio",
  /** Max inline image size in MB. Images larger than this show the download box. */
  display_max_filesize: 5,
  /** Shadow CSS for images. */
  shadow_style_css: "0 2px 12px rgba(0,0,0,0.15)",
  /** Color palette name (loads from src/config/colors-{name}.yml). */
  color_palette: "default",
  /**
   * Opt-in <ClientRouter> SPA navigation (Astro View Transitions). OFF by
   * default — Phase D's deferred jQuery/A17 bootstrap runs on full page loads;
   * enabling this needs the A17 behaviors re-initialized on `astro:page-load`,
   * which is out of this milestone's scope. Flag wired, inert until set true.
   */
  enable_view_transitions: false,
};

/** Hard-coded display baseline (mirrors options.yml, SPEC-theme-api §8). */
const DEFAULT_OPTIONS = {
  // Branding
  site_logo_url: DEFAULT_SITE_CONFIG.site_logo_url,
  site_logo_width: DEFAULT_SITE_CONFIG.site_logo_width,
  site_logo_height: DEFAULT_SITE_CONFIG.site_logo_height,
  site_favicon_url: DEFAULT_SITE_CONFIG.site_favicon_url,
  // Styling
  color_palette: DEFAULT_SITE_CONFIG.color_palette,
  thumbnail_height: 240,
  // Display flags
  replace_underscore_space: true,
  replace_dash_space: true,
  display_file_extensions: true,
  display_file_names_in_gallery: true,
  // Listing
  listing_mode: "list" as "list" | "grid" | "masonry",
  icon_set_list: "list",
  icon_set_grid: "grid",
  // Column visibility (list view)
  display_icons: true,
  display_name: true,
  display_size: true,
  display_date: true,
  display_kind: true,
  display_comment: false,
  // Sort
  default_sort: "filename",
  default_sort_order: "Desc" as "Asc" | "Desc",
  // UI chrome
  display_header: true,
  display_collapse_header: true,
  display_send_page: true,
  display_tiny_url: false,
  display_breadcrumb: true,
  display_navigation: true,
  display_file_listing_header: true,
  display_updated_since: true,
  display_copyright: true,
  display_info: true,
  // Access
  hide_locked_folders: false,
};

/**
 * Decode the handful of HTML entities legacy `settings.yml` carries in
 * human-visible strings (chiefly `site_copyright`, e.g. `&copy;`). The PHP engine
 * emitted these raw into HTML; the port escapes interpolated values, so we decode
 * to the real characters here and let normal escaping handle them downstream.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/** Coerce a YAML value to a boolean, tolerating string "true"/"false". */
function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return fallback;
}

/** Coerce a raw YAML value to match the type of a default. */
function coerceLike<T>(raw: unknown, def: T): T {
  if (raw === undefined || raw === null) return def;
  if (typeof def === "boolean") return asBool(raw, def) as T;
  if (typeof def === "number") return asNumber(raw, def as number) as T;
  if (typeof def === "string") return (asString(raw) ?? def) as T;
  return def;
}

// --- Build merged config at module load (build time) -------------------------

const configDir = process.env.SUBFOLIO_CONFIG_DIR ?? "./config";
const settings = loadSettings(configDir);
const theme = asString(settings.theme) || THEME_DEFAULT;
const options = loadThemeOptions(configDir, theme);

/**
 * Site-wide config: defaults ← settings.yml (renames below) ← theme options.yml
 * (branding/palette). Legacy `site_name` → `site_title`; `text_rendering` and
 * `thumbnail_max_filesize` are intentionally NOT read here (they have dedicated
 * env-driven sources elsewhere).
 */
export const siteConfig = {
  ...DEFAULT_SITE_CONFIG,
  // settings.yml
  site_root: asString(settings.site_root) ?? DEFAULT_SITE_CONFIG.site_root,
  site_domain: asString(settings.site_domain) ?? DEFAULT_SITE_CONFIG.site_domain,
  site_title: asString(settings.site_name) ?? DEFAULT_SITE_CONFIG.site_title,
  site_meta_description:
    asString(settings.site_meta_description) ?? DEFAULT_SITE_CONFIG.site_meta_description,
  site_copyright: decodeHtmlEntities(
    asString(settings.site_copyright) ?? DEFAULT_SITE_CONFIG.site_copyright,
  ),
  google_analytics_code:
    asString(settings.google_analytics_code) ?? DEFAULT_SITE_CONFIG.google_analytics_code,
  // theme options.yml (logo/favicon/palette — options wins, matches PHP precedence)
  site_logo_url: asString(options.site_logo_url) ?? DEFAULT_SITE_CONFIG.site_logo_url,
  site_logo_width: asNumber(options.site_logo_width, DEFAULT_SITE_CONFIG.site_logo_width),
  site_logo_height: asNumber(options.site_logo_height, DEFAULT_SITE_CONFIG.site_logo_height),
  site_favicon_url: asString(options.site_favicon_url) ?? DEFAULT_SITE_CONFIG.site_favicon_url,
  color_palette: asString(options.color_palette) ?? DEFAULT_SITE_CONFIG.color_palette,
};

/** Display options: defaults ← theme options.yml (key names already match). */
export const defaultOptions = (() => {
  const merged = { ...DEFAULT_OPTIONS };
  for (const key of Object.keys(DEFAULT_OPTIONS) as (keyof typeof DEFAULT_OPTIONS)[]) {
    (merged[key] as unknown) = coerceLike(options[key], DEFAULT_OPTIONS[key]);
  }
  return merged;
})();

export type SiteConfig = typeof siteConfig;
export type Options = typeof defaultOptions;
