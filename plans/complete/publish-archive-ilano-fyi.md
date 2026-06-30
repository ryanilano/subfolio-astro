# Plan — Publish private content to `archive.ilano.fyi`

## Context

`./dev-content.sh preview` renders the **public** Subfolio engine (`subfolio-astro`,
GitHub PUBLIC) against the **private** real portfolio (`subfolio-astro-content`,
GitHub PRIVATE — puma, sephora, michelin, k2, david-yurman, …). The goal is to
publish that rendered output to `archive.ilano.fyi` **without** the client content
ever entering the public repo, and **without** disturbing the existing public demo
at `subfolio-astro.ilano.fyi`.

The content already has a private home (its own repo), so nothing needs to move.
We add a **second, separate** Cloudflare Pages project (`subfolio-archive`) that is
built by a GitHub Actions workflow **living in the private content repo** — it
checks out the public engine, builds it against the private content, and deploys.

Decisions locked with the user:
- **Trigger:** GitHub Actions, owned by the private content repo (auto-rebuild on content push).
- **Access:** public URL is fine; add `noindex` so it isn't crawled/indexed.
- **Public-repo edits:** generic, content-free env plumbing is allowed (site URL + noindex flag).

Existing pieces this reuses:
- `.github/workflows/deploy.yml` (engine repo) — template for the new workflow.
- `dev-content.sh` — documents the `SUBFOLIO_CONTENT_DIR` env contract (CI sets real env vars instead of sourcing `.env`).
- `package.json` `build` script — already runs all `gen-*` passes then `astro build`; caches write to engine cwd, never into content.
- All `gen-*` scripts + loaders already read `SUBFOLIO_CONTENT_DIR` / `SUBFOLIO_TEXT_RENDERING` from `process.env`.

---

## Part A — Public engine repo (`subfolio-astro`): 2 content-free edits

These default to current behavior, so the existing demo build is unchanged.

### A1. `astro.config.mjs` — env-overridable `site`
Replace the hardcoded line:
```js
site: process.env.SUBFOLIO_SITE_URL ?? "https://subfolio-astro.ilano.fyi",
```
Drives correct canonical URLs, OG/Twitter `og:url`/`og:image` (built via `new URL(..., Astro.site)` in `src/layouts/Layout.astro:82,86`), and the `@astrojs/sitemap` output.

### A2. `src/layouts/Layout.astro` — env-gated `noindex`
In frontmatter, read the flag:
```js
const noindex = process.env.SUBFOLIO_NOINDEX === "1";
```
In `<head>` (near the canonical link, ~line 234), emit when set:
```astro
{noindex && <meta name="robots" content="noindex, nofollow" />}
```

### A3. (optional, recommended) `astro.config.mjs` — drop sitemap when noindex
Wrap the integration so a noindex build doesn't ship a sitemap:
```js
integrations: [...(process.env.SUBFOLIO_NOINDEX === "1" ? [] : [sitemap()])],
```
Keeps the archive from advertising every private URL in a machine-readable index.

> These three edits live in the public repo but contain **no client content** — they
> are generic deploy knobs that also benefit the demo (still defaults unchanged).
> Land them on `main` via the normal squash-per-phase flow.

---

## Part B — Private content repo (`subfolio-astro-content`): new deploy workflow

Create `.github/workflows/deploy-archive.yml`. Sketch:

```yaml
name: Deploy archive.ilano.fyi
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout engine (public)
        uses: actions/checkout@v4
        with:
          repository: ryanilano/subfolio-astro
          ref: main
          path: engine
      - name: Checkout content (this repo, private)
        uses: actions/checkout@v4
        with:
          path: content
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version-file: engine/.nvmrc
          cache: npm
          cache-dependency-path: engine/package-lock.json
      - name: Install
        working-directory: engine
        run: npm ci
      - name: Build against private content
        working-directory: engine
        env:
          SUBFOLIO_CONTENT_DIR: ${{ github.workspace }}/content
          SUBFOLIO_SITE_URL: https://archive.ilano.fyi
          SUBFOLIO_NOINDEX: "1"
          SUBFOLIO_TEXT_RENDERING: markdown
        run: npm run build
      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy engine/dist --project-name subfolio-archive
```

