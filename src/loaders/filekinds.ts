import { readFileSync } from "node:fs";
import { parseSubfolioYaml } from "./yaml.ts";
import { extOf } from "./conventions.ts";

/**
 * Extension → kind → view mapping, per subfolio/plans/spec/SPEC-filekinds.md.
 * Loads the bundled config/filekinds.yml (the legacy sample, normalized for the
 * Spyc `instructions:>` folded marker by parseSubfolioYaml) and resolves an
 * extension to the FIRST kind in YAML order whose `extensions` list contains it.
 */

export interface FileKind {
  kind: string; // the YAML key, e.g. "img"
  icon: string;
  display: string;
  instructions?: string;
  extensions: string[];
}

let cached: FileKind[] | null = null;

/** Load and cache the kind table in YAML declaration order. */
export function loadFileKinds(configPath: string): FileKind[] {
  if (cached) return cached;
  const raw = readFileSync(configPath, "utf8");
  const doc = parseSubfolioYaml(raw);
  const kinds: FileKind[] = [];
  for (const [key, val] of Object.entries(doc)) {
    if (!val || typeof val !== "object") continue;
    const block = val as Record<string, unknown>;
    const extensions = Array.isArray(block.extensions)
      ? (block.extensions as unknown[]).map((e) => String(e).toLowerCase())
      : [];
    kinds.push({
      kind: key,
      icon: typeof block.icon === "string" ? block.icon : "gen",
      display: typeof block.display === "string" ? block.display : key,
      instructions:
        typeof block.instructions === "string" ? block.instructions.trim() : undefined,
      extensions,
    });
  }
  cached = kinds;
  return kinds;
}

/**
 * Resolve a kind by extension: lowercase, then first-match in YAML order
 * (SPEC-filekinds §1, §4). Returns null when no kind matches.
 */
export function kindByExtension(ext: string, kinds: FileKind[]): FileKind | null {
  const e = ext.toLowerCase();
  if (!e) return null;
  for (const k of kinds) {
    if (k.extensions.includes(e)) return k;
  }
  return null;
}

/** Convenience: resolve a kind directly from a filename. */
export function kindByFile(name: string, kinds: FileKind[]): FileKind | null {
  return kindByExtension(extOf(name), kinds);
}
