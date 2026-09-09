# Template checklist

Work top to bottom. Delete this file when every box is ticked.

## 1. Fill the placeholders (the script does this)

```bash
node scripts/init-template.mjs
```

| Placeholder | What to put there | Example |
| --- | --- | --- |
| `PROJECT_NAME` | The product's user-facing name | `Hexreign` |
| `PROJECT_SLUG` | Kebab-case identifier used in markers and temp files | `hexreign` |
| `PROJECT_DESCRIPTION` | One or two sentences: what the product is and who it is for | `A seasonal browser war game for...` |
| `OWNER_NAME` | The human product owner's first name, as the agents will address them | `John` |
| `GITHUB_OWNER` | GitHub user or org | `jjmasse` |
| `GITHUB_REPO` | Repository name | `hexreign` |
| `STACK_SUMMARY` | One paragraph naming the locked stack and layout | `pnpm monorepo: apps/server (Fastify), apps/web (React)...` |
| `VERIFY_COMMAND` | The full local gate, one shell line, that CI also runs | `pnpm typecheck && pnpm lint && pnpm test` |
| `DEV_COMMAND` | How to run the project locally | `pnpm dev` |
| `DEPLOY_PLATFORM` | Where production runs, or `none` | `Railway` |
| `PROD_HEALTH_URL` | A URL that returns 200 when production is healthy, or `none` | `https://play.example.com/health` |
| `OWNER_PORTS` | Local ports reserved for the owner's own checkout, or `none` | `3000 (API) and 5173 (web)` |

`node scripts/init-template.mjs --check` must print nothing and exit 0 when
you are done. CI runs the same check on every repository that is not itself
a template.

## 2. Fill the sections the script cannot

These are marked `<!-- TEMPLATE: ... -->` in the files. Search for `TEMPLATE:`
across the repo; the comments say what belongs there and are meant to be
deleted once the real text is in place.

- [ ] `CLAUDE.md`: golden rules specific to this product (2 to 4 of them), the
      locked architecture, the build order, the non-negotiable test cases.
- [ ] `AGENTS.md` and `.cursor/rules/project-stability.mdc`: mirror what you
      wrote in `CLAUDE.md`. Same change, same commit, every time.
- [ ] `.github/MERGE-POLICY.md`: the red/yellow/green path lists for your
      layout. Anything you leave unlisted is red by default, so list things.
- [ ] `.github/workflows/ci.yml`: the verify step already runs your gate
      command; add services such as a database if the tests need one.
- [ ] `planning/BUILD-SPEC.md`: domain model, schema, formulas, first phase.
- [ ] `planning/RUNBOOK-release.md`: how a deploy happens and how it rolls back.
- [ ] `.env.example`: every variable the project reads, with a comment each.
- [ ] `.claude/settings.json`: the permission allowlist for your read-only
      commands (typecheck, test, lint). Never allow anything that writes to a
      database, merges, publishes, or deploys.
- [ ] `.claude/launch.json` (optional): dev server entries for the Claude Code
      browser preview, including the alt-port entries agent sessions use.

## 3. Human steps on GitHub

- [ ] Mark the source repository as a **template** (Settings, General,
      Template repository) if you have not already.
- [ ] Branch protection on `main`: require the `verify` check and the
      `review-record` **status** (the context named `review-record`, not the
      job named `review-record-job`). Requiring the job instead of the status
      looks configured while enforcing nothing.
- [ ] Enable repository auto-merge if you intend to use `assisted` or
      `autonomous` mode later. Leave `MERGE-POLICY.md` in `shadow` until you
      have watched the advisory verdicts for a while and trust them.
- [ ] Create a pinned issue titled **Decision docket**. Escalations post there
      as comments; the body is only an index.
- [ ] (Optional) A GitHub Project board for the Inbox to Done pipeline
      described in `planning/PROCESS-work-pipeline.md`.

## 4. Local machine conventions

- [ ] Put the real `.env` at the repo root and nowhere else. Worktrees have no
      `.env`; copy it in when a session needs to run servers.
- [ ] If tests need a database, give them their own (`TEST_DATABASE_URL`) so a
      full-suite run never touches the world you develop in.
- [ ] Decide the port split between your own checkout and agent sessions and
      record it in `CLAUDE.md` (the `OWNER_PORTS` placeholder got you started).

## 5. Finish

- [ ] `node scripts/init-template.mjs --check` passes.
- [ ] `grep -rn "TEMPLATE:" --exclude-dir=.git .` returns nothing.
- [ ] Delete `scripts/init-template.mjs`, `templates/`, and this file. Commit.
