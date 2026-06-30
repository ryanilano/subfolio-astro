#!/usr/bin/env bash
#
# Fan out the Milestone-6 PERF tasks (the disjoint, conflict-free ones in
# docs/DEEPSEEK-TASKS-perf.md) across parallel headless `claude` processes, each
# in its own git worktree, on the DeepSeek backend.
#
# Adapted from docs/run-deepseek-tasks.sh (the Phase-2 Wave runner). Two additions
# this milestone, per plans/zippy-coalescing-rainbow.md Phase A:
#   1. GUARD that scripts/perf-budget.mjs exists on main before fanning out — the
#      measurement Gate must be merged first or there's no baseline to show deltas
#      against.
#   2. MODEL/TOKEN LEDGER: each worker runs `claude -p --output-format json` and the
#      result JSON is tee'd to $WT_DIR/$id.json. After fan-out, scripts/ledger.mjs
#      reads every *.json and writes docs/ledger-perf.json + a Markdown table, so the
#      DeepSeek-vs-Anthropic split + token/cost footprint is provable per phase.
#
# Run this from your terminal, NOT from inside a Claude session — it flips the
# proxy backend globally and would change the model under your current session.
#
# Usage:  ./docs/run-deepseek-perf.sh [PHASE]
#   PHASE selects a task set below (default: B). Add sets as later phases need them.

set -uo pipefail

PHASE="${1:-B}"
REPO="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
WT_DIR="$REPO/../subfolio-astro-perf-wt"   # worktrees live here, siblings of the repo
PROXY="http://127.0.0.1:3200"
MAX_PARALLEL=4                             # lower if you hit DeepSeek rate limits
# Unattended runs need no permission prompts. Worktrees isolate every change, and
# each task edits only ITS OWN disjoint file(s), so bypassing is pragmatic here.
CLAUDE_FLAGS="--permission-mode bypassPermissions"

# task-id : branch  (the disjoint per-file tasks from docs/DEEPSEEK-TASKS-perf.md).
# Phase B: CSS minify, font diet, lazy images ×3 — every task a DIFFERENT file, so
# the merges are conflict-free. The two Layout.astro items (B4) are Opus-owned and
# are NOT in this list (hot shared file, serialized by hand).
case "$PHASE" in
  B)
    # B2 (font diet) already done by hand via the Inter swap; B4 is Opus-owned
    # (hot Layout.astro). Remaining disjoint fan-out:
    TASKS=(
      "B1:perf/css-minify"
      "B3a:perf/lazy-gallery"
      "B3b:perf/lazy-features"
      "B3c:perf/lazy-img"
    )
    ;;
  C)
    # Phase C fan-out: mirror the Gallery <picture> Gate into the other two image
    # surfaces. Gate (gen-thumbs.mjs, routing.ts, Gallery.astro) is Opus-owned.
    TASKS=(
      "C1:perf/picture-features"
      "C2:perf/picture-img"
    )
    ;;
  *)
    echo "ABORT: unknown PHASE '$PHASE' (known: B, C)"; exit 1 ;;
esac

# --- guards -----------------------------------------------------------------
if ! git -C "$REPO" ls-files --error-unmatch docs/DEEPSEEK-TASKS-perf.md >/dev/null 2>&1; then
  echo "ABORT: docs/DEEPSEEK-TASKS-perf.md is not committed to git."
  echo "       Worktrees branch off main and won't see it. Commit it first."
  exit 1
fi
# Phase-A Gate guard: the measurement harness must exist or workers can't show deltas.
if ! git -C "$REPO" ls-files --error-unmatch scripts/perf-budget.mjs >/dev/null 2>&1; then
  echo "ABORT: the Phase-A measurement Gate (scripts/perf-budget.mjs) is not on main."
  echo "       Merge Phase A first — it's the baseline every later wave diffs against."
  exit 1
