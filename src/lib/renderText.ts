/**
 * Text body rendering — ports `format::get_rendered_text()` from the PHP engine
 * (`engine/application/helpers/MY_format.php`).
 *
 * Upstream switched on a global `text_rendering` setting (none|textile|markdown),
 * auto-linked bare URLs, then rendered. All three are supported here:
 * - `markdown` — the remark/unified stack (Phase 5).
 * - `textile`  — `textile-js` (MIT), the JS port of the Textile 2 syntax that
 *   upstream's bundled PHP-Textile 2.5.1 (`vendor/classTextile.php`) implements.
 * - `none`     — escaped plain text with live links.
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
import textile from "textile-js";

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

// --- Textile ------------------------------------------------------------------

/** Just enough of the hast node shape for the autolink walk below. */
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/** Elements whose text is never auto-linked: existing links, code, raw text. */
const NO_AUTOLINK = new Set(["a", "pre", "code", "kbd", "samp", "script", "style", "textarea"]);

/**
 * A bare URL in body text. Same schemes as upstream `text::auto_link_urls`
 * (http/https/ftp/ftps). The last character can't be closing punctuation or a
 * quote, so "see http://x.com." links `http://x.com`.
 */
const BARE_URL = /\b(?:https?|ftps?):\/\/[^\s<>"“”‘’]*[^\s<>"“”‘’'.,;:!?)\]]/g;

/** Split one text node into text + `<a target="_blank">` nodes. */
function linkifyText(value: string): HastNode[] {
  const out: HastNode[] = [];
  let last = 0;
  for (const match of value.matchAll(BARE_URL)) {
    const url = match[0];
    const at = match.index ?? 0;
    if (at > last) out.push({ type: "text", value: value.slice(last, at) });
    out.push({
      type: "element",
      tagName: "a",
      properties: { href: url, target: "_blank" },
      children: [{ type: "text", value: url }],
    });
    last = at + url.length;
  }
  if (out.length === 0) return [{ type: "text", value }];
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

/** Recursively auto-link text nodes, skipping NO_AUTOLINK subtrees. */
function autolinkChildren(node: HastNode): void {
  if (!node.children) return;
  const next: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value) {
      next.push(...linkifyText(child.value));
      continue;
    }
    if (child.type !== "element" || !NO_AUTOLINK.has(child.tagName ?? "")) {
      autolinkChildren(child);
    }
    next.push(child);
  }
  node.children = next;
}

/**
 * Bare-URL autolinking for Textile, run AFTER Textile on the parsed tree.
 *
 * Upstream ran `text::auto_link_urls()` on the raw source BEFORE Textile. That
 * rewrote the URL half of `"text":http://…` links and `!http://…!` images into
 * `<a>` tags, so Textile no longer saw them as links or images. Linking only the
 * bare URLs left in the rendered text keeps the upstream intent (bare URLs open
 * in a new window) without breaking Textile's own link and image syntax.
 */
function rehypeAutolinkBareUrls() {
  return (tree: unknown) => {
    autolinkChildren(tree as HastNode);
  };
}

/**
 * Textile HTML → parsed (parse5, via rehype-raw) → bare URLs linked → HTML.
 * Re-parsing applies the markdown path's raw-HTML policy: block HTML in the
 * source passes through (trusted author content) but comes out well-formed, so
 * an unclosed tag in one text file can't swallow the rest of the page.
 */
const textileHtmlProcessor = unified()
  .use(rehypeRaw)
  .use(rehypeAutolinkBareUrls)
  .use(rehypeStringify);

type HtmlTree = Parameters<typeof textileHtmlProcessor.runSync>[0];

function renderTextile(raw: string): string {
  // Upstream PHP-Textile's cleanWhiteSpace() strips a UTF-8 byte-order mark;
  // textile-js doesn't, and a BOM in front of `h1.` stops it being a heading.
  // Trailing blank lines are trimmed: textile-js turns them into an empty <p>.
  const source = raw.replace(/^﻿/, "").trimEnd();
  let html: string;
  try {
    html = textile(source);
  } catch (err) {
    // Lenient like the rest of the loader: one bad file must not fail the build.
    // Loud, never silent: say which text fell back.
    console.warn(
      `[renderText] Textile failed (${(err as Error).message}); rendering this text as plain text: ` +
        JSON.stringify(source.slice(0, 60)),
    );
    return renderText(raw, "none");
  }
  // A root holding one raw node is how remark-rehype hands raw HTML to rehype-raw.
  const tree = { type: "root", children: [{ type: "raw", value: html }] } as unknown as HtmlTree;
  return textileHtmlProcessor.stringify(textileHtmlProcessor.runSync(tree));
}

/**
 * Render a raw text body to HTML per the configured renderer.
 * - `markdown`: full GFM pipeline.
 * - `textile`: Textile 2 (headings, p., bq., lists, phrase markup, links,
 *   images, line breaks, block HTML). Unknown syntax stays as literal text.
 * - `none`: escape + auto-link + paragraph-wrap (plain text, links live).
 */
export function renderText(raw: string, renderer: Renderer): string {
  if (!raw || !raw.trim()) return "";

  if (renderer === "markdown") {
    return String(markdownProcessor.processSync(raw));
  }

  if (renderer === "textile") {
    return renderTextile(raw);
  }

  // `none`: plain text, escaped, bare URLs linked.
  return `<p>${autoLinkUrls(escapeHtml(raw)).replace(/\n{2,}/g, "</p>\n<p>").replace(/\n/g, "<br>\n")}</p>`;
}
