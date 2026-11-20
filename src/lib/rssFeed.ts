/**
 * RSS render-time reader — the consume side of the Phase 3 RSS slice. Reads the
 * feed items that scripts/gen-rss.mjs fetched into ./.rss-cache/ at build time.
 *
 * Sync + lenient + memoized, mirroring src/lib/imageMeta.ts: it only reads files
 * already on disk (no network at render — the fetch happened in the pre-build
 * pass), and returns [] on any miss so a missing/unfetched feed never breaks a
 * render. The cache-file path rule MUST stay in lockstep with gen-rss.mjs.
 */
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

const cacheRoot = resolve(process.env.SUBFOLIO_RSS_CACHE ?? "./.rss-cache");

export interface RssItem {
  title: string;
  description: string;
  link: string;
}

interface CacheEntry {
  feedurl: string;
  fetchedAt: number;
  items: RssItem[];
}

/** Shared cache-file path rule — MUST match scripts/gen-rss.mjs. */
function cacheFileFor(feedurl: string): string {
  const hash = createHash("sha1").update(feedurl).digest("hex");
  return join(cacheRoot, `${hash}.json`);
}

/**
 * A feed item's link, or "" unless it is an absolute http(s) URL. The feed
 * publisher is not the site author, so a `javascript:` or `data:` link must
 * never reach an href (audit finding F3, 2026-11-15). Applied when gen-rss
 * writes the cache AND here when it is read, so a cache written before the
 * fix is cleaned too.
 */
export function webLink(link: unknown): string {
  if (typeof link !== "string") return "";
  const v = link.trim();
  if (!URL.canParse(v)) return "";
  // Return the parsed form: "https:example.com" or a control character would
  // otherwise reach the href as typed and resolve as a path on this site.
  if (!/^https?:\/\//i.test(v)) return "";
  const url = new URL(v);
  return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
}

// Build-time memo: a given feed is read off disk once per build.
const cache = new Map<string, RssItem[]>();

/**
 * Items for a feed URL, capped at `count`. Returns [] when the feed wasn't
 * fetched (no cache file), the file is malformed, or `feedurl` is empty.
 */
export function rssItemsFor(feedurl: string, count = 10): RssItem[] {
  if (!feedurl) return [];

  let items = cache.get(feedurl);
  if (!items) {
    items = [];
    try {
      const entry = JSON.parse(readFileSync(cacheFileFor(feedurl), "utf8")) as CacheEntry;
      if (Array.isArray(entry.items)) items = entry.items.map((it) => ({ ...it, link: webLink(it.link) }));
    } catch {
      /* missing / malformed cache → empty list */
    }
    cache.set(feedurl, items);
  }
  return items.slice(0, count);
}
