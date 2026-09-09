# RUNBOOK — Releasing to production (CI/CD + rollback)

> The goal: fixes ship incrementally as they are ready, and nothing broken ever
> reaches production.

## The pipeline

```
commit → push to main → GitHub Actions (ci.yml) → green? → {{DEPLOY_PLATFORM}} builds & deploys
                                        └────────→ red?  → nothing ships
```

1. **Every push to `main`** runs `.github/workflows/ci.yml`: the full local
   gate (`{{VERIFY_COMMAND}}`).
2. **{{DEPLOY_PLATFORM}} deploys `main`** only after the checks pass.
   <!-- TEMPLATE: name the setting that makes the platform wait for CI. -->
3. Deploys are zero-downtime-ish: the new instance boots, runs migrations,
   passes the health check, and takes over.
   <!-- TEMPLATE: what runs at boot, and what tolerates the overlap window. -->

## Rolling back

<!-- TEMPLATE: the exact clicks or commands to re-activate the previous
     deployment, and where variables/secrets come from when you do. -->

- **Why rollback is safe**: migrations are **additive-only by convention** —
  never drop or rename a column or table that live data or the PREVIOUS
  release still uses. Removals follow expand → migrate → contract across
  separate releases. An older image therefore always runs happily against a
  newer schema.
- If a migration itself is the problem: roll the app back first (stops the
  bleeding), then write a FORWARD migration to correct the schema — never
  edit or delete an applied migration file.

## What "healthy" means

`{{PROD_HEALTH_URL}}` must return 200.
<!-- TEMPLATE: list every field in the health response and what a bad value
     means. A bare 200 proves the process answers, not that it is doing its
     job — name the signals that prove the latter, and the order to read them
     in. The post-merge-cleanup driver's Test-Healthy function should check
     the same things. -->

## Release discipline (what "ready to push" means)

- Same bar as always (CLAUDE.md "what done means") — the agent runs the gate
  locally before committing; CI is the backstop, not the first line.
- Small commits, one concern each — that is what makes rollback targeting
  trivial.
- Config-only changes are still commits and still ride the same pipeline —
  every production change is in the git log.

## Watching a release

- GitHub → Actions tab: the run for your commit.
- {{DEPLOY_PLATFORM}}: build and deploy logs; the health URL should stay 200
  after cutover.
- Post-deploy sanity: open the product, do one action.

## One-time setup checklist

- [ ] `ci.yml` filled in and green on `main`
- [ ] Branch protection requiring `verify` and the `review-record` status
- [ ] {{DEPLOY_PLATFORM}} set to wait for CI before deploying
- [ ] Health URL answering 200 in production
