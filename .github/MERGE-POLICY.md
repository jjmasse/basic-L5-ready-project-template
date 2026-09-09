# Merge Policy — AI review & merge autonomy tiers

This file is **data, not vibes**: it defines how much autonomy automation has
over a pull request, based on what the PR touches. Automation MUST read this
file — at run time, not from memory — and obey it.

"Automation" here means all of: the `/review-and-ship` skill (the main actor —
it reviews, tiers, and merges), the `/dev-loop` skill that hands off to it, and
any scheduled task that merges PRs.

## Current mode: `shadow`

| Mode         | Meaning                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `shadow`     | AI reviews every PR and records an advisory **WOULD-MERGE / WOULD-BLOCK** verdict. A human performs every merge. |
| `assisted`   | Green-tier PRs may be auto-merged by automation when all criteria pass. Yellow/red unchanged.                    |
| `autonomous` | Green auto-merges; yellow auto-merges after a veto window announced in the PR. Red is always human-merged.       |

Mode changes are a human decision, made by editing this line — never by
automation. Record the date and the reason here when it changes.

**To pull the handbrake:** edit the mode line above back to `shadow`. That one
word stops all auto-merging, in every tier, immediately — no other file needs to
change.

Before moving past `shadow`, put branch protection on `main` requiring the
`verify` check and the `review-record` status, and enable repository
auto-merge. Then failing CI is blocked by GitHub itself, not only by automation
choosing to obey this file.

## Tier rules

A PR's tier is the **highest** tier of any file it touches, then escalated by any
matching trait rule. When in doubt, escalate.

**A path matched by no rule below is 🔴 red.** Unlisted means undecided, and an
undecided path is not something automation gets to merge. But treat a
red-by-default escalation as a _bug in this file_, not a verdict: say so in the
decision memo (see "Escalation" below), name the path, and propose a tier.
Silent permanent escalation is how a policy rots into noise that gets ignored.

<!-- TEMPLATE: Replace the example paths in each tier with your layout. Keep
     the reasons; they are what a future reader needs to re-decide a tier.
     Audit every path in the repo against these rules once and list what you
     find; the default above is the backstop for the next gap, not a
     substitute for listing things. Delete this comment when done. -->

### 🔴 Red — human review + human merge, always

Paths:

- Schema migrations (`<!-- TEMPLATE: e.g. apps/server/drizzle/** -->`) — the
  additive-only policy, see `planning/RUNBOOK-release.md`.
- The database client, migration runner, and schema module.
- Authentication and session resolution.
- Any scheduler, lock, or lifecycle code that must run exactly once.
- `.github/**` — CI, this policy file, review workflows.
- `**/Dockerfile`, deploy platform config — the deploy surface.
- Every dependency manifest (`**/package.json`, `pyproject.toml`, `go.mod`,
  ...), **except** a diff that only changes the version range of an
  already-present dependency, which stays 🟡 yellow to match the lockfile rule
  below. Everything else in a manifest is red: scripts define what production
  runs, and adding or removing a dependency is a red trait below.
- `.env.example`, `.dockerignore` — the env and image surface.
- `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/**`, `**/.claude/skills/**`,
  `.claude/hooks/**` — the agent contracts, skills, and hooks. These steer
  every future AI change, so an AI editing them is an AI rewriting its own
  instructions — including the very skill that decides what may auto-merge. A
  human reads that diff, in every mode. (The `**/` prefix matters if any
  sub-project carries its own `.claude/` directory.)
- Any check that judges the AI's own work (an allowlist a test reads, a
  baseline file a gate compares against). Same shape as the contracts above.

Traits (regardless of path):

- Adds or changes any **state-spending transaction**, row locking, or
  `SELECT ... FOR UPDATE` usage (the double-spend surface).
- Changes tenancy or scoping (`<!-- TEMPLATE: e.g. season_id, tenant_id -->`).
- Touches secrets handling, env parsing, or admin gating.
- Adds a new dependency.
- Deletes user data or a table.

### 🟡 Yellow — AI review required, then auto-merge after a veto window (`autonomous` mode)

- Application source not listed red (`<!-- TEMPLATE: e.g. apps/server/src/**, apps/web/src/** -->`).
- Pure domain formulas (well-tested, but behavior-affecting).
- Lockfile version bumps of existing deps, together with the matching manifest
  range change (see the manifest carve-out in red).
- Tooling and build config not listed red: `tsconfig*.json`, test runner and
  linter config, `.editorconfig`, `.prettierrc`, `.gitignore`,
  `.claude/launch.json`, `.claude/settings.json` — the shared permission
  allowlist. **Escalates to 🔴 red for any diff that adds a
  `permissions.allow` entry which writes to a database, merges, publishes, or
  deploys.**