fi
command -v claude >/dev/null || { echo "ABORT: 'claude' CLI not on PATH."; exit 1; }
curl -sS "$PROXY/_proxy/status" >/dev/null || { echo "ABORT: proxy not reachable at $PROXY"; exit 1; }

mkdir -p "$WT_DIR"

# --- flip proxy to DeepSeek -------------------------------------------------
echo ">> switching proxy -> deepseek"
curl -sS -X POST "$PROXY/_proxy/mode" -d 'backend=deepseek' >/dev/null
trap 'echo ">> restoring proxy -> anthropic"; curl -sS -X POST "$PROXY/_proxy/mode" -d "backend=anthropic" >/dev/null' EXIT

# Snapshot the proxy's OWN cumulative cost accounting BEFORE fan-out. /_proxy/cost
# is the only source that knows the real backend + DeepSeek-priced spend — the
# per-worker `claude -p` JSON always reports the local Anthropic envelope
# (claude-* id, Anthropic pricing) regardless of where the proxy routed it. The
# ledger diffs after-minus-before to attribute THIS phase's spend to the backend
# that actually served it.
curl -sS "$PROXY/_proxy/cost" >"$WT_DIR/_cost-before.json" 2>/dev/null || echo '{}' >"$WT_DIR/_cost-before.json"

# --- launch -----------------------------------------------------------------
run_task() {
  local id="$1" branch="$2"
  local path="$WT_DIR/$id"
  local json="$WT_DIR/$id.json"
  local log="$WT_DIR/$id.log"

  git -C "$REPO" worktree add -b "$branch" "$path" main >/dev/null 2>&1 \
    || { echo "[$id] worktree/branch already exists, skipping"; return; }

  local prompt="You are doing a performance edit in this repo (subfolio-astro). Open \
docs/DEEPSEEK-TASKS-perf.md and execute ONLY task $id exactly as written — it names the \
single file you may touch and the exact change. Mirror any reference pattern the task \
pins. Do NOT touch any other task's files, and do NOT run a full build. When finished, \
run 'git add -A && git commit -m \"$id: \$(short description)\"'."

  echo "[$id] -> $branch ($path)"
  # --output-format json emits the model/token/cost envelope the ledger reads.
  # tee to $json (the ledger input); keep a human log too.
  ( cd "$path" && claude -p "$prompt" $CLAUDE_FLAGS --output-format json >"$json" 2>"$log" ; \
    echo "[$id] done (json: $json, log: $log)" ) &
}

i=0
for entry in "${TASKS[@]}"; do
  run_task "${entry%%:*}" "${entry##*:}"
  i=$((i+1))
  if (( i % MAX_PARALLEL == 0 )); then wait -n 2>/dev/null || wait; fi
done
wait

# --- ledger -----------------------------------------------------------------
# Snapshot the proxy's cumulative cost AFTER fan-out; the ledger diffs it against
# _cost-before.json to get the real backend/spend for this phase.
curl -sS "$PROXY/_proxy/cost" >"$WT_DIR/_cost-after.json" 2>/dev/null || echo '{}' >"$WT_DIR/_cost-after.json"
echo
echo ">> building model/token ledger from $WT_DIR/*.json (+ proxy cost delta)"
node "$REPO/scripts/ledger.mjs" "$WT_DIR" --phase="$PHASE" \
  --cost-before="$WT_DIR/_cost-before.json" --cost-after="$WT_DIR/_cost-after.json" || true

# --- summary ----------------------------------------------------------------
echo
echo ">> all tasks finished. Branches created:"
for entry in "${TASKS[@]}"; do echo "   ${entry##*:}"; done
echo
echo ">> review a branch's work, then merge from the main repo, e.g.:"
echo "     git -C \"$REPO\" merge ${TASKS[0]##*:}"
echo ">> when done with a worktree:"
echo "     git -C \"$REPO\" worktree remove $WT_DIR/${TASKS[0]%%:*}"
