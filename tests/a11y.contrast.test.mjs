/**
 * A11y gate — color-contrast unit test (pure node, no browser).
 *
 * The YAML palettes in src/config/colors-*.yml feed the inlined `colorCss`
 * block in src/layouts/Layout.astro, which paints body/listing/breadcrumb text
 * over the `back` background. This test computes WCAG 2.1 contrast ratios for
 * those foreground-on-`back` pairs and asserts they meet AA.
 *
 * This is the fast, deterministic pre-check. In-context contrast (feature hover
 * states, flash messages, links over non-`back` backgrounds) is covered by the
 * rendered axe-core gate in a11y.axe.test.mjs — keep the two complementary.
 *
 * Run:  node --test tests/a11y.contrast.test.mjs   (or `npm run test:a11y`)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const palettePath = (name) =>
  fileURLToPath(new URL(`../src/config/colors-${name}.yml`, import.meta.url));

/** Minimal CSS named-color map (only the names our palettes actually use). */
const NAMED = { white: "#ffffff", black: "#000000", red: "#ff0000" };

/** Parse a CSS color string ("white", "#CCC", "#1a1a1a") → [r,g,b] 0–255. */
function toRgb(value) {
  let v = String(value).trim().toLowerCase();
  if (v in NAMED) v = NAMED[v];
  const hex = v.replace(/^#/, "");
  const full =
    hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-f]{6}$/.test(full)) {
    throw new Error(`Unrecognized color value: "${value}"`);
  }
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** WCAG relative luminance of an [r,g,b] color. */
function luminance([r, g, b]) {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio between two color strings (1–21). */
function contrast(fg, bg) {
  const l1 = luminance(toRgb(fg));
  const l2 = luminance(toRgb(bg));
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Foreground palette keys painted as text over `back`, with the AA ratio they
 * must meet. Normal body/link/listing text → 4.5:1; intentionally secondary
 * dimmed text → 3:1 (large-text floor). Keys absent from a palette are skipped.
 */
const TEXT_KEYS = {
  main_link: 4.5,
  text: 4.5,
  text_light: 4.5,
  text_strong: 4.5,
  sub_link: 4.5,
  text_dimmed: 3.0,
};

for (const paletteName of ["default", "dark"]) {
  const palette = parseYaml(readFileSync(palettePath(paletteName), "utf8")) ?? {};
  const back = palette.back;

  test(`palette "${paletteName}" defines a background (back)`, () => {
    assert.ok(back, `colors-${paletteName}.yml is missing "back"`);
  });

  for (const [key, minRatio] of Object.entries(TEXT_KEYS)) {
    if (palette[key] == null) continue; // optional/commented key — not active
    test(`palette "${paletteName}": ${key} on back meets ${minRatio}:1`, () => {
      const ratio = contrast(palette[key], back);
      assert.ok(
        ratio >= minRatio,
        `${key} (${palette[key]}) on back (${back}) = ${ratio.toFixed(2)}:1, ` +
          `needs ${minRatio}:1`,
      );
    });
  }
}