- `tools/**` — developer tooling that ships to nobody.
- `planning/**` except `WORK-*.md` — the product owner's direction documents.
  These are markdown, so the green docs rule would otherwise auto-merge them
  with no veto window at all, and `CLAUDE.md` says an agent "edits a planning
  doc only when explicitly asked". The failure this prevents: an agent decides
  a spec section is stale, opens a docs-only PR rewriting it, CI is trivially
  green because no code changed, it lands unread, and the next agent builds
  from the rewritten spec. Yellow rather than red so the owner's own doc edits
  still flow, with the veto window to catch one they did not intend.

#### The yellow veto window

Yellow covers most of the app, so yellow PRs announce themselves before landing
instead of merging the moment CI goes green.

1. Once all merge criteria below pass, automation posts a PR comment naming
   the exact UTC time it intends to merge — **30 minutes** out — and what the
   PR does in one plain sentence. (This is the MINIMUM: a scheduled run whose
   next pass is later may name that later time instead. Shorten it here once
   the owner is reliably reading escalations faster than that.)
2. During the window, **any** of these cancels the merge: a comment containing
   `hold` (case-insensitive) from a human, a GitHub "changes requested" review,
   the PR being converted to draft, or a new commit pushed to the branch. The
   first three also escalate the PR to the owner as a decision memo (see
   "Escalation" below). A new commit is **not** an escalation — it cancels the
   window and rule 3 governs what happens next.
3. A new commit **restarts** the window from zero — the announced time always
   refers to the commit that was reviewed, never an earlier one.
4. At the announced time, automation re-checks every criterion against the head
   commit (CI may have been re-run, the branch may have drifted from `main`) and
   merges only if they all still hold. A stale check is a cancel, not a pass.
5. A cancelled window is never silently re-armed. Automation escalates and stops.

Green tier has no window — it merges as soon as the criteria pass. Red tier has
no window either, because red never auto-merges at all.

### 🟢 Green — auto-merge eligible (in `assisted`+ modes) when criteria pass

- `**/*.md` docs — except `.github/**` and the agent contracts (`CLAUDE.md`,
  `AGENTS.md`), which are red, and `planning/**` other than `WORK-*.md`, which
  is yellow. A file matching two rules takes the _highest_ tier, never the most
  specific one.
- `planning/WORK-*.md` — the agent's own execution trackers. `CLAUDE.md` names
  these as the one agent-owned exception under `planning/`, so writing them is
  the normal course of work, not a change of direction.
- Versioned config data (`<!-- TEMPLATE: e.g. packages/shared/src/config/** -->`)
  — data-only changes, provided a test gates them.
- Test scaffolding that is not itself a test: `**/tests/helpers/**`,
  `**/tests/setup.*`, and test fixtures — green when it strengthens or
  maintains the harness, not when it disables parts of it.
- Test-only diffs (`*.test.*` / `*.spec.*` and fixtures) — **but only when the
  diff adds or strengthens coverage.** A test-only diff that deletes a test,
  removes or loosens an assertion, adds `.skip`/`.todo`/`.only`, or widens a
  tolerance is **not** green; it escalates to 🟡 yellow, and to 🔴 red if it
  touches any of the non-negotiable cases `CLAUDE.md` names.

  The reason is narrow and worth stating plainly: tests are the evidence that
  the rest of the auto-merge criteria mean anything. A PR that only removes a
  test passes CI trivially — green CI on a weakened suite is not the same
  signal as green CI on the suite that caught the bug. Deleting a test is a
  decision about risk, and decisions about risk are the owner's.

  Rewriting a test to assert the _invariant_ instead of an incidental detail is
  a strengthening, not a weakening, even when assertions disappear — say so in
  the PR body and let it be reviewed as such rather than silently claiming green.

## Merge criteria (all tiers, before any auto-merge in `assisted`+ modes)

1. CI fully green — **both required checks on `main`**: `verify` (the full
   local gate, run in `ci.yml`) and `review-record` (criterion 2 below).
