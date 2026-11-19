/**
 * Location stripping for published images — unit tests, no site build needed.
 *
 * src/lib/stripMetadata.ts rewrites the copy the /directory route publishes.
 * Fixtures are generated here with sharp (GPS EXIF, XMP with GPS + city, a P3
 * ICC profile, Orientation 6), plus a hand-built TIFF and GIF, so the repo
 * carries no binaries.
 *
 * Pixels are proved identical two ways: decoded RGBA from sharp must match the
 * original exactly, and in "location" mode the file must keep its exact length
 * with every changed byte inside a metadata block (for JPEG: the bytes from the
 * first SOS marker to the end are byte-identical).
 *
 * Run:  node --test tests/unit.strip-location.test.mjs   (also part of `npm run test`)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync, deflateSync, crc32 } from "node:zlib";
import { stripImageMetadata, publishedBytes } from "../src/lib/stripMetadata.ts";
import { parseStrictBool } from "../src/lib/site.ts";

const EXIF = {
  IFD0: { Make: "LeakyCam", Model: "X1" },
  IFD3: {
    GPSLatitudeRef: "N",
    GPSLatitude: "40/1 45/1 3000/100",
    GPSLongitudeRef: "W",
    GPSLongitude: "73/1 53/1 1500/100",
  },
};
const XMP =
  '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description rdf:about="" xmlns:exif="http://ns.adobe.com/exif/1.0/" ' +
  'xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
  'exif:GPSLatitude="51,28.7N" photoshop:City="Greenwich" dc:format="image/jpeg">' +
  "<exif:GPSLongitude>0,0.25W</exif:GPSLongitude>" +
  "</rdf:Description></rdf:RDF></x:xmpmeta>" +
  '<?xpacket end="w"?>';

/** A noisy 64×48 image (so JPEG has real scan data) with every metadata kind. */
async function fixture(fmt) {
  const w = 64, h = 48;
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < px.length; i++) px[i] = (i * 37 + ((i / 3) | 0) * 11) & 0xff;
  return sharp(px, { raw: { width: w, height: h, channels: 3 } })
    .withExif(EXIF)
    .withMetadata({ orientation: 6 })
    .withIccProfile("p3")
    .withXmp(XMP)
    [fmt]()
    .toBuffer();
}

// ---- test-side EXIF reader (independent of the code under test) ------------

/** Number of entries in the GPS IFD of a TIFF/EXIF blob; 0 if none. */
function gpsEntryCount(tiff) {
  if (!tiff || tiff.length < 8) return 0;
  const le = tiff[0] === 0x49;
  const r16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const r32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const ifd0 = r32(4);
  const n = r16(ifd0);
  for (let i = 0; i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    if (r16(e) === 0x8825) {
      const gps = r32(e + 8);
      return gps ? r16(gps) : 0;
    }
  }
  return 0;
}

/** sharp's metadata().exif starts with "Exif\0\0" for some formats. */
function exifTiff(meta) {
  const x = meta.exif;
  if (!x) return null;
  return x.toString("latin1", 0, 6) === "Exif\0\0" ? x.subarray(6) : x;
}

async function rgba(buf, opts) {
  return sharp(buf, opts).ensureAlpha().raw().toBuffer();
}

function jpegScanStart(buf) {
  for (let p = 2; p < buf.length - 1; ) {
    if (buf[p] !== 0xff) throw new Error("bad jpeg");
    const m = buf[p + 1];
    if (m === 0xda) return p;
    p += 2 + buf.readUInt16BE(p + 2);
  }
  throw new Error("no SOS");
}

const ext = { jpeg: ".jpg", png: ".png", webp: ".webp", avif: ".avif" };

// ---- location mode (the default) -------------------------------------------

for (const fmt of ["jpeg", "png", "webp", "avif"]) {
  test(`${fmt}: location mode removes GPS + XMP place, keeps ICC, Orientation, pixels`, async () => {
    const src = await fixture(fmt);
    const before = await sharp(src).metadata();
    assert.ok(gpsEntryCount(exifTiff(before)) >= 4, "fixture must carry GPS entries");
    assert.match(before.xmp.toString(), /GPSLatitude/);

    const srcCopy = Buffer.from(src);
    const out = stripImageMetadata(src, ext[fmt], "location");
    assert.ok(src.equals(srcCopy), "input buffer must not be modified");

    const after = await sharp(out).metadata();
    assert.equal(gpsEntryCount(exifTiff(after)), 0, "GPS IFD must be empty");
    const xmp = after.xmp.toString();
    assert.doesNotMatch(xmp, /GPS|51,28|0,0\.25W|Greenwich/);
    assert.match(xmp, /dc:format="image\/jpeg"/, "non-location XMP is kept");
    assert.ok(exifTiff(after).includes("LeakyCam"), "camera make is kept in location mode");
    assert.ok(after.icc && after.icc.equals(before.icc), "ICC profile byte-identical");
    if (fmt !== "avif") assert.equal(after.orientation, 6, "Orientation kept");
    assert.ok((await rgba(out)).equals(await rgba(src)), "decoded pixels identical");
    if (fmt !== "png") assert.equal(out.length, src.length, "in-place: same byte length");
    if (fmt === "jpeg") {
      const s = jpegScanStart(src);
      assert.equal(jpegScanStart(out), s);
      assert.ok(out.subarray(s).equals(src.subarray(s)), "JPEG scan data byte-identical");
    }
  });
}

