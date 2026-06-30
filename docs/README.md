# docs

Planning and reference for the Subfolio → Astro port.

- [ROADMAP.md](./ROADMAP.md) — phased plan and current status.
- [ADR-deployment.md](./ADR-deployment.md) — the architectural decision (Go binary → Astro
  static, Cloudflare Pages, hybrid-ready). **Accepted.**
- [spec/](./spec/) — stack-agnostic behavior specs extracted from the original PHP engine
  (`Filebrowser.php` / `Subfolio.php` / `FileKind.php`). These are the source of truth for
  *what* the port must do; they describe behavior, not implementation.

## Provenance

These docs originate in the upstream [`subfolio`](https://github.com/ryanilano/subfolio)
repo (the live PHP/Kohana app being ported from), under its `plans/` directory. The
stack-agnostic specs and the accepted deployment ADR are mirrored here so this repo is
self-documenting.

Intentionally **not** copied (they live in the upstream repo as historical/parked
reference, and are Go-specific or superseded):

- `ADR-imaging`, `ADR-text-render`, `ADR-web-stack`, `ADR-yaml` — parked Go-library
  choices. Their *behavioral* rationale survives (resize rules, CommonMark+Textile,
  session/password semantics, YAML semantics); the Go library picks do not. Astro
  equivalents: `sharp`, `@astrojs/mdx` + a Textile step, the `yaml` npm lib, and Web
  Crypto/`scrypt` in the deferred auth Worker.
- `MODERNIZATION.md` — the original Go-targeted plan; superseded by [ROADMAP.md](./ROADMAP.md).
- `DEEPSEEK-TASKS.md` / `run-deepseek-tasks.sh` — an obsolete Go-port task fan-out.
