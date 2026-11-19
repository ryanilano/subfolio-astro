/**
 * Location and metadata stripping for published images (TypeScript, no deps).
 *
 * The /directory route copies content files into the build byte for byte, so a
 * phone photo would ship with its GPS position. This module rewrites the
 * PUBLISHED copy only; the source file on disk is never touched.
 *
 * Design rule: never re-encode. Pixel data (JPEG scan data, PNG IDAT, WebP
 * VP8/VP8L, AVIF/HEIC item data, TIFF strips) is copied untouched. Two modes:
 *
 *   "location" (default): metadata is edited IN PLACE at the same byte length.
 *     Location fields are overwritten (zeros in EXIF, spaces in XMP/IPTC), so
 *     every offset in the file stays valid: MPF secondary images (iPhone gain
 *     maps), HEIF item locations, TIFF strip offsets. ICC profile and EXIF
 *     Orientation are untouched because nothing else changes.
 *
 *   "all": for JPEG, PNG and WebP every metadata block is removed except the
 *     ICC colour profile; a minimal EXIF holding only Orientation is written
 *     back when the photo is rotated. For TIFF, AVIF, HEIC and GIF (where blocks
 *     can't be dropped without rewriting offsets) the location scrub runs plus
 *     in-place blanking of camera/owner fields, the EXIF sub-IFD, XMP and IPTC.
 *
 * Which files: chosen by content (magic bytes), never by extension. Anything
 * that sniffs as JPEG, PNG, WebP, GIF, TIFF (DNG and other TIFF-based raws) or
 * ISO-BMFF HEIF/AVIF is stripped whatever its name. Bytes with no image
 * signature pass through unchanged (they can't hold readable EXIF, XMP or
 * IPTC); if the NAME claims an image, a warning names the file.
 *
 * Fail loud, narrowly: a recognised image whose metadata structure can't be
 * parsed or skipped safely throws a StripError naming the problem (an XMP
 * packet with no end marker, an EXIF value range that overlaps pixel data,
 * more TIFF pages than the guard allows). The route adds the path, so the
 * build stops instead of shipping an image that might still carry a location.
 * Damage outside metadata (a JPEG cut off in its scan data, a PNG cut off in
 * IDAT) does not stop the build: the metadata that is there is scrubbed.
 */

import { inflateSync, deflateSync, crc32 } from "node:zlib";

export type StripMode = "location" | "all";

export class StripError extends Error {}

/**
 * Bumped whenever the stripper's output changes, so caches of stripped files
 * (scripts/gen-oplx.mjs) are rebuilt instead of serving an older strip.
 */
export const STRIP_VERSION = 2;

/**
 * Extensions that name an image (lowercase, with dot). Used ONLY to decide
 * whether a file with no image signature deserves a warning; which files are
 * stripped is decided by sniffImage(), from the bytes.
 */
export const IMAGE_EXTS = new Set([
  ".jpg", ".jpeg", ".jpe", ".jfif", ".jif", ".mpo", ".png", ".apng", ".webp", ".avif",
  ".avifs", ".heic", ".heics", ".heif", ".hif", ".tif", ".tiff", ".dng", ".gif",
]);

/**
 * In a file NAMED as an image but with no image signature, these mean a
 * damaged image whose metadata is still readable. `<rdf:RDF` is left out on
 * purpose: Inkscape writes it into ordinary SVGs.
 */
const ORPHAN_METADATA_SIGNATURES = ["Exif\0\0", "II*\0", "MM\0*", "<x:xmpmeta", "8BIM"];

export type ImageKind = "jpeg" | "png" | "webp" | "tiff" | "heif" | "gif";

/** Identify an image container from its first bytes; null if it isn't one. */
export function sniffImage(b: Buffer): ImageKind | null {
  if (isJpeg(b)) return "jpeg";
  if (isPng(b)) return "png";
  if (isWebp(b)) return "webp";
  if (isTiffHeader(b, 0) || isBigTiff(b)) return "tiff";
  if (isIsoBmff(b)) return "heif";
  if (isGif(b)) return "gif";
  return null;
}

/**
 * Strip metadata from `buf`. Returns a new Buffer; `buf` is not modified.
 * The format comes from the bytes (sniffImage); `ext` is informational only.
 * Bytes that aren't a recognised image are returned as a copy.
 */
export function stripImageMetadata(buf: Buffer, _ext: string, mode: StripMode): Buffer {
  const kind = sniffImage(buf);
  const out = Buffer.from(buf); // private copy; location mode edits this in place
  switch (kind) {
    case "jpeg":
      return mode === "all" ? jpegStripAll(out) : jpegScrub(out);
    case "png":
      return pngProcess(out, mode);
    case "webp":
      return mode === "all" ? webpStripAll(out) : webpScrub(out);
    case "tiff":
      need(!isBigTiff(out), "BigTIFF files are not supported");
      scrubTiff(out, 0, out.length, mode);
      return out;
    case "heif":
      isoScrub(out, mode);
      return out;
    case "gif":
      gifScrub(out, mode);
      return out;
    default:
      return out;
  }
}

/**
 * Apply a metadata policy to one published file. `mode` null = unchanged.
 * Files are chosen by content: bytes with no image signature pass through
 * unchanged (with a warning when the name claims an image). A recognised image
 * whose metadata can't be parsed throws an Error naming `relPath`, so the build
 * stops instead of publishing an image that may still carry its GPS position.
 */