test("off: publishedBytes with mode null returns the exact bytes", async () => {
  const src = await fixture("jpeg");
  assert.ok(publishedBytes("photos/a.jpg", src, null).equals(src));
});

test("non-image files pass through unchanged", () => {
  const txt = Buffer.from("GPSLatitude 40.7 in a text file");
  assert.ok(publishedBytes("notes/readme.txt", txt, "location").equals(txt));
});

// ---- all mode ---------------------------------------------------------------

for (const fmt of ["jpeg", "png", "webp"]) {
  test(`${fmt}: all mode drops EXIF/XMP, keeps ICC + Orientation, pixels identical`, async () => {
    const src = await fixture(fmt);
    const before = await sharp(src).metadata();
    const out = stripImageMetadata(src, ext[fmt], "all");
    const after = await sharp(out).metadata();
    assert.equal(after.xmp, undefined, "XMP removed");
    assert.ok(!out.includes("LeakyCam"), "camera make removed");
    assert.ok(!out.includes("Greenwich"), "place removed");
    assert.equal(gpsEntryCount(exifTiff(after)), 0);
    assert.equal(after.orientation, 6, "Orientation rewritten");
    assert.ok(after.icc && after.icc.equals(before.icc), "ICC kept");
    assert.ok((await rgba(out)).equals(await rgba(src)), "decoded pixels identical");
    assert.ok(out.length < src.length);
  });
}

test("all mode with Orientation 1 writes no EXIF at all (jpeg)", async () => {
  const src = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#c33" } })
    .withExif(EXIF)
    .jpeg()
    .toBuffer();
  const out = stripImageMetadata(src, ".jpg", "all");
  assert.equal((await sharp(out).metadata()).exif, undefined);
});

// ---- JPEG trailer (MPF secondary images, e.g. iPhone gain maps) -------------

test("jpeg: GPS in an image appended after EOI is scrubbed too", async () => {
  const main = await fixture("jpeg");
  const second = await fixture("jpeg");
  const src = Buffer.concat([main, second]);
  const out = stripImageMetadata(src, ".jpg", "location");
  assert.equal(out.length, src.length);
  const tail = out.subarray(main.length);
  assert.equal(gpsEntryCount(exifTiff(await sharp(tail).metadata())), 0);
  assert.ok(!tail.includes("Greenwich"));
});

// ---- TIFF (hand-built: sharp's TIFF writer has no GPS IFD) ------------------

/** 2×1 8-bit grey uncompressed little-endian TIFF with Make and a GPS IFD. */
function tiffWithGps() {
  const b = Buffer.alloc(240);
  b.write("II", 0, "latin1");
  b.writeUInt16LE(42, 2);
  b.writeUInt32LE(8, 4);
  const entries = [
    [256, 3, 1, 2], // ImageWidth
    [257, 3, 1, 1], // ImageLength
    [258, 3, 1, 8], // BitsPerSample
    [259, 3, 1, 1], // Compression none
    [262, 3, 1, 1], // BlackIsZero
    [271, 2, 7, 180], // Make -> "Camera\0" at 180 (over 4 bytes, so out of line)
    [273, 4, 1, 220], // StripOffsets
    [278, 3, 1, 1], // RowsPerStrip
    [279, 4, 1, 2], // StripByteCounts
    [0x8825, 4, 1, 140], // GPS IFD at 140
  ];
  let p = 8;
  b.writeUInt16LE(entries.length, p);
  p += 2;
  for (const [tag, type, count, val] of entries) {
    b.writeUInt16LE(tag, p);
    b.writeUInt16LE(type, p + 2);
    b.writeUInt32LE(count, p + 4);
    if (type === 3) b.writeUInt16LE(val, p + 8);
    else b.writeUInt32LE(val, p + 8);
    p += 12;
  }
  b.writeUInt32LE(0, p); // next IFD
  // IFD0 ends at 8 + 2 + 10*12 + 4 = 134.
  // GPS IFD at 140: LatitudeRef "N" (inline), Latitude 3 rationals at 190
  b.writeUInt16LE(2, 140);
  b.writeUInt16LE(1, 142), b.writeUInt16LE(2, 144), b.writeUInt32LE(2, 146), b.write("N\0", 150, "latin1");
  b.writeUInt16LE(2, 154), b.writeUInt16LE(5, 156), b.writeUInt32LE(3, 158), b.writeUInt32LE(190, 162);
  b.writeUInt32LE(0, 166);
  b.write("Camera\0", 180, "latin1");
  [40, 1, 45, 1, 30, 1].forEach((v, i) => b.writeUInt32LE(v, 190 + i * 4));
  b[220] = 0x10;
  b[221] = 0xf0;
  return b.subarray(0, 222);
}

