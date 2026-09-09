# {{PROJECT_NAME}}

Repository: https://github.com/{{GITHUB_OWNER}}/{{GITHUB_REPO}}

{{PROJECT_DESCRIPTION}}

See [`CLAUDE.md`](./CLAUDE.md) for the engineering contract every agent and
contributor follows. Planning and product-owner docs (build spec, backlog,
runbooks) live in [`planning/`](./planning), which is tracked in git so every
session reads the same plans. Treat those docs as read-mostly inputs: the
product owner maintains them, and the build follows them.

## Layout

<!-- TEMPLATE: the top-level directories and what each one is. -->

```
```

## Prerequisites

<!-- TEMPLATE: runtimes, package manager, a database if any. -->

## Setup

1. **Install**

   <!-- TEMPLATE: install command -->

2. **Configure env.** Copy the template to a real file **at the repo root**:

   ```bash
   cp .env.example .env
   ```

   Then fill in the values marked as required in `.env.example`. Put it at the
   repo root and nowhere else; the comments in `.env.example` explain the two
   near-misses that fail silently.

3. **Run**

   ```bash
   {{DEV_COMMAND}}
   ```

## Scripts

Run from the repo root.

| Command | What |
| --- | --- |
| `{{VERIFY_COMMAND}}` | The full local gate. CI runs the same thing; run it before pushing. |
| `{{DEV_COMMAND}}` | Run locally. |

## Troubleshooting local dev

<!-- TEMPLATE: the first three things that go wrong on a fresh machine and
     how to tell them apart. Keep adding as they happen. -->

**Missing env when running inside a git worktree.** `.env` is gitignored and
exists only in your main checkout; a fresh worktree has none. Copy it in.

## Architecture notes

<!-- TEMPLATE: three to five bullets that explain the shape of the system to
     a newcomer, each one a sentence. -->
