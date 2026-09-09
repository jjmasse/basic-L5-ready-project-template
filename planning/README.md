# planning/

The product owner's direction for {{PROJECT_NAME}}, tracked in git so every
agent session, cloud VM, and worktree reads the same plans.

## Who writes here

- **The product owner ({{OWNER_NAME}}), or whatever authors product-owner
  files on their behalf**, writes everything in this directory.
- **A coding agent writes only `WORK-<slug>.md`** — its own execution tracker
  for one effort, created by the `/dev-loop` skill. It edits any other file
  here only when explicitly asked, and never moves or deletes anything.
- **Nothing planning-shaped lives outside this directory.** Specs, briefs,
  status write-ups, runbooks, reviews: all here, never at the repo root.

## File prefixes

| Prefix | What it is | Owner |
| --- | --- | --- |
| `BUILD-SPEC.md` | Domain model, schema, formulas, phased task breakdown. The build follows it. | PO |
| `BACKLOG.md` | Deferred work with a one-line why each, so nothing is dropped silently. | PO (agents append on effort close) |
| `RUNBOOK-*.md` | Operating procedures: releasing, rolling back, cutovers. | PO |
| `PROCESS-*.md` | How work flows between the owner and the agents. | PO |
| `BRIEF-*.md`, `SPEC-*.md`, `PLAN-*.md` | Direction for one area or one season of work. | PO |
| `STATUS-*.md`, `REVIEW-*.md` | Write-ups of where something stands or what a review found. | PO |
| `WORK-*.md` | One effort's execution tracker: outcome, steps, tiers, status, PRs. | **Agent** |

## Merge tiers

`.github/MERGE-POLICY.md` puts `planning/**` in 🟡 yellow (AI-reviewed, then a
veto window before auto-merge) and `planning/WORK-*.md` in 🟢 green. The
reason: a docs-only PR that rewrites a spec passes CI trivially, and the next
agent would build from the rewritten spec. The window is what catches that.
