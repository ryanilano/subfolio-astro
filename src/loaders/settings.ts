import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSubfolioYaml } from "./yaml.ts";

/**
 * Site + theme config loaders, replacing the PHP engine's reads of
 * `config/settings/settings.yml` (site-wide) and the active theme's
 * `config/themes/<theme>/options.yml` (display toggles).
 *
 * Both return the *raw parsed map* with legacy keys intact (`site_name`,
 * `listing_mode`, …). The legacy-key → port-field rename + merge over hard-coded
 * defaults lives in src/lib/site.ts, so the mapping stays in one place.
 *
 * Lenient like the rest of the loaders: a missing or malformed file yields `{}`
 * (parseSubfolioYaml swallows parse errors), and site.ts falls back to defaults.
 */

export type RawSettings = Record<string, unknown>;
export type RawOptions = Record<string, unknown>;

/** Active theme when settings.yml omits or fails to provide `theme`. */
export const THEME_DEFAULT = "default";

/** Read a YAML file leniently; `{}` if it's missing or unparseable. */
function readYamlSafe(path: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  return parseSubfolioYaml(raw);
}

/** Load `<configDir>/settings.yml` as a raw legacy-keyed map. */
export function loadSettings(configDir: string): RawSettings {
  return readYamlSafe(join(configDir, "settings.yml"));
}

/** Load `<configDir>/themes/<themeName>/options.yml` as a raw map. */
export function loadThemeOptions(configDir: string, themeName: string): RawOptions {
  return readYamlSafe(join(configDir, "themes", themeName, "options.yml"));
}