export function publishedBytes(relPath: string, body: Buffer, mode: StripMode | null): Buffer {
  if (mode === null) return body;
  if (sniffImage(body) === null) {
    const dot = relPath.lastIndexOf(".");
    const ext = dot >= 0 ? relPath.slice(dot).toLowerCase() : "";
    if (IMAGE_EXTS.has(ext)) {
      // A damaged header can hide an image whose EXIF/XMP a scanning reader
      // (exiftool) still finds. Only signature-free bytes pass.
      const sig = ORPHAN_METADATA_SIGNATURES.find((x) => body.includes(x, 0, "latin1"));
      if (sig !== undefined) {
        throw new Error(
          `[strip-location] ${relPath}: not a readable image, but it holds metadata ` +
            `(${JSON.stringify(sig)}) that tools can still read. The build stopped rather ` +
            `than publish it. Fix or remove the file, or set strip_location: false ` +
            `(and strip_all_metadata: false) in settings.yml.`,
        );
      }
      console.warn(
        `[strip-location] ${relPath}: no image signature in the bytes, so it can't hold ` +
          `readable EXIF, XMP or IPTC. Published unchanged.`,
      );
    }
    return body;
  }
  try {
    return stripImageMetadata(body, relPath, mode);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[strip-location] ${relPath}: ${why}. Location data could not be removed, so the build ` +
        `stopped rather than publish it. Fix or remove the file, or set strip_location: false ` +
        `(and strip_all_metadata: false) in settings.yml.`,
    );
  }
}

// ---------------------------------------------------------------- shared bits

const XMP_SIG = "http://ns.adobe.com/xap/1.0/\0";
const XMP_EXT_SIG = "http://ns.adobe.com/xmp/extension/\0";
const EXIF_SIG = "Exif\0\0";

function startsWithAscii(buf: Buffer, at: number, s: string): boolean {
  if (at < 0 || at + s.length > buf.length) return false;
  return buf.toString("latin1", at, at + s.length) === s;
}

function need(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new StripError(msg);
}

/** Byte patterns that mean "metadata lives here" in any container. */
const METADATA_SIGNATURES = [
  "Exif\0\0", "II*\0", "MM\0*", "<x:xmpmeta", "<rdf:RDF", "xpacket", "8BIM",
];

/**
 * A file cut short or damaged is published from the point parsing stopped
 * only when the unparsed rest holds no metadata. A corrupt length field can
 * make a later EXIF/XMP block look like part of the "cut off" tail; that must
 * stop the build, not ship unscrubbed. `extra` adds container-specific names.
 */
function needCleanTail(b: Buffer, from: number, what: string, extra: string[] = []): void {
  const tail = b.subarray(from);
  for (const sig of [...METADATA_SIGNATURES, ...extra]) {
    need(
      !tail.includes(sig, 0, "latin1"),
      `${what} is cut short or damaged, and the unreadable rest holds metadata (${JSON.stringify(sig)})`,
    );
  }
}

// ----------------------------------------------------------------- TIFF/EXIF

const TYPE_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4,
};

const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_INTEROP_IFD = 0xa005;
const TAG_XMP = 700;
const TAG_IPTC = 33723;
const TAG_PHOTOSHOP = 34377;
const TAG_ORIENTATION = 0x0112;

/** IFD0 fields blanked in "all" mode: text that names a camera, owner or time. */
const ALL_MODE_BLANK_TAGS = new Set([
  0x010e, // ImageDescription
  0x010f, // Make
  0x0110, // Model
  0x0131, // Software
  0x0132, // DateTime
  0x013b, // Artist
  0x013c, // HostComputer
  0x8298, // Copyright
  0x9c9b, 0x9c9c, 0x9c9d, 0x9c9e, 0x9c9f, // XPTitle/Comment/Author/Keywords/Subject
  0xc4a5, // PrintIM
]);

/** GeoTIFF georeferencing: pixel scale, tiepoints, transformation, GeoKeys. */
const GEOTIFF_TAGS = new Set([33550, 33922, 34264, 34735, 34736, 34737]);

/** More pages than this stops the build rather than leave pages unchecked. */
const MAX_TIFF_PAGES = 64;
/** A GPS value larger than this is a corrupt count, not data. */
const MAX_GPS_VALUE = 4096;
/** Upper bound for any other value this module zeroes. */
const MAX_VALUE = 16 * 1024 * 1024;

function isBigTiff(b: Buffer): boolean {
  if (b.length < 8) return false;
  if (b[0] === 0x49 && b[1] === 0x49) return b.readUInt16LE(2) === 43;
  if (b[0] === 0x4d && b[1] === 0x4d) return b.readUInt16BE(2) === 43;
  return false;
}

function isTiffHeader(buf: Buffer, at: number): boolean {
  if (at + 8 > buf.length) return false;
  const a = buf[at], b = buf[at + 1];
  if (a === 0x49 && b === 0x49) return buf.readUInt16LE(at + 2) === 42;
  if (a === 0x4d && b === 0x4d) return buf.readUInt16BE(at + 2) === 42;
  return false;
}

interface Tiff {
  buf: Buffer;
  base: number; // absolute offset of the TIFF header
  end: number; // absolute end of the TIFF blob
  le: boolean;
}

function u16(t: Tiff, off: number): number {
  const at = t.base + off;
  need(at + 2 <= t.end, "EXIF offset out of range");
  return t.le ? t.buf.readUInt16LE(at) : t.buf.readUInt16BE(at);
}
function u32(t: Tiff, off: number): number {
  const at = t.base + off;
  need(at + 4 <= t.end, "EXIF offset out of range");
  return t.le ? t.buf.readUInt32LE(at) : t.buf.readUInt32BE(at);
}

interface Entry {
  pos: number; // TIFF-relative offset of the 12-byte entry
  tag: number;
  type: number;
  count: number;
  valueOff: number; // TIFF-relative offset of the value bytes
  size: number; // byte length of the value
}

function readIfd(t: Tiff, ifdOff: number): { entries: Entry[]; next: number } {
  const n = u16(t, ifdOff);
  need(t.base + ifdOff + 2 + n * 12 + 4 <= t.end, "EXIF directory runs past the data");
  const entries: Entry[] = [];
  for (let i = 0; i < n; i++) {
    const pos = ifdOff + 2 + i * 12;
    const tag = u16(t, pos);
    const type = u16(t, pos + 2);
    const count = u32(t, pos + 4);
    const size = (TYPE_SIZE[type] ?? 1) * count;
    const valueOff = size <= 4 ? pos + 8 : u32(t, pos + 8);
    entries.push({ pos, tag, type, count, valueOff, size });
  }
  return { entries, next: u32(t, ifdOff + 2 + n * 12) };
}

function valueInRange(t: Tiff, e: Entry): boolean {
  return e.valueOff >= 0 && t.base + e.valueOff + e.size <= t.end;
}

/**
 * TIFF-relative byte ranges that must never be zeroed: every directory table
 * (main chain, EXIF, GPS, interop) and all image data (strips, tiles, the IFD1
 * JPEG thumbnail). Lenient: a range that can't be read is left out.
 */
function protectedRanges(t: Tiff, chain: number[]): [number, number][] {
  const r: [number, number][] = [];
  const table = (off: number) => {
    try {
      r.push([off, off + 2 + u16(t, off) * 12 + 4]);
      return readIfd(t, off).entries;
    } catch {
      return [];
    }
  };
  const array = (e: Entry | undefined): number[] => {
    if (!e || (e.type !== 3 && e.type !== 4) || e.count > 1_000_000 || !valueInRange(t, e)) return [];
    const out: number[] = [];
    for (let i = 0; i < e.count; i++) {
      out.push(e.type === 3 ? u16(t, e.valueOff + i * 2) : u32(t, e.valueOff + i * 4));
    }
    return out;
  };
  const subTables = (entries: Entry[], depth: number) => {
    for (const e of entries) {
      if (e.tag !== TAG_EXIF_IFD && e.tag !== TAG_GPS_IFD && e.tag !== TAG_INTEROP_IFD) continue;
      let sub = 0;
      try {
        sub = u32(t, e.valueOff);
      } catch {
        continue;
      }
      if (sub > 0 && depth < 3) subTables(table(sub), depth + 1);
    }
  };
  for (const ifd of chain) {
    const entries = table(ifd);
    subTables(entries, 0);
    const get = (tag: number) => entries.find((x) => x.tag === tag);
    for (const [offTag, lenTag] of [[273, 279], [324, 325], [513, 514]]) {
      const offs = array(get(offTag));
      const lens = array(get(lenTag));
      if (offTag === 513) {
        // JPEGInterchangeFormat/Length are single LONGs held inline.
        const o = get(513), l = get(514);
        if (o && l) r.push([u32(t, o.pos + 8), u32(t, o.pos + 8) + u32(t, l.pos + 8)]);
        continue;
      }
      for (let i = 0; i < Math.min(offs.length, lens.length); i++) r.push([offs[i], offs[i] + lens[i]]);
    }
  }
  return r;
}

interface ZeroGuard {
  ranges: [number, number][];
  maxValue: number;
}

/**
 * Zero one entry's out-of-line value, refusing (StripError) when the range is
 * implausibly large or overlaps a directory or image data: a corrupt count must
 * never zero pixels. A value that lies outside the data holds nothing to zero.
 */
function zeroValue(t: Tiff, e: Entry, g: ZeroGuard, what: string): void {
  if (e.size <= 4) return;
  need(e.size <= g.maxValue, `${what} value of ${e.size} bytes is implausibly large (corrupt count)`);
  if (!valueInRange(t, e)) return;
  const a = e.valueOff, b = e.valueOff + e.size;
  for (const [x, y] of g.ranges) {
    need(!(a < y && x < b), `${what} value at ${a}..${b} overlaps image data or a directory (corrupt entry)`);
  }
  t.buf.fill(0, t.base + a, t.base + b);
}

/** Zero an IFD's values and entries, leaving a valid empty IFD (count 0). */
function emptyIfd(t: Tiff, ifdOff: number, seen: Set<number>, g: ZeroGuard, what: string): void {
  if (seen.has(ifdOff)) return;
  seen.add(ifdOff);
  const { entries } = readIfd(t, ifdOff);
  for (const e of entries) {
    // Nested IFDs (interop inside EXIF) are emptied too.
    if (e.tag === TAG_INTEROP_IFD || e.tag === TAG_GPS_IFD || e.tag === TAG_EXIF_IFD) {
      const sub = u32(t, e.valueOff);
      if (sub > 0) emptyIfd(t, sub, seen, g, what);
    }
    zeroValue(t, e, g, what);
  }
  // Entries are zeroed only after every value checked out, so a refusal above
  // leaves no half-emptied directory.
  for (const e of entries) t.buf.fill(0, t.base + e.pos, t.base + e.pos + 12);
  // count 0; the 4-byte next-IFD pointer that now follows is already zeroed
  // (it was the first entry's bytes) or keeps the old value for an n=0 IFD.
  const at = t.base + ifdOff;
  t.buf.fill(0, at, at + 2 + 4);
}

/**
 * Scrub a TIFF structure (an EXIF blob or a whole .tif file) in place, walking
 * every IFD in the chain. Image-structure tags are never touched; "all" mode
 * only blanks the named text fields and empties the EXIF sub-IFD.
 */
function scrubTiff(buf: Buffer, start: number, end: number, mode: StripMode): void {
  need(isTiffHeader(buf, start), "EXIF block has no TIFF header");
  const t: Tiff = { buf, base: start, end, le: buf[start] === 0x49 };
  // Walk the whole page chain first, so a file with too many pages stops the
  // build before anything is written.
  const chain: number[] = [];
  const seen = new Set<number>();
  for (let ifd = u32(t, 4); ifd !== 0; ifd = readIfd(t, ifd).next) {
    need(!seen.has(ifd), "EXIF directory loop");
    need(
      chain.length < MAX_TIFF_PAGES,
      `TIFF has more than ${MAX_TIFF_PAGES} pages; the rest can't be checked for location data`,
    );
    seen.add(ifd);
    chain.push(ifd);
  }
  const ranges = protectedRanges(t, chain);
  const gpsGuard: ZeroGuard = { ranges, maxValue: MAX_GPS_VALUE };
  const anyGuard: ZeroGuard = { ranges, maxValue: MAX_VALUE };
  for (const ifd of chain) {
    const { entries } = readIfd(t, ifd);
    for (const e of entries) {
      if (e.tag === TAG_GPS_IFD) {
        const gps = u32(t, e.valueOff);
        if (gps > 0) emptyIfd(t, gps, seen, gpsGuard, "GPS");
      } else if (e.tag === TAG_EXIF_IFD && mode === "all") {
        const sub = u32(t, e.valueOff);
        if (sub > 0) emptyIfd(t, sub, seen, anyGuard, "EXIF");
      } else if (GEOTIFF_TAGS.has(e.tag)) {
        // GeoTIFF georeferencing: zero the value, keep the (now empty) tag.
        if (e.size <= 4) buf.fill(0, t.base + e.pos + 8, t.base + e.pos + 12);
        else zeroValue(t, e, anyGuard, "GeoTIFF");
      } else if (e.tag === TAG_XMP && valueInRange(t, e)) {
        scrubXmp(buf, t.base + e.valueOff, t.base + e.valueOff + e.size, mode);
      } else if (e.tag === TAG_IPTC && valueInRange(t, e)) {
        scrubIptc(buf, t.base + e.valueOff, t.base + e.valueOff + e.size, mode);
      } else if (e.tag === TAG_PHOTOSHOP && valueInRange(t, e)) {
        scrub8bim(buf, t.base + e.valueOff, t.base + e.valueOff + e.size, mode);
      } else if (mode === "all" && ALL_MODE_BLANK_TAGS.has(e.tag)) {
        zeroValue(t, e, anyGuard, "IFD0 text");
      }
    }
  }
}

