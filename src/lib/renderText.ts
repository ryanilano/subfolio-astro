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

/** Just enough of the hast node shape for the text walk below. */
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/** Elements whose text keeps its literal characters: code and raw text. */
const NO_GLYPHS = new Set(["pre", "code", "script", "style", "textarea"]);

/** Elements whose text is never auto-linked: existing links, code, raw text. */
const NO_AUTOLINK = new Set(["a", "pre", "code", "kbd", "samp", "script", "style", "textarea"]);

/** One Unicode word character, as PHP-Textile's `$wrd` snippet matches it. */
const WRD = "[\\p{L}\\p{M}\\p{N}\\p{Pc}]";

/**
 * Typography: upstream's PHP-Textile 2.5.1 glyph table (`vendor/classTextile.php`
 * prepGlyphs()) is the target. textile-js already matches it for ` - ` → en dash,
 * `...` → ellipsis, (c) (r) (tm), curly quotes and most apostrophes. These rules
 * cover where textile-js differs. They run on text nodes after textile-js,
 * outside code and <pre> (PHP-Textile shelves those before glyphs).
 */
const PHP_GLYPH_GAPS: [RegExp, string][] = [
  // Em dash: PHP converts every `--` (/--/); textile-js only between words or spaces.
  [/--/g, "—"],
  // Primes: textile-js turns 5' and 6'2" into ′ and ″; PHP has no prime rule, so
  // its closing-quote and apostrophe rules give ’ and ”.
  [/(\d)′/g, "$1’"],
  [/(\d)″/g, "$1”"],
  // "Back in '88", "the '90s": an apostrophe, not an opening quote.
  // PHP: /(\s)'(\d+$wrd?)\b(?![.]?[$wrd]*?')/ → $1&#8217;$2
  [new RegExp(`(\\s)‘(\\d+${WRD}?)(?!${WRD})(?!\\.?${WRD}*?’)`, "gu"), "$1’$2"],
  // Apostrophe after a closing paren, "(Subfolio)'s". PHP: /($wrd|\))'($wrd)/
  [new RegExp(`\\)‘(${WRD})`, "gu"), ")’$1"],
  // Dimension sign with a capital X ("3 X 4"); textile-js only converts lowercase x.
  // PHP: /([0-9]+[\])]?['"]? ?)[xX]( ?[\[(]?)(?=[+-]?[0-9]*\.?[0-9]+)/
  [/(\d+[\])]?['"’”]? ?)X( ?[[(]?)(?=[+-]?\d*\.?\d+)/g, "$1×$2"],
  // Trademark in mixed case, "(Tm)". PHP: /(\b ?|\s|^)[([]TM[])]/i
  [/(\b ?|\s|^)[([]tm[\])]/gi, "$1™"],
  // Fractions, degrees, plus-minus: textile-js converts only the first of each
  // in a run of text; PHP converts every one, with ( ) or [ ].
  [/[([]1\/4[\])]/g, "¼"],
  [/[([]1\/2[\])]/g, "½"],
  [/[([]3\/4[\])]/g, "¾"],
  [/[([]o[\])]/g, "°"],
  [/[([]\+\/-[\])]/g, "±"],
];

function phpGlyphGaps(value: string): string {
  let out = value;
  for (const [pattern, replacement] of PHP_GLYPH_GAPS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * A bare URL in body text. Same schemes as upstream `text::auto_link_urls`
 * (http/https/ftp/ftps). The last character can't be closing punctuation, a
 * quote, or a Textile phrase marker, so "see http://x.com." links
 * `http://x.com` and `*http://x.com*` stays bold.
 */
const BARE_URL = /\b(?:https?|ftps?):\/\/[^\s<>"“”‘’]*[^\s<>"“”‘’'.,;:!?)\]*_@+^~%=|-]/g;

/**
 * A bare URL Textile doesn't own. Skipped when it follows `:` (the target of
 * `"text":url` or `!img!:url`), `!` / `!<` / `!>` / `!=` (an `!image!` source),
 * `)` `}` `]` (an image after attribute modifiers, or a `[alias]url` link
 * definition), or `=` (an unquoted HTML attribute).
 */
const PROTECTED_URL = new RegExp(`(?<![:!=)}\\]]|![<>=])${BARE_URL.source}`, "g");

/** `->` that isn't the end of an HTML comment. textile-js makes it →; PHP doesn't. */
const ARROW = /(?<!-)->/g;

/**
 * Placeholder for text set aside from textile-js: an index between two Private
 * Use Area characters, which no textile-js rule matches. Built with
 * fromCharCode so the source holds no invisible characters.
 */
const TOKEN_OPEN = String.fromCharCode(0xe000);
const TOKEN_CLOSE = String.fromCharCode(0xe001);
const TOKEN = new RegExp(`${TOKEN_OPEN}(\\d+)${TOKEN_CLOSE}`, "g");
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);

/** A set-aside piece of source: a bare URL (linked later) or literal text. */
type Piece = { text: string; url: boolean };

/** Swap bare URLs and `->` for placeholders before Textile runs. */
function setAside(source: string): { text: string; pieces: Piece[] } {
  const pieces: Piece[] = [];
  const hold = (text: string, url: boolean) => `${TOKEN_OPEN}${pieces.push({ text, url }) - 1}${TOKEN_CLOSE}`;
  const text = source
    .replace(PROTECTED_URL, (url) => hold(url, true))
    .replace(ARROW, (arrow) => hold(arrow, false));
  return { text, pieces };
}

/**
 * HTML5 block elements textile-js 2.1.1 doesn't know. Its `allowedBlocktags`
 * stops at the HTML4 set (p, div, pre, blockquote, ul, ol, ...), so a block
 * that opens with `<header>` is treated as a paragraph: the tag is escaped to
 * text and the blank lines inside it split it into `<p>`s.
 */
const HTML5_BLOCKS = ["article", "aside", "figcaption", "figure", "footer", "header", "hgroup", "main", "nav", "section"];

/** Textile's block signatures and attribute modifiers (textile-js re_ext.js). */
const TX_BLOCKS = "(?:b[qc]|div|notextile|pre|h[1-6]|fn\\d+|p|###)";
const TX_ATTR = "(?:\\([^)]+\\)|\\{[^}]+\\}|\\[[^[\\]]+\\]|<>|<|>|=|[()]+)*";

/** Start of a Textile block: start of the text, or after a blank line (LF or CRLF). */
const AT_BLOCK = "(?<=^|\\r?\\n[ \\t]*\\r?\\n)";

/** Literal regions an HTML5 tag inside must not be counted in: comments, pre, code, notextile. */
const LITERAL_HTML = "<!--[\\s\\S]*?-->|<(?:pre|code|notextile)(?=[\\s>])[^>]*>[\\s\\S]*?<\\/(?:pre|code|notextile)\\s*>";

/**
 * One scan of the source. In order of the alternatives, each skipped whole so a
 * tag inside is left alone: an HTML comment or a `<pre>` / `<code>` /
 * `<notextile>` element; an extended Textile block (`bc..`, `pre..`, `bq..`
 * and the rest), which runs across blank lines to the next block signature.
 * Last, the one we act on: an HTML5 block opening tag at the start of a Textile
 * block, leading spaces allowed. An HTML5 tag in the middle of a paragraph is
 * not a block and is left to textile-js.
 */
const HTML5_BLOCK_START = new RegExp(
  LITERAL_HTML +
    `|${AT_BLOCK}${TX_BLOCKS}${TX_ATTR}\\.\\.(?:\\s|(?=:))[\\s\\S]*?(?=\\r?\\n+${TX_BLOCKS}${TX_ATTR}\\.|$)` +
    `|${AT_BLOCK}[ \\t]*<(?<tag>${HTML5_BLOCKS.join("|")})(?=[\\s/>])[^>]*>`,
  "gi",
);

/**
 * Where the element opened at `from` closes: the end of its matching close tag,
 * counting nested tags of the same name, outside comments, pre, code and
 * notextile. -1 if it never closes; that block is left as it was, and parse5
 * tidies it later. `<section />` counts as an opener, as browsers parse it.
 * Also -1 when a `<pre>`, `<code>` or `<notextile>` inside opens and never
 * closes before this block does: wrapped in `<notextile>`, that open tag makes
 * textile-js drop everything after the wrapper, so the block is left as it was.
 */
function matchingCloseEnd(source: string, tag: string, from: number): number {
  // Like LITERAL_HTML, but a pre/code/notextile only closes with its own name
  // (`<pre>a</code>` is not closed). It is tried first, so the `open`
  // alternative only matches an opener it could not close.
  const literal = "<!--[\\s\\S]*?-->|<(?<lit>pre|code|notextile)(?=[\\s>])[^>]*>[\\s\\S]*?<\\/\\k<lit>\\s*>";
  const tags = new RegExp(
    `${literal}|<(?<open>pre|code|notextile)(?=[\\s>])|<(?<close>\\/?)${tag}(?=[\\s/>])[^>]*>`,
    "gi",
  );
  // A pre/code/notextile "closed" only by a closer past this block's own close
  // tag (a later section's </pre>) is really unclosed here.
  const closeTag = new RegExp(`<\\/${tag}(?=[\\s>])`, "i");
  tags.lastIndex = from;
  let depth = 0;
  for (let m = tags.exec(source); m; m = tags.exec(source)) {
    if (m.groups?.open) return -1; // an unclosed pre/code/notextile: leave the block as it was
    if (m.groups?.lit && closeTag.test(m[0])) return -1; // it only closes past our own close tag
    if (m.groups?.close === undefined) continue; // a closed literal region
    depth += m.groups.close ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/** Plain lowercase text textile-js leaves alone: the paragraph `wrapsCleanly` looks for. */
const SENTINEL = "zqxwrapsentinel";

/** How often "notextile" appears in a string, any case. More in the output than in the input means a wrapper leaked. */
const countNotextile = (s: string): number => s.match(/notextile/gi)?.length ?? 0;

/**
 * True when textile-js takes `<notextile>block</notextile>` as one block and
 * still renders the paragraph after it. textile-js reads a `<notextile>` block
 * until every tag opened inside it is closed (its void-tag list is short), so
 * an open `<p>`, `<li>`, `<span>` or `<figcaption>`, a `<source>`, or a
 * self-closed `<code/>` makes it swallow the rest of the file. textile-js
 * itself is the judge here, so every such case is caught, not only the ones
 * listed. It also fails when the wrapper itself shows up as text. A block that
 * fails, or that holds a `<notextile>` tag of its own, is left as it was.
 */
function wrapsCleanly(block: string): boolean {
  if (/<\/?notextile/i.test(block)) return false;
  try {
    const html: string = textile(`<notextile>${block}</notextile>\n\n${SENTINEL}`);
    return html.trimEnd().endsWith(`<p>${SENTINEL}</p>`) && countNotextile(html) <= countNotextile(block);
  } catch {
    return false;
  }
}

/**
 * Wrap each top-level HTML5 block in `<notextile>` so textile-js passes it
 * through as written. Textile markup inside the block is not applied, which
 * matches how the PHP engine's archive pages show these blocks. Renaming the
 * tags to `div` instead (textile-js does parse Textile inside a `<div>`) would
 * not work: a `<div>` nested inside then closes the renamed outer block early
 * in textile-js's phrase pass.
 */
function passHtml5Blocks(source: string): string {
  let out = "";
  let last = 0;
  HTML5_BLOCK_START.lastIndex = 0;
  for (let m = HTML5_BLOCK_START.exec(source); m; m = HTML5_BLOCK_START.exec(source)) {
    const tag = m.groups?.tag;
    if (!tag) continue; // a literal region or an extended block: leave it
    // m.index is the start of the line: textile-js only sees <notextile> there,
    // so any indent goes inside the wrapper.
    const end = matchingCloseEnd(source, tag, m.index + m[0].indexOf("<"));
    if (end < 0) continue;
    const block = source.slice(m.index, end);
    // A block on one line already renders as HTML on main, with Textile inside
    // it (*bold*, links, curly quotes), so it is left to textile-js. Only a
    // block that spans lines is escaped and split, and needs the wrapper.
    if (!/[\r\n]/.test(block) || !wrapsCleanly(block)) continue;
    // textile-js only takes a block <notextile> when nothing follows it on the
    // line; anything that does ("</section> <!-- end -->") starts a new line.
    const tail = /^[ \t]*(?:\r?\n|$)/.test(source.slice(end)) ? "" : "\n";
    out += `${source.slice(last, m.index)}<notextile>${source.slice(m.index, end)}</notextile>${tail}`;
    last = end;
    HTML5_BLOCK_START.lastIndex = end;
  }
  return out + source.slice(last);
}

/** Put the original text back into a string (attribute values, comments). */
function restore(value: string, pieces: Piece[]): string {
  return value.replace(TOKEN, (token, i: string) => pieces[Number(i)]?.text ?? token);
}

function anchorFor(url: string): HastNode {
  return {
    type: "element",
    tagName: "a",
    properties: { href: url, target: "_blank" },
    children: [{ type: "text", value: url }],
  };
}

/** Split one text run into text + `<a target="_blank">` nodes. */
function linkifyText(value: string): HastNode[] {
  const out: HastNode[] = [];
  let last = 0;
  for (const match of value.matchAll(BARE_URL)) {
    const url = match[0];
    const at = match.index ?? 0;
    if (at > last) out.push({ type: "text", value: value.slice(last, at) });
    out.push(anchorFor(url));
    last = at + url.length;
  }
  if (out.length === 0) return [{ type: "text", value }];
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

/**
 * One text node → nodes. Placeholders go back as typed: a URL becomes a link
 * (plain text where links aren't allowed), `->` stays `->`. The text between
 * them gets the PHP glyph rules and, as a fallback, links for any bare URL
 * that wasn't set aside.
 */
function renderTextValue(value: string, pieces: Piece[], glyphs: boolean, links: boolean): HastNode[] {
  const out: HastNode[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const styled = glyphs ? phpGlyphGaps(text) : text;
    if (links) out.push(...linkifyText(styled));
    else out.push({ type: "text", value: styled });
  };
  let last = 0;
  for (const match of value.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    pushText(value.slice(last, at));
    const piece = pieces[Number(match[1])];
    if (!piece) out.push({ type: "text", value: match[0] });
    else if (piece.url && links) out.push(anchorFor(piece.text));
    else out.push({ type: "text", value: piece.text });
    last = at + match[0].length;
  }
  pushText(value.slice(last));
  return out;
}

/**
 * Walk the tree once: put set-aside text back everywhere (text, attributes,
 * comments), apply the PHP glyph rules outside NO_GLYPHS, and link URLs
 * outside NO_AUTOLINK.
 */
function transformText(node: HastNode, pieces: Piece[], glyphs: boolean, links: boolean): void {
  if (!node.children) return;
  const next: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text") {
      next.push(...renderTextValue(child.value ?? "", pieces, glyphs, links));
      continue;
    }
    if (child.type === "comment" && child.value) {
      child.value = restore(child.value, pieces);
    }
    if (child.properties) {
      for (const [key, prop] of Object.entries(child.properties)) {
        if (typeof prop === "string") child.properties[key] = restore(prop, pieces);
        else if (Array.isArray(prop)) {
          child.properties[key] = prop.map((p) => (typeof p === "string" ? restore(p, pieces) : p));
        }
      }
    }
    const tag = child.type === "element" ? (child.tagName ?? "") : "";
    transformText(child, pieces, glyphs && !NO_GLYPHS.has(tag), links && !NO_AUTOLINK.has(tag));
    next.push(child);
  }
  node.children = next;
}

/**
 * Textile HTML → parsed (parse5, via rehype-raw) → serialized.
 * Re-parsing applies the markdown path's raw-HTML policy: block HTML in the
 * source passes through (trusted author content) but comes out well-formed, so
 * an unclosed tag in one text file can't swallow the rest of the page.
 */
const textileHtmlProcessor = unified().use(rehypeRaw).use(rehypeStringify);

type HtmlTree = Parameters<typeof textileHtmlProcessor.runSync>[0];

/**
 * Textile, with bare URLs set aside before it runs and linked after.
 *
 * Upstream ran `text::auto_link_urls()` on the raw source BEFORE Textile
 * (`MY_format.php:52`). That kept URLs away from Textile's typography, but it
 * also rewrote the URL half of `"text":http://…` links and `!http://…!` images
 * into `<a>` tags, so Textile no longer saw them as links or images. Setting
 * aside only the URLs Textile doesn't own keeps both: `800x600` or `--` inside a
 * URL stays as typed, and Textile links and images still work.
 */
function renderTextile(raw: string): string {
  // Upstream PHP-Textile's cleanWhiteSpace() strips a UTF-8 byte-order mark;
  // textile-js doesn't, and a BOM in front of `h1.` stops it being a heading.
  // Trailing blank lines are trimmed: textile-js turns them into an empty <p>.
  const source = raw.replace(BOM, "").trimEnd();
  const { text, pieces } = setAside(source);
  let html: string;
  try {
    html = textile(passHtml5Blocks(text));
    // A wrapper textile-js didn't take as a block (one that landed inside a
    // bc.. or <pre> block, say) shows up in the page as text. Compared with a
    // render without the wrappers, so the word in the author's own text
    // doesn't count: if the wrappers added any, render without them, as
    // before the HTML5 fix.
    if (countNotextile(html) > 0) {
      const plain: string = textile(text);
      if (countNotextile(html) > countNotextile(plain)) html = plain;
    }
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
  const rawTree = { type: "root", children: [{ type: "raw", value: html }] } as unknown as HtmlTree;
  const tree = textileHtmlProcessor.runSync(rawTree);
  transformText(tree as unknown as HastNode, pieces, true, true);
  return textileHtmlProcessor.stringify(tree);
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

  // Never fall through to plain text for a value that isn't `none`; the setting
  // is validated in src/lib/textRendering.ts, so this only catches a bad caller.
  if (renderer !== "none") {
    throw new Error(`renderText: unknown renderer ${JSON.stringify(renderer)}`);
  }

  // `none`: plain text, escaped, bare URLs linked.
  return `<p>${autoLinkUrls(escapeHtml(raw)).replace(/\n{2,}/g, "</p>\n<p>").replace(/\n/g, "<br>\n")}</p>`;
}
