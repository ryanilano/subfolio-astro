/**
 * Textile rendering — unit tests for renderText(raw, "textile").
 *
 * Unlike the smoke suite these need no build: they import src/lib/renderText.ts
 * directly (Node strips the TypeScript types on import) and check the HTML it
 * returns. One test per Textile construct original Subfolio content uses, then
 * the four real K2 text embeds in tests/fixtures/k2-textile/ (copied verbatim
 * from Ryan's 2011 K2 working folder, except one phrase removed from the
 * commented-out draft in 09. Vandal; the test doesn't depend on it).
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
  readFileSync(fileURLToPath(new URL(`./fixtures/k2-textile/${rel}`, import.meta.url)), "utf8");

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
  assert.equal(tx("Darko - Skate Style"), "<p>Darko – Skate Style</p>"); // U+2013
  assert.equal(tx("Draft--final and Draft -- final"), "<p>Draft—final and Draft — final</p>"); // U+2014
});

test("glyphs: curly quotes and apostrophes, incl. Back in '88", () => {
  assert.equal(tx(`"Double" and 'single'`), "<p>“Double” and ‘single’</p>");
  assert.equal(tx("It's Ryan's board"), "<p>It’s Ryan’s board</p>");
  // PHP rule /(\s)'(\d+$wrd?)\b/ → apostrophe; a quoted '90s' stays a quote pair.
  assert.equal(tx("Back in '88 and the '90s"), "<p>Back in ’88 and the ’90s</p>");
  assert.equal(tx("the '90s' sound"), "<p>the ‘90s’ sound</p>");
});

test("glyphs: ellipsis, (c) (r) (tm)", () => {
  assert.equal(tx("Wait for it..."), "<p>Wait for it…</p>");
  assert.equal(tx("Copyright (c) 2011"), "<p>Copyright © 2011</p>");
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
  assert.equal(tx("pre-2011 well-known file-name"), "<p>pre-2011 well-known file-name</p>");
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
  const src = "h1. Darko - Skate Style";
  assert.equal(renderText(src, "none"), "<p>h1. Darko - Skate Style</p>");
  assert.equal(renderText(src, "markdown"), "<p>h1. Darko - Skate Style</p>");
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

// --- Real content: Ryan's 2011 K2 folder --------------------------------------

test("K2 01. Darko: the top embed is a heading, not literal h1.", () => {
  assert.equal(tx(fixture("01. Darko/-t-top-darko.txt")), "<h1>Darko – Skate Style</h1>");
});

test("K2 04. T1 Speedlace theme board matches the 2011 Subfolio page", () => {
  // Ryan's screenshot of the original 2011 page shows a real h1 reading
  // "T1 Speedlace – Super Tech, Clean, NASA Aesthetic" (en dash).
  const html = tx(fixture("04. T1 Speedlace/00-Themes+Inspiration/-t-top-t1speedlace.txt"));
  // PHP-Textile also wraps 3+ capitals in <span class="caps">; neither theme styles it.
  assert.equal(html, '<h1>T1 Speedlace – Super Tech, Clean, <span class="caps">NASA</span> Aesthetic</h1>');
  assert.equal(html.replace(/<[^>]+>/g, ""), "T1 Speedlace – Super Tech, Clean, NASA Aesthetic");
});

test("K2 08. Curfew Colorway 2: double space after the dash is kept", () => {
  assert.equal(
    tx(fixture("08. Curfew Colorway 2/-t-top-curfewC2.txt")),
    "<h1>Curfew Colorway 2 –  Skate Style, Super Pop</h1>",
  );
});

test("K2 09. Vandal: h1 + h4, and the commented-out column draft stays hidden", () => {
  const html = tx(fixture("09. Vandal/-t-top-t1.txt"));
  assert.ok(
    html.startsWith(
      "<h1>Vandal</h1>\n<h4>High school skateboarder, cool kid, probably smokes but mom still pays for his clothes.</h4>\n<!--",
    ),
    html,
  );
  assert.ok(html.endsWith("-->"), "comment must close the output; nothing after it");
  const visible = html.replace(/<!--[\s\S]*?-->/g, "");
  assert.doesNotMatch(visible, /T1 Speedlace|columns3/, "the commented draft must not render");
});