/**
 * Location scrub with a safety net: if the EXIF block is malformed, blank the
 * whole block rather than risk leaving a GPS IFD behind. Readers then see an
 * unreadable EXIF and ignore it (Orientation is lost for that file only).
 */
function scrubExifBlob(buf: Buffer, start: number, end: number, mode: StripMode): void {
  try {
    scrubTiff(buf, start, end, mode);
  } catch (err) {
    if (!(err instanceof StripError)) throw err;
    buf.fill(0, start, end);
  }
}

/** Orientation (1..8) from an EXIF/TIFF blob, or 1 if absent/unreadable. */
function readOrientation(buf: Buffer, start: number, end: number): number {
  try {
    if (!isTiffHeader(buf, start)) return 1;
    const t: Tiff = { buf, base: start, end, le: buf[start] === 0x49 };
    const { entries } = readIfd(t, u32(t, 4));
    const e = entries.find((x) => x.tag === TAG_ORIENTATION && x.type === 3);
    if (!e) return 1;
    const v = u16(t, e.valueOff);
    return v >= 1 && v <= 8 ? v : 1;
  } catch {
    return 1;
  }
}

/** A 26-byte big-endian TIFF holding only IFD0 Orientation. */
function minimalOrientationTiff(orientation: number): Buffer {
  const b = Buffer.alloc(26);
  b.write("MM", 0, "latin1");
  b.writeUInt16BE(42, 2);
  b.writeUInt32BE(8, 4);
  b.writeUInt16BE(1, 8); // one entry
  b.writeUInt16BE(TAG_ORIENTATION, 10);
  b.writeUInt16BE(3, 12); // SHORT
  b.writeUInt32BE(1, 14);
  b.writeUInt16BE(orientation, 18);
  b.writeUInt32BE(0, 22); // no next IFD
  return b;
}

// ------------------------------------------------------------------------ XMP

/**
 * XMP properties that carry a place. Matched by qualified name; covers EXIF GPS
 * in XMP, DJI/drone Gps* fields, IPTC Core/Extension locations, Photoshop
 * City/State/Country, and Dublin Core coverage.
 */
