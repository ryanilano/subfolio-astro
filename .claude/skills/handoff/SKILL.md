---
name: handoff
description: Capture durable session state for a clean pass-off to a new context window, or resume cold from a prior handoff. Use when the user says "prepare for new context window", "hand off", "pass off to phase/next session", "wrap up for handoff", "prep handoff", or "resume work / resume <milestone/phase>". Built for this repo's milestone/phase + DeepSeek fan-out workflow.
---

# Handoff

Make passing work between context windows cheap and lossless. A new window starts cold —
it only knows what's in durable memory and git. This skill has two modes: **capture** (end of a
session) and **resume** (start of one).

**Finding the memory dir (portable, do this first in either mode):** the per-project memory lives
under the Claude config home, in a folder named after the project's working-directory path with
slashes turned to dashes. Derive it at runtime — don't hardcode a `/Users/...` path:
`MEM="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/$(pwd | sed 's#/#-#g')/memory"`.
Confirm with `ls "$MEM"` (it holds `MEMORY.md` + per-fact `*.md`). The session's system context
also names this dir directly — use that if present. If the dir doesn't exist, create it.

Pick the mode from the user's phrasing. "Prepare for handoff / wrap up / pass off" → **Capture**.
"Resume / pick up / continue <phase>" → **Resume**.

---

## Mode A — Capture (prepare for handoff)

The goal: a fresh window can continue with zero re-derivation. Work the steps in order.

### 1. Get the tree to a clean, known state
- `git status --short` — there must be **nothing uncommitted** at handoff. If there is, either
  finish + commit it or tell the user what's dangling; never hand off a dirty tree silently.
- `git log --oneline origin/main..HEAD` and `git branch --show-current` — record branch, the
  commits ahead of `origin/main`, and whether HEAD is pushed (`git rev-parse HEAD origin/<branch>`).
- Offer to squash multi-commit phase work **before** pushing (see [[git-squash-per-phase]]).
  Don't force-push published history unasked.

### 2. Hunt for cross-branch / cross-window blockers — the highest-value step
The thing that bites a cold window is an assumption that was true in *this* window but isn't on
disk where the next one looks. Actively check, don't assume:
- **Fan-out gate reachability.** This repo's `docs/run-deepseek-perf.sh` (and the Phase-2
  `run-deepseek-tasks.sh`) branch worktrees off `main` and **guard for gate files on `main`**.
  If the gate/task-doc/runner only exist on a feature branch, the next session's fan-out aborts.
  Verify: `git ls-tree main --name-only -- <gate-file> <task-doc>`. If empty → it's a BLOCKER.
- **Env/config that isn't in git.** `SUBFOLIO_CONTENT_DIR` must be a real shell var; `.env` is
  permission-denied (see [[subfolio-content-dir-needs-real-env-var]], [[subfolio-env-overrides-render-default]]).
- **Anything "done" that isn't committed/pushed**, build artifacts that are gitignored (e.g.
  `dist/perf-budget.json` — baseline lives in the committed scoreboard instead), worktrees still
  on disk (`git worktree list`).
State each blocker as a BLOCKER with the exact command to resolve it, and whether it needs a
**user decision** (e.g. "merge to main vs. rebase the worktree base") — flag those, don't pick.

### 3. Update durable memory (the actual handoff payload)
The memory file is what the next window reads. Find the relevant `type: project` memory (e.g.
`milestone6-perf.md`) and rewrite its **current-state** section so it is self-sufficient:
- **Frontmatter `description`** = one line a cold window sees first: phase status + the headline
  blocker. (e.g. "Phase A DONE & pushed; Phase B next but BLOCKED: gate not on main yet".)
- In the body, record, concretely (convert relative dates to absolute — see the memory rules):
  - Branch, exact commit SHAs + one-line each, pushed-or-not, PR-or-not.
  - What's **done** (with the proof: which tests green, what was measured — cite numbers, not
    "improved"). Note which suites are *expected* to fail and why, so the next window doesn't
    chase them (e.g. the 2 pre-existing smoke failures here).
  - What's **remaining**, as a checklist with **file:line targets** and which backend owns each
    (Opus-by-hand vs. DeepSeek fan-out — see [[opus-deepseek-model-tiering]]).
  - Every BLOCKER from step 2, with its resolve command.
  - Per-merge ritual reminders that are easy to forget: render-review (`npm run preview`, grep
    `dist/` for leftover `{...}`, eyeball — a green build does NOT prove a render, see
    [[astro-no-interpolation-in-style-and-script]]), run the ledger, close the phase with a
    results block.
- Don't duplicate what git/code/CLAUDE.md already say. Memory holds the *non-obvious* state.
- Update the matching one-line pointer in `MEMORY.md` to match the new description.

### 4. Verify and report
- Re-run `git status --short` (clean ✓) and confirm HEAD == `origin/<branch>`.
- Give the user: the commit list, each blocker, and a **suggested first prompt** for the next
  window (e.g. `resume Milestone 6 Phase B — first resolve the gate-not-on-main blocker`).
- Do NOT spawn agents or start new work. Capture is a stopping point.

---

## Mode B — Resume (cold start from a prior handoff)

1. **Read the project memory first** — the relevant `type: project` file in the memory dir +ø its
   `MEMORY.md` line. That's the handoff payload. Recalled memory reflects what was true *when
   written* — if it names a file/line/flag, **verify it still exists** before acting on it.
2. **Reconcile with reality:** `git status`, `git branch --show-current`, `git log --oneline -8`,
   `git worktree list`. Confirm the branch + SHAs match what memory claims; note any drift.
3. **Resolve blockers before doing the work.** If memory flagged a BLOCKER needing a user
   decision, raise it now and wait — don't pick for them.
4. **Re-establish the baseline** if the phase needs deltas: `npm run perf` (writes
   `dist/perf-budget.json`), and check the existing suites are green (`npm run test`,
   `npm run test:a11y`, `npm run test:perf`) so you know your starting line. Remember `astro
   build` wipes `dist/`, so run `npm run perf` immediately before `npm run test:perf`.
5. Pick up the remaining-work checklist from memory and proceed.

---

## Notes
- This repo conserves Claude sessions by tiering work (spec/gate on Opus, mechanical bulk on
  DeepSeek, brief Opus render-review) — preserve that split across the handoff (see
  [[opus-deepseek-model-tiering]]).
- Memory dir: derive it at runtime (see the top of this file) — never hardcode an absolute path,
  so the skill works on any machine / clone.
- If no `type: project` memory exists for the current work yet, create one rather than stuffing
  state into the conversation — that's the whole point.
- The `[[double-bracket]]` references above are this project's memory slugs; they may not exist in
  another repo's memory — treat them as pointers, not hard dependencies.
