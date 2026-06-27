import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

/**
 * Color palette loader — replaces `SubfolioTheme::get_color()` +
 * `template_colors.php`. Reads a YAML color definition and resolves optional
 * colors that fall back to their main-color defaults.
 *
 * The returned flat record is rendered as CSS custom properties on <body>.
 */

export interface ColorPalette {
  back: string;
  main_link: string;
  main_link_hover: string;
  main_link_back_color: string;
  main_link_back_hover: string;
  flash: string;
  text_strong: string;
  text: string;
  text_light: string;
  text_dimmed: string;
  line: string;
  border: string;
  gallery_link: string;
  gallery_link_hover: string;
  gallery_back: string;
  gallery_back_hover: string;
  feature_link: string;
  feature_link_hover: string;
  feature_text_hover: string;
  feature_back: string;
  feature_back_hover: string;
  sub_link: string;
  sub_link_hover: string;
  sub_link_back_hover: string;
  back_shift: string;
}

const DEFAULTS: ColorPalette = {
  back: "white",
  main_link: "#1a1a1a",
  main_link_hover: "#808080",
  main_link_back_color: "#ffffff",
  main_link_back_hover: "#f5f5f5",
  flash: "red",
  text_strong: "#191919",
  text: "#7F7F7F",
  text_light: "#808080",
  text_dimmed: "#CCC",
  line: "#E4E4E4",
  border: "#E4E4E4",
  gallery_link: "#1a1a1a",
  gallery_link_hover: "#808080",
  gallery_back: "#ffffff",
  gallery_back_hover: "#f5f5f5",
  feature_link: "#1a1a1a",
  feature_link_hover: "white",
  feature_text_hover: "#7F7F7F",
  feature_back: "#f5f5f5",
  feature_back_hover: "#808080",
  sub_link: "#7F7F7F",
  sub_link_hover: "#808080",
  sub_link_back_hover: "#f5f5f5",
  back_shift: "#f5f5f5",
};

function loadYamlFile(path: string): Record<string, unknown> {
  try {
    const raw = readFileSync(path, "utf8");
    const doc = parseYaml(raw);
    return doc && typeof doc === "object" ? (doc as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function s(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : fallback;
}

export function loadColorPalette(yamlPath: string): ColorPalette {
  const doc = loadYamlFile(yamlPath);

  const back = s(doc.back, DEFAULTS.back);
  const main_link = s(doc.main_link, DEFAULTS.main_link);
  const main_link_hover = s(doc.main_link_hover, DEFAULTS.main_link_hover);
  const main_link_back_color = s(doc.main_link_back_color, DEFAULTS.main_link_back_color);
  const main_link_back_hover = s(doc.main_link_back_hover, DEFAULTS.main_link_back_hover);
  const flash = s(doc.flash, DEFAULTS.flash);
  const text_strong = s(doc.text_strong, DEFAULTS.text_strong);
  const text = s(doc.text, DEFAULTS.text);
  const text_light = s(doc.text_light, DEFAULTS.text_light);
  const text_dimmed = s(doc.text_dimmed, DEFAULTS.text_dimmed);
  const line = s(doc.line, DEFAULTS.line);

  // Optional colors fall back to corresponding main colors (matching PHP logic)
  const border = s(doc.border, line);
  const gallery_link = s(doc.gallery_link, main_link);
  const gallery_link_hover = s(doc.gallery_link_hover, main_link_hover);
  const gallery_back = s(doc.gallery_back, main_link_back_color);
  const gallery_back_hover = s(doc.gallery_back_hover, main_link_back_hover);
  const feature_link = s(doc.feature_link, main_link);
  const feature_link_hover = s(doc.feature_link_hover, back);
  const feature_text_hover = s(doc.feature_text_hover, text);
  const feature_back = s(doc.feature_back, main_link_back_hover);
  const feature_back_hover = s(doc.feature_back_hover, main_link_hover);
  const sub_link = s(doc.sub_link, text);
  const sub_link_hover = s(doc.sub_link_hover, main_link_hover);
  const sub_link_back_hover = s(doc.sub_link_back_hover, main_link_back_hover);
  const back_shift = s(doc.back_shift, main_link_back_hover);

  return {
    back, main_link, main_link_hover, main_link_back_color, main_link_back_hover,
    flash, text_strong, text, text_light, text_dimmed, line,
    border, gallery_link, gallery_link_hover, gallery_back, gallery_back_hover,
    feature_link, feature_link_hover, feature_text_hover,
    feature_back, feature_back_hover,
    sub_link, sub_link_hover, sub_link_back_hover, back_shift,
  };
}

/** Render a ColorPalette as a CSS custom-property style string. */
export function paletteToStyle(p: ColorPalette): string {
  return Object.entries(p)
    .map(([k, v]) => `--color-${k.replace(/_/g, "-")}: ${v};`)
    .join(" ");
}
