#!/usr/bin/env bash
#
# Fan out the structural smoke-test wave (docs/DEEPSEEK-TASKS-testing.md) across
# parallel headless `claude` processes, each in its own git worktree, on DeepSeek.
#
# How it works:
#   - flips the DeepClaude proxy to the DeepSeek backend (global switch)
#   - for each task: creates a worktree on a new branch off main, symlinks
#     node_modules from the main repo (so `npm run build`/`npm run test` work
#     without a reinstall), runs `claude -p` headless with a prompt pointing at
#     the task ID in docs/DEEPSEEK-TASKS-testing.md
#   - waits for all of them, then flips the proxy back to anthropic
#
# PREREQS:
#   1. Set the DeepSeek API key in the proxy vault FIRST. Verify:
#        curl -s http://127.0.0.1:3200/_proxy/status
#        curl -sX POST http://127.0.0.1:3200/_proxy/mode -d backend=deepseek   # must NOT error
#        curl -sX POST http://127.0.0.1:3200/_proxy/mode -d backend=anthropic  # flip back
#   2. The Gate must be COMMITTED to main: tests/_dist.mjs, tests/smoke.routes.test.mjs,
#      the package.json "test" script, and docs/DEEPSEEK-TASKS-testing.md.
#      (Worktrees branch off main and only see what's committed there.)
#
# Run this from your terminal, NOT from inside a Claude session — it flips the
# proxy backend globally and would change the model under your current session.

set -uo pipefail

REPO="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
WT_DIR="$REPO/../subfolio-astro-wt"     # worktrees live here, as siblings of the repo
PROXY="http://127.0.0.1:3200"
MAX_PARALLEL=4                          # lower if you hit DeepSeek rate limits
# Unattended runs need no permission prompts. Worktrees isolate every change, and
# tasks only add one new test file (RSS1 edits one script) + git commit.
CLAUDE_FLAGS="--permission-mode bypassPermissions"

# task-id : branch  (the Wave from docs/DEEPSEEK-TASKS-testing.md — conflict-free)
# ST1-ST4 each add one new tests/smoke.*.test.mjs. RSS1 edits scripts/gen-rss.mjs
# (its own branch, disjoint from the test files). Drop RSS1 if you only want tests.
TASKS=(
  "ST1:test/smoke-listing"
  "ST2:test/smoke-filekinds"
  "ST3:test/smoke-encoding"
  "ST4:test/smoke-thumbnails"
  "RSS1:fix/gen-rss-tolerant"
)

# --- guards -----------------------------------------------------------------
for f in docs/DEEPSEEK-TASKS-testing.md tests/_dist.mjs tests/smoke.routes.test.mjs; do
  if ! git -C "$REPO" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "ABORT: $f is not committed to main. Commit the Gate first (see PREREQS)."
    exit 1
  fi
done
command -v claude >/dev/null || { echo "ABORT: 'claude' CLI not on PATH."; exit 1; }
curl -sS "$PROXY/_proxy/status" >/dev/null || { echo "ABORT: proxy not reachable at $PROXY"; exit 1; }
# Fail fast if the DeepSeek key isn't set — otherwise every worker runs on the wrong backend.
if curl -sS -X POST "$PROXY/_proxy/mode" -d 'backend=deepseek' | grep -q '"error"'; then
  echo "ABORT: proxy refused backend=deepseek (API key not set?). Fix the key first."
  curl -sS -X POST "$PROXY/_proxy/mode" -d 'backend=anthropic' >/dev/null
  exit 1
fi

mkdir -p "$WT_DIR"
trap 'echo ">> restoring proxy -> anthropic"; curl -sS -X POST "$PROXY/_proxy/mode" -d "backend=anthropic" >/dev/null' EXIT
echo ">> proxy is on deepseek"

# --- launch -----------------------------------------------------------------
run_task() {
  local id="$1" branch="$2"
  local path="$WT_DIR/$id"
  local log="$WT_DIR/$id.log"

  git -C "$REPO" worktree add -b "$branch" "$path" main >/dev/null 2>&1 \
    || { echo "[$id] worktree/branch already exists, skipping"; return; }

  # Share the main repo's installed deps so build/test run without a reinstall.
  [ -e "$path/node_modules" ] || ln -s "$REPO/node_modules" "$path/node_modules"

  local prompt="You are adding automated tests to subfolio-astro (an Astro static site). \
Open docs/DEEPSEEK-TASKS-testing.md and execute ONLY task $id exactly as written. \
Mirror the reference test tests/smoke.routes.test.mjs (same imports: node:test, \
node:assert/strict, and the ./_dist.mjs helpers) as your pattern. To discover exact assertion \
markers, first run 'npm run build', then grep the relevant dist/<route>/index.html files. \
Produce ONLY the one file the task names; do NOT modify tests/_dist.mjs, \
tests/smoke.routes.test.mjs, package.json, or any other task's file. \
SELF-VERIFY before committing: run 'npm run build && npm run test' and ensure ALL tests pass \
(the existing ones too). When green, run 'git add -A && git commit -m \"$id: \$(short description)\"'."

  echo "[$id] -> $branch ($path)"
  ( cd "$path" && claude -p "$prompt" $CLAUDE_FLAGS >"$log" 2>&1 ; echo "[$id] done (log: $log)" ) &
}

i=0
for entry in "${TASKS[@]}"; do
  run_task "${entry%%:*}" "${entry##*:}"
  i=$((i+1))
  if (( i % MAX_PARALLEL == 0 )); then wait -n 2>/dev/null || wait; fi
done
wait

# --- summary ----------------------------------------------------------------
echo
echo ">> all tasks finished. Branches created:"
for entry in "${TASKS[@]}"; do echo "   ${entry##*:}  (log: $WT_DIR/${entry%%:*}.log)"; done
echo
echo ">> review each branch, then merge from the main repo, e.g.:"
echo "     git -C \"$REPO\" merge test/smoke-listing"
echo ">> after merging, prove the whole suite:  npm run build && npm run test"
echo ">> clean up a worktree when done:"
echo "     git -C \"$REPO\" worktree remove $WT_DIR/ST1"
