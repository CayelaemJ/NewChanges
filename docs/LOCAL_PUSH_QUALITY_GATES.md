# Local push quality gates

These gates reuse existing NewChanges tests and do not create GitHub Actions jobs, paid CI, or cloud infrastructure.

## Set up (Windows Git Bash, macOS or Linux)

Install Node 24 and dependencies, including frontend dependencies, then activate the repository-local hooks:

```bash
npm ci --no-audit --no-fund
npm ci --prefix frontend --no-audit --no-fund
bash scripts/install-local-hooks.sh
```

On Windows, use Git Bash for these shell scripts. The installer copies the hook to Git's local hooks directory and sets its executable bit. It refuses to overwrite an existing pre-push hook; if one exists, integrate these checks into it manually. If you previously set `core.hooksPath`, unset it only after confirming that it is safe to change your local hook configuration.

## Before push

A normal `git push` runs the pre-push hook. It fails closed if local Node dependencies are absent or any check fails.

The checks include Git whitespace validation, ESLint, backend/frontend TypeScript, Vitest, build, password form associations, security regressions, identity protection, and source sync safety.

## After push

Git does **not** have a native post-push hook. To run the expanded checks automatically *after a successful push*, use:

```bash
bash scripts/push-verified.sh origin your-branch
```

This performs an ordinary `git push`, including its pre-push hook, and then runs local UI, import, scheduling, refresh, brand, accessibility, performance, governance, compliance, MLOps and React regressions.

**Important:** post-push failures cannot retract a push that already succeeded. Protect main with PR review and required status checks from an approved runner; do not treat the local post-push report as an enforceable remote merge gate.

## Isolation and coverage limits

Local hooks explicitly clear common cloud database environment variables. They do not connect to a disposable PostgreSQL container and must not be used as a substitute for database integration tests. These tests can still inherit other local configuration, so run on a clean synthetic-development machine; never supply cloud credentials to testing commands. Existing checks should be reviewed for outbound requests before relying on them as strictly offline.

For integration coverage, run the repository's PostgreSQL/RLS and browser jobs on a self-hosted runner or locally using disposable services, after the corresponding isolated Docker setup is independently verified.

The existing CircleCI configuration has jobs that require opt-in Neon test credentials. Those jobs are **not** invoked by these scripts. Likewise, no new GitHub-hosted Actions workflow is introduced.

Failures should be fixed and rerun; do not bypass hooks with `--no-verify` as a routine workflow.
