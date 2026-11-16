/**
 * Textile rendering — unit tests for renderText(raw, "textile").
 *
 * Unlike the smoke suite these need no build: they import src/lib/renderText.ts
 * directly (Node strips the TypeScript types on import) and check the HTML it
 * returns. One test per Textile construct original Subfolio content uses, then
 * the three real K2 text embeds in tests/fixtures/k2-textile/ (copied verbatim
 * from Ryan's 2011 K2 working folder).
 *
 * Run:  node --test tests/unit.textile.test.mjs   (also part of `npm run test`)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderText } from "../src/lib/renderText.ts";

const tx = (src) => renderText(src, "textile");
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

test("typographic glyphs match PHP-Textile (spaced hyphen → en dash, -- → em dash)", () => {
  assert.equal(tx("Darko - Skate Style -- 2011"), "<p>Darko – Skate Style — 2011</p>");
});

// --- Bare URLs (upstream text::auto_link_urls) --------------------------------

test("bare URLs open in a new window; trailing punctuation stays outside", () => {
  assert.equal(
    tx("See http://example.com/a?b=1&c=2. Or (https://example.org)."),
    '<p>See <a href="http://example.com/a?b=1&#x26;c=2" target="_blank">http://example.com/a?b=1&#x26;c=2</a>. ' +
      'Or (<a href="https://example.org" target="_blank">https://example.org</a>).</p>',
  );
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
  assert.equal(tx("﻿h1. Title"), "<h1>Title</h1>");
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

// --- Real content: Ryan's 2011 K2 folder --------------------------------------

test("K2 01. Darko: the top embed is a heading, not literal h1.", () => {
  assert.equal(tx(fixture("01. Darko/-t-top-darko.txt")), "<h1>Darko – Skate Style</h1>");
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
