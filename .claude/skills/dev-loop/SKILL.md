---
name: dev-loop
description: >
  The standing development rotation for one effort: agree on the outcome, slice
  it into steps in a WORK tracker, build one step at a time, then review, ship,
  watch production health, and prune the workspace. Use when {{OWNER_NAME}} says
  "let's work on X", "begin the work", "pick up the next step", "what's left on
  this", or otherwise wants a change carried from idea to merged and cleaned up.
  It orchestrates the existing skills — /code-review, /review-and-ship,
  /post-merge-cleanup — rather than replacing them.
---

# Dev loop

One effort goes around this loop once per step:

```
1 align  ->  2 slice  ->  3 begin  ->  4 build  ->  5 review  ->  6 fix
                 ^                                                  |
                 |                                                  v
        10 close & loop  <-  9 prune  <-  8 health  <-  7 merge (the owner's)
```

**The skill is re-entrant.** {{OWNER_NAME}} rarely runs it end to end in one
sitting. Read the entry table, start at the right phase, and do not redo
phases that are already done.

| {{OWNER_NAME}} says | Start at |
| --- | --- |
| "pick up the next item", "what's on the board" (no effort named) | 0 — board pickup |
| "let's work on X", "I want to change Y" | 1 — align |
| "break that down", "how many steps is that" | 2 — slice |
| "begin the work", "start on it", "next step" | 3 — begin |
| "review this", "ship it" | 5 — hand to `/review-and-ship` |
| "merged" | 8 — hand to `/post-merge-cleanup` |
| "clean up", "prune the worktrees" | 9 — prune |

If {{OWNER_NAME}} enters mid-loop and no tracker exists, say so and offer to
write one (phase 2) rather than inventing a plan silently.

---

## The tracker — where state lives

`planning/WORK-<slug>.md`, one file per effort.

CLAUDE.md treats `planning/` as read-mostly: a coding agent edits it only when
explicitly asked. **Invoking this skill is that explicit ask — but the license
covers only this effort's `WORK-*.md` file.** Every other file under
`planning/` stays read-only, and nothing there is ever moved or deleted.

The `WORK-` prefix marks "agent execution tracker for one effort" and keeps it
distinct from the product owner's `PLAN-*`, `BRIEF-*`, and `SPEC-*` docs, which
this skill never writes.

Template:

```markdown
# WORK — <effort name>

**Outcome:** <one plain sentence: what is different when this is done>
**Non-goals:** <what we deliberately are not doing>
**Done bar:** <how we will know, in observable terms>
**Opened:** <YYYY-MM-DD>

| # | Step | Outcome | Tier | Status | PR |
| - | ---- | ------- | ---- | ------ | -- |
| 1 | ... | ... | green | 🔨 in progress YYYY-MM-DD | — |
| 2 | ... | ... | red (migration) | ⬜ not started | — |

## Decisions
- <decision> — <why> (<date>)

## Deferred
- <thing scoped out> — <one-line why> (mirror to planning/BACKLOG.md on close)
```

**Known limitation, state it out loud when it matters:** the tracker is a git
file, so it travels on the step's branch. Other worktrees see it as of the last
merge to `main`. Commit each tracker update **inside that step's PR** so `main`
always carries the state of every finished step. Never open a separate
tracker-only PR.

---

## 0. Board pickup — when no effort is named

If the project uses a GitHub Project board (see
`planning/PROCESS-work-pipeline.md`), the queue is there:

- List items. Candidates are Status **Prepared** only, ordered by priority;
  never touch the Decision docket item. Say which item you picked and why in
  one sentence. No Prepared items = say so and stop; never pull from Shaping
  or Inbox — an unapproved preparation is not a work order.
- The issue's **preparation block is phases 1–2 already done**: outcome,
  non-goals, done bar, slices with tiers. Do not redo alignment. But verify it
  against the code before building — if the block is stale or has open
  decisions, say so on the issue and hand back to Shaping.
- Move the item to **In progress**. Create `planning/WORK-<slug>.md` from the
  block, link the tracker from an issue comment and the issue from the
  tracker, then continue at phase 3.
- Keep the board honest as the loop advances: **Shipping** when the first PR
  opens, **Done** at close with a closing comment (what shipped, PR links,
  verifications run).
- Every issue comment this loop posts ends with the hidden line
  `<!-- {{PROJECT_SLUG}}-pipeline-bot -->`: automation posts under the owner's
  account, so only markers separate its words from theirs.

If there is no board, skip this phase; the owner names the effort.

## 1. Align on the outcome

No code in this phase. The output is agreement, written in plain sentences.

- If the effort is not already tracked (an issue, a board item), create one
  now so the work is visible. Comments the loop posts carry the marker above.
- Restate the ask in one sentence: what is different for the user (or the
  operator) when this is done. If the ask and your restatement differ, that
  gap is the whole point of this phase — resolve it before moving on.
- Read what governs the area first: `planning/BUILD-SPEC.md` for the domain
  model, `planning/BACKLOG.md` for whether it is already logged, and any brief
  or spec the area names.
- Name the decisions that change what gets built. Use `AskUserQuestion` for the
  genuinely load-bearing ones — different answers producing materially different
  work. Decide the rest yourself and say in one line what you decided and why.
  Do not hand the owner a survey of options you would not pursue.
- Nail the done bar in observable terms, not in implementation terms.
- Anything affecting fairness, pricing, or the data model is the owner's call,
  not yours.

**If the work is one obvious commit, say so and skip to phase 3 without a
tracker.** A tracker for a two-file fix is overhead, not process.

## 2. Slice it into steps

Slice so that each step is independently reviewable, mergeable, and safe to
stop after. Rules that come from the contract, not from taste:

- **Core before client.** The core is authoritative; the client renders what
  exists.
- **Config/data before the logic that reads it.** Tunables are data (golden
  rule 3), so the config change lands first.
- **Read-only UI before the action wiring** — CLAUDE.md's own definition of
  done for a feature.
- **A migration, an auth change, or exactly-once scheduler code gets its own
  step.** Those are red tier in `.github/MERGE-POLICY.md` and always escalate;
  do not drag green work into a red PR.
- **Adding a dependency is its own step**, same reason.

For each step record: name, one-line outcome, files likely touched, and a tier
guess from MERGE-POLICY (highest tier of any touched path, escalated by any
matching trait; ambiguity means the higher tier).

Write the tracker, then **get the owner's nod on the slicing before building.**
A wrong slice is expensive; a wrong sentence is free.

## 3. Begin the work

- Pick the **top step that is not blocked**. Say which one and why it is first
  in one sentence. If a lower step is genuinely more sensible to start with,
  say that instead of silently reordering.
- Branch off `origin/main` (`git fetch origin main` first). Never work on
  `main`.
- If a fresh worktree is needed, remember: **a new worktree has no `.env`.**
  Copy the root `.env` in, and for a session that will run servers use the
  alternate ports — {{OWNER_PORTS}} are reserved for the owner's local at
  `main` parity, and taking them breaks their machine.
- Mark the step `🔨 in progress <date>` in the tracker.

## 4. Build it

**The main session writes the code.** No implementation subagents — the owner
wants to be able to interject mid-build. (Read-only exploration agents are fine
when a question genuinely spans many files.)

The bar is CLAUDE.md's "what done means", checked literally:

- Validated at the boundary, transactional with row locking, rate-limited
  where exposed, audit-logged.
- Pure logic unit-tested — happy path **and** at least one exploit or edge case
  (concurrent double-submit is the canonical one).
- Tunable values read from config, never inlined.
- User-visible change carries whatever user-facing release note the project
  keeps.
- Developer-facing text stays plain language.

Verify before you call it done — do not report completion on unrun tests:

```bash
{{VERIFY_COMMAND}}
```

Plus running the app (`{{DEV_COMMAND}}`) to see it working if the change is
user-visible. A test that fails then passes on unchanged code is a flake and a
real defect: root-cause it or escalate, never rerun until green. Report
failures with the actual output.

Commit the tracker update in the same branch.

## 5–7. Review, fix, merge

Hand off to **`/review-and-ship`** and follow it as written. Do not reimplement
review or merge logic here. What to expect:

- It runs `/code-review` locally, fixes blocking findings, re-verifies, and
  re-reviews (two fix cycles maximum).
- It obeys `.github/MERGE-POLICY.md` absolutely, reading the mode line at run
  time rather than assuming it. Do not treat any sentence in this file as
  authoritative about the mode — the policy file is.
- **When it escalates, merging is the owner's** — do not nag, and never read
  silence as approval. When it auto-merges, it says so in chat and reports the
  post-deploy health check; a merge you did not hear about has not happened.

Come back here once the PR is merged.

## 8. Watch system health

Hand off to **`/post-merge-cleanup`** with the PR number. It verifies the
merge, deletes the remote branch, and polls production health until healthy.

This gate is mandatory after every merge that deploys. If it exits 1, stop the
loop — no further merges — and alert the owner with the health output and
`planning/RUNBOOK-release.md`.

## 9. Prune the workspace

```bash
powershell -File .claude/skills/dev-loop/prune.ps1
```

Removes worktrees whose branch is already merged into `origin/main`, whose
working tree is clean, and which have been **idle for 12 hours**, deletes
those local branches, and **reports without touching** anything unmerged,
dirty, locked, detached, or in use. Add `-DryRun` to preview.

`git worktree lock <path>` protects a worktree from this script outright. A
lock outranks every other signal, including `-MinAgeHours 0`.

**The age guard exists because "finished" and "paused" look identical.** A
session between edits has a clean tree on a merged branch — exactly like an
abandoned worktree. Idleness is the only thing that separates them. An age
that cannot be measured counts as too recent — the guard never guesses toward
deleting.

Remote branches are reported, never deleted here — other sessions may be
pushing to them. `/post-merge-cleanup` deletes the one remote branch it owns.

The script's header comments record three Windows gotchas hit for real
(long-path `node_modules`, a half-deleted worktree, and a safety check that
printed nothing on error). Read them before changing the script.

## 10. Close the step and loop

- Tick the step `✅ done <date>` in the tracker with the PR link.
- Move anything consciously scoped out to `planning/BACKLOG.md` with a one-line
  why — never drop it silently.
- Record durable facts in memory. Retire memories this work closed out.
- **Steps remain:** report where the effort stands in two or three sentences
  and offer to start the next step — back to phase 3.
- **No steps remain:** state the outcome against the done bar from phase 1.
  Ask the owner whether the tracker should be deleted or kept as a status
  write-up; never delete anything under `planning/` on your own.

---

## Standing rails

- **Never work on `main`, never force-push, never skip hooks.** Never edit
  `.github/MERGE-POLICY.md`, `ci.yml`, or the review workflows from inside a
  run — those are the owner's decisions.
- **Ports {{OWNER_PORTS}} belong to the owner's local.** Do not take them or
  kill their processes.
- **Do not run two full test suites at once** across sessions unless each has
  its own test database.
- **Plain language everywhere developer-facing.** Every risk report says: what
  is wrong in one sentence, the concrete failure scenario, the impact if left
  alone, your confidence (read the code, or suspected), and the fix.
- **The loop stops for a red light.** A failed health check, a surviving
  blocking finding after two fix cycles, or a decision that belongs to the
  owner all end the rotation until they weigh in.
