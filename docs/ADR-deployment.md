# ADR — Deployment Model (Go binary vs. Astro static vs. hybrid)

**Status:** Accepted
**Date:** 2026-06-27
**Supersedes (conditionally):** the Go-target framing in `plans/MODERNIZATION.md` and parks the four
Go-library ADRs (`ADR-imaging`, `ADR-text-render`, `ADR-web-stack`, `ADR-yaml`) — see Consequences.

## Context

`plans/MODERNIZATION.md` targets a **Go single binary** to escape the PHP5/Kohana runtime-EOL trap.
That choice was made to "escape the runtime treadmill," not because Go itself was a requirement. The
maintainer separately operates `ilano-fyi` — a working **Astro 6 → Cloudflare (Wrangler) → static**
site (MDX content collections, `sharp`, `sass`) — and asked whether Subfolio could instead become a
flat/static site that "updates the same way," rather than a from-scratch Go service.

Constraints gathered this session are all *loose* — none on its own forces an architecture:

- **Authoring:** mixed (some galleries stable, some change often; no firm requirement either way).
- **Auth** (login + `-access` private folders): **nice-to-have, not required.**
- **Hosting:** cheapest / either.
- Still a **port** that preserves look + content conventions, not a redesign.

When constraints are this loose, the tiebreakers become **cost** and **fluency in the stack** — both
pointing away from a bespoke Go service and toward the Astro/Cloudflare pipeline already in use.

The real question is not "static vs. dynamic" as a binary, but: *which request-time behaviors actually
need a server, once the nice-to-have features are treated as nice-to-have?* The Phase-0 behavior
inventory (engine libraries, captured in `plans/spec/`) plus the answers above resolve each one:

| Request-time behavior (PHP today) | Disposition |
|---|---|
| Live file-drop visibility (no build) | **Trade-off** — static needs a build; replaced by watch→rebuild (local) / deploy hook. The one thing pure-static genuinely can't match. Acceptable given mixed authoring. |
| Thumbnail generation (`FileFolder` resize-if-stale, `SPEC-thumbnails.md`) | **BUILD-TIME** via `sharp`. Spec is literally "resize when thumb older than source." |
| Directory/folder listing, hidden filtering, filekind mapping | **BUILD-TIME** — pure functions over the tree → Astro content collection. |
| `-properties`/`.info` YAML, `-t-/-m-/-b-` embeds, `.ftr` features, retina/shadow variants | **BUILD-TIME** — static per folder, precomputed into the collection. |
| Sort preferences (session `?sort=`) | **CLIENT-SIDE** — localStorage + JS re-sort; folder/theme defaults baked at build. |
| Mobile/`iPhone` detection → grid mode | **CLIENT-SIDE** — responsive CSS (default theme is already responsive). |
| RSS `.rss` fetch + cache | **BUILD-TIME** fetch (or scheduled rebuild). |
| `.oplx` → on-the-fly ZIP | **BUILD-TIME** prebuilt `.zip` artifact (or Worker if it must be live). |
| Raw file serve/download **with access checks** | **NEEDS-EDGE** *only because of auth.* Public files are plain static assets; gated files need a Worker. |
| Login / sessions / `-access` evaluation | **NEEDS-EDGE** — but **nice-to-have**, so deferrable. |

With auth treated as nice-to-have, the only genuinely server-bound behaviors are **auth and
access-gated file serving** — exactly the pair the maintainer is willing to defer. Everything else is
build-time or client-side.

## Decision

**Target C — Astro static, hybrid-ready.** Build Subfolio as an Astro static site deployed to
Cloudflare Pages (mirroring `ilano-fyi`), with a clean architectural seam where a **Cloudflare
Worker** can later add auth + access-gated file serving *if and only if* that need becomes real. Ship
pure-static first; do not build the Worker until auth is actually required.

### Alternatives considered

