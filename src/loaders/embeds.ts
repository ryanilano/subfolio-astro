import { readFileSync } from "node:fs";
import { join } from "node:path";
import { positionOf, type Position } from "./conventions.ts";
import { kindByFile, type FileKind } from "./filekinds.ts";
import { parseSubfolioYaml, asNumber } from "./yaml.ts";
import type { Embed } from "./schema.ts";

/**
 * Position embeds (`-t-`/`-m-`/`-b-`), per SPEC-conventions §2, §7. For a folder
 * we collect prefixed files, group by position, and classify each by filekind as
 * img / txt / rss.
 *
 * Phase 1 captures parsed intent, NOT rendered output:
 *  - txt → rawText + chosen renderer (Textile/MD render deferred to Phase 5)
 *  - img → src only (dimensions deferred to Phase 3 sharp)
 *  - rss → feed params only (HTTP fetch deferred to Phase 3)
 */

export type Renderer = "none" | "textile" | "markdown";

export interface EmbedInput {
  /** File name as it sits on disk (includes the -t-/-m-/-b- prefix). */
  name: string;
  /** Path relative to the content root, "/"-separated. */
  relPath: string;
}

export interface EmbedContext {
  contentRoot: string;
  kinds: FileKind[];
  renderer: Renderer;
}

const EMPTY = (): Record<Position, Embed[]> => ({ top: [], middle: [], bottom: [] });

export function collectEmbeds(
  files: EmbedInput[],
  ctx: EmbedContext,
): Record<Position, Embed[]> {
  const out = EMPTY();
  for (const f of files) {
    const pos = positionOf(f.name);
    if (!pos) continue;
    const kind = kindByFile(f.name, ctx.kinds)?.kind ?? "";
    const abs = join(ctx.contentRoot, f.relPath);

    if (kind === "img") {
      out[pos].push({ position: pos, type: "img", name: f.name, src: f.relPath });
    } else if (kind === "rss") {
      const doc = parseSubfolioYaml(safeRead(abs));
      out[pos].push({
        position: pos,
        type: "rss",
        name: f.name,
        feedurl: typeof doc.feedurl === "string" ? doc.feedurl : "",
        count: asNumber(doc.count, 10),
        cache: asNumber(doc.cache, 3600),
      });
    } else {
      // Everything else treated as text (txt is the common case; SPEC §2 lists
      // img/txt/rss as the three supported embed kinds).
      out[pos].push({
        position: pos,
        type: "txt",
        name: f.name,
        rawText: safeRead(abs),
        renderer: ctx.renderer,
      });
    }
  }
  return out;
}

function safeRead(abs: string): string {
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}
