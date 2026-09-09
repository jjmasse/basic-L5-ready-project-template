---
name: review-and-ship
description: >
  Full shipping loop for a completed change: code-review the diff, prioritize
  and fix the findings, re-verify, then either auto-merge (green immediately,
  yellow after a veto window — the mode in MERGE-POLICY.md decides) or escalate
  to {{OWNER_NAME}} with a decision memo on the docket. Use when a change is
  ready to leave the branch — "review and ship this", "run the ship loop", or
  after finishing implementation work on a branch/PR.
---

# Review and ship

This skill turns a finished change into either a merged PR or a decision memo
for {{OWNER_NAME}} on the docket (both defined in MERGE-POLICY.md's
"Escalation" section). The autonomy rules live in `.github/MERGE-POLICY.md` —
this skill OBEYS that file; it never overrides it. When in doubt at any step,
escalate.

## 0. Preflight

- `git fetch origin main`. Identify scope: the argument (a PR number or
  branch name) or, by default, the current branch's diff vs `origin/main`.
  Never operate directly on `main`.
- Read `.github/MERGE-POLICY.md`: note the **current mode** (`shadow` /
  `assisted` / `autonomous`) and the tier rules. The mode line is a human
  decision — this skill NEVER edits MERGE-POLICY.md, `ci.yml`, or the review
  workflows, even to "fix" them.
- If the PR is a draft, stop: a draft is not ready to ship.

## 1. Review

Run the **local `/code-review` skill** (via the Skill tool) over the diff.
Check its output against the "Review focus" list in MERGE-POLICY.md (the
CLAUDE.md golden rules, mechanically) and add anything it missed. Write every
finding in the required format: what is wrong (one sentence), the concrete
failure scenario (who does what, then what goes wrong), the impact if unfixed,
confidence (verified by reading the code, or suspected), and the fix. Tag each
finding 🛑 blocking or ⚠️ advisory.

## 2. Prioritize

- All 🛑 blocking findings get fixed.
- ⚠️ advisories get fixed only when the fix is small and clearly right;
  otherwise list them as "noted, not taken" with one sentence of reasoning.
  Do not churn the diff chasing nitpicks.

## 3. Fix

Apply the fixes on the branch. Keep the diff scoped to the change plus its
fixes. If the change is user-visible, confirm whatever user-facing release
note the project keeps has an entry.

## 4. Verify

Run the full local gate:

```bash
{{VERIFY_COMMAND}}
```

**Deterministically green**: a test that fails then passes on unchanged code
is a flake and a real defect — root-cause it or escalate; never
rerun-until-green. (Worktree note: without a `.env`, suites that need a
database may skip locally — CI is the authoritative run.)

## 5. Re-review

Run `/code-review` once more on the post-fix diff (the fixes themselves can
introduce defects). Maximum two fix cycles total; if blocking findings survive
two cycles, stop fixing and escalate with the loop history. The final clean
pass is the review that MERGE-POLICY criterion 2 asks for.

## 6. Tier the change

Compute the tier from MERGE-POLICY.md: highest tier of any touched path, then
escalate by any matching trait. Ambiguity = the higher tier.

## 7. Ship gate

Push the branch and open (or update) the PR. The PR body records the loop:
review rounds run, findings fixed, advisories not taken, tier and why — plus
the final `/code-review` verdict, so the PR carries its own review record.

**Then post the review record — mandatory, on every PR, in every mode,
including ones the owner will merge by hand.** The `review-record` check is a
required status on `main` and is red until this comment exists for the current
head commit:

```bash
PR=<number>
SHA=$(gh pr view "$PR" --json headRefOid --jq .headRefOid)
gh pr comment "$PR" --body "Review record — local /code-review, no blocking findings on ${SHA:0:7}.

<!-- {{PROJECT_SLUG}}-review-record: $SHA -->"
```

Rules that make the record mean something:

- Post it **only after** the final clean `/code-review` pass, never before or
  alongside the review. The record asserts a completed review with zero 🛑
  findings; posting it early makes it a lie.
- Re-read the sha at the moment you post. If you pushed a fix after reviewing,
  the record must name the **new** commit — and that commit needs its own
  review pass first (step 5), not a re-stamp of the old one.
- If the review found blocking findings you did not fix, **do not post a
  record.** Escalate instead. A red `review-record` on an unreviewed PR is the
  correct state, not a problem to route around.