const XMP_PLACE_NS: [prefix: string, uri: string, names: string][] = [
  ["photoshop", "http://ns.adobe.com/photoshop/1.0/", "City|State|Country"],
  // CreatorContactInfo and its Ci* fields hold the creator's postal address.
  [
    "Iptc4xmpCore",
    "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/",
    "Location|CountryCode|CreatorContactInfo|CiAdrExtadr|CiAdrCity|CiAdrRegion|CiAdrPcode|CiAdrCtry",
  ],
  // DJI drones write position without the GPS prefix (drone-dji:Latitude, ...).
  ["drone-dji", "http://www.dji.com/drone-dji/1.0/", "Latitude|Longitude|AbsoluteAltitude|RelativeAltitude"],
  [
    "Iptc4xmpExt",
    "http://iptc.org/std/Iptc4xmpExt/2008-02-29/",
    "LocationCreated|LocationShown|City|CountryName|CountryCode|ProvinceState|Sublocation|WorldRegion",
  ],
  ["dc", "http://purl.org/dc/elements/1.1/", "coverage"],
];
const ANY_GPS = "[A-Za-z][\\w.-]*:(?:GPS|Gps)\\w*";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Qualified-name pattern for XMP place properties in packet `s`. A namespace is
 * matched by its URI: any prefix the packet binds to the Photoshop, IPTC or
 * Dublin Core namespace counts (`ps:City`), as well as the usual prefix.
 */
function xmpLocationName(s: string): string {
  const alts = [ANY_GPS];
  for (const [def, uri, names] of XMP_PLACE_NS) {
    const prefixes = new Set([def]);
    for (const m of s.matchAll(/xmlns:([A-Za-z_][\w.-]*)\s*=\s*["']([^"']*)["']/g)) {
      if (m[2] === uri) prefixes.add(m[1]);
    }
    alts.push(`(?:${[...prefixes].map(escapeRe).join("|")}):(?:${names})`);
  }
  return `(?:${alts.join("|")})`;
}

function spaces(m: string): string {
  return " ".repeat(m.length);
}

/**
 * Blank location properties in an XMP packet in place (same byte length).
 * Operates on latin1, which maps bytes 1:1, so multi-byte UTF-8 survives.
 * "all" mode blanks the whole packet.
 */
function scrubXmp(buf: Buffer, start: number, end: number, mode: StripMode): void {
  if (end <= start) return;
  if (mode === "all") {
    buf.fill(0x20, start, end);
    return;
  }
  const s = buf.toString("latin1", start, end);
  const n = xmpLocationName(s);
  const out = s
    // <name .../>  (empty element form) FIRST: otherwise the element pattern
    // reads `<name attr/>` as an opening tag and blanks through the next close.
    .replace(new RegExp(`<${n}(?:\\s[^>]*)?/>`, "g"), spaces)
    // <name ...>...</name>  (element form, incl. structs like LocationShown)
    .replace(new RegExp(`<(${n})(?:\\s[^>]*)?>[\\s\\S]*?</\\1\\s*>`, "g"), spaces)
    // name="..."  (attribute form)
    .replace(new RegExp(`\\s${n}\\s*=\\s*(?:"[^"]*"|'[^']*')`, "g"), spaces);
  if (out !== s) buf.write(out, start, end - start, "latin1");
}

// ----------------------------------------------------------------- IPTC / 8BIM

/** IPTC IIM record-2 datasets that name a place. */
const IPTC_LOCATION_DATASETS = new Set([26, 27, 90, 92, 95, 100, 101]);

/** Blank location datasets (all record-2 values in "all" mode) in place. */
function scrubIptc(buf: Buffer, start: number, end: number, mode: StripMode): void {
  let p = start;
  while (p + 5 <= end && buf[p] === 0x1c) {
    const record = buf[p + 1];
    const dataset = buf[p + 2];
    let len = buf.readUInt16BE(p + 3);
    let data = p + 5;
    if (len & 0x8000) {
      // extended length: low 15 bits = number of length bytes that follow
      const nbytes = len & 0x7fff;
      if (nbytes > 4 || data + nbytes > end) return;
      len = buf.readUIntBE(data, nbytes);
      data += nbytes;
    }
    if (data + len > end) return;
    if (record === 2 && (mode === "all" || IPTC_LOCATION_DATASETS.has(dataset))) {
      if (!(mode === "all" && dataset === 0)) buf.fill(0x20, data, data + len); // keep record version
    }
    p = data + len;
  }
}

/** Walk Photoshop image resources ("8BIM" blocks) and scrub the ones that hold metadata. */
function scrub8bim(buf: Buffer, start: number, end: number, mode: StripMode): void {
  let p = start;
  while (p + 12 <= end && startsWithAscii(buf, p, "8BIM")) {
    const id = buf.readUInt16BE(p + 4);
    const nameLen = buf[p + 6];
    let q = p + 7 + nameLen;
    if ((nameLen + 1) % 2) q++; // pascal string padded to even length
    if (q + 4 > end) return;
    const size = buf.readUInt32BE(q);
    const data = q + 4;
    if (data + size > end) return;
    if (id === 0x0404) scrubIptc(buf, data, data + size, mode);
    else if (id === 0x0422 || id === 0x0423) {
      if (mode === "all") buf.fill(0, data, data + size);
      else if (isTiffHeader(buf, data)) scrubExifBlob(buf, data, data + size, mode);
    } else if (id === 0x0424) scrubXmp(buf, data, data + size, mode);
    p = data + size + (size % 2);
  }
}

// ----------------------------------------------------------------------- JPEG

function isJpeg(b: Buffer): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

interface Seg {
  marker: number;
  start: number; // offset of 0xFF
  dataStart: number; // after the 2-byte length
  end: number; // exclusive
}

interface ParsedJpeg {
  segs: Seg[];
  /** Offset just past EOI; the file length when the file is cut short. */
  eoiEnd: number;
  /**
   * Where segment structure was lost after the first scan (garbage where a
   * marker should be), or -1. Bytes from here on are treated like a trailer.
   */
  lostAt: number;
}

/**
 * Parse JPEG segments up to EOI. Entropy-coded data after each SOS is skipped
 * by scanning for the next real marker (handles progressive files).
 *
 * A file cut short (no EOI, scan data running to the end, a non-metadata
 * segment cut off) parses as far as it goes: metadata always comes before the
 * scan, so what is there gets scrubbed. Throws only when a metadata segment
 * (APPn, COM) is itself cut off, or the structure is broken before any scan.
 */
