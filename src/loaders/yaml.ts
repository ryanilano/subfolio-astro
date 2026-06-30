import { parse } from "yaml";

/**
 * YAML wrapper replacing the PHP Spyc parser. Subfolio's config/enhancer files
 * were authored for Spyc and carry one non-standard habit standard YAML rejects:
 * a folded-scalar marker with no space before it, e.g. `description:>` and
 * `instructions:>` (Spyc treats `>` like `: >`). We normalize that to `: >`
 * before parsing. Everything else is valid YAML.
 *
 * Files are also full of `#` comment lines and the leading "YAML NOTE" banner,
 * which standard YAML already handles, so no special-casing needed there.
 */

/** Turn Spyc's `key:>` folded marker into standard `key: >`. */
function normalizeSpyc(src: string): string {
  // Match `<indent><key>:>` at line start (key has no spaces/colons).
  return src.replace(/^(\s*[^\s:#][^:\n]*):>[ \t]*$/gm, "$1: >");
}

/**
 * Parse a Subfolio YAML string leniently. Returns an object (or {} on empty /
 * parse failure — these files are user-authored and occasionally malformed, and
 * a single bad enhancer should not break the whole build).
 */
export function parseSubfolioYaml(src: string): Record<string, unknown> {
  const normalized = normalizeSpyc(src);
  try {
    const out = parse(normalized);
    return out && typeof out === "object" ? (out as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Coerce a YAML value to a number with a fallback. */
export function asNumber(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** Coerce a YAML value to a trimmed string, or undefined. */
export function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}