test("tiff: GPS IFD emptied in place, image data untouched", async () => {
  const src = tiffWithGps();
  assert.equal(gpsEntryCount(src), 2);
  const out = stripImageMetadata(src, ".tif", "location");
  assert.equal(out.length, src.length);
  assert.equal(gpsEntryCount(out), 0);
  assert.ok(out.subarray(190, 214).every((x) => x === 0), "latitude rationals zeroed");
  assert.ok(out.includes("Camera"), "Make kept in location mode");
  assert.ok(out.subarray(220).equals(src.subarray(220)), "strip bytes identical");
  const lax = { failOn: "none" }; // libtiff warns: the minimal file has no resolution tags
  assert.ok((await rgba(out, lax)).equals(await rgba(src, lax)), "decoded pixels identical");
  const all = stripImageMetadata(src, ".tif", "all");
  assert.ok(!all.includes("Camera"), "Make blanked in all mode");
  assert.ok((await rgba(all, lax)).equals(await rgba(src, lax)));
});

// ---- GIF (XMP application extension) -----------------------------------------

test("gif: location in an XMP extension is blanked and the GIF still decodes", async () => {
  const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#3c6" } })
    .gif()
    .toBuffer();
  const magic = Buffer.alloc(258);
  magic[0] = 0x01;
  for (let i = 0; i < 256; i++) magic[1 + i] = 0xff - i;
  magic[257] = 0x00;
  const ext = Buffer.concat([
    Buffer.from("\x21\xff\x0bXMP DataXMP", "latin1"),
    Buffer.from(XMP, "utf8"),
    magic,
  ]);
  const src = Buffer.concat([gif.subarray(0, gif.length - 1), ext, gif.subarray(gif.length - 1)]);
  assert.ok((await rgba(src)).length > 0, "fixture GIF decodes");
  const out = stripImageMetadata(src, ".gif", "location");
  assert.equal(out.length, src.length);
  assert.ok(!out.includes("Greenwich") && !out.includes("GPSLatitude"));
  assert.ok((await rgba(out)).equals(await rgba(src)));
});

// ---- broken input -------------------------------------------------------------

test("unreadable metadata in a recognised image stops the build with the path", async () => {
  const src = await fixture("jpeg");
  // Cut inside the APP1 EXIF segment: a metadata block that can't be parsed.
  const app1 = src.indexOf("Exif\0\0", 0, "latin1");
  const truncated = src.subarray(0, app1 + 40);
  assert.throws(() => publishedBytes("trips/IMG_0001.jpg", truncated, "location"), (err) => {
    assert.match(err.message, /trips\/IMG_0001\.jpg/);
    assert.match(err.message, /strip_location: false/);
    return true;
  });
});

test("malformed EXIF inside a valid JPEG is blanked, not shipped", async () => {
  const src = Buffer.from(await fixture("jpeg"));
  const i = src.indexOf("Exif\0\0", 0, "latin1") + 6;
  src.writeUInt32LE(0xfffffff0, i + 4); // IFD0 offset points past the block
  const out = stripImageMetadata(src, ".jpg", "location");
  assert.ok(!out.subarray(i, i + 300).includes("LeakyCam"));
  assert.ok((await rgba(out)).equals(await rgba(src)));
});

// =============================================================================
// Review fixes (PR #33): each test below failed before the fix it names.
// =============================================================================

/** Capture console.warn calls while `fn` runs. */
function withWarnings(fn) {
  const seen = [];
  const orig = console.warn;
  console.warn = (...a) => seen.push(a.join(" "));
  try {
    return { result: fn(), warnings: seen };
  } finally {
    console.warn = orig;
  }
}

/** Rebuild a PNG with `extra` chunks inserted just before IDAT. */
function pngChunkBuf(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
  return out;
}
function pngChunks(buf) {
  const list = [];
  for (let p = 8; p < buf.length; ) {
    const len = buf.readUInt32BE(p);
    list.push({ type: buf.toString("latin1", p + 4, p + 8), raw: buf.subarray(p, p + 12 + len) });
    p += 12 + len;
  }
  return list;
}

/**
 * Little-endian TIFF builder. pages: arrays of [tag, type, count, value];
 * value = number (inline) | Buffer (out of line when > 4 bytes) |
 * {ifd: entries} (sub-IFD pointer) | {data: Buffer} (offset to raw bytes).
 * Allocation is in entry order, so callers control what sits next to what.
 * Returns { buf, at } where at[tag] = offset of that entry's 12 bytes.
 */
