/**
 * Textile rendering — unit tests for renderText(raw, "textile").
 *
 * Unlike the smoke suite these need no build: they import src/lib/renderText.ts
 * directly (Node strips the TypeScript types on import) and check the HTML it
 * returns. One test per Textile construct original Subfolio content uses, then
 * the sample text embeds in tests/fixtures/textile-samples/: synthetic files
 * shaped like real Subfolio embeds (headings with a spaced hyphen and an all-caps
 * word, trailing blank lines, a commented-out HTML draft, mixed blocks).
 *
 * Run:  node --test tests/unit.textile.test.mjs   (also part of `npm run test`)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderText } from "../src/lib/renderText.ts";
import { parseRenderer } from "../src/lib/textRendering.ts";

const tx = (src) => renderText(src, "textile");
// A UTF-8 byte-order mark, built here so the source holds no invisible character.
const BOM = String.fromCharCode(0xfeff);
const fixture = (rel) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/textile-samples/${rel}`, import.meta.url)), "utf8");

// --- Block modifiers ---------------------------------------------------------

test("h1. through h6. render headings", () => {
  for (let n = 1; n <= 6; n++) {
    assert.equal(tx(`h${n}. Heading ${n}`), `<h${n}>Heading ${n}</h${n}>`);
  }
});

test("p. and plain blocks render paragraphs", () => {
  assert.equal(tx("p. Explicit paragraph."), "<p>Explicit paragraph.</p>");
  assert.equal(tx("First block.\n\nSecond block."), "<p>First block.</p>\n<p>Second block.</p>");
});

test("bq. renders a blockquote with a paragraph inside", () => {
  assert.equal(tx("bq. Blockquoted Text"), "<blockquote>\n<p>Blockquoted Text</p>\n</blockquote>");
});

test("* renders a bulleted list, ** nests", () => {
  assert.equal(
    tx("* Bulleted item 1\n* Bulleted item 2\n** Nested"),
    "<ul>\n\t<li>Bulleted item 1</li>\n\t<li>Bulleted item 2\n\t<ul>\n\t\t<li>Nested</li>\n\t</ul></li>\n</ul>",
  );
});

test("# renders a numbered list", () => {
  assert.equal(
    tx("# Numbered item 1\n# Numbered item 2"),
    "<ol>\n\t<li>Numbered item 1</li>\n\t<li>Numbered item 2</li>\n</ol>",
  );
});

test("a single newline inside a block is a line break", () => {
  assert.equal(tx("Line one\nLine two"), "<p>Line one<br>\nLine two</p>");
});

// --- Phrase modifiers ----------------------------------------------------------

test("*strong* and _em_", () => {
  assert.equal(tx("This is *bold* and _italic_"), "<p>This is <strong>bold</strong> and <em>italic</em></p>");
});

test('"link text":url renders a link (no second autolink on the URL)', () => {
  assert.equal(tx('"text link":http://area17.com'), '<p><a href="http://area17.com">text link</a></p>');
});

test("!image! and !image(alt)!:link render images", () => {
  assert.equal(
    tx("!http://www.example.com/image.png!"),
    '<p><img src="http://www.example.com/image.png" alt=""></p>',
  );
  assert.equal(
    tx("!pic.png(Alt text)!:http://example.com"),
    '<p><a href="http://example.com"><img src="pic.png" title="Alt text" alt="Alt text"></a></p>',
  );
});

// --- Typography: upstream PHP-Textile 2.5.1 glyph table (classTextile.php:646-659) --

test("glyphs: spaced hyphen → en dash, double hyphen → em dash", () => {
  assert.equal(tx("Field Notes - Summer Edition"), "<p>Field Notes – Summer Edition</p>"); // U+2013
  assert.equal(tx("Draft--final and Draft -- final"), "<p>Draft—final and Draft — final</p>"); // U+2014
});

test("glyphs: curly quotes and apostrophes, incl. Back in '88", () => {
  assert.equal(tx(`"Double" and 'single'`), "<p>“Double” and ‘single’</p>");
  assert.equal(tx("It's the team's board"), "<p>It’s the team’s board</p>");
  // PHP rule /(\s)'(\d+$wrd?)\b/ → apostrophe; a quoted '90s' stays a quote pair.
  assert.equal(tx("Back in '88 and the '90s"), "<p>Back in ’88 and the ’90s</p>");
  assert.equal(tx("the '90s' sound"), "<p>the ‘90s’ sound</p>");
});

test("glyphs: ellipsis, (c) (r) (tm)", () => {
  assert.equal(tx("Wait for it..."), "<p>Wait for it…</p>");
  assert.equal(tx("Copyright (c) 2020"), "<p>Copyright © 2020</p>");
  assert.equal(tx("Brand(r) and Name(tm) and Name (TM)"), "<p>Brand® and Name™ and Name ™</p>");
});

test("glyphs: dimension sign and fractions, either bracket style", () => {
  assert.equal(tx("10 x 20 and 3 X 4"), "<p>10 × 20 and 3 × 4</p>");
  assert.equal(tx("(1/2) [1/2] [1/4] (3/4)"), "<p>½ ½ ¼ ¾</p>");
});

test("glyphs: textile-js differences from PHP-Textile are undone", () => {
  // PHP converts every -- (textile-js needs words or spaces around it).
  assert.equal(tx("a--. --) a---b"), "<p>a—. —) a—-b</p>");
  // PHP has no prime rule: feet and inches get closing quotes, not ′ ″.
  assert.equal(tx(`6'2" tall, 5' wide`), "<p>6’2” tall, 5’ wide</p>");
  // PHP has no arrow rule: -> stays as typed.
  assert.equal(tx("a->b and c -> d"), "<p>a->b and c -> d</p>");
  // Apostrophe after a paren; mixed-case (Tm); every fraction, not just the first.
  assert.equal(tx("(Subfolio)'s board"), "<p>(Subfolio)’s board</p>");
  assert.equal(tx("Name(Tm) (1/2) (1/2) (o) (o) (+/-) (+/-)"), "<p>Name™ ½ ½ ° ° ± ±</p>");
});

test("glyphs leave code and <pre> literal", () => {
  assert.equal(tx("@a - b... '88 (c)@"), "<p><code>a - b... '88 (c)</code></p>");
  assert.equal(tx("<pre>a -- b [1/2] 3 X 4</pre>"), "<pre>a -- b [1/2] 3 X 4</pre>");
});

test("the dash-to-space naming rule never touches body text", () => {
  // replace_dash_space applies to listing names only (listingHelpers.ts);
  // hyphens inside words in a text body stay hyphens.
  assert.equal(tx("pre-2020 well-known file-name"), "<p>pre-2020 well-known file-name</p>");
});

// --- Bare URLs (upstream text::auto_link_urls) --------------------------------

test("bare URLs open in a new window; trailing punctuation stays outside", () => {
  assert.equal(
    tx("See http://example.com/a?b=1&c=2. Or (https://example.org)."),
    '<p>See <a href="http://example.com/a?b=1&#x26;c=2" target="_blank">http://example.com/a?b=1&#x26;c=2</a>. ' +
      'Or (<a href="https://example.org" target="_blank">https://example.org</a>).</p>',
  );
});

test("bare URLs reach the page exactly as typed (no Textile typography inside)", () => {
  // 800x600 would become 800×600, -- an em dash, ABCD a caps span.
  const url = "http://cdn.example.com/800x600/a--b/ABCD.jpg";
  assert.equal(tx(`see ${url}`), `<p>see <a href="${url}" target="_blank">${url}</a></p>`);
});

test("Textile phrase markers around a bare URL still apply", () => {
  assert.equal(
    tx("*http://x.com* and _http://y.com_"),
    '<p><strong><a href="http://x.com" target="_blank">http://x.com</a></strong> and ' +
      '<em><a href="http://y.com" target="_blank">http://y.com</a></em></p>',
  );
});

test("URLs Textile owns, and URLs in HTML attributes, are left to Textile and HTML", () => {
  assert.equal(
    tx('"Read this":http://area17.com/a--b and !http://x.com/800x600.png!'),
    '<p><a href="http://area17.com/a--b">Read this</a> and <img src="http://x.com/800x600.png" alt=""></p>',
  );
  assert.equal(tx('<a href="http://x.com/a--b">http://x.com/a--b</a>'), '<p><a href="http://x.com/a--b">http://x.com/a--b</a></p>');
});

test("URLs inside @code@ and <pre> are not auto-linked", () => {
  assert.equal(tx("@http://example.com@"), "<p><code>http://example.com</code></p>");
  assert.equal(tx("<pre>http://example.com</pre>"), "<pre>http://example.com</pre>");
});

// --- Raw HTML (same trust policy as the markdown path) -----------------------

test("block HTML passes through", () => {
  assert.equal(
    tx("<div class='columns3'><h4>T1</h4>All black classy leather.</div>"),
    '<div class="columns3"><h4>T1</h4>All black classy leather.</div>',
  );
  assert.equal(tx("<pre><code>h1. Header 1</code></pre>"), "<pre><code>h1. Header 1</code></pre>");
});

test("an HTML comment stays a comment, even across blank lines", () => {
  const html = tx("h1. Title\n\n<!-- <h4>draft</h4>\n\nmore draft -->");
  assert.match(html, /^<h1>Title<\/h1>\n<!--[\s\S]*-->$/);
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ""), /draft/);
});

test("malformed HTML can't leave an unclosed tag in the page", () => {
  const html = tx("<div><p>unclosed");
  assert.doesNotMatch(html, /<div>/, "an unclosed <div> would swallow the rest of the page");
  assert.match(html, /unclosed/);
});

// --- HTML5 block elements (textile-js 2.1.1 only knows the HTML4 block tags) ---

test("a top-level <header> with nested <div>s passes through, not escaped or split", () => {
  // Shape of a Subfolio project intro: blank lines inside, two nested column divs.
  const src = [
    '<header class="project-header">',
    "  <hgroup><h1>Title</h1></hgroup>",
    "",
    '  <div class="column"><div>Left - text</div></div>',
    "",
    '  <div class="column">Right "text"</div>',
    "</header>",
  ].join("\n");
  // Before the fix: <p>&#x3C;header class=“project-header”> ... <p>&#x3C;/header></p>
  assert.equal(tx(src), src, "the block comes out exactly as written");
});

test("a <figure> with a <figcaption> passes through", () => {
  const src = '<figure><img src="a.jpg" alt="A"><figcaption>Cap - tion</figcaption></figure>';
  assert.equal(tx(src), src);
});

test("Textile around HTML5 blocks still renders", () => {
  assert.equal(
    tx("h2. Before - after\n\n<section>\n\nInside\n\n</section>\n\nAfter *bold*"),
    "<h2>Before – after</h2>\n<section>\n\nInside\n\n</section>\n<p>After <strong>bold</strong></p>",
  );
});

test("indented and nested same-name HTML5 blocks close at the matching tag", () => {
  assert.equal(
    tx("  <section><section>in</section>\n\nmid\n\n  </section>\n\nh2. After"),
    "<section><section>in</section>\n\nmid\n\n  </section>\n<h2>After</h2>",
  );
});

test("an HTML5 tag inside a paragraph is left to textile-js", () => {
  // Not at the start of a block, so it isn't set aside: Textile still runs on
  // the text inside it (the spaced hyphen becomes an en dash).
  assert.match(tx("Intro - text <section>a - b</section>"), /<section>a – b<\/section>/);
});

test("an HTML5 block that never closes, or sits inside <pre>, is left as it was", () => {
  assert.equal(tx("<header>\n\nno close - here"), "<p>&#x3C;header></p>\n<p>no close – here</p>");
  assert.equal(tx("<pre>\n\n<header>keep</header>\n\n</pre>"), "<pre>\n&#x3C;header>keep&#x3C;/header>\n\n</pre>");
});

test("an unclosed <pre>, <code> or <notextile> inside an HTML5 block never drops the text after it", () => {
  // Wrapped in <notextile>, the open tag would make textile-js swallow the rest
  // of the file, so the block is left as it was and every word survives.
  for (const open of ["<pre>", "<code>", "<notextile>"]) {
    const html = tx(`<section>\n\n${open}unclosed\n\n</section>\n\nAfter *b*\n\nh2. Kept`);
    assert.match(html, /After/, `${open}: text after the block is kept`);
    assert.match(html, /Kept/, `${open}: the heading after the block is kept`);
  }
});

test("HTML5 blocks in CRLF text pass through too", () => {
  assert.equal(
    tx('h2. Intro\r\n\r\n<header class="x">\r\n\r\n<div>a</div>\r\n\r\n</header>\r\n\r\nAfter'),
    '<h2>Intro</h2>\n<header class="x">\n\n<div>a</div>\n\n</header>\n<p>After</p>',
  );
});

test("an HTML5 tag inside an extended bc.. or pre.. block stays literal code", () => {
  assert.equal(
    tx("bc.. <div>\n\n<header>Title</header>\n\np. done"),
    "<pre><code>&#x3C;div>\n\n&#x3C;header>Title&#x3C;/header></code></pre>\n<p>done</p>",
  );
  assert.equal(
    tx("pre.. a\n\n<section>x</section>\n\nh2. After"),
    "<pre>a\n\n&#x3C;section>x&#x3C;/section></pre>\n<h2>After</h2>",
  );
});

test("text after an HTML5 block's close tag, on the same line, never leaks the wrapper", () => {
  assert.equal(
    tx("<section>\n\ntext\n\n</section> <!-- end intro -->"),
    "<section>\n\ntext\n\n</section>\n<!-- end intro -->",
  );
  assert.equal(tx("<section>\n\na\n\n</section> and *more*"), "<section>\n\na\n\n</section>\n<p>and <strong>more</strong></p>");
});

test("a same-name tag inside <pre> doesn't throw off the close-tag match", () => {
  const html = tx("<section>\n\n<pre>&lt;section&gt; example</pre>\n\n</section>\n\nAfter");
  assert.equal(html, "<section>\n\n<pre>&#x3C;section> example</pre>\n\n</section>\n<p>After</p>");
});

// --- Unknown syntax renders as text, never dropped ---------------------------

test("unknown block modifiers stay literal text", () => {
  assert.equal(tx("h7. Not a heading"), "<p>h7. Not a heading</p>");
  assert.equal(tx("foo. Not a block"), "<p>foo. Not a block</p>");
});

test("an unpaired * stays literal text", () => {
  assert.equal(tx("5 * 3 is fifteen"), "<p>5 * 3 is fifteen</p>");
});

// --- Input hygiene -----------------------------------------------------------

test("byte-order mark, CRLF line endings and trailing blank lines are cleaned", () => {
  assert.equal(tx(BOM + "h1. Title"), "<h1>Title</h1>");
  assert.equal(tx("h1. A\r\n\r\nB\r\nC"), "<h1>A</h1>\n<p>B<br>\nC</p>");
  assert.equal(tx("h1. Title\n\n\n\n\n"), "<h1>Title</h1>");
});

test("empty and whitespace-only bodies render nothing", () => {
  assert.equal(tx(""), "");
  assert.equal(tx("  \n\n "), "");
});

// --- The other renderers are untouched ----------------------------------------

test("none and markdown keep their own output for the same source", () => {
  const src = "h1. Field Notes - Summer Edition";
  assert.equal(renderText(src, "none"), "<p>h1. Field Notes - Summer Edition</p>");
  assert.equal(renderText(src, "markdown"), "<p>h1. Field Notes - Summer Edition</p>");
});

// --- The SUBFOLIO_TEXT_RENDERING setting (src/lib/textRendering.ts) ---------------

test("the renderer setting ignores case and surrounding spaces", () => {
  for (const v of ["textile", "Textile", "TEXTILE", " textile "]) assert.equal(parseRenderer(v), "textile", v);
  assert.equal(parseRenderer("Markdown"), "markdown");
  assert.equal(parseRenderer("NONE"), "none");
});

test("an unset or empty renderer setting keeps the markdown default", () => {
  assert.equal(parseRenderer(undefined), "markdown");
  assert.equal(parseRenderer(""), "markdown");
  assert.equal(parseRenderer("   "), "markdown");
});

test("an unknown renderer setting stops the build and names the allowed values", () => {
  for (const v of ["txtile", "html", "md"]) {
    assert.throws(
      () => parseRenderer(v),
      (err) =>
        err instanceof Error &&
        err.message.includes("SUBFOLIO_TEXT_RENDERING") &&
        err.message.includes(JSON.stringify(v)) &&
        err.message.includes("none, textile, markdown"),
      v,
    );
  }
});

test("renderText refuses an unknown renderer instead of rendering plain text", () => {
  assert.throws(() => renderText("h1. Title", "txtile"), /unknown renderer/);
});

// --- Sample text embeds (tests/fixtures/textile-samples/) ----------------------------

test("sample: an h1. heading embed renders a heading, not literal h1.", () => {
  // Trailing blank lines, as embed files often have, add nothing.
  assert.equal(tx(fixture("heading-dash.txt")), "<h1>Field Notes – Summer Edition</h1>");
});

test("sample: spaced hyphen → en dash and an all-caps word → caps span, as PHP Textile did", () => {
  const html = tx(fixture("heading-caps.txt"));
  // PHP-Textile also wraps 3+ capitals in <span class="caps">; neither theme styles it.
  assert.equal(html, '<h1>Studio Kit – Clean, Simple, <span class="caps">HTML</span> Ready</h1>');
  assert.equal(html.replace(/<[^>]+>/g, ""), "Studio Kit – Clean, Simple, HTML Ready");
});

test("sample: a double space after the dash is kept", () => {
  assert.equal(tx(fixture("heading-double-space.txt")), "<h1>Sample Board –  Second Draft, Bold Color</h1>");
});

test("sample: h1 + h4, and a commented-out HTML draft stays hidden", () => {
  const html = tx(fixture("draft-comment.txt"));
  assert.ok(
    html.startsWith(
      "<h1>Sample Board</h1>\n<h4>A short subtitle that explains the board in one line.</h4>\n<!--",
    ),
    html,
  );
  assert.ok(html.endsWith("-->"), "comment must close the output; nothing after it");
  const visible = html.replace(/<!--[\s\S]*?-->/g, "");
  assert.doesNotMatch(visible, /Option A|columns3/, "the commented draft must not render");
});

test("sample: paragraphs, block HTML, a link, an image, a quote and lists", () => {
  assert.equal(
    tx(fixture("mixed-blocks.txt")),
    [
      "<h2>Overview</h2>",
      "<p>A plain paragraph with <strong>strong</strong> and <em>emphasis</em>.</p>",
      "<p>Another paragraph<br>",
      "with a line break.</p>",
      '<div class="note"><p>Block <span class="caps">HTML</span> passes through.</p></div>',
      '<p>See <a href="https://example.com/docs">the docs</a> and <img src="https://example.com/pic.png" title="A sample picture" alt="A sample picture">.</p>',
      "<blockquote>",
      "<p>A quoted line.</p>",
      "</blockquote>",
      "<ul>",
      "\t<li>First point</li>",
      "\t<li>Second point</li>",
      "</ul>",
      "<ol>",
      "\t<li>Step one</li>",
      "\t<li>Step two</li>",
      "</ol>",
    ].join("\n"),
  );
});