| | A: Go single binary (prior plan) | B: Pure Astro static | **C: Astro static, hybrid-ready (chosen)** |
|---|---|---|---|
| Live file-drop, zero build | ✅ native | ❌ rebuild | ❌ rebuild (watch / deploy-hook) |
| Auth / private folders | ✅ native | ❌ gone | ⏸ deferred to optional Worker |
| Access-gated file serve | ✅ native | ❌ public-only | ⏸ Worker when needed; public-only until then |
| Thumbnails | Go imaging lib | `sharp` at build | `sharp` at build |
| Hosting cost | paid host + ops | **free (CF Pages)** | **free (CF Pages)**, Worker on free tier |
| Stack fluency for maintainer | ❌ new from scratch | ✅ = ilano-fyi | ✅ = ilano-fyi |
| Reuses Phase-0 specs | ✅ | ✅ | ✅ |
| Work already sunk | Phase-1 Go skeleton | none | none |

**A** is the most capable but the most expensive in money *and* learning — to buy features rated
nice-to-have. **B** is cheapest but discards access control entirely. **C** gets B's cost and fluency
while keeping a defined path back to A's gated serving, without paying for it upfront.

## Consequences

- **Positive — cost/ops drop to ~zero.** Cloudflare Pages free tier vs. standing up and patching a
  host for a Go binary.
- **Positive — reuses tooling already operated.** `ilano-fyi`'s `package.json` already carries
  `sharp`, `sass`, and `wrangler`; the build pipeline is not a new dependency surface.
- **Positive — the path-traversal bug disappears by construction.** The vuln the Go skeleton was
  fixing (`Filebrowser.php:179` raw `?path=` concatenation → `readfile`) has no analog in a static
  build: there is no runtime `?path=` parameter, and build-time path resolution is jailed to the
  content root. The security goal survives even though the Go code that delivered it is discarded.
- **Positive — Phase-0 specs survive unchanged.** `plans/spec/SPEC-*.md` are stack-agnostic behavior
  specs and remain the source of truth. `SPEC-theme-api.md` needs its template-function surface
  re-expressed as Astro components rather than `html/template`, but the *contract* holds.
- **Negative — no true zero-build live file-drop.** Authoring becomes "drop files → `astro dev` watch
  rebuilds locally / push triggers a Pages deploy." Acceptable under mixed authoring; if it ever
  stops being acceptable, that is the trigger to revisit Target A — not to bolt live editing onto
  static.
- **Negative — until the Worker exists, everything is public.** Gated `-access` folders are not
  enforced by a static build. Fine for an internal / non-exposed tool, but it must be stated plainly,
  and it gates any future public exposure on building Phase 4.
- **Parked work — the Phase-1 Go skeleton is discarded** (safepath jail, Go config loader, Go
  directory browser, JSON server), and the four Go-library ADRs become **superseded/parked**: their
  *behavioral* rationale (bcrypt, CommonMark + Textile, YAML semantics, resize rules) stays valid;
  the Go library picks no longer apply. Astro-side equivalents: `sharp` (imaging), `@astrojs/mdx` +
  a Textile step (text rendering), the `yaml` npm lib (config), and Web Crypto / `scrypt` in the
  Worker (password hashing).
- **Risk — the novel piece is the Astro content loader** that interprets Subfolio's file-naming
  conventions (what MDX collections do not give for free). Prototype it first (Phase 1) to de-risk.

## References

- `plans/MODERNIZATION.md` — prior Go-targeted plan; revised roadmap lands there alongside this ADR.
- `plans/spec/SPEC-*.md` — stack-agnostic behavior specs (esp. `SPEC-thumbnails.md`,
  `SPEC-conventions.md`, `SPEC-routes.md`, `SPEC-access.md`, `SPEC-theme-api.md`).
- `plans/adr/ADR-imaging.md`, `ADR-text-render.md`, `ADR-web-stack.md`, `ADR-yaml.md` — parked Go
  library choices whose behavioral rationale carries over.
- Reference stack: `~/local-dev/ilano-fyi` (Astro 6 + Wrangler + `sharp`/`sass`).