function buildTiff(pages) {
  const b = Buffer.alloc(1 << 16);
  const at = {};
  let top = 8;
  b.write("II", 0, "latin1");
  b.writeUInt16LE(42, 2);
  const alloc = (n) => {
    const o = top;
    top += n + (n & 1);
    return o;
  };
  function writeIfd(entries) {
    const o = alloc(2 + entries.length * 12 + 4);
    b.writeUInt16LE(entries.length, o);
    entries.forEach(([tag, type, count, val], i) => {
      const e = o + 2 + i * 12;
      at[tag] = e;
      b.writeUInt16LE(tag, e);
      b.writeUInt16LE(type, e + 2);
      b.writeUInt32LE(count, e + 4);
      if (val && val.ifd) b.writeUInt32LE(writeIfd(val.ifd), e + 8);
      else if (val && val.data) {
        const v = alloc(val.data.length);
        val.data.copy(b, v);
        b.writeUInt32LE(v, e + 8);
      } else if (Buffer.isBuffer(val)) {
        if (val.length <= 4) val.copy(b, e + 8);
        else {
          const v = alloc(val.length);
          val.copy(b, v);
          b.writeUInt32LE(v, e + 8);
        }
      } else if (type === 3) b.writeUInt16LE(val, e + 8);
      else b.writeUInt32LE(val, e + 8);
    });
    return o;
  }
  let prevNext = 4;
  for (const entries of pages) {
    const o = writeIfd(entries);
    b.writeUInt32LE(o, prevNext);
    prevNext = o + 2 + entries.length * 12;
  }
  return { buf: Buffer.from(b.subarray(0, top)), at };
}
const rationals = (...v) => {
  const r = Buffer.alloc(v.length * 4);
  v.forEach((x, i) => r.writeUInt32LE(x, i * 4));
  return r;
};
const gpsIfd = () => ({
  ifd: [
    [1, 2, 2, Buffer.from("N\0")],
    [2, 5, 3, rationals(40, 1, 44, 1, 54, 1)],
  ],
});
const imageTags = (px) => [
  [256, 3, 1, 2],
  [257, 3, 1, 1],
  [258, 3, 1, 8],
  [259, 3, 1, 1],
  [262, 3, 1, 1],
  [273, 4, 1, { data: px }],
  [278, 3, 1, 1],
  [279, 4, 1, px.length],
];

// ---- finding 1: PNG text chunks named after EXIF/XMP/IPTC properties --------

test("png: tEXt/zTXt/iTXt chunks carrying location are dropped (ImageMagick style)", async () => {
  const src = await fixture("png");
  const kw = (k, v) => Buffer.from(`${k}\0${v}`, "latin1");
  const extra = [
    pngChunkBuf("tEXt", kw("exif:GPSLatitude", "40/1,44/1,1356/25")),
    pngChunkBuf("tEXt", kw("xmp:GPSLongitude", "73,59.1W")),
    pngChunkBuf("tEXt", kw("photoshop:City", "LEAKCITY")),
    pngChunkBuf("tEXt", kw("Iptc4xmpCore:Location", "LEAKPLACE")),
    pngChunkBuf("zTXt", Buffer.concat([Buffer.from("iptc:City\0\0", "latin1"), deflateSync("LEAKZ")])),
    pngChunkBuf("iTXt", kw("GPSAltitude", "\0\0\0\0LEAKALT")),
    pngChunkBuf("tEXt", kw("Title", "KEEPTITLE")),
  ];
  const chunks = pngChunks(src);
  const i = chunks.findIndex((c) => c.type === "IDAT");
  const tagged = Buffer.concat([
    src.subarray(0, 8),
    ...chunks.slice(0, i).map((c) => c.raw),
    ...extra,
    ...chunks.slice(i).map((c) => c.raw),
  ]);
  const out = stripImageMetadata(tagged, ".png", "location");
  for (const leak of ["GPSLatitude", "GPSLongitude", "LEAKCITY", "LEAKPLACE", "iptc:City", "LEAKALT"]) {
    assert.ok(!out.includes(leak), `${leak} removed`);
  }
  assert.ok(out.includes("KEEPTITLE"), "unrelated text chunk kept");
  assert.ok((await rgba(out)).equals(await rgba(src)));
});

// ---- finding 2: choose images by content, not extension ----------------------

test("images are stripped whatever their extension (.jfif .jpe .mpo .hif .dng)", async () => {
  const jpg = await fixture("jpeg");
  for (const name of ["a.jfif", "a.jpe", "a.mpo", "a.JPG", "a.bin"]) {
    const out = publishedBytes(`p/${name}`, jpg, "location");
    assert.equal(gpsEntryCount(exifTiff(await sharp(out).metadata())), 0, `${name}: GPS removed`);
    assert.ok(!out.includes("Greenwich"), `${name}: XMP place removed`);
  }
  const avif = await fixture("avif"); // ISO-BMFF HEIF family, standing in for a .hif
  const outHif = publishedBytes("p/a.hif", avif, "location");
  assert.ok(!outHif.includes("Greenwich"));
  const { buf: tif } = buildTiff([[...imageTags(Buffer.from([1, 2])), [0x8825, 4, 1, gpsIfd()]]]);
  const outDng = publishedBytes("p/a.dng", tif, "location");
  assert.equal(gpsEntryCount(outDng), 0, "TIFF-based raw (.dng) scrubbed");
});

