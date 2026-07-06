# Routing GSD subagents to DeepSeek V4

Run GSD's subagent fleet on **DeepSeek V4** cheaply, with a one-flag toggle to a
**mixed** mode where the reasoning-heavy agents (planner / plan-checker /
verifier) run on real Claude while everything else stays on DeepSeek.

This is dev tooling for the DeepClaude workflow (see [CLAUDE.md](../CLAUDE.md));
it does not affect the Astro build or the deployed site.

## TL;DR

```sh
./gsd-run.sh            # all-DeepSeek  (cheapest)
./gsd-run.sh mixed      # Claude plans/verifies, DeepSeek does the grunt work
```

The wrapper ([gsd-run.sh](../gsd-run.sh)) sets the model ids Claude Code emits;
the DeepClaude proxy routes each id to a backend. The only thing that changes
between modes is where the `opus` alias (the "reasoning tier") resolves.

## The two DeepSeek V4 models

From the [DeepSeek API model table](https://api-docs.deepseek.com/quick_start/pricing)
(USD per 1M tokens):

| Model | Context | Max out | Cache hit | Cache miss (in) | Output | Concurrency |
|---|---|---|---|---|---|---|
| `deepseek-v4-flash` | 1M | 384K | $0.0028 | $0.14 | $0.28 | 2500 |
| `deepseek-v4-pro`   | 1M | 384K | $0.003625 | $0.435 | $0.87 | 500 |

Both support thinking + non-thinking modes, JSON output, and tool calls, and
expose a **native Anthropic-format endpoint**: `https://api.deepseek.com/anthropic`.

> **Deadline:** the legacy ids `deepseek-chat` / `deepseek-reasoner` deprecate
> **2026-07-24 15:59 UTC**. Anything mapping onto them (incl. DeepClaude's
> `MODEL_REMAP`) must move to `deepseek-v4-*` before then or it silently falls
> back to the backend default.

## How the tiering maps onto GSD agents

- **Grunt (default).** 33 of 34 GSD agents declare no `model:` field, so they
  inherit the main-loop model. `ANTHROPIC_MODEL=deepseek-v4-flash` puts all of
  them on flash — cheap, and flash's 2500-concurrency ceiling absorbs wide
  fan-outs (codebase-mapper, doc-classifier, finder fleets) that pro's 500 would
  throttle.
- **Reasoning tier.** `gsd-planner`, `gsd-plan-checker`, `gsd-verifier` are
  pinned to the `opus` alias via `model_overrides` (below). The wrapper decides
  what `opus` resolves to per mode.
- **Safety net.** `ANTHROPIC_DEFAULT_SONNET_MODEL` / `_HAIKU_MODEL` also point at
  flash so no alias can leak a `claude-*` id in all-DeepSeek mode. This also
  catches `gsd-mempalace-curator`, the one agent that hard-pins `model: sonnet`.

## A — the wrapper

[gsd-run.sh](../gsd-run.sh). Env it sets (names verified against the current
Claude Code env-var reference):

| Var | Value | Purpose |
|---|---|---|
| `ANTHROPIC_BASE_URL` | `http://127.0.0.1:3200` | DeepClaude proxy |
| `ANTHROPIC_AUTH_TOKEN` | `$DEEPCLAUDE_TOKEN` | client auth to the proxy |
| `ANTHROPIC_MODEL` | `deepseek-v4-flash` | main loop + inheriting grunt agents |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `deepseek-v4-flash` | remap `haiku` alias |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `deepseek-v4-flash` | remap `sonnet` alias |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | **the toggle** | `deepseek-v4-pro` (deepseek) / `claude-sonnet-5` (mixed) |

`ANTHROPIC_SMALL_FAST_MODEL` is deprecated — `ANTHROPIC_DEFAULT_HAIKU_MODEL`
replaces it. **Do not** set `CLAUDE_CODE_SUBAGENT_MODEL`: it is priority-1 and
would override the per-agent `model_overrides`, collapsing the flash/pro split.

## B — GSD config (applied to `.planning/config.json`)

`.planning/` is untracked (local planning state), so this is a live local change,
not part of the PR. Added keys:

```json
{
  "model_profile": "inherit",
  "resolve_model_ids": false,
  "model_overrides": {
    "gsd-planner":      "opus",
    "gsd-plan-checker": "opus",
    "gsd-verifier":     "opus"
  }
}
```

- `model_profile: "inherit"` (was `"adaptive"`) — stops GSD imposing its own
  per-agent model choices so agents inherit `ANTHROPIC_MODEL` (flash).
- `resolve_model_ids: false` — keeps the `opus` alias **unresolved** so the
  wrapper's env can retarget it. If it were `true`, GSD would expand it to a full
  `claude-*` id before spawning, which DeepSeek would reject.
- `model_overrides` — passes `opus` as the per-invocation model (priority 2,
  beats `inherit`) for exactly the three reasoning agents.

Revert: set `model_profile` back to `"adaptive"` and drop the two added keys.

## C — DeepClaude routing change (DRAFT — not applied)

### Current architecture

DeepClaude (`aattaran/deepclaude`, cloned to `~/.config/deepclaude/proxy`) is a
**mode switch**: `deepseek` | `openrouter` | `anthropic` (passthrough). In
`deepseek` mode it remaps `claude-*` ids to backend ids via a hardcoded
`MODEL_REMAP` table in `proxy/proxy/model-proxy.js`, translating Anthropic↔OpenAI
on the way. Unmapped ids are forwarded raw and silently mis-route
([issue #39](https://github.com/aattaran/deepclaude/issues/39); guarded by
`~/.config/deepclaude/check-remap.sh`).

**Limitation:** one backend per mode. So the current proxy can do all-DeepSeek
(`deepseek` mode) or all-Claude (`anthropic` mode) — **but not both in one
session**, which is what `mixed` needs.

### Proposed change: per-id prefix router

Replace the mode-switch + stale `MODEL_REMAP` with routing by id prefix,
targeting DeepSeek's native Anthropic endpoint (no translation):

| Id prefix | Upstream | Auth |
|---|---|---|
| `deepseek-v4-*` | `https://api.deepseek.com/anthropic` | `Authorization: Bearer $DEEPSEEK_API_KEY` |
| `claude-*` | `https://api.anthropic.com` | existing Anthropic passthrough |

Benefits:

1. **Enables mixed mode** — planner emits `claude-sonnet-5` → Anthropic; grunt
   emits `deepseek-v4-flash` → DeepSeek, in the same run.
2. **Kills the #39 class of bug** — we emit explicit `deepseek-v4-*` ids from the
   wrapper, so there is no `claude-*`→`deepseek` remap table to keep in sync with
   each Claude release. Drop the translation path too (native endpoint speaks
   Anthropic format directly).

Until this lands, `mixed` will run all-Claude or all-DeepSeek depending on the
proxy mode, **not** a true split.

## Verification (run against `/_proxy/cost`)

1. **`model_overrides` honors the alias.** Spawn `gsd-planner` in each mode;
   confirm `/_proxy/cost` shows `deepseek-v4-pro` (deepseek) / a `claude-*` id
   (mixed) for it, while fan-out agents show `deepseek-v4-flash`. If GSD resolves
   the alias to a full id despite `resolve_model_ids: false`, swap full-id
   `model_overrides` blocks per mode instead of relying on the env toggle.
2. **DeepSeek `/anthropic` auth** — Bearer vs `x-api-key`:
   ```sh
   curl -s https://api.deepseek.com/anthropic/v1/messages \
     -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
     -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
     -d '{"model":"deepseek-v4-flash","max_tokens":16,"messages":[{"role":"user","content":"ping"}]}'
   ```
   401 → use `-H "x-api-key: $DEEPSEEK_API_KEY"` and `ANTHROPIC_API_KEY` instead.
3. **Proxy client token** — whatever `ANTHROPIC_AUTH_TOKEN` the proxy expects
   (or none, for unauthenticated localhost).

Also refresh `check-remap.sh`'s `CURRENT_CLAUDE_MODELS` — it still lists
`claude-sonnet-4-6`; confirm the current Sonnet id for your Claude Code build
before pinning it in `mixed` mode.