function parseJpeg(b: Buffer, from = 0): ParsedJpeg {
  need(b[from] === 0xff && b[from + 1] === 0xd8, "JPEG has no start-of-image marker");
  const segs: Seg[] = [];
  let p = from + 2;
  let sawScan = false;
  const cut = (): ParsedJpeg => {
    needCleanTail(b, p, "JPEG");
    return { segs, eoiEnd: b.length, lostAt: -1 };
  };
  for (;;) {
    if (p >= b.length) return cut();
    if (b[p] !== 0xff) {
      if (sawScan) return { segs, eoiEnd: b.length, lostAt: p };
      // Stray bytes between header segments ("extraneous bytes before marker"):
      // libjpeg skips to the next 0xFF and decodes the file, so do the same, as
      // long as the skipped bytes can't hide metadata.
      const next = b.indexOf(0xff, p);
      need(
        !METADATA_SIGNATURES.some((sig) => b.subarray(p, next === -1 ? b.length : next).includes(sig, 0, "latin1")),
        "JPEG segment structure is corrupt before the image data, and the skipped bytes hold metadata",
      );
      if (next === -1) return cut();
      p = next;
      continue;
    }
    while (p < b.length && b[p] === 0xff) p++; // fill bytes
    if (p >= b.length) return cut();
    const marker = b[p];
    const start = p - 1;
    p++;
    if (marker === 0xd9) return { segs, eoiEnd: p, lostAt: -1 };
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue; // standalone
    const isMeta = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    const len = p + 2 <= b.length ? b.readUInt16BE(p) : -1;
    if (len < 2 || p + len > b.length) {
      need(!isMeta, `JPEG metadata segment (marker ${marker.toString(16)}) runs past the end of the file`);
      need(len === -1 || len >= 2, "JPEG segment structure is corrupt");
      return cut();
    }
    const seg: Seg = { marker, start, dataStart: p + 2, end: p + len };
    segs.push(seg);
    p = seg.end;
    if (marker === 0xda) {
      sawScan = true;
      // entropy-coded data: runs until a marker that is not a stuffed 0x00 or RSTn
      while (p < b.length) {
        if (b[p] === 0xff && p + 1 < b.length) {
          const m = b[p + 1];
          if (m !== 0x00 && !(m >= 0xd0 && m <= 0xd7) && m !== 0xff) break;
        }
        p++;
      }
    }
  }
}

function app1Kind(b: Buffer, s: Seg): "exif" | "xmp" | "xmpext" | "xmploose" | null {
  if (s.marker !== 0xe1) return null;
  if (startsWithAscii(b, s.dataStart, EXIF_SIG)) return "exif";
  if (startsWithAscii(b, s.dataStart, XMP_SIG)) return "xmp";
  if (startsWithAscii(b, s.dataStart, XMP_EXT_SIG)) return "xmpext";
  // Not a signature we know, but it holds an XMP packet (a damaged or variant
  // namespace string): scrub it as XMP rather than skip it.
  const body = b.subarray(s.dataStart, s.end);
  if (body.includes("<x:xmpmeta", 0, "latin1") || body.includes("<rdf:RDF", 0, "latin1")) return "xmploose";
  return null;
}

/** In-place location scrub of one JPEG's metadata segments. */
function jpegScrubSegments(b: Buffer, segs: Seg[]): void {
  // Extended XMP is split across segments; reassemble per GUID, scrub, write back.
  const ext = new Map<string, { at: number; len: number; off: number }[]>();
  for (const s of segs) {
    const kind = app1Kind(b, s);
    if (kind === "exif") scrubExifBlob(b, s.dataStart + 6, s.end, "location");
    else if (kind === "xmp") scrubXmp(b, s.dataStart + XMP_SIG.length, s.end, "location");
    else if (kind === "xmploose") scrubXmp(b, s.dataStart, s.end, "location");
    else if (kind === "xmpext") {
      const h = s.dataStart + XMP_EXT_SIG.length;
      if (h + 40 > s.end) continue;
      const guid = b.toString("latin1", h, h + 32);
      const off = b.readUInt32BE(h + 36);
      const list = ext.get(guid) ?? [];
      list.push({ at: h + 40, len: s.end - (h + 40), off });
      ext.set(guid, list);
    } else if (s.marker === 0xed && startsWithAscii(b, s.dataStart, "Photoshop 3.0\0")) {
      scrub8bim(b, s.dataStart + 14, s.end, "location");
    }
  }
  for (const parts of ext.values()) {
    parts.sort((x, y) => x.off - y.off);
    const whole = Buffer.concat(parts.map((x) => b.subarray(x.at, x.at + x.len)));
    scrubXmp(whole, 0, whole.length, "location");
    let o = 0;
    for (const x of parts) {
      whole.copy(b, x.at, o, o + x.len);
      o += x.len;
    }
  }
}

function jpegScrub(b: Buffer): Buffer {
  const { segs, eoiEnd, lostAt } = parseJpeg(b);
  jpegScrubSegments(b, segs);
  if (lostAt >= 0) scrubTrailerApp1(b, lostAt); // structure lost mid-file
  // Data after EOI: MPF secondary images (gain maps, depth) carry their own
  // EXIF/XMP. Scrub every embedded JPEG we can parse; never move bytes.
  let p = eoiEnd;
  while (p + 3 < b.length) {
    const i = b.indexOf(Buffer.from([0xff, 0xd8, 0xff]), p);
    if (i < 0) break;
    try {
      const inner = parseJpeg(b, i);
      jpegScrubSegments(b, inner.segs);
      p = inner.eoiEnd;
    } catch {
      p = i + 3;
    }
  }
  // Last line of defence for the trailer: any stray EXIF/XMP APP1 we couldn't
  // reach through a parse is scrubbed by signature (requires FFE1 + length).
  scrubTrailerApp1(b, eoiEnd);
  // Motion photos: a QuickTime/MP4 movie appended after the image.
  scrubTrailerMovie(b, eoiEnd);
  return b;
}

function scrubTrailerApp1(b: Buffer, from: number): void {
  for (const sig of [EXIF_SIG, XMP_SIG]) {
    let p = from;
    for (;;) {
      const i = b.indexOf(sig, p, "latin1");
      if (i < 0) break;
      p = i + sig.length;
      if (i < 4 || b[i - 4] !== 0xff || b[i - 3] !== 0xe1) continue;
      const end = i - 2 + b.readUInt16BE(i - 2);
      if (end > b.length) continue;
      if (sig === EXIF_SIG) scrubExifBlob(b, i + 6, end, "location");
      else scrubXmp(b, i + sig.length, end, "location");
    }
  }
}

/** Keep only what decoding and colour need: JFIF, ICC, Adobe; drop the rest and the trailer. */
function jpegStripAll(b: Buffer): Buffer {
  const { segs, eoiEnd, lostAt } = parseJpeg(b);
  let orientation = 1;
  for (const s of segs) {
    if (app1Kind(b, s) === "exif") orientation = readOrientation(b, s.dataStart + 6, s.end);
  }
  const parts: Buffer[] = [b.subarray(0, 2)];
  let insertedExif = false;
  const pushExif = () => {
    if (insertedExif || orientation === 1) return;
    insertedExif = true;
    const tiff = minimalOrientationTiff(orientation);
    const hdr = Buffer.alloc(4);
    hdr[0] = 0xff;
    hdr[1] = 0xe1;
    hdr.writeUInt16BE(2 + EXIF_SIG.length + tiff.length, 2);
    parts.push(hdr, Buffer.from(EXIF_SIG, "latin1"), tiff);
  };
  let cursor = 2;
  for (const s of segs) {
    const isApp = s.marker >= 0xe0 && s.marker <= 0xef;
    const keep =
      !isApp && s.marker !== 0xfe
        ? true
        : (s.marker === 0xe0 && startsWithAscii(b, s.dataStart, "JFIF\0")) ||
          (s.marker === 0xe2 && startsWithAscii(b, s.dataStart, "ICC_PROFILE\0")) ||
          (s.marker === 0xee && startsWithAscii(b, s.dataStart, "Adobe"));
    // Write the minimal EXIF right after JFIF (or first, if there is no JFIF).
    if (!(s.marker === 0xe0 && keep)) pushExif();
    // Bytes between the previous segment end and this segment start are
    // entropy-coded scan data (after an SOS); they always stay.
    if (s.start > cursor) parts.push(b.subarray(cursor, s.start));
    if (keep) parts.push(b.subarray(s.start, s.end));
    cursor = s.end;
  }
  pushExif();
  parts.push(b.subarray(cursor, eoiEnd)); // last scan data + EOI; trailer dropped
  const out = Buffer.concat(parts);
  // Structure lost mid-file: the rest is copied as is, so scrub any EXIF/XMP
  // APP1 in it by signature (the output is a prefix-preserving copy past cursor).
  if (lostAt >= 0) scrubTrailerApp1(out, out.length - (eoiEnd - lostAt));
  return out;
}