test("files without an image signature pass through; image-named ones warn", () => {
  const txt = Buffer.from("GPSLatitude 40.7 in a text file");
  const r1 = withWarnings(() => publishedBytes("notes/readme.txt", txt, "location"));
  assert.ok(r1.result.equals(txt));
  assert.equal(r1.warnings.length, 0, "ordinary non-image: no warning");
  for (const [name, body] of [
    ["x/empty.png", Buffer.alloc(0)],
    ["x/really-svg.png", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ["x/page.jpg", Buffer.from("<!doctype html><p>hi</p>")],
  ]) {
    const r = withWarnings(() => publishedBytes(name, body, "location"));
    assert.ok(r.result.equals(body), `${name} unchanged`);
    assert.equal(r.warnings.length, 1, `${name} warns once`);
    assert.ok(r.warnings[0].includes(name), "warning names the file");
  }
});

test("an image-named file with a damaged header but readable EXIF stops the build", async () => {
  const webp = Buffer.from(await fixture("webp"));
  webp.write("RIFX", 0, "latin1"); // no longer sniffs as WebP; exiftool still finds the EXIF
  assert.throws(() => publishedBytes("p/broken.webp", webp, "location"), /broken\.webp.*metadata/s);
});

// ---- B: truncated JPEG is scrubbed and published ------------------------------

test("jpeg truncated in its scan data: metadata scrubbed, file published", async () => {
  const src = await fixture("jpeg");
  const cut = src.subarray(0, jpegScanStart(src) + 40);
  const out = publishedBytes("trips/cut.jpg", cut, "location");
  assert.equal(out.length, cut.length);
  assert.equal(gpsEntryCount(exifTiff(await sharp(out, { failOn: "none" }).metadata())), 0);
  assert.ok(!out.includes("Greenwich"));
  const all = publishedBytes("trips/cut.jpg", cut, "all");
  assert.ok(!all.includes("LeakyCam") && !all.includes("Greenwich"));
  // A PNG cut inside IDAT is published too (no metadata after it is lost).
  const png = await fixture("png");
  const idat = png.indexOf("IDAT", 0, "latin1");
  const cutPng = png.subarray(0, idat + 30);
  assert.ok(!publishedBytes("x/cut.png", cutPng, "location").includes("Greenwich"));
});

test("a corrupt length that would hide later metadata in a 'cut off' tail throws", async () => {
  // WebP: VP8 chunk size made huge, so the EXIF/XMP chunks after it look cut off.
  const webp = Buffer.from(await fixture("webp"));
  const vp8 = webp.indexOf("VP8 ", 12, "latin1");
  webp.writeUInt32LE(0x7ffffff0, vp8 + 4);
  assert.throws(() => stripImageMetadata(webp, ".webp", "location"), /metadata/);
  // PNG: IDAT length made huge with an eXIf chunk after IDAT.
  const png = await fixture("png");
  const chunks = pngChunks(png);
  const ex = chunks.find((c) => c.type === "eXIf");
  const rest = chunks.filter((c) => c !== ex);
  const iend = rest.pop();
  const moved = Buffer.concat([png.subarray(0, 8), ...rest.map((c) => c.raw), ex.raw, iend.raw]);
  moved.writeUInt32BE(0x7ffffff0, moved.indexOf("IDAT", 8, "latin1") - 4);
  assert.throws(() => stripImageMetadata(moved, ".png", "location"), /metadata/);
});

// ---- finding 3: strict booleans for the two strip keys -----------------------

test("config: strip keys accept only booleans and \"true\"/\"false\"", () => {
  assert.equal(parseStrictBool("strip_location", undefined, true), true);
  assert.equal(parseStrictBool("strip_location", null, true), true);
  assert.equal(parseStrictBool("strip_location", false, true), false);
  assert.equal(parseStrictBool("strip_all_metadata", " TRUE ", false), true);
  assert.equal(parseStrictBool("strip_all_metadata", "false", true), false);
  for (const bad of ["yes", "on", "no", "off", 1, 0, "1", "", [], {}]) {
    assert.throws(
      () => parseStrictBool("strip_all_metadata", bad, false),
      /strip_all_metadata.*true or false/s,
      `rejects ${JSON.stringify(bad)}`,
    );
  }
});

test("config: a build with strip_all_metadata: yes stops with a clear error", () => {
  const dir = mkdtempSync(join(tmpdir(), "strip-cfg-"));
  writeFileSync(join(dir, "settings.yml"), "strip_location: no\nstrip_all_metadata: yes\n");
  const r = spawnSync(process.execPath, ["-e", 'await import("./src/lib/site.ts")'], {
    env: { ...process.env, SUBFOLIO_CONFIG_DIR: dir },
    encoding: "utf8",
  });
  rmSync(dir, { recursive: true, force: true });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /strip_location/);
});

// ---- finding 4: TIFF page guard -----------------------------------------------

test("tiff: more than 64 pages throws instead of skipping the rest", () => {
  const pages = Array.from({ length: 65 }, () => [[256, 3, 1, 1]]);
  pages.push([[0x8825, 4, 1, gpsIfd()]]);
  const { buf } = buildTiff(pages);
  assert.throws(() => stripImageMetadata(buf, ".tif", "location"), /64/);
  const ok = buildTiff([...pages.slice(0, 63), pages[65]]).buf; // 64 pages: scrubbed
  assert.ok(!stripImageMetadata(ok, ".tif", "location").includes(rationals(40, 1, 44, 1, 54, 1)));
});