2. A review completed on the latest commit with verdict **WOULD-MERGE** and
   zero unresolved CONFIRMED correctness findings.

   **What satisfies this, concretely.** The review of record is the **local
   `/code-review` skill**, run in-session by `/review-and-ship`. Its final
   clean pass over the head commit — zero 🛑 blocking findings — is what this
   criterion asks for, and the PR body must record that verdict so the PR
   carries its own review record.

   A PR with no review of any kind is never auto-mergeable, in any tier or
   mode. If `/code-review` cannot be run, automation does an inline review pass
   against the focus list below and **escalates** — an inline pass is enough to
   inform a human, never enough to auto-merge.

   **This is enforced, not just asserted — the `review-record` check.**
   `.github/workflows/review-record.yml` posts a commit status on the PR head
   that is green only when a comment on the PR carries a hidden marker naming
   that exact commit:

   ```
   <!-- {{PROJECT_SLUG}}-review-record: <full head sha> -->
   ```

   `/review-and-ship` posts that comment after its final clean `/code-review`
   pass. The check re-runs on comment events, so posting the record turns the
   status green without a push. **A new commit invalidates the record** — the
   marker names a sha, so pushing means reviewing again.

   The gate applies to **every** PR, including ones the owner merges by hand
   and ones from authors no agent session touched (bots, other tools). Those
   stay red until someone reviews them, which is the point.

   To post a record by hand after reviewing a PR yourself:

   ```bash
   gh pr comment <PR> --body "Reviewed locally with /code-review — no blocking findings.

   <!-- {{PROJECT_SLUG}}-review-record: $(gh pr view <PR> --json headRefOid --jq .headRefOid) -->"
   ```

   **What this does and does not buy.** It closes stale reviews, hand-merges
   with no review at all, and unreviewed PRs from other authors. It does not
   make the review independent: the session proposing the merge is usually the
   session posting the record, so this enforces attestation, not verification.
   Do not describe it to anyone as an independent check.

3. No human has requested changes or commented "hold" on the PR.
4. Not a draft; branch up to date with `main` or trivially mergeable.
5. After merge: automation must watch the deploy and verify production health
   (`{{PROD_HEALTH_URL}}`) within 10 minutes, and alert loudly if it does not
   recover (see `planning/RUNBOOK-release.md` for rollback).

   **One merge at a time, and stop on failure.** Automation merges one PR, then
   watches it all the way to a healthy production before merging anything else
   — never two in flight, or a bad deploy cannot be attributed. If the health
   check fails, automation halts **all** auto-merging, alerts the owner with the
   health output and the rollback pointer, and does not resume until told to.
   It must never attempt the rollback itself.

6. **Green means deterministically green.** A check that failed and then passed
   on the _same commit_ is a flake, not a pass — automation must never re-run a
   check until it goes green, and a retried-into-green PR is not mergeable.
   Treat the flaky test as a real defect: root-cause it before merge.

   The one carve-out: `review-record` is red until a review of the head commit
   is written down, then green. It re-runs on comment events by design. A
   red-to-green transition there is the gate working, not a flake, and never
   blocks a merge. This carve-out never applies to `verify`.

## Review focus (what the AI reviewer checks, every PR)

The golden rules from `CLAUDE.md`, mechanically:

- One authoritative core — no client-computed outcomes trusted anywhere.
- No lost or duplicated writes — state-changing paths are transactional and
  row-locked; flag any concurrent-submit hazard.
- Tunable numbers come from config, not inline literals.
- <!-- TEMPLATE: one line per product-specific golden rule -->
- Integer math for balances; no float drift.
- Mutating operations follow `authenticate → validate → rate-limit → tx → lock →
  re-validate → mutate → audit → commit`.
- Randomness uses stored seeds.
- New/changed tests are deterministic — flag sleeps/timeouts as
  synchronization, unseeded randomness, wall-clock dependence, ordering
  assumptions on concurrent outcomes (assert the invariant, not which racer
  won), and assertions that depend on config values that may drift (derive
  them from config in the test instead).

## Escalation: decision memos and the docket

When automation may not merge a PR, it escalates the PR to the owner as a
**decision memo**. Escalation triggers: 🔴 red tier in any mode; a surviving
WOULD-BLOCK finding; a cancelled veto window; and genuine doubt at any step. In
`shadow` mode the per-PR advisory artifact is the shadow verdict below — a
docket memo is owed only when a PR is ready for the owner's merge (all criteria
pass) or genuinely needs their input, never one per open PR.

The memo exists so the owner judges a stated argument rather than re-deriving
one from the diff: they are the person with the least loaded context, so an
escalation that hands them raw evidence and leaves the judgment to them is
unfinished review work.

Every memo states, in this order:

