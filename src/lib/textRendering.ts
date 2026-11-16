/**
 * The text renderer setting, `SUBFOLIO_TEXT_RENDERING`, read and checked in one
 * place for both readers: the loader (src/content.config.ts, config time) and the
 * page route (src/pages/[...path].astro, render time).
 *
 * Case and surrounding spaces don't matter (`Textile`, ` MARKDOWN `). Unset or
 * empty means markdown, the port's default. Anything else stops the build with a
 * message naming the allowed values; before this, a typo such as `txtile`
 * silently rendered every text file as plain text.
 */
import type { Renderer } from "./renderText.ts";

export const RENDERERS: readonly Renderer[] = ["none", "textile", "markdown"];
export const DEFAULT_RENDERER: Renderer = "markdown";

/** Normalize and validate one setting value. Throws on an unknown renderer. */
export function parseRenderer(value: string | undefined): Renderer {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "") return DEFAULT_RENDERER;
  const match = RENDERERS.find((r) => r === v);
  if (match) return match;
  throw new Error(
    `SUBFOLIO_TEXT_RENDERING=${JSON.stringify(value)} is not a text renderer. ` +
      `Use one of: ${RENDERERS.join(", ")} (unset or empty means ${DEFAULT_RENDERER}).`,
  );
}

/** The renderer for this build, from the environment. */
export const textRenderer: Renderer = parseRenderer(process.env.SUBFOLIO_TEXT_RENDERING);
