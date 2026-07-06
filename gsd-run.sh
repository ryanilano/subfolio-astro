#!/usr/bin/env bash
#
# gsd-run.sh — launch Claude Code with GSD subagents routed to DeepSeek V4, with
# a one-flag toggle between all-DeepSeek (cheap) and mixed (Claude does the
# planning/verifying, DeepSeek does the grunt work).
#
# HOW IT WORKS
#   Every model id Claude Code emits is chosen here via env, then routed to a
#   backend by the DeepClaude proxy (ANTHROPIC_BASE_URL). The "reasoning tier" is
#   carried by the `opus` alias, which GSD pins onto planner/plan-checker/
#   verifier via .planning/config.json `model_overrides`. Flipping where that
#   alias resolves is the ENTIRE difference between the two modes:
#
#     deepseek : opus -> deepseek-v4-pro     (all DeepSeek; cheapest)
#     mixed    : opus -> claude-sonnet-5      (planner/verifier on real Claude)
#
#   Grunt agents (no `model:` field -> inherit main) run deepseek-v4-flash in
#   both modes: cheap, and flash's 2500 concurrency cap absorbs wide fan-outs
#   where pro's 500 would throttle.
#
# ROUTING (DeepClaude — see docs/gsd-deepseek-routing.md)
#   deepseek-v4-*  ->  https://api.deepseek.com/anthropic   (native Anthropic fmt)
#   claude-*       ->  https://api.anthropic.com            (passthrough)
#   NOTE: `mixed` needs the PREFIX-ROUTER change drafted in that doc. The current
#   mode-switch proxy serves ONE backend per mode (all-DeepSeek or all-Claude),
#   so verify mixed actually splits before relying on it.
#
# PREREQUISITES (env — never hardcode secrets here)
#   DEEPCLAUDE_TOKEN   client token the proxy expects (optional if the localhost
#                      proxy accepts unauthenticated requests)
#   DeepClaude proxy running at ANTHROPIC_BASE_URL below.
#
# USAGE
#   ./gsd-run.sh                        # all-DeepSeek (default)
#   ./gsd-run.sh deepseek               # same, explicit
#   ./gsd-run.sh mixed                  # Claude planner/verifier + DeepSeek grunt
#   ./gsd-run.sh mixed /gsd-plan-phase  # extra args pass through to `claude`
#
set -euo pipefail
cd "$(dirname "$0")"

# First arg is the mode ONLY if it names one; otherwise default and pass through.
mode="deepseek"
if [[ "${1:-}" == "deepseek" || "${1:-}" == "mixed" ]]; then
  mode="$1"; shift
fi

# --- backend router -------------------------------------------------------
export ANTHROPIC_BASE_URL="http://127.0.0.1:3200"
export ANTHROPIC_AUTH_TOKEN="${DEEPCLAUDE_TOKEN:-}"
[ -n "$ANTHROPIC_AUTH_TOKEN" ] || \
  echo "warn: DEEPCLAUDE_TOKEN unset — relying on the proxy accepting unauthenticated localhost requests" >&2

# --- grunt tier (both modes) ---------------------------------------------
export ANTHROPIC_MODEL="deepseek-v4-flash"                 # main loop + inheriting agents
export ANTHROPIC_DEFAULT_HAIKU_MODEL="deepseek-v4-flash"
export ANTHROPIC_DEFAULT_SONNET_MODEL="deepseek-v4-flash"  # catches gsd-mempalace-curator's `model: sonnet`

# --- reasoning tier (the toggle) -----------------------------------------
case "$mode" in
  deepseek) export ANTHROPIC_DEFAULT_OPUS_MODEL="deepseek-v4-pro" ;;   # or deepseek-v4-flash for rock-bottom
  mixed)    export ANTHROPIC_DEFAULT_OPUS_MODEL="claude-sonnet-5" ;;   # or claude-opus-4-8 for max quality
esac

echo "→ gsd-run: mode=$mode  grunt=deepseek-v4-flash  reasoning=$ANTHROPIC_DEFAULT_OPUS_MODEL" >&2
exec claude "$@"
