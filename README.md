# project-template

A starting point for a new software project run the way Hexreign is run:
a human product owner sets direction in a tracked `planning/` directory, AI
coding agents build from it under a written contract, and a merge policy
decides how much autonomy automation has over each pull request.

This repository holds **process, not product**. There is no application code
in it. Everything stack-specific is a placeholder you fill in once, and the
contract files tell every agent what the project's rules are.

## What is in the box

| Path | What it is |
| --- | --- |
| `CLAUDE.md` | The binding engineering contract for every agent. Read by Claude Code. |
| `AGENTS.md` | The short mirror of the contract, for Cursor, cloud agents, and anything else. |
| `.cursor/rules/*.mdc` | The same contract as always-on Cursor rules, plus the plain-language rule. |
| `.github/MERGE-POLICY.md` | How much autonomy automation has over a PR, by what it touches. Starts in `shadow` mode. |
| `.github/workflows/ci.yml` | The deploy gate: one `verify` job that runs your project's full local gate. |
| `.github/workflows/review-record.yml` | A required check that is green only when a review of the exact head commit is written down on the PR. |
| `.github/pull_request_template.md` | The PR body records its own review loop. |
| `.claude/settings.json` | Shared Claude Code settings: the git-stash hook is wired here. |
| `.claude/hooks/block-git-stash.mjs` | Refuses `git stash`. The stash stack is shared across worktrees and silently moves work between sessions. |
| `.claude/skills/dev-loop/` | The standing development rotation: align, slice, build, review, ship, watch, prune. |
| `.claude/skills/review-and-ship/` | Review the diff, fix findings, tier the change, then merge or escalate per the policy. |
| `.claude/skills/post-merge-cleanup/` | After a merge: verify it, delete the branch, poll production health, tidy up. |
| `planning/` | The product owner's direction: build spec, backlog, release runbook, the work pipeline. |
| `.env.example`, `.gitignore`, `.gitattributes`, `.editorconfig` | Hygiene that has bitten before: root-only env, LF endings, ignored `.env*`. |
| `TEMPLATE-CHECKLIST.md` | Every placeholder and every human step, in order. Delete it when you are done. |
| `scripts/init-template.mjs` | Fills the placeholders in one pass. Needs Node, nothing else. |

## Using it

1. On GitHub, click **Use this template** (or clone and re-init). Clone the new repo.
2. Run the init script and answer its questions:

   ```bash
   node scripts/init-template.mjs
   ```

   Non-interactive form: `node scripts/init-template.mjs --set PROJECT_NAME=Foo --set GITHUB_OWNER=me` and so on.
   `--list` prints the placeholders. `--check` fails if any remain, and CI runs that check on every repository that is not itself a template.
3. Open `TEMPLATE-CHECKLIST.md` and work through the human steps: fill the
   sections the script cannot (golden rules, stack, tiers, test cases), add your
   application code, turn on branch protection.
4. Delete `TEMPLATE-CHECKLIST.md`, `templates/`, and the init script. Commit.

The init script replaces this README with the project README skeleton in
`templates/README.project.md`.

## The ideas this template carries

- **Direction lives in `planning/` and is tracked in git.** Agents read it; only
  the product owner writes it, except for an agent's own `WORK-*.md` tracker.
- **The contract is mirrored, and a change updates every mirror in the same
  commit.** `CLAUDE.md`, `AGENTS.md`, and `.cursor/rules/` must not drift.
- **Autonomy is data.** `MERGE-POLICY.md` says which paths an AI may merge on
  its own, which need a veto window, and which always need a human. Automation
  reads the file at run time and never edits it.
- **A PR with no review record does not merge.** The `review-record` check
  makes "every PR is reviewed" a mechanical fact instead of a stated intention.
- **Plain language everywhere developer-facing.** Every risk report says what is
  wrong, the concrete failure scenario, the impact, the confidence, and the fix.
- **Hygiene rules are written down where they bite.** Root-only `.env`, no
  `git stash` across worktrees, reserved ports for the owner's local, an isolated
  test database.