// ---- finding 5: structures that could hold XMP are never skipped silently ----

test("gif: XMP extension with no xpacket end throws", async () => {
  const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#3c6" } }).gif().toBuffer();
  const xmp = XMP.replace('<?xpacket end="w"?>', "");
  const ext = Buffer.concat([Buffer.from("\x21\xff\x0bXMP DataXMP", "latin1"), Buffer.from(xmp), Buffer.from([1, 0])]);
  const src = Buffer.concat([gif.subarray(0, gif.length - 1), ext, gif.subarray(gif.length - 1)]);
  assert.throws(() => stripImageMetadata(src, ".gif", "location"), /xpacket/);
});

/** Minimal HEIF: ftyp heic + meta{iinf v0 + infe v0 (XMP mime item) + iloc v0} + mdat XMP. */
function heifWithV0Xmp() {
  const box = (type, ...parts) => {
    const body = Buffer.concat(parts);
    const h = Buffer.alloc(8);
    h.writeUInt32BE(8 + body.length, 0);
    h.write(type, 4, "latin1");
    return Buffer.concat([h, body]);
  };
  const full = (v) => Buffer.from([v, 0, 0, 0]);
  const u16 = (n) => Buffer.from([n >> 8, n & 0xff]);
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const ftyp = box("ftyp", Buffer.from("heic"), u32(0), Buffer.from("mif1heic"));
  const infe = box("infe", full(0), u16(1), u16(0), Buffer.from("\0application/rdf+xml\0", "latin1"));
  const iinf = box("iinf", full(0), u16(1), infe);
  const xmp = Buffer.from(XMP);
  const mkIloc = (off) => box("iloc", full(0), Buffer.from([0x44, 0x00]), u16(1), u16(1), u16(0), u16(1), u32(off), u32(xmp.length));
  const hdlr = box("hdlr", full(0), u32(0), Buffer.from("pict"), Buffer.alloc(12), Buffer.from("\0"));
  const metaLen = box("meta", full(0), hdlr, iinf, mkIloc(0)).length;
  const meta = box("meta", full(0), hdlr, iinf, mkIloc(ftyp.length + metaLen + 8));
  return Buffer.concat([ftyp, meta, box("mdat", xmp)]);
}

test("heif: XMP item described by an infe version 0 box is scrubbed", () => {
  const src = heifWithV0Xmp();
  assert.ok(src.includes("Greenwich"));
  const out = stripImageMetadata(src, ".heic", "location");
  assert.equal(out.length, src.length);
  assert.ok(!out.includes("Greenwich") && !out.includes("51,28.7N"));
  assert.ok(out.includes('dc:format="image/jpeg"'));
});

test("jpeg: APP1 holding XMP under a damaged signature is scrubbed as XMP", async () => {
  const src = Buffer.from(await fixture("jpeg"));
  const i = src.indexOf("http://ns.adobe.com/xap/1.0/", 0, "latin1");
  src[i + 7] = 0x58; // "ns" -> "Xs"
  const out = stripImageMetadata(src, ".jpg", "location");
  assert.ok(!out.includes("Greenwich") && !out.includes("51,28.7N"));
});

test("xmp: place properties are matched by namespace URI, not a fixed prefix", async () => {
  const xmp = XMP.replace('xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"', 'xmlns:ps="http://ns.adobe.com/photoshop/1.0/"')
    .replace('photoshop:City="Greenwich"', 'ps:City="Greenwich" ps:Country="LEAKLAND"');
  const src = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c33" } }).withXmp(xmp).jpeg().toBuffer();
  assert.ok(src.includes("ps:City"));
  const out = stripImageMetadata(src, ".jpg", "location");
  assert.ok(!out.includes("Greenwich") && !out.includes("LEAKLAND"));
});

test("jpeg: stray bytes between header segments are skipped like libjpeg; hidden EXIF still throws", async () => {
  const src = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#33c" } })
    .withXmp(XMP).jpeg().toBuffer();
  const app0End = 4 + src.readUInt16BE(4); // SOI (2) + marker (2) + APP0 length
  assert.equal(src[app0End], 0xff);
  const stray = Buffer.concat([src.subarray(0, app0End), Buffer.from([0, 0]), src.subarray(app0End)]);
  const out = publishedBytes("x/stray.jpg", stray, "location");
  assert.ok(!out.includes("Greenwich") && !out.includes("51,28.7N"), "XMP place scrubbed after resync");
  const hidden = Buffer.concat([src.subarray(0, app0End), Buffer.from("Exif\0\0", "latin1"), src.subarray(app0End)]);
  assert.throws(() => publishedBytes("x/hidden.jpg", hidden, "location"), /skipped bytes hold metadata/);
});

