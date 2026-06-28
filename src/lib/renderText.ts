/**
 * Text body rendering — ports `format::get_rendered_text()` from the PHP engine
 * (`engine/application/helpers/MY_format.php`).
 *
 * Upstream switched on a global `text_rendering` setting (none|textile|markdown),
 * auto-linked bare URLs, then rendered. Phase 5 decision: **Markdown only** — the
 * remark/unified stack is already a dependency, and Textile has no maintained JS
 * port. A `textile` selector falls back to `none` with a build warning so existing
 * config doesn't break the build.
 *
 * Used by the `.txt` detail view (`fileHelpers.ts` → `body`) and position text
 * embeds (`listing/InlineEmbeds.astro`).
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkSmartypants from "remark-smartypants";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";

export type Renderer = "none" | "textile" | "markdown";

/**
 * Markdown → HTML. GFM (incl. bare-URL autolinking, mirroring PHP
 * `auto_link_urls`), smart typography, and raw-HTML passthrough (the fixture
 * embeds inline `<pre><code>`), built once and reused across calls.
 */
const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkSmartypants)
  // allowDangerousHtml + rehype-raw: user-authored bodies may contain inline
  // HTML, which the legacy engine passed through. This content is trusted (it's
  // the site author's own files on disk), same trust model as the PHP app.
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeStringify);

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Auto-link bare http(s) URLs, mirroring PHP `text::auto_link_urls($text, '_blank')`. */
function autoLinkUrls(escaped: string): string {
  return escaped.replace(
    /\bhttps?:\/\/[^\s<]+[^\s<.,!?)]/g,
    (url) => `<a href="${url}" target="_blank">${url}</a>`,
  );
}

let warnedTextile = false;

/**
 * Render a raw text body to HTML per the configured renderer.
 * - `markdown`: full GFM pipeline.
 * - `none`: escape + auto-link + paragraph-wrap (plain text, links live).
 * - `textile`: not supported in the JS port → falls back to `none` once-warned.
 */
export function renderText(raw: string, renderer: Renderer): string {
  if (!raw || !raw.trim()) return "";

  if (renderer === "markdown") {
    return String(markdownProcessor.processSync(raw));
  }

  if (renderer === "textile" && !warnedTextile) {
    warnedTextile = true;
    console.warn(
      "[renderText] Textile is not supported in the Astro port; rendering as plain text. " +
        "Set SUBFOLIO_TEXT_RENDERING=markdown.",
    );
  }

  // `none` (and the textile fallback): plain text, escaped, bare URLs linked.
  return `<p>${autoLinkUrls(escapeHtml(raw)).replace(/\n{2,}/g, "</p>\n<p>").replace(/\n/g, "<br>\n")}</p>`;
}
