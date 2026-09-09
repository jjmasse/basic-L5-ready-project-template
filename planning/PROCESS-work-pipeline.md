# PROCESS — work intake, shaping, and execution

**Status: template.** Adopt as-is, trim, or delete. The pipeline below is
optional; the rest of the repository works without a project board. If you do
adopt it, record the adoption date and any changes here.

The goal: the owner creates work with minimal ceremony, an agent shapes it
into an executable state asynchronously, and `/dev-loop` executes it — so the
owner's mandatory touchpoints shrink to (1) filing the idea, (2) confirming
the alignment handshake on judgment work, and (3) whatever
`.github/MERGE-POLICY.md` already escalates.

## What each surface is for

| Surface | Role | Owner |
| --- | --- | --- |
| **GitHub Project board** | The queue: what work exists, what state it is in, what order it runs | Owner creates items; agents move them (except the one human gate below) |
| **GitHub Issues** | One unit of work each; the shaping conversation and the preparation block live in comments | Shared |
| **`planning/`** | Design content — briefs, specs, formulas. Issues *link* to these; they do not replace them | Owner |
| **`planning/WORK-*.md`** | Execution tracker for one effort, linked from the issue | Agent |

**Direction stays in `planning/`; tracking lives on the board.**

## The pipeline (Project status field)

```
Inbox → Shaping → Prepared → In progress → Shipping → Done
                     ↑                        (Blocked, from anywhere)
              the one human gate
```

1. **Inbox** — the owner files an issue. One sentence is enough. Anything
   filed here is an idea, not a commitment.
2. **Shaping** — an agent picks the item up and does dev-loop phases 1–2
   asynchronously, on the issue: reads the governing docs and the code, posts
   only the load-bearing clarifying questions (each with a recommendation, so
   the owner can answer with one word), and drafts the **preparation block**
   as a comment, revising it as answers arrive.
3. **Prepared** — the item carries a complete preparation block and the owner
   has confirmed a bulleted summary of the commitment (the **alignment
   handshake**). Mechanical corrective work may self-promote with an
   announcement; the owner can demote any time.
4. **In progress** — a `/dev-loop` session owns it, entering at phase 3.
5. **Shipping** — PRs open; `/review-and-ship` and the merge policy govern.
6. **Done** — merged, health verified, `/post-merge-cleanup` run. The agent
   moves the item and posts a closing comment: what shipped, PR links,
   verifications run.
7. **Blocked** — waiting on an owner decision (docket link in the issue) or an
   external dependency. The agent states what unblocks it in one sentence and
   moves on.

## The preparation block — definition of "Prepared"

Posted as one issue comment, revised in place until approved:

```markdown
## Preparation

**Outcome:** <one plain sentence>
**Non-goals:** <what this deliberately does not do>
**Done bar:** <observable, not implementation terms>
**Governing docs:** <planning files read, with the sections that apply>

| # | Slice | Outcome | Tier | Files likely touched |
| - | ----- | ------- | ---- | -------------------- |

**Open decisions:** <none, or the questions with a recommendation each>
```

## Ownership and markers

Automation posts under the owner's account, so every comment an agent posts
ends with the hidden line `<!-- {{PROJECT_SLUG}}-pipeline-bot -->`. Only the
absence of that marker identifies a comment as the owner's own words. A
session in a live chat with the owner outranks any scheduled run: "pick up the
next item" in chat always works.
