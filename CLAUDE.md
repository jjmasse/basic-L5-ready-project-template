# CLAUDE.md — {{PROJECT_NAME}}

> Project context for the coding agent. Read this before writing code. Pair it
> with `planning/BUILD-SPEC.md` (domain model, schema, formulas, tasks) and
> `planning/BACKLOG.md` (deferred work).
>
> **Mirrors:** this contract is mirrored for Cursor in
> `.cursor/rules/project-stability.mdc` and summarized in `AGENTS.md`. A change
> to the rules or conventions here must update all three files in the same
> change. Where they disagree, this file wins — flag the drift.

## Planning & product-owner docs live in `planning/` (read this)

All planning and product-owner artifacts — build spec, requirements, status
write-ups, backlog, briefs, runbooks — live in the **`planning/` directory**,
which is **tracked in git** so cloud agents, CI, and worktrees all see the same
plans. It is the shared workspace between the human product owner
({{OWNER_NAME}}) and whatever authors the product-owner files; the coding agent
builds the product from it.

- **`planning/` is the single source of direction.** Consult it for what to
  build next (`planning/BUILD-SPEC.md`), deferred work (`planning/BACKLOG.md`),
  and how releases happen (`planning/RUNBOOK-release.md`). When orienting at
  the start of a task, read the relevant file(s) here.
- **Every agent must create any new planning/design/status/spec document
  inside `planning/`, never at the repo root or scattered elsewhere.**
- **Treat planning docs as read-mostly inputs.** The product owner authors
  them; a coding agent edits a planning doc only when explicitly asked, and
  **never moves or deletes anything under `planning/`** without being asked.
  The one exception is `planning/WORK-<slug>.md`: a coding agent's own
  execution tracker for a single effort, written and updated by the
  `/dev-loop` skill. `WORK-*` files are agent-owned; every other prefix is not.
- Planning-doc edits are committed like any other file; their merge tier is
  set in `.github/MERGE-POLICY.md`.

## What we're building

{{PROJECT_DESCRIPTION}}

## Golden rules (do not violate)

<!-- TEMPLATE: The first three rules below generalize well and are worth keeping
     in most projects. Add two to four rules specific to this product: the
     invariants whose violation would be a P0. Hexreign's, for comparison:
     "server is authoritative", "no double-spend, ever", "balance numbers are
     data, not code", "everything scopes to a season", "time is measured in
     ticks", "legacy is power-free". Write yours as short imperative sentences
     with one line of why. Delete this comment when done. -->

1. **One authoritative core.** Clients (browser, CLI, headless integrations)
   render state and *request* actions. They never compute outcomes, never
   decide what is legal, never trust their own numbers. Every action is
   validated where the truth lives.
2. **No lost or duplicated writes.** Any action that changes state runs in a
   single transaction, re-validates inside it, and is audit-logged. Concurrent
   double-submit is the canonical exploit — treat it as a P0 at all times.
3. **Tunables are data, not code.** Every rate, cost, limit, and timer lives in
   a versioned config object. No magic numbers inline. Changing a number is a
   config edit, never a code edit.
4. <!-- TEMPLATE: product-specific rule -->
5. <!-- TEMPLATE: product-specific rule -->

## Architecture & stack (LOCKED)

{{STACK_SUMMARY}}

<!-- TEMPLATE: State what is locked and why, in a few bullets: the process
     model (one service? several?), the datastore, auth, validation at the
     boundary, the test runner. "LOCKED" means an agent does not restructure
     it without the product owner saying so. Delete this comment when done. -->

## Conventions

- Strict types on. No escape hatches (`any`, `unsafe`, `# type: ignore`)
  without a comment justifying each one.
- Pure domain logic (formulas, resolution, decisions) is **side-effect-free**
  and lives apart from IO (database, network, filesystem). This keeps the core
  testable without infrastructure.
- Money and resource math in **integers**. Never floats for balances.
- Mutating operations follow one shape:
  `authenticate → validate input → rate-limit → begin transaction → lock the
  row(s) → re-validate → mutate → audit-log → commit`.
- Every mutating action writes an audit row, inside the same transaction.
- Anything random uses a **stored seed** so outcomes are reproducible.
- Migrations are **additive-only**: never drop or rename what the previous
  release still reads. Expand, migrate, then contract in a later release, so a
  rollback to the previous image always works against the newer schema.

## Local dev on the product owner's machine (multi-session convention)

Several agent sessions run in parallel on this machine, and every one of them
that runs the project shares the same local resources.

- **Ports {{OWNER_PORTS}} are reserved for the product owner's local.** That
  pair serves current `main`. Never take these ports, never kill their
  processes, and never leave them serving branch code.
- **Feature/QA sessions run on alternate ports**, set through the worktree's
  root `.env`. <!-- TEMPLATE: name the alt ports and the env vars that select them. -->
- **Test runs use an isolated database** (`TEST_DATABASE_URL` in the root
  `.env`) so a full-suite run never touches the world you develop in, and dev
  servers can stay up. Do not run two sessions' full suites at the same time
  unless each points at its own test database.
- **A fresh worktree has no `.env`.** Copy the root `.env` in before running
  anything that needs it. The real `.env` lives at the repo root and nowhere
  else — see `.env.example` for the two near-misses that fail silently.
- **If the reserved pair is down or serving branch code, restore it** (any
  session may): kill the orphaned processes, start a main-level pair.

This applies only on the shared local machine; isolated environments (CI,
cloud agent VMs) have no port contention and ignore it.

## Language & explanations (all agents, all output)

- **Plain language in everything developer-facing.** Docs, code comments,
  commit messages, PR descriptions, review findings, and chat/status updates
  use simple, direct sentences. No metaphor, no flourish. Define any jargon or
  project-specific term the first time it appears in a given document or reply.
- <!-- TEMPLATE: if the product has its own voice (in-app copy, lore, brand),
     name the one place metaphor is allowed and the file that defines it. -->
- **Explain risks so a non-author can judge them.** Most code here is
  AI-written, so the person reading a warning usually did not write the code.
  Never just name a pattern ("race condition", "possible double-spend") and
  move on. Every risk or bug report must include: (1) what is wrong, in one
  plain sentence; (2) the concrete failure scenario — who does what, and then
  what goes wrong; (3) the impact if it's left alone; (4) how confident you are
  (verified by reading the code, or suspected); (5) the fix or next step. If
  you can't describe the concrete scenario, say so explicitly instead of
  implying certainty.

## What "done" means for a feature

- Validated at the boundary, transactional, rate-limited where exposed,
  audit-logged.
- Pure logic unit-tested: happy path **plus at least one exploit or edge case**
  (concurrent double-submit is the canonical one).
- Tunable values pulled from config, not hardcoded.
- Reflected in the client read-only first, then wired to the action.
- The full local gate passes before the work is declared finished:

  ```bash
  {{VERIFY_COMMAND}}
  ```

## Build order

<!-- TEMPLATE: the phases, in order, with a checkmark as each lands, and a
     pointer to the task detail in planning/BUILD-SPEC.md. Name the layers
     that are painful to retrofit (config-as-data, tenancy/scoping, audit) and
     say they land early. -->

## Non-negotiable test cases to keep around

<!-- TEMPLATE: three to five invariants, each phrased as a test that must keep
     passing. Hexreign's, for shape: "two concurrent requests from the same
     account cannot both succeed against the same balance"; "an account offline
     for N periods accrues exactly what one polled every period accrues". -->

- Two concurrent requests from the same account cannot both succeed against the
  same balance.
- <!-- TEMPLATE: invariant -->
- <!-- TEMPLATE: invariant -->