test("xmp: creator postal address and DJI drone position are blanked", async () => {
  const xmp = XMP.replace(
    'xmlns:dc="http://purl.org/dc/elements/1.1/" ',
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/" ' +
      'xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/" drone-dji:Latitude="+51.4779" drone-dji:Longitude="-0.0015" ' +
      'drone-dji:AbsoluteAltitude="+46.00" ',
  ).replace(
    "</rdf:Description>",
    '<Iptc4xmpCore:CreatorContactInfo Iptc4xmpCore:CiAdrCity="LEAKCREATORCITY" Iptc4xmpCore:CiAdrPcode="LEAKPCODE"/>' +
      "</rdf:Description>",
  );
  const src = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#3c3" } }).withXmp(xmp).jpeg().toBuffer();
  assert.ok(src.includes("LEAKCREATORCITY") && src.includes("51.4779"));
  const out = stripImageMetadata(src, ".jpg", "location");
  for (const leak of ["LEAKCREATORCITY", "LEAKPCODE", "51.4779", "-0.0015", "+46.00"]) {
    assert.ok(!out.includes(leak), `${leak} removed`);
  }
});

// ---- finding 6: GeoTIFF georeferencing ---------------------------------------

test("tiff: GeoTIFF tags are zeroed in location mode", () => {
  const dbl = (...v) => {
    const b = Buffer.alloc(v.length * 8);
    v.forEach((x, i) => b.writeDoubleLE(x, i * 8));
    return b;
  };
  const px = Buffer.from([7, 9]);
  const { buf, at } = buildTiff([
    [
      ...imageTags(px),
      [33550, 12, 3, dbl(0.0001, 0.0001, 0)],
      [33922, 12, 6, dbl(0, 0, 0, -73.9857, 40.7484, 0)],
      [34264, 12, 16, dbl(...Array.from({ length: 16 }, (_, i) => i + 0.5))],
      [34735, 3, 4, Buffer.from([1, 0, 1, 0, 0, 0, 0, 0])],
      [34736, 12, 1, dbl(40.7484)],
      [34737, 2, 8, Buffer.from("WGS 84|\0")],
    ],
  ]);
  const out = stripImageMetadata(buf, ".tif", "location");
  assert.equal(out.length, buf.length);
  assert.ok(!out.includes(dbl(-73.9857)) && !out.includes(dbl(40.7484)) && !out.includes("WGS 84"));
  const strip = buf.readUInt32LE(at[273] + 8);
  assert.ok(out.subarray(strip, strip + 2).equals(px), "pixels untouched");
});

// ---- finding 7: a corrupt GPS count can't zero pixel data ---------------------

test("tiff: a GPS value range that overlaps image data throws, pixels never zeroed", () => {
  const px = Buffer.alloc(16, 0x5a); // enough bytes that a 4-rational value stays inside the file
  // GPS IFD (and its latitude value) is allocated right before the strip data.
  const { buf, at } = buildTiff([[[0x8825, 4, 1, gpsIfd()], ...imageTags(px)]]);
  buf.writeUInt32LE(4, at[2] + 4); // GPSLatitude count 3 -> 4: 8 bytes into the strip
  assert.throws(() => stripImageMetadata(buf, ".tif", "location"), /overlap/);
  const big = Buffer.from(buf);
  big.writeUInt32LE(100000, at[2] + 4);
  assert.throws(() => stripImageMetadata(big, ".tif", "location"));
});

// ---- 9 and 10 ----------------------------------------------------------------

test("png all mode keeps Orientation when eXIf comes after IDAT", async () => {
  const src = await fixture("png");
  const chunks = pngChunks(src);
  const ex = chunks.find((c) => c.type === "eXIf");
  const rest = chunks.filter((c) => c !== ex);
  const iend = rest.pop();
  const moved = Buffer.concat([src.subarray(0, 8), ...rest.map((c) => c.raw), ex.raw, iend.raw]);
  const out = stripImageMetadata(moved, ".png", "all");
  assert.equal((await sharp(out).metadata()).orientation, 6);
});

test("xmp: an empty GPS element with attributes doesn't blank later properties", async () => {
  const xmp = XMP.replace(
    "<exif:GPSLongitude>",
    '<exif:GPSLatitude rdf:resource="x"/><dc:title>KEEPME</dc:title><dc:rights>KEEPRIGHTS</dc:rights><exif:GPSLatitude>51,28.6N</exif:GPSLatitude><exif:GPSLongitude>',
  );
  const src = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c33" } }).withXmp(xmp).jpeg().toBuffer();
  const out = stripImageMetadata(src, ".jpg", "location");
  assert.ok(out.includes("KEEPME") && out.includes("KEEPRIGHTS"));
  assert.ok(!out.includes("GPSLatitude") && !out.includes("0,0.25W") && !out.includes("51,28.6N"));
});

// ---- C: motion photo (MP4 appended after the JPEG) ----------------------------