// ------------------------------------------------------------------------ PNG

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function isPng(b: Buffer): boolean {
  return b.length >= 8 && b.subarray(0, 8).equals(PNG_SIG);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
  return out;
}

/** Text chunks never needed to show the image (dropped in "all" mode). */
const PNG_META_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

/** Chunk names whose presence in an unparsed tail means unscrubbed metadata. */
const PNG_META_NAMES = ["eXIf", "tEXt", "zTXt", "iTXt"];

/** Text keyword prefixes ImageMagick and others use for EXIF/XMP/IPTC properties. */
const PNG_PROPERTY_PREFIX = /^(?:exif:|xmp:|photoshop:|Iptc4xmp|iptc:)/i;
/** Place property names, qualified (any prefix:GPS*, photoshop:City, ...) or bare. */
const PNG_PLACE_KEYWORD = new RegExp(
  `^(?:${xmpLocationName("")}|(?:GPS|Gps)\\w*|City|State|Country|CountryCode|CountryName|` +
    `Location|LocationCreated|LocationShown|ProvinceState|Sublocation|WorldRegion|coverage)$`,
);

/** True when a PNG text chunk's keyword names a metadata property that can carry a place. */
function pngTextIsLocation(keyword: string): boolean {
  return PNG_PROPERTY_PREFIX.test(keyword) || PNG_PLACE_KEYWORD.test(keyword);
}

interface PngChunk {
  type: string;
  raw: Buffer;
  data: Buffer;
}

function pngProcess(b: Buffer, mode: StripMode): Buffer {
  // Pass 1: list the chunks. A file cut short inside a chunk that isn't
  // metadata (usually IDAT) keeps its tail as is; a cut-off text or EXIF chunk
  // can't be scrubbed, so it stops the build.
  const chunks: PngChunk[] = [];
  let p = 8;
  let tail = b.subarray(b.length);
  while (p < b.length) {
    if (p + 12 > b.length) {
      needCleanTail(b, p, "PNG", PNG_META_NAMES);
      tail = b.subarray(p);
      break;
    }
    const len = b.readUInt32BE(p);
    const type = b.toString("latin1", p + 4, p + 8);
    const dEnd = p + 8 + len;
    if (dEnd + 4 > b.length) {
      need(!PNG_META_CHUNKS.has(type), `PNG chunk ${type} runs past the end of the file`);
      needCleanTail(b, p + 8, "PNG", PNG_META_NAMES);
      tail = b.subarray(p);
      break;
    }
    chunks.push({ type, raw: b.subarray(p, dEnd + 4), data: b.subarray(p + 8, dEnd) });
    p = dEnd + 4;
    if (type === "IEND") break; // bytes after IEND are dropped
  }

  const parts: Buffer[] = [b.subarray(0, 8)];
  if (mode === "all") {
    // Orientation first, so an eXIf placed after IDAT (legal) still counts.
    const ex = chunks.find((c) => c.type === "eXIf");
    const orientation = ex ? readOrientation(ex.data, 0, ex.data.length) : 1;
    let wrote = false;
    for (const c of chunks) {
      if (PNG_META_CHUNKS.has(c.type)) continue;
      if (c.type === "IDAT" && orientation !== 1 && !wrote) {
        parts.push(pngChunk("eXIf", minimalOrientationTiff(orientation)));
        wrote = true;
      }
      parts.push(c.raw);
    }
  } else {
    for (const { type, raw, data } of chunks) {
      if (type === "eXIf") {
        const copy = Buffer.from(data);
        scrubExifBlob(copy, 0, copy.length, "location");
        parts.push(pngChunk("eXIf", copy));
      } else if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
        const kwEnd = data.indexOf(0);
        const keyword = kwEnd > 0 ? data.toString("latin1", 0, kwEnd) : "";
        // ImageMagick hex dumps of EXIF/XMP/IPTC: no browser reads them, drop.
        if (/^Raw profile type /i.test(keyword)) continue;
        if (keyword === "XML:com.adobe.xmp") parts.push(pngXmp(type, data));
        // ImageMagick also writes each property as its own chunk
        // (`exif:GPSLatitude`, `photoshop:City`): drop the metadata ones.
        else if (pngTextIsLocation(keyword)) continue;
        else parts.push(raw);
      } else {
        parts.push(raw);
      }
    }
  }
  parts.push(tail);
  return Buffer.concat(parts);
}

/**
 * Scrub an XMP text chunk and rebuild it. iTXt is the spec form (optionally
 * compressed); libvips and some tools write tEXt or zTXt with the same keyword.
 */
function pngXmp(type: string, data: Buffer): Buffer {
  let q = data.indexOf(0) + 1; // after keyword\0
  let compressed = false;
  if (type === "iTXt") {
    // compFlag compMethod lang\0 transKeyword\0 text
    compressed = data[q] === 1;
    q += 2;
    q = data.indexOf(0, q) + 1;
    q = data.indexOf(0, q) + 1;
  } else if (type === "zTXt") {
    compressed = true;
    q += 1; // compression method byte
  }
  need(q > 0 && q <= data.length, "PNG XMP chunk is malformed");
  const header = data.subarray(0, q);
  const text = compressed ? inflateSync(data.subarray(q)) : Buffer.from(data.subarray(q));
  scrubXmp(text, 0, text.length, "location");
  const body = compressed ? deflateSync(text) : text;
  return pngChunk(type, Buffer.concat([header, body]));
}

// ----------------------------------------------------------------------- WebP

function isWebp(b: Buffer): boolean {
  return b.length >= 12 && startsWithAscii(b, 0, "RIFF") && startsWithAscii(b, 8, "WEBP");
}

interface RiffChunk {
  fourcc: string;
  start: number;
  dataStart: number;
  size: number;
  end: number; // padded
}

function parseWebp(b: Buffer): RiffChunk[] {
  const chunks: RiffChunk[] = [];
  let p = 12;
  while (p + 8 <= b.length) {
    const fourcc = b.toString("latin1", p, p + 4);
    const size = b.readUInt32LE(p + 4);
    const end = p + 8 + size + (size % 2);
    if (p + 8 + size > b.length) {
      // Cut short: a metadata chunk can't be scrubbed; image data keeps its tail.
      need(fourcc !== "EXIF" && fourcc !== "XMP ", `WebP chunk ${fourcc} runs past the end of the file`);
      needCleanTail(b, p + 8, "WebP", ["EXIF", "XMP "]);
      chunks.push({ fourcc, start: p, dataStart: p + 8, size: b.length - p - 8, end: b.length });
      break;
    }
    chunks.push({ fourcc, start: p, dataStart: p + 8, size, end: Math.min(end, b.length) });
    p = end;
  }
  need(chunks.length > 0, "WebP file has no chunks");
  return chunks;
}

