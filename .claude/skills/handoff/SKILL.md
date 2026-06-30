---
name: handoff
description: Capture durable session state for a clean pass-off to a new context window, or resume cold from a prior handoff. Use when the user says "prepare for new context window", "hand off", "pass off to phase/next session", "wrap up for handoff", "prep handoff", or "resume work / resume <milestone/phase>". Built for this repo's milestone/phase + DeepSeek fan-out workflow.
---

# Handoff

Make passing work between context windows cheap and lossless. A new window starts cold — it knows only durable memory + git. Two modes: **capture** (session end) and **resume** (session start). Pick from the user's phrasing: "prepare/wrap up/pass off" → Capture; "resume/pick up/continue" → Resume.

**Token efficiency is mandatory for everything this skill writes** (memory files + the handoff report). The payload is re-read cold every future session, so every wasted token is paid forever. Write for signal density: facts, `file:line` targets, PR#/commit SHAs, terse bullets — no narrative, no blow-by-blow, no restating git/code/CLAUDE.md. **Compress completed/shipped work to outcome + durable gotchas only** (the execution story is in git). Keep what's non-obvious and not derivable from the repo; cut the rest. See [[token-efficient-memory-writing]].

**Find the memory dir first (either mode), portable — don't hardcode `/Users/...`:**
`MEM="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/$(pwd | sed 's#/#-#g')/memory"`. Confirm with `ls "$MEM"` (holds `MEMORY.md` + per-fact `*.md`). The session's system context also names this dir. Create it if absent.

---

## Mode A — Capture

Goal: a fresh window continues with zero re-derivation. In order:

### 1. Clean, known tree state
- `git status --short` — **nothing uncommitted** at handoff. If dirty, finish+commit or tell the user what's dangling; never hand off a dirty tree silently.
- `git log --oneline origin/main..HEAD`, `git branch --show-current`, `git rev-parse HEAD origin/<branch>` — record branch, commits ahead of `origin/main`, pushed-or-not.
- Offer to squash multi-commit phase work **before** pushing ([[git-squash-per-phase]]). Don't force-push published history unasked.

### 2. Hunt cross-branch/cross-window blockers — highest value
What bites a cold window: an assumption true in *this* window but not on disk where the next one looks. Check, don't assume:
- **Fan-out gate reachability.** `docs/run-deepseek-perf.sh` (and Phase-2 `run-deepseek-tasks.sh`) branch worktrees off `main` and guard for gate files on `main`. If gate/task-doc/runner exist only on a feature branch, the next fan-out aborts. Verify: `git ls-tree main --name-only -- <gate-file> <task-doc>` — empty → BLOCKER.
- **Env/config not in git.** `SUBFOLIO_CONTENT_DIR` must be a real shell var; `.env` is permission-denied ([[subfolio-content-dir-needs-real-env-var]], [[subfolio-env-overrides-render-default]]).
- **Anything "done" but uncommitted/unpushed**, gitignored artifacts (e.g. `dist/perf-budget.json` — baseline lives in the committed scoreboard), worktrees still on disk (`git worktree list`).

State each as a BLOCKER with the exact resolve command, and flag any needing a **user decision** (e.g. merge-to-main vs. rebase-worktree-base) — don't pick.

### 3. Update durable memory (the handoff payload)
Find the relevant `type: project` memory (e.g. `milestone6-perf.md`); rewrite its current-state section self-sufficiently:
- **Frontmatter `description`** = the one line a cold window sees first: phase status + headline blocker.
- Body, concrete (absolute dates per memory rules):
  - Branch, exact SHAs + one-line each, pushed-or-not, PR-or-not.
  - What's **done**, with proof (which tests green, measured numbers — not "improved"). Note suites *expected* to fail + why (e.g. the 2 pre-existing smoke failures) so the next window doesn't chase them.
  - What's **remaining** — checklist with **file:line targets** + which backend owns each (Opus-by-hand vs DeepSeek fan-out, [[opus-deepseek-model-tiering]]).
  - Every BLOCKER from step 2 + resolve command.
  - Easy-to-forget per-merge rituals: render-review (`npm run preview`, grep `dist/` for leftover `{...}`, eyeball — green build ≠ render, [[astro-no-interpolation-in-style-and-script]]); run the ledger; close phase with a results block.
- Don't duplicate git/code/CLAUDE.md. Memory holds the *non-obvious* state.
- Update the matching `MEMORY.md` pointer line to the new description.

### 4. Verify + report
- Re-run `git status --short` (clean ✓); confirm HEAD == `origin/<branch>`.
- Give the user: commit list, each blocker, a **suggested first prompt** for the next window (e.g. `resume Milestone 6 Phase B — first resolve the gate-not-on-main blocker`).
- Do NOT spawn agents or start new work. Capture is a stopping point.

---

## Mode B — Resume

1. **Read project memory first** — the relevant `type: project` file + its `MEMORY.md` line. Memory reflects what was true *when written*; if it names a file/line/flag, **verify it still exists** before acting.
2. **Reconcile with reality:** `git status`, `git branch --show-current`, `git log --oneline -8`, `git worktree list`. Confirm branch + SHAs match; note drift.
3. **Resolve blockers before working.** If memory flagged one needing a user decision, raise it and wait.
4. **Re-establish baseline** if deltas are needed: `npm run perf` (writes `dist/perf-budget.json`); check suites green (`npm run test`, `npm run test:a11y`, `npm run test:perf`). `astro build` wipes `dist/`, so run `npm run perf` immediately before `npm run test:perf`.
5. Pick up the remaining-work checklist and proceed.

---

## Notes
- Conserve Claude sessions by tiering: spec/gate on Opus, mechanical bulk on DeepSeek, brief Opus render-review ([[opus-deepseek-model-tiering]]). Preserve the split across handoff.
- `[[double-bracket]]` refs are this repo's memory slugs — pointers, not hard dependencies.
- If no `type: project` memory exists for the current work, create one rather than stuffing state into the conversation.
