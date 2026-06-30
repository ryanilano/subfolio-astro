/**
 * Site configuration — replaces `Subfolio::get_setting()` and
 * `Kohana::config('filebrowser.*')` lookups from the PHP engine.
 *
 * Values here mirror the legacy config. In production these would come from
 * env vars or a config file.
 */
export const siteConfig = {
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
} as const;

/** Default display options — mirrors options.yml (SPEC-theme-api §8). */
export const defaultOptions = {
  // Branding
  site_logo_url: siteConfig.site_logo_url,
  site_logo_width: siteConfig.site_logo_width,
  site_logo_height: siteConfig.site_logo_height,
  site_favicon_url: siteConfig.site_favicon_url,
  // Styling
  color_palette: siteConfig.color_palette,
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

export type SiteConfig = typeof siteConfig;
export type Options = typeof defaultOptions;