1. **The call** — MERGE / DON'T MERGE / MERGE AFTER `<condition>` / NEEDS
   INPUT: `<question>`. A stated position is mandatory. Honest uncertainty is
   a valid position ("NEEDS INPUT: I cannot reach a confident call; here is
   what blocks one") and is always better than fabricated confidence.
2. **Bottom line** — what the change does, one plain sentence.
3. **Why it's on the owner's desk** — the tier/trait or blocker, in plain
   words. When the tier came from the unlisted-path default above, name the
   unmatched path and propose a tier here.
4. **What would make the call wrong** — the concrete failure scenario the
   recommendation is betting against.
5. **How it would be caught and undone** — the detection signal (a test, a
   health field, a user report) and the rollback path.
6. **Where to look** — 2–3 specific references, each with one sentence on what
   to check there. In the GitHub copy these must be permalinks pinned to the
   reviewed head sha — plain `file:line` text is not clickable in an issue.
7. **Findings ledger** — fixed, and noted-not-taken.
8. **How to try it** — if the change is user-visible, the steps to see it.
9. **The PR link, ready to merge.**

**Confidence** (verified by reading the code, or suspected) goes on the call
and on every risk claim.

**Delivery.** The full memo posts as a comment on the item's issue when the
work has one, and on the docket otherwise. Either way, a session that has a
chat open with the owner delivers the memo there too — a call the owner can
only discover by browsing GitHub has not been delivered.

**The docket** is the pinned issue whose title begins with "Decision docket"
(find it by title among pinned issues; never trust a number over the title).
It is the one standing queue of calls waiting on the owner: every open decision
has an index line in its body, and full memos are posted as new **comments**
(append-only, so concurrent sessions never overwrite each other). Editing the
body: fetch it immediately before writing, change only your own line, and
re-read it after writing. Sections: "Waiting on you", "Time-gated", "Blocked
before a decision exists", "Recently decided".

Decisions, and the ledger they build:

- **A PR escalated for a cause specific to it is the owner's to merge until
  they lift the escalation.** No automation merges it on its own initiative.
- A ratification of a **red** item ("merge #N") authorizes nothing automated —
  the owner clicks merge themselves.
- A ratification of a **non-red** item lifts the escalation and the PR
  re-enters the normal tier flow from the top: fresh criteria check, veto
  window for yellow. The comment never skips the gates.
- "Recently decided" records the recommendation next to how each item
  resolved, and **only the owner's own words and actions may appear as their
  call**. A PR that automation merged through the normal tier flow records as
  "auto-merged (tier flow)", never as the owner's decision. This ledger is the
  evidence base for ever moving a category down a tier; automation's own
  merges never count as that evidence.
- Never nag, and never treat silence as approval: an unanswered memo stays
  waiting, however old it gets.

## Shadow-verdict format (posted as a PR comment)

Rules for the summary comment — tier and verdict are **different axes** and the
comment must never let them blur:

1. **Lead with the verdict.** The first line answers "would this merge?"
2. **Exactly one final verdict.** Never render a verdict transition.
3. **Tier is not a grade of this PR.** Tier measures the blast radius of what
   the PR _touches_. A 🔴-tier PR with a clean review is ✅ WOULD-MERGE.
4. **Tag every finding** as either `🛑 blocking` (drives WOULD-BLOCK) or
   `⚠️ advisory` (does not affect the verdict).
5. **Write every finding for a reader who didn't write the code:** what is
   wrong (one sentence); the concrete failure scenario; the impact if unfixed;
   confidence. No bare pattern names.

Template (fill the `<...>` parts; keep everything else verbatim):

```
## 🤖 AI review: ✅ WOULD-MERGE        ← or: ## 🤖 AI review: ❌ WOULD-BLOCK

> Shadow mode: advisory only — a human performs every merge, whatever the verdict.

**Bottom line:** <one plain-English sentence: why it would merge, or the
single thing that must change before it would.>

**Risk tier:** 🔴|🟡|🟢 — <which paths/traits triggered it>.
*(Tier describes what the PR touches, not how good it is. Red = a human must
review and merge PRs in this area in every mode; it is independent of the
verdict above.)*

**Findings:**
<numbered list, most severe first, each tagged 🛑 blocking or ⚠️ advisory and
written per rule 5 above — or the single word "None.">
```

## Auto-merge announcement format (yellow tier)

The comment that opens a veto window. Keep the marker line — it is how
automation recognises its own window and avoids arming a second one.

```
## 🤖 Auto-merge scheduled

**What this does:** <one plain sentence.>

**Merging at:** <YYYY-MM-DD HH:MM UTC> — <window> from now.
**Risk tier:** 🟡 yellow — <which paths triggered it>.
**Review:** local `/code-review`, clean on <short sha> (zero blocking findings).

To stop it: comment `hold`, request changes, convert to draft, or push a commit.
Any of those cancels the merge. The first three send this PR to the owner instead;
a new commit restarts the review and the window.

<!-- {{PROJECT_SLUG}}-automerge-window: <head sha> -->
```
