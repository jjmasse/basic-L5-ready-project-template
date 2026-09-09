# AGENTS.md

**Binding engineering contract:** every agent working in this repo — Cursor
(IDE or cloud), Claude Code, or anything else — MUST follow
[`.cursor/rules/project-stability.mdc`](./.cursor/rules/project-stability.mdc),
which mirrors [`CLAUDE.md`](./CLAUDE.md). Read the rule file for the
engineering contract, and read `CLAUDE.md` too — it carries direction the
mirror doesn't (the build order and which `planning/` docs to consult). These
are requirements, not suggestions. The non-negotiables in brief:

- One authoritative core; clients only render and request.
- Any state-changing action runs in one transaction with row locking, and
  every mutating action writes an audit row.
- Mutating operations: `authenticate → validate → rate-limit → begin tx → lock
  row → re-validate → mutate → audit-log → commit`.
- Tunable numbers live in versioned config, never inline.
- Integer math for balances; stored seeds for anything random; migrations
  additive-only.
- <!-- TEMPLATE: one line per product-specific golden rule from CLAUDE.md -->
- A feature is **done** only when it's transactional, rate-limited,
  audit-logged, unit-tested (happy path + an exploit/edge case), and the full
  local gate passes: `{{VERIFY_COMMAND}}`.
- **Plain language** in all developer-facing writing (docs, comments, commits,
  reviews, chat). Risk and bug reports must include the concrete failure
  scenario, impact, and confidence — not just a pattern name. See
  [`.cursor/rules/plain-language.mdc`](./.cursor/rules/plain-language.mdc).
- All planning and status documents live in `planning/` (tracked in git),
  which is the product owner's. An agent edits there only when asked, except
  for its own `planning/WORK-*.md` tracker.

Setup and standard commands live in [`README.md`](./README.md). The rest of
this file adds local-machine and cloud-agent operating notes.

## Local dev ports on the product owner's machine

On the shared local machine (not a cloud VM), ports **{{OWNER_PORTS}} are
reserved for the product owner's local**, serving current `main` — never take
those ports or kill their processes. Feature/QA sessions run on alternate
ports set in the worktree's root `.env`. Test runs use an isolated database
(`TEST_DATABASE_URL` in the root `.env`), so dev servers stay up during
full-suite runs. If the reserved pair is down or serving branch code, restore
it. Full rule text: `CLAUDE.md` / `.cursor/rules/project-stability.mdc`.

## Cloud agent specific instructions

<!-- TEMPLATE: what differs in a cloud VM: local database instead of hosted,
     which secrets are absent and what that disables, which services to start
     before tests, how to confirm the stack is healthy. Delete if there is no
     cloud environment. -->

- Run locally with `{{DEV_COMMAND}}`; verify with `{{VERIFY_COMMAND}}`.