- Never post a record for a PR you did not review — including to unblock
  someone else's PR from a bot or another tool. Review it first or leave it red.

Then wait for CI — both `verify` and `review-record` must be green.

**Auto-merge is allowed only when ALL of these hold:**

1. MERGE-POLICY.md mode is `assisted` or `autonomous`. Read the line at run
   time — never from memory, and never from this file. In `shadow` this skill
   always escalates.
2. Tier is 🟢 green (any qualifying mode), or 🟡 yellow (`autonomous` only, and
   only through the veto window below). 🔴 red always escalates, in every mode.
3. All merge criteria in MERGE-POLICY.md pass: CI green on the first run —
   **both** `verify` and `review-record` — and criterion 2 satisfied by this
   skill's final `/code-review` pass being clean on the latest commit, with
   the record posted per this step.
4. No other PR from this session is mid-merge or mid-health-watch. One at a
   time, always.
5. If the owner has enabled GitHub's own auto-merge on the PR, posting the
   review record IS the merge — no window ever opens. Verify everything before
   the record in that case.

**🟢 Green tier — merge now.** No window; the criteria passing is the gate.

**🟡 Yellow tier — open the veto window first.** Post the announcement comment
from MERGE-POLICY.md ("Auto-merge announcement format"), naming a merge time
in UTC **the policy's window duration** out (read the number from the policy
at run time — this skill deliberately does not restate it) and keeping the
`<!-- {{PROJECT_SLUG}}-automerge-window: <head sha> -->` marker line. Then:

- Before posting, check for an existing window marker on this PR. If one is
  already open for this same sha, do not post a second one.
- Tell the owner in chat that the window is open, with the PR link and the
  merge time, so the announcement is not something they only find on GitHub.
- When the window elapses, **re-check everything against the current head
  sha**: the criteria, the tier (a new commit can change it), the PR state (it
  may already have been merged by hand), and the cancel signals — a `hold`
  comment (case-insensitive) from a human, a changes-requested review, the PR
  converted to draft, or any commit pushed since the announcement.
- A new commit **restarts** the window: re-run the review from step 1 on the
  new diff, then announce a fresh window. Never merge a sha the announcement
  did not name.
- Any cancel signal, or any criterion that no longer holds, ends the attempt:
  comment on the PR that auto-merge is cancelled and why, escalate with the
  decision memo, and stop. Never silently re-arm a cancelled window.

**If auto-merging:** merge the PR (merge commit, repo convention), delete the
branch, then watch the deploy: production health (`{{PROD_HEALTH_URL}}`) must
come back healthy within 10 minutes. On any post-deploy failure, alert the
owner immediately with the health output and what to roll back
(`planning/RUNBOOK-release.md`), halt all further auto-merging until they say
otherwise, and do not attempt the rollback yourself.

Report every auto-merge in chat when it lands — what merged, the tier, and that
health came back clean. Auto-merge means the owner did not have to click; it
does not mean they should have to go looking for what happened.

**If escalating**, deliver a **decision memo**. The memo's required contents
(the nine items, the call first), the docket and its concurrency rules, and
the decision/ledger rules are all defined canonically in **MERGE-POLICY.md's
"Escalation: decision memos and the docket" section** — write the memo to
that definition, reading it at run time. This file deliberately does not
restate the list: two full copies of one protocol diverge, and the policy is
the one that wins.

What this skill adds on top of the policy's definition:

- Deliver the memo in chat as well as on the docket. The chat copy uses
  clickable `file:line` references where the docket copy uses sha-pinned
  permalinks.
- Then stop. An escalated PR is the owner's to merge until they lift the
  escalation. Do not nag, and do not treat silence as approval.

## Standing rails (repeat offenders — always apply)

- Never force-push, never skip hooks, never edit the policy/CI/workflow
  files from inside a run.
- Migrations, dependency additions, auth, exactly-once scheduler code, and the
  agent contracts (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/**`,
  `.claude/skills/**`, `.claude/hooks/**`) are red-tier: they always escalate
  no matter how clean the review. The agent contracts are red precisely
  because this skill is one of the things they steer — never merge a change
  to your own instructions.
- After ANY merge that deploys, the health check is mandatory.
- Reviews and memos use plain language per CLAUDE.md — findings a non-author
  can judge.
