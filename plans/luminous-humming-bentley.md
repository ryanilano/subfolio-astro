# Plan: Cloudflare deploy via Wrangler (close out Phase 3)

## Context

Phase 3's build pipeline (thumbnails, image metadata, sitemap, sass, RSS-at-build) is
done, squashed, and pushed (`b57c70f`, origin in sync). The **one remaining Phase 3
item is deploy** — the roadmap line "deploy to Cloudflare Pages via Wrangler (mirror
`ilano-fyi`)" has no implementation in the repo (no `wrangler.*`, no `deploy` script).

The reference repo `~/local-dev/ilano-fyi` has since moved off the Pages adapter to the
newer **Workers static-assets** pattern: a `wrangler.jsonc` pointing `assets.directory`
at `./dist`, deployed with `wrangler deploy` (no Pages project, no adapter, no CI).
We mirror that. `wrangler ^4.87.0` is already in this repo's `devDependencies`, and the
build already emits a clean static `dist/` (31 pages incl. the `/directory/` raw-bytes
tree and space-in-name folders). Decisions confirmed with the user: **Workers
static-assets** + **manual `npm run deploy` script only** (no GitHub Action).

Outcome: `npm run deploy` builds and ships subfolio to Cloudflare's edge, completing
Phase 3 except the explicitly-deferred auth (Phase 4).

## Changes

### 1. New file: `wrangler.jsonc`
Mirror `ilano-fyi/wrangler.jsonc` exactly, renamed:
```jsonc
{
	"name": "subfolio",
	"compatibility_date": "2026-06-27",
	"assets": {
		"directory": "./dist"
	},
	"observability": {
		"enabled": true
	}
}
```
- `name: "subfolio"` — Workers project name; URL becomes `https://subfolio.<account>.workers.dev`. Note `astro.config.mjs` `site:` is currently `https://subfolio.pages.dev` (used for sitemap absolute URLs) — see Open question below.
- No `not_found_handling` needed: Astro default `directory` build format emits `index.html` per route, which static-assets serves and 404s correctly. Astro also emits a `dist/404.html` that Cloudflare serves on misses automatically.

### 2. `package.json` — add `deploy` script
Mirror ilano-fyi's manual flow. Add alongside existing scripts:
```json
"deploy": "npm run build && wrangler deploy"
```
`npm run build` already chains the three `gen-*` pre-build scripts + `astro check` + `astro build`, so `dist/` is fresh before upload.

### 3. `.gitignore` — add Wrangler local state
Append the Wrangler working dir (ilano-fyi has a `.wrangler/`):
```
# wrangler local state
.wrangler/
```

### 4. `docs/ROADMAP.md` — mark deploy done
- Update the Phase 3 bullet wording from "Cloudflare Pages" to "Cloudflare (Workers static-assets)" to match reality.
- Flip the status checkbox: `- [x] Phase 3 — Build pipeline & deploy`, move the `← next` marker to Phase 5 (Phase 4 is deferred/optional).

## Files
- `wrangler.jsonc` (new) — mirror of `~/local-dev/ilano-fyi/wrangler.jsonc`
- `package.json` — one new `deploy` script line
- `.gitignore` — add `.wrangler/`
- `docs/ROADMAP.md` — Phase 3 wording + status

## Open question (resolve at execution)
`astro.config.mjs` `site:` is `https://subfolio.pages.dev`. With Workers static-assets the
default hostname is `subfolio.<account>.workers.dev`, not `*.pages.dev`. The `site:` value
only affects absolute URLs in the sitemap. Options: (a) leave it (harmless if a custom
domain/`pages.dev` alias is intended later), or (b) update to the real workers.dev/custom
domain once known. Will confirm the intended public hostname before changing `site:`.

## Verification
1. `npm run build` — confirm green (already verified: 31 pages, all gen scripts run).
2. `npx wrangler deploy --dry-run` — validate `wrangler.jsonc` + asset upload manifest **without** shipping. Confirms config parses and `./dist` is picked up.
3. Spot-check the dry-run output includes the tricky paths: `05 display rss feed/`,
   `06 slideshow.slide/`, and the `directory/` raw-bytes tree.
4. Real deploy (`npm run deploy`) is gated on the user being logged in (`wrangler login`)
   and choosing to ship — I will **not** run a live deploy without explicit go-ahead, since
   it's outward-facing and publishes content. Dry-run is the safe end-to-end check.
5. After a live deploy: load the deployed URL, diff side-by-side against the live PHP app
   on the same content (the Phase 3 roadmap acceptance criterion).

## Commit
Single commit on `main` (working tree is clean, origin in sync):
`feat: Phase 3 — Cloudflare deploy via Wrangler (Workers static-assets)`.
Do not push or live-deploy without explicit user go-ahead.
