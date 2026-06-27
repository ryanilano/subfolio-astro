#!/usr/bin/env bash
#
# Fan out the Phase-2 view-port tasks (the Wave in docs/DEEPSEEK-TASKS.md) across
# parallel headless `claude` processes, each in its own git worktree, on the
# DeepSeek backend.
#
# How it works:
#   - flips the DeepClaude proxy to the DeepSeek backend (global switch)
#   - for each task: creates a worktree on a new branch off main, runs `claude -p`
#     headless with a tiny prompt that points at the task ID in
#     docs/DEEPSEEK-TASKS.md (which lives in every worktree)
#   - waits for all of them, then flips the proxy back to anthropic
#
# PREREQS:
#   1. docs/DEEPSEEK-TASKS.md must be COMMITTED to main (worktrees branch off main).
#   2. The GATE must be merged to main first: src/layouts/Layout.astro and the
#      reference src/components/filekinds/Img.astro must exist. Workers mirror
#      Img.astro as the pattern; without it they have nothing to copy. Guard below
#      checks for both.
#   3. Source PHP views are read from the UPSTREAM repo (see UPSTREAM below), not
#      from the worktree. They are NOT in this repo.
#
# Run this from your terminal, NOT from inside a Claude session — it flips the
# proxy backend globally and would change the model under your current session.

set -uo pipefail

REPO="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
WT_DIR="$REPO/../subfolio-astro-wt"     # worktrees live here, as siblings of the repo
UPSTREAM="/Users/ryan/local-dev/subfolio"   # the live PHP app — source of the views being ported
PROXY="http://127.0.0.1:3200"
MAX_PARALLEL=4                          # lower if you hit DeepSeek rate limits; raise to go wider
# Unattended runs need no permission prompts. Worktrees isolate every change, and
# tasks only write new component files + git commit, so bypassing is pragmatic here.
CLAUDE_FLAGS="--permission-mode bypassPermissions"

# task-id : branch  (the Wave from docs/DEEPSEEK-TASKS.md — all conflict-free)
# Filekind ports (C1-C11) + listing ports (C12-C16). img is the Gate, not a task.
TASKS=(
  "C1:port/filekind-vid"
  "C2:port/filekind-snd"
  "C3:port/filekind-link"
  "C4:port/filekind-oplx"
  "C5:port/filekind-rss"
  "C6:port/filekind-site"
  "C7:port/filekind-txt"
  "C8:port/filekind-swf"
  "C9:port/filekind-webloc"
  "C10:port/filekind-default"
  "C11:port/filekind-downloadbox"
  "C12:port/listing-gallery"
  "C13:port/listing-files-and-folders"
  "C14:port/listing-features"
  "C15:port/listing-related"
  "C16:port/listing-inline-embeds"
)

# --- guards -----------------------------------------------------------------
if ! git -C "$REPO" ls-files --error-unmatch docs/DEEPSEEK-TASKS.md >/dev/null 2>&1; then
  echo "ABORT: docs/DEEPSEEK-TASKS.md is not committed to git."
  echo "       Worktrees branch off main and won't see it. Commit it first."
  exit 1
fi
if ! git -C "$REPO" ls-files --error-unmatch src/layouts/Layout.astro >/dev/null 2>&1 \
   || ! git -C "$REPO" ls-files --error-unmatch src/components/filekinds/Img.astro >/dev/null 2>&1; then
  echo "ABORT: the Gate is not merged to main."
  echo "       Build + commit src/layouts/Layout.astro and src/components/filekinds/Img.astro"
  echo "       (the reference pattern) before fanning out. See docs/DEEPSEEK-TASKS.md > Gate."
  exit 1
fi
[ -d "$UPSTREAM/config/themes/default" ] || { echo "ABORT: upstream views not found at $UPSTREAM"; exit 1; }
command -v claude >/dev/null || { echo "ABORT: 'claude' CLI not on PATH."; exit 1; }
curl -sS "$PROXY/_proxy/status" >/dev/null || { echo "ABORT: proxy not reachable at $PROXY"; exit 1; }

mkdir -p "$WT_DIR"

# --- flip proxy to DeepSeek -------------------------------------------------
echo ">> switching proxy -> deepseek"
curl -sS -X POST "$PROXY/_proxy/mode" -d 'backend=deepseek' >/dev/null
trap 'echo ">> restoring proxy -> anthropic"; curl -sS -X POST "$PROXY/_proxy/mode" -d "backend=anthropic" >/dev/null' EXIT

# --- launch -----------------------------------------------------------------
run_task() {
  local id="$1" branch="$2"
  local path="$WT_DIR/$id"
  local log="$WT_DIR/$id.log"

  git -C "$REPO" worktree add -b "$branch" "$path" main >/dev/null 2>&1 \
    || { echo "[$id] worktree/branch already exists, skipping"; return; }

  local prompt="You are porting Subfolio's default theme to Astro components, in this repo \
(subfolio-astro). Open docs/DEEPSEEK-TASKS.md and execute ONLY task $id exactly as written. \
The SOURCE PHP views you are porting live in the UPSTREAM repo at \
$UPSTREAM/config/themes/default/ — read them there. Mirror the already-ported reference \
component src/components/filekinds/Img.astro as your pattern (prop signature, import style, \
class-preserving markup). The data shape is src/loaders/schema.ts. Produce the component file(s) \
the task names; keep markup and CSS classes IDENTICAL to the PHP for visual diffing. Do not \
touch any other task's files. When finished, run 'git add -A && git commit -m \"$id: \$(short description)\"'."

  echo "[$id] -> $branch ($path)"
  ( cd "$path" && claude -p "$prompt" $CLAUDE_FLAGS >"$log" 2>&1 ; echo "[$id] done (log: $log)" ) &
}

i=0
for entry in "${TASKS[@]}"; do
  run_task "${entry%%:*}" "${entry##*:}"
  i=$((i+1))
  # throttle: wait for a slot once MAX_PARALLEL are in flight
  if (( i % MAX_PARALLEL == 0 )); then wait -n 2>/dev/null || wait; fi
done
wait

# --- summary ----------------------------------------------------------------
echo
echo ">> all tasks finished. Branches created:"
for entry in "${TASKS[@]}"; do echo "   ${entry##*:}"; done
echo
echo ">> review a branch's work, then merge from the main repo, e.g.:"
echo "     git -C \"$REPO\" merge port/filekind-vid"
echo ">> when done with a worktree:"
echo "     git -C \"$REPO\" worktree remove $WT_DIR/C1"