function exifStart(b: Buffer, c: RiffChunk): number {
  // Some writers prefix the WebP EXIF chunk with "Exif\0\0".
  return startsWithAscii(b, c.dataStart, EXIF_SIG) ? c.dataStart + 6 : c.dataStart;
}

function webpScrub(b: Buffer): Buffer {
  for (const c of parseWebp(b)) {
    if (c.fourcc === "EXIF") scrubExifBlob(b, exifStart(b, c), c.dataStart + c.size, "location");
    else if (c.fourcc === "XMP ") scrubXmp(b, c.dataStart, c.dataStart + c.size, "location");
  }
  return b;
}

function webpStripAll(b: Buffer): Buffer {
  const chunks = parseWebp(b);
  let orientation = 1;
  const kept: Buffer[] = [];
  for (const c of chunks) {
    if (c.fourcc === "EXIF") {
      orientation = readOrientation(b, exifStart(b, c), c.dataStart + c.size);
      continue;
    }
    if (c.fourcc === "XMP ") continue;
    kept.push(Buffer.from(b.subarray(c.start, c.end)));
  }
  const vp8x = kept.find((k) => k.toString("latin1", 0, 4) === "VP8X");
  if (orientation !== 1 && vp8x) {
    const tiff = minimalOrientationTiff(orientation);
    const hdr = Buffer.alloc(8);
    hdr.write("EXIF", 0, "latin1");
    hdr.writeUInt32LE(tiff.length, 4);
    kept.push(Buffer.concat([hdr, tiff])); // EXIF goes after image data per spec
  }
  if (vp8x) {
    vp8x[8] &= ~0x0c; // clear EXIF (0x08) and XMP (0x04) flags
    if (orientation !== 1) vp8x[8] |= 0x08;
  }
  const body = Buffer.concat(kept);
  const hdr = Buffer.alloc(12);
  hdr.write("RIFF", 0, "latin1");
  hdr.writeUInt32LE(4 + body.length, 4);
  hdr.write("WEBP", 8, "latin1");
  return Buffer.concat([hdr, body]);
}

// ------------------------------------------------------- ISO BMFF (AVIF/HEIC)

function isIsoBmff(b: Buffer): boolean {
  if (b.length < 12 || !startsWithAscii(b, 4, "ftyp")) return false;
  const brands = b.toString("latin1", 8, Math.min(b.length, 8 + b.readUInt32BE(0) - 8));
  return /avif|avis|heic|heix|heim|heis|hevc|hevx|mif1|msf1|miaf/.test(brands);
}

interface Box {
  type: string;
  start: number;
  dataStart: number;
  end: number;
}

/**
 * List the boxes in [from, to). `lenient` (top level only): a box that runs
 * past the end, as in a file cut off inside its media data, ends the list;
 * a cut-off `meta` box still throws, because it is the metadata.
 */
function boxes(b: Buffer, from: number, to: number, lenient = false): Box[] {
  const out: Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    let size = b.readUInt32BE(p);
    const type = b.toString("latin1", p + 4, p + 8);
    let hdr = 8;
    if (size === 1) {
      if (lenient && p + 16 > to && type !== "meta") {
        needCleanTail(b, p + 8, "HEIF", ["meta", "iinf", "iloc"]);
        break;
      }
      need(p + 16 <= to, "HEIF box header truncated");
      size = Number(b.readBigUInt64BE(p + 8));
      hdr = 16;
    } else if (size === 0) size = to - p;
    if (lenient && type !== "meta" && size >= hdr && p + size > to) {
      needCleanTail(b, p + 8, "HEIF", ["meta", "iinf", "iloc"]);
      break;
    }
    need(size >= hdr && p + size <= to, `HEIF box ${type} runs past its parent`);
    out.push({ type, start: p, dataStart: p + hdr, end: p + size });
    p += size;
  }
  return out;
}

function readUIntN(b: Buffer, at: number, n: number): number {
  if (n === 0) return 0;
  if (n === 8) return Number(b.readBigUInt64BE(at));
  return b.readUIntBE(at, n);
}

function isoScrub(b: Buffer, mode: StripMode): void {
  const meta = boxes(b, 0, b.length, true).find((x) => x.type === "meta");
  if (!meta) return; // no item metadata at all
  const kids = boxes(b, meta.dataStart + 4, meta.end); // meta is a FullBox
  const iinf = kids.find((x) => x.type === "iinf");
  const iloc = kids.find((x) => x.type === "iloc");
  if (!iinf || !iloc) return;

  // item_ID -> "exif" | "xmp"
  const wanted = new Map<number, "exif" | "xmp">();
  {
    const v = b[iinf.dataStart];
    const first = iinf.dataStart + 4 + (v === 0 ? 2 : 4);
    // NUL-terminated string inside the infe box; [text, offset after the NUL].
    const cstr = (at: number, end: number): [string, number] => {
      if (at >= end) return ["", end];
      const z = b.indexOf(0, at);
      const stop = z < 0 || z >= end ? end : z;
      return [b.toString("latin1", at, stop), stop + 1];
    };
    const mimeItem = (id: number, at: number, end: number) => {
      const [, afterName] = cstr(at, end);
      const [ct, afterCt] = cstr(afterName, end);
      if (ct !== "application/rdf+xml") return;
      const [enc] = cstr(afterCt, end);
      need(enc === "", `HEIF XMP item is ${enc}-encoded, which can't be scrubbed in place`);
      wanted.set(id, "xmp");
    };
    for (const infe of boxes(b, first, iinf.end)) {
      if (infe.type !== "infe") continue;
      const iv = b[infe.dataStart];
      let q = infe.dataStart + 4;
      need(q + 4 <= infe.end, "HEIF item info entry is truncated");
      if (iv <= 1) {
        // Versions 0 and 1: item_ID(16) protection(16) name content_type [encoding]
        const id = b.readUInt16BE(q);
        mimeItem(id, q + 4, infe.end);
        continue;
      }
      need(iv <= 3, `HEIF item info entry version ${iv} is not supported`);
      const id = iv === 2 ? b.readUInt16BE(q) : b.readUInt32BE(q);
      q += iv === 2 ? 2 : 4;
      q += 2; // protection index
      const itype = b.toString("latin1", q, q + 4);
      q += 4;
      if (itype === "Exif") wanted.set(id, "exif");
      else if (itype === "mime") mimeItem(id, q, infe.end);
    }
  }
  if (wanted.size === 0) return;

  const v = b[iloc.dataStart];
  let q = iloc.dataStart + 4;
  const offSize = b[q] >> 4;
  const lenSize = b[q] & 0x0f;
  const baseSize = b[q + 1] >> 4;
  const idxSize = v === 1 || v === 2 ? b[q + 1] & 0x0f : 0;
  q += 2;
  const count = v < 2 ? b.readUInt16BE(q) : b.readUInt32BE(q);
  q += v < 2 ? 2 : 4;
  for (let i = 0; i < count; i++) {
    const id = v < 2 ? b.readUInt16BE(q) : b.readUInt32BE(q);
    q += v < 2 ? 2 : 4;
    let method = 0;
    if (v === 1 || v === 2) {
      method = b.readUInt16BE(q) & 0x0f;
      q += 2;
    }
    q += 2; // data_reference_index
    const base = readUIntN(b, q, baseSize);
    q += baseSize;
    const extents = b.readUInt16BE(q);
    q += 2;
    const ranges: [number, number][] = [];
    for (let e = 0; e < extents; e++) {
      q += idxSize;
      const off = readUIntN(b, q, offSize);
      q += offSize;
      const len = readUIntN(b, q, lenSize);
      q += lenSize;
      ranges.push([base + off, len]);
    }
    const kind = wanted.get(id);
    if (!kind) continue;
    need(method === 0, "HEIF metadata stored in an unsupported way (construction method)");
    need(ranges.length === 1, "HEIF metadata split across extents is not supported");
    const [at, len0] = ranges[0];
    const len = len0 === 0 ? b.length - at : len0;
    need(at + len <= b.length, "HEIF metadata item runs past the end of the file");
    if (kind === "xmp") scrubXmp(b, at, at + len, mode);
    else {
      // Exif item: u32 offset to the TIFF header, then (usually "Exif\0\0") TIFF.
      const tiffAt = at + 4 + b.readUInt32BE(at);
      // "all" also empties the EXIF sub-IFD; a bad block stops the build.
      if (mode === "all") scrubTiff(b, tiffAt, at + len, "all");
      else scrubExifBlob(b, tiffAt, at + len, "location");
    }
  }
}