/** Stub QuickTime movie: ftyp + moov{udta{©xyz}, meta{hdlr, keys, ilst}} + mdat. */
function stubMovie() {
  const box = (type, ...parts) => {
    const body = Buffer.concat(parts);
    const h = Buffer.alloc(8);
    h.writeUInt32BE(8 + body.length, 0);
    h.write(type, 4, "latin1");
    return Buffer.concat([h, body]);
  };
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const iso = "+40.7484-073.9857/";
  const xyzBody = Buffer.concat([Buffer.from([0, iso.length, 0x15, 0xc7]), Buffer.from(iso)]);
  const udta = box("udta", box("\xa9xyz", xyzBody));
  const key = (name) => Buffer.concat([u32(8 + name.length), Buffer.from("mdta"), Buffer.from(name)]);
  const keys = box("keys", u32(0), u32(2), key("com.apple.quicktime.make"), key("com.apple.quicktime.location.ISO6709"));
  const data = (s) => box("data", u32(1), u32(0), Buffer.from(s));
  const ilst = box("ilst", box("\0\0\0\x01", data("KEEPMAKE")), box("\0\0\0\x02", data("+40.7484-073.9857+012.000/")));
  const hdlr = box("hdlr", u32(0), u32(0), Buffer.from("mdta"), Buffer.alloc(12), Buffer.from("\0"));
  const meta = box("meta", hdlr, keys, ilst); // QuickTime style: no version/flags
  const moov = box("moov", box("mvhd", Buffer.alloc(100)), udta, meta);
  return Buffer.concat([box("ftyp", Buffer.from("qt  "), u32(0), Buffer.from("qt  ")), moov, box("mdat", Buffer.from("VIDEO-BYTES"))]);
}

test("jpeg motion photo: ©xyz and Apple location keys in the appended movie are blanked", async () => {
  const main = await fixture("jpeg");
  const mov = stubMovie();
  const src = Buffer.concat([main, mov]);
  const out = stripImageMetadata(src, ".jpg", "location");
  assert.equal(out.length, src.length);
  const tail = out.subarray(main.length);
  assert.ok(!tail.includes("40.7484"), "location strings gone");
  assert.ok(tail.includes("KEEPMAKE") && tail.includes("VIDEO-BYTES"), "other movie data kept");
  assert.ok(tail.includes("com.apple.quicktime.location.ISO6709"), "key names untouched");
  let diff = 0;
  for (let i = 0; i < mov.length; i++) if (tail[i] !== mov[i]) diff++;
  assert.ok(diff > 0 && diff <= 18 + 26, "only the two location values changed");
  assert.equal(gpsEntryCount(exifTiff(await sharp(out).metadata())), 0);
});

// ---- A: .oplx zips go through the same filter ----------------------------------

/** Read a zip's entries (stored or deflated) into a name -> Buffer map. */
function readZip(zip) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < n; i++) {
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(dataAt, dataAt + csize);
    if (!name.endsWith("/")) out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

test("oplx: images inside a generated .oplx zip are stripped; mode change rebuilds", async () => {
  const root = mkdtempSync(join(tmpdir(), "strip-oplx-"));
  const content = join(root, "content");
  const cache = join(root, "cache");
  const cfgOn = join(root, "cfg-on");
  const cfgOff = join(root, "cfg-off");
  mkdirSync(join(content, "deck.oplx", "img"), { recursive: true });
  mkdirSync(cfgOn);
  mkdirSync(cfgOff);
  writeFileSync(join(cfgOn, "settings.yml"), "strip_location: true\n");
  writeFileSync(join(cfgOff, "settings.yml"), "strip_location: false\n");
  const jpg = await fixture("jpeg");
  writeFileSync(join(content, "deck.oplx", "img", "photo.jpg"), jpg);
  writeFileSync(join(content, "deck.oplx", "notes.txt"), "GPSLatitude stays in text");
  const zipPath = join(cache, "deck.oplx.zip");
  // A zip cached before this change (newer than the source, no mode record).
  mkdirSync(cache, { recursive: true });
  writeFileSync(zipPath, "stale");
  const future = new Date(Date.now() + 3600_000);
  utimesSync(zipPath, future, future);
  const run = (cfg) =>
    spawnSync(process.execPath, ["scripts/gen-oplx.mjs"], {
      env: { ...process.env, SUBFOLIO_CONTENT_DIR: content, SUBFOLIO_OPLX_CACHE: cache, SUBFOLIO_CONFIG_DIR: cfg },
      encoding: "utf8",
    });
  try {
    let r = run(cfgOn);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 created/, "stale pre-change zip rebuilt");
    let files = readZip(readFileSync(zipPath));
    const photo = files.get("img/photo.jpg");
    assert.ok(photo && photo.length === jpg.length);
    assert.equal(gpsEntryCount(exifTiff(await sharp(photo).metadata())), 0, "GPS stripped inside zip");
    assert.ok(!photo.includes("Greenwich"));
    assert.equal(files.get("notes.txt").toString(), "GPSLatitude stays in text");
    r = run(cfgOn);
    assert.match(r.stdout, /1 fresh/, "same mode: cached zip reused");
    r = run(cfgOff);
    assert.match(r.stdout, /1 created/, "mode change: rebuilt");
    files = readZip(readFileSync(zipPath));
    assert.ok(files.get("img/photo.jpg").equals(jpg), "strip_location: false keeps original bytes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
