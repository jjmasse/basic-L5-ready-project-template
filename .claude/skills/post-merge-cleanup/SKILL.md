---
name: post-merge-cleanup
description: >
  Post-merge cleanup and next-session prep after a PR merges: verify the
  merge, delete the remote branch, watch the deploy via the production health
  URL, then record memory notes and leave the worktree tidy. Use when
  {{OWNER_NAME}} says "merged", "clean up", "close out", or "prepare for the
  next session" — this is the step after /review-and-ship ends.
---

# Post-merge cleanup

Two halves: a **driver** for the mechanical checks (merge verify → remote
branch delete → production health poll) and a **judgment checklist** the agent
does by hand (memory notes, worktree state, hand-off). Paths below are relative
to the repo root.

## 1. Run the driver

```bash
powershell -File .claude/skills/post-merge-cleanup/cleanup.ps1 -Pr <number>
```

What it does (idempotent — safe to re-run):

- Refuses to touch anything unless the PR state is `MERGED`.
- Deletes the PR's remote branch, or reports it already gone.
- Polls the production health URL (`{{PROD_HEALTH_URL}}`; pass `-HealthUrl`
  to override, or `none` to skip) every 30 s (default 10 min budget,
  `-HealthTimeoutSec` to change) until healthy: HTTP 200, and if the body is
  JSON with an `ok` field, `ok` must be true. Exit 0 = all clear; exit 1 =
  stop and alert the owner (rollback steps: `planning/RUNBOOK-release.md`).

The health gate is mandatory after every merge that deploys. If the project's
health endpoint reports more than `ok` (a lag figure, a heartbeat), extend the
script's `Test-Healthy` function and say in `RUNBOOK-release.md` what healthy
means — a bare 200 hides a process that is up but not doing its job.

## 2. Judgment checklist (agent, by hand)

- **Check whether `origin/main` moved past your merge** (`git fetch origin`,
  `git log --oneline origin/main -3`): other agents land PRs between
  sessions. Skim anything that touched files you also touched.
- **Memory prep for the next session:** new durable facts get a memory file
  and an index line; update existing files in place rather than duplicating;
  fold any gotcha that cost real time into the gotchas file. Retire memories
  the merge closed out.
- **Worktree tidy:** `git status --short` must be clean. A worktree cannot
  check out `main` (it's held by the primary checkout) — leaving the merged
  branch checked out is fine; the next session branches fresh off
  `origin/main`.
- **Local branch:** the merged branch can't be deleted from inside the
  worktree that has it checked out. Leave it; don't fight it.

## Gotchas (all hit for real)

- **PowerShell 5.1 parses BOM-less UTF-8 scripts as ANSI** — an em dash in a
  `.ps1` becomes `â€”` and produces "missing string terminator" parse errors.
  `cleanup.ps1` is deliberately pure ASCII; keep it that way.
- **PS5.1 mangles embedded double quotes passed to native exes**, even from
  here-strings. Always `--body-file` with a temp file for PR bodies/comments.
- **`gh pr checks` exits non-zero while checks are pending** — a non-zero exit
  there is not a failure signal; read the check lines.

## Troubleshooting

- `The string is missing the terminator: "` on running the driver → someone
  reintroduced non-ASCII into `cleanup.ps1`; strip it back to ASCII.
- Driver exits 1 with `PROD NOT HEALTHY` → do NOT merge anything further;
  alert the owner with the health output and `planning/RUNBOOK-release.md`.
- Driver exits 1 with `state is 'OPEN'` → the PR isn't merged; you're in
  /review-and-ship territory, not here.