// ------------------------------------------- motion photo movie (JPEG trailer)

/** Boxes walked into when looking for location metadata in a movie. */
const MOVIE_CONTAINERS = new Set(["moov", "trak", "udta", "mdia", "minf", "meta", "edts"]);
const QT_LOCATION_KEY = "com.apple.quicktime.location";

/** True when `at` starts a plausible box (size fits, printable type). */
function looksLikeBox(b: Buffer, at: number, end: number): boolean {
  if (at + 8 > end) return false;
  const size = b.readUInt32BE(at);
  return size >= 8 && at + size <= end && /^[\x20-\x7e\xa9]{4}$/.test(b.toString("latin1", at + 4, at + 8));
}

/**
 * Motion photos append a QuickTime/MP4 movie after the JPEG. When the trailer
 * holds an ISO-BMFF `ftyp`, walk the movie's metadata boxes and blank, at the
 * same length, every `©xyz` payload (ISO 6709 position) and the values of
 * `com.apple.quicktime.location*` keys. Everything else stays byte for byte.
 */
function scrubTrailerMovie(b: Buffer, from: number): void {
  for (let p = from; ; ) {
    const i = b.indexOf("ftyp", p, "latin1");
    if (i < 0) return;
    p = i + 4;
    if (i - 4 < from || !looksLikeBox(b, i - 4, b.length)) continue;
    movieBoxes(b, i - 4, b.length, 0);
    return;
  }
}

function movieBoxes(b: Buffer, from: number, to: number, depth: number): void {
  const kids: Box[] = [];
  for (let p = from; p + 8 <= to; ) {
    let size = b.readUInt32BE(p);
    const type = b.toString("latin1", p + 4, p + 8);
    let hdr = 8;
    if (size === 1 && p + 16 <= to) {
      size = Number(b.readBigUInt64BE(p + 8));
      hdr = 16;
    } else if (size === 0) size = to - p;
    if (size < hdr || p + size > to) {
      if (depth === 0) break; // top level: movie cut short in its media data
      throw new StripError(`motion photo movie: box ${JSON.stringify(type)} runs past its parent`);
    }
    kids.push({ type, start: p, dataStart: p + hdr, end: p + size });
    p += size;
  }
  let keyNames: string[] | null = null;
  for (const k of kids) {
    if (k.type === "\xa9xyz") {
      // QuickTime text atom: u16 length, u16 language, then the position text.
      b.fill(0x20, Math.min(k.dataStart + 4, k.end), k.end);
    } else if (k.type === "keys") {
      keyNames = movieKeys(b, k);
    } else if (k.type === "ilst") {
      movieIlst(b, k, keyNames ?? []);
    } else if (MOVIE_CONTAINERS.has(k.type) && depth < 8) {
      // ISO `meta` is a FullBox (4 bytes of version/flags); QuickTime's is not.
      let inner = k.dataStart;
      if (k.type === "meta" && !looksLikeBox(b, inner, k.end)) inner += 4;
      movieBoxes(b, inner, k.end, depth + 1);
    }
  }
}

/** Key names of a QuickTime `keys` box, in order (item index i+1). */
function movieKeys(b: Buffer, k: Box): string[] {
  need(k.dataStart + 8 <= k.end, "motion photo movie: keys box is truncated");
  const n = b.readUInt32BE(k.dataStart + 4);
  const names: string[] = [];
  let q = k.dataStart + 8;
  for (let i = 0; i < n; i++) {
    need(q + 8 <= k.end, "motion photo movie: keys box is truncated");
    const size = b.readUInt32BE(q);
    need(size >= 8 && q + size <= k.end, "motion photo movie: keys entry runs past its box");
    names.push(b.toString("latin1", q + 8, q + size));
    q += size;
  }
  return names;
}

/** Blank the `data` values of ilst items that hold a location. */
function movieIlst(b: Buffer, ilst: Box, keyNames: string[]): void {
  for (const item of boxes(b, ilst.dataStart, ilst.end)) {
    const index = b.readUInt32BE(item.start + 4);
    const name = keyNames[index - 1] ?? "";
    if (!name.startsWith(QT_LOCATION_KEY) && item.type !== "\xa9xyz") continue;
    for (const d of boxes(b, item.dataStart, item.end)) {
      if (d.type !== "data" || d.dataStart + 8 > d.end) continue;
      const textual = b.readUInt32BE(d.dataStart) === 1; // well-known type 1 = UTF-8
      b.fill(textual ? 0x20 : 0, d.dataStart + 8, d.end);
    }
  }
}

// ------------------------------------------------------------------------ GIF

function isGif(b: Buffer): boolean {
  return b.length >= 6 && (startsWithAscii(b, 0, "GIF87a") || startsWithAscii(b, 0, "GIF89a"));
}

/**
 * GIF has no EXIF; location can only sit in an XMP application extension.
 * XMP-in-GIF stores the packet raw with a "magic trailer", so replacing packet
 * bytes with spaces keeps the file decodable.
 */
function gifScrub(b: Buffer, mode: StripMode): void {
  const sig = Buffer.from("\x21\xff\x0bXMP DataXMP", "latin1");
  let p = 0;
  for (;;) {
    const i = b.indexOf(sig, p);
    if (i < 0) return;
    const start = i + sig.length;
    const close = b.indexOf("<?xpacket end", start, "latin1");
    const endTag = close < 0 ? -1 : b.indexOf("?>", close, "latin1");
    // Without the end marker the packet's extent is unknown; don't guess.
    need(endTag >= 0, "GIF XMP packet has no <?xpacket end?> marker");
    // Scrub only inside the packet itself, never the magic trailer.
    scrubXmp(b, start, endTag + 2, "location");
    if (mode === "all") {
      const open = b.indexOf("<x:xmpmeta", start, "latin1");
      const shut = b.indexOf("</x:xmpmeta>", start, "latin1");
      if (open >= 0 && shut > open) b.fill(0x20, open, shut + 12);
    }
    p = endTag + 2;
  }
}
