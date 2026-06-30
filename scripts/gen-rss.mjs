/**
 * Pre-build RSS fetch — runs BEFORE `astro build` (see package.json), alongside
 * gen-thumbs.mjs and gen-css.mjs.
 *
 * Why a separate pass: Astro's static build is two-phase and network I/O must
 * not happen lazily during render. We fetch every feed up front into an
 * out-of-tree cache that the render-time reader (src/lib/rssFeed.ts) then treats
 * as the single source of truth — the same pattern gen-thumbs.mjs uses for
 * thumbnails. The cache PERSISTS across builds so the per-feed `cache:` TTL is
 * honored the way the PHP engine's `-<name>.cache` files were
 * (SubfolioFiles::fetch_rss, Subfolio.php:1535-1579).
 *
 * The cache lives at ./.rss-cache/ (gitignored): one .rss-cache/<sha1(url)>.json
 * per feed, holding { feedurl, fetchedAt, items: [{title, description, link}] }.
 * We never write into SUBFOLIO_CONTENT_DIR.
 *
 * Lenient/offline-safe: a failed fetch keeps any existing (stale) cache rather
 * than clobbering it; with no prior cache it writes an empty item list. One bad
 * or unreachable feed never breaks the build.
 */
import Parser from "rss-parser";
import { readdirSync, statSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";

const contentRoot = resolve(process.env.SUBFOLIO_CONTENT_DIR ?? "./content/examples");
const cacheRoot = resolve(process.env.SUBFOLIO_RSS_CACHE ?? "./.rss-cache");

const DEFAULT_COUNT = 10;
const DEFAULT_CACHE_SECONDS = 3600;

const parser = new Parser();

/** Shared cache-file path rule — MUST match src/lib/rssFeed.ts. */
function cacheFileFor(feedurl) {
  const hash = createHash("sha1").update(feedurl).digest("hex");
  return join(cacheRoot, `${hash}.json`);
}

/** Recursively collect .rss files (prefixed or standalone) under contentRoot. */
function walkRss(relDir, out) {
  const absDir = join(contentRoot, relDir);
  let names;
  try {
    names = readdirSync(absDir);
  } catch {
    return;
  }
  for (const name of names) {
    const relPath = relDir ? `${relDir}/${name}` : name;
    const abs = join(absDir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkRss(relPath, out);
    } else if (name.toLowerCase().endsWith(".rss")) {
      out.push(relPath);
    }
  }
}

/** Parse a .rss file body (YAML) for the three fields we honor. Lenient. */
function readFeedSpec(relPath) {
  let doc = {};
  try {
    // Normalize the legacy Spyc folded-scalar marker like src/loaders/yaml.ts.
    const raw = readFileSync(join(contentRoot, relPath), "utf8").replace(/:\s*>\s*$/gm, ": >");
    doc = parseYaml(raw) ?? {};
  } catch {
    /* malformed YAML → empty spec, skip below */
  }
  const feedurl = typeof doc.feedurl === "string" ? doc.feedurl.trim() : "";
  const count = Number.isFinite(+doc.count) && +doc.count > 0 ? Math.floor(+doc.count) : DEFAULT_COUNT;
  const cache =
    Number.isFinite(+doc.cache) && +doc.cache >= 0 ? Math.floor(+doc.cache) : DEFAULT_CACHE_SECONDS;
  return { feedurl, count, cache };
}

/** Read an existing cache entry, or null. */
function readCache(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Fetch + parse a feed → normalized items. Throws on failure (caller handles). */
async function fetchItems(feedurl, count) {
  const feed = await parser.parseURL(feedurl);
  return (feed.items ?? []).slice(0, count).map((it) => ({
    title: it.title ?? "",
    description: it.contentSnippet ?? it.content ?? it.summary ?? "",
    link: it.link ?? "",
  }));
}

async function processFeed(relPath) {
  const { feedurl, count, cache } = readFeedSpec(relPath);
  if (!feedurl) return "skip"; // no feedurl → nothing to fetch

  const file = cacheFileFor(feedurl);
  const existing = readCache(file);

  // Fresh within TTL → leave as-is.
  if (existing && typeof existing.fetchedAt === "number") {
    if (Date.now() - existing.fetchedAt < cache * 1000) return "fresh";
  }

  try {
    const items = await fetchItems(feedurl, count);
    mkdirSync(cacheRoot, { recursive: true, mode: 0o755 });
    writeFileSync(file, JSON.stringify({ feedurl, fetchedAt: Date.now(), items }, null, 2));
    return "fetched";
  } catch (err) {
    // Keep stale cache if we have one; otherwise seed an empty list so the
    // reader gets a deterministic (empty) result and the build stays green.
    if (!existing) {
      mkdirSync(cacheRoot, { recursive: true, mode: 0o755 });
      writeFileSync(file, JSON.stringify({ feedurl, fetchedAt: 0, items: [] }, null, 2));
    }
    console.warn(`[gen-rss] fetch failed for ${feedurl}: ${err.message}`);
    return "failed";
  }
}

async function main() {
  const feeds = [];
  walkRss("", feeds);

  let fetched = 0;
  let fresh = 0;
  let failed = 0;
  let skip = 0;
  // Dedup by feedurl so two .rss files pointing at the same feed fetch once.
  const seen = new Set();
  for (const rel of feeds) {
    const { feedurl } = readFeedSpec(rel);
    if (feedurl && seen.has(feedurl)) continue;
    if (feedurl) seen.add(feedurl);
    const r = await processFeed(rel);
    if (r === "fetched") fetched++;
    else if (r === "fresh") fresh++;
    else if (r === "failed") failed++;
    else skip++;
  }
  console.log(
    `[gen-rss] ${seen.size} feed(s) → ${fetched} fetched, ${fresh} fresh, ${failed} failed, ${skip} skipped (cache: ${cacheRoot})`,
  );
}

main();