Notes:
- `SUBFOLIO_CONTENT_DIR` points at the content checkout — same contract `dev-content.sh` promotes locally.
- `SUBFOLIO_TEXT_RENDERING: markdown` because the port only renders markdown (textile falls back to plain w/ warning — see `src/lib/renderText.ts`).
- Content is checked out into the runner only; it is **never** pushed to the public repo. The engine is public so its checkout needs no token.
- Add a short note to the content repo's `CLAUDE.md`/`README.md` that pushes auto-deploy to `archive.ilano.fyi`.

### B1. SECURITY — strip repo metadata before build (found during verification)

The engine serves the content tree **verbatim** across three surfaces: `/directory/<path>`
raw bytes (`src/pages/directory/[...path].ts` `walkFiles` — no hidden filtering), HTML
listing pages, and root-listing items. Pointed at a real git checkout, that exposed the
content repo's `.git/` (→ full private history `git clone`-able), `.github/`, `.claude/`,
`.DS_Store`, and `README/CLAUDE/AGENTS.md` on the public archive. The bundled
`content/examples/` fixture has no nested `.git`, so this never surfaced before.

**Resolution (chosen): strip in CI**, not an engine change. Because both the loader and the
endpoint read the same checkout, removing metadata from the throwaway runner checkout closes
all three surfaces at once. Adds nothing to daily authoring; private repo + local files
untouched. Workflow step (after content checkout, before build):
```yaml
- name: Strip repo metadata (must never reach the public archive)
  run: |
    find content -maxdepth 1 -name '.*' ! -name '.' -exec rm -rf {} +   # .git, .github, .claude, .gitignore …
    find content -name '.DS_Store' -delete
    rm -f content/README.md content/CLAUDE.md content/AGENTS.md
```
Dry-run verified: removes only metadata + the 3 docs; keeps all 12 project folders + `examples`.
Engine `walkFiles`/loader left unchanged (public demo has no `.git`, so no leak there).

---

## Part C — Cloudflare + DNS (one-time, manual; user-run)

Done by the user (account-scoped, not automatable from here):
1. **Create Pages project** `subfolio-archive` (CF dashboard → Pages → Create →
   "Direct Upload"/Wrangler; no Git connection needed since CI deploys via Wrangler).
   Or first deploy via `wrangler pages project create subfolio-archive`.
2. **Custom domain:** add `archive.ilano.fyi` to the `subfolio-archive` project →
   CF creates the `CNAME` (ilano.fyi is already on Cloudflare per `ilano-fyi`).
3. **Secrets** in the **content** repo (Settings → Secrets → Actions):
   `CLOUDFLARE_API_TOKEN` (Pages:Edit scope) and `CLOUDFLARE_ACCOUNT_ID` — same
   values the engine repo already uses.

---

## Verification

1. **Local parity first** — confirm the build is correct before wiring CI:
   ```sh
   SUBFOLIO_SITE_URL=https://archive.ilano.fyi SUBFOLIO_NOINDEX=1 \
   SUBFOLIO_TEXT_RENDERING=markdown ./dev-content.sh build
   ./dev-content.sh preview
   ```
   - Spot-check a real project page (e.g. `/puma`) renders.
   - `grep -r 'archive.ilano.fyi' dist/` → canonical/OG URLs use the archive domain.
   - `grep -rl 'name="robots"' dist/ | head` → `noindex,nofollow` present.
   - Confirm `dist/sitemap-*.xml` is absent (A3) or, if kept, points at archive.
2. **CI dry-run** — push the content repo (or `workflow_dispatch`); watch the Action
   build green and the `wrangler pages deploy` succeed to `subfolio-archive`.
3. **Live** — load `https://archive.ilano.fyi`, view-source: canonical = archive
   domain, robots = noindex. Confirm `https://subfolio-astro.ilano.fyi` (the public
   demo) still serves `content/examples/` unchanged.

## Out of scope / explicit non-goals
- No auth/gating on the live URL (deferred Phase 4 Worker; user chose public).
- No client content copied into the public repo — ever.
- Existing public demo + its `deploy.yml` untouched.
