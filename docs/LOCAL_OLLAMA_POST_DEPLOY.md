# Local Ollama post-deployment reviewer

## Purpose
The final **advisory** security check reviews The Fixer's checked-out source with a local
`qwen2.5-coder:7b` model on the Ubuntu self-hosted runner (label `newchanges-ci`).
It does not call hosted models, connect to production databases, fix source automatically,
merge changes, trigger deployments, or change authentication.

## Trigger behavior and important limitation
`.github/workflows/post-deploy-ollama.yml` runs after GitHub receives a
`deployment_status` event whose state is `success` and whose deployment ref is `main`.
It can also be run manually through GitHub Actions > The Fixer final post-deploy Ollama check
> Run workflow. **Neither Render nor Cloudflare is guaranteed to publish GitHub deployment
status events**. Verify this integration for each real deployment provider before claiming
that the check runs after every deployment. Render's `render.yaml` currently sets
`autoDeployTrigger: off`, so deployment behavior must be verified with the service owner.
Do not add deployment secrets or public Ollama exposure as a workaround.

## Manual local run (WSL Ubuntu)
```bash
cd ~/NewChanges
mkdir -p test-reports/ai-security
docker compose -f docker-compose.ai-security.yml run --build --rm ai-security-review
cat test-reports/ai-security/report.md
docker compose -f docker-compose.ai-security.yml run --rm --entrypoint python ai-security-review /scanner/ai-remediation-plan.py
cat test-reports/ai-security/remediation-plan.md
```

## Operational limits
- Docker must reach the Windows Ollama service on `host.docker.internal:11434`.
- The model must be pulled locally. Models ending in `:cloud` are rejected.
- Only a bounded set of source files is scanned; default maximum 25 files, prioritized
  toward authentication, security, MFA, database, tenant, and API paths.
- Scan exclusions and a conservative source-credential heuristic reduce the chance
  of secrets entering prompts but are **not a complete secrets detector**.
- Model findings can be wrong or incomplete. Validate with Semgrep, Gitleaks, Trivy,
  unit/integration tests, and manual review.
- A scan timeout is recorded as an error and the AI step remains non-blocking.
- Reports stay on the local runner filesystem under `test-reports/ai-security`. GitHub
  Actions receives only aggregate counts, not source excerpts or full reports.
- The remediation planner produces suggestions; the separate auto-repair stage may apply
  **one small low-severity UI fix** (up to six replacement lines, one allowlisted
  component, max 12 total diff lines). It then runs offline dependency installation,
  frontend TypeScript checking, and a frontend build. Only successful validation can
  create a **draft pull request** on the bot branch. It does **not** merge or deploy.
- High/critical, medium, authentication, MFA, authorization, database, API,
  infrastructure, ambiguous, or failed-test changes are escalated through a GitHub
  issue pointing to the workflow run. GitHub issue notifications depend on repository
  notification settings and Actions permissions.
- Offline npm verification requires pre-populated npm caches. Missing dependencies
  cause escalation rather than bypassing tests.
- Never automatically run remediation changes against live databases or deployed services.

## Deployment integration still required
1. Verify actual Render and Cloudflare deployment events reaching GitHub.
2. If a provider does not publish them, use its authenticated deployment-completion
   integration to trigger a trusted GitHub workflow or dispatch this review; do not
   treat repository push as confirmation of deployment.
3. Test the event trigger and timestamps with a real, approved staging deploy.
4. Keep the scanner last in the release verification sequence, after existing
   deterministic tests and deployment smoke checks.

## What the check cannot guarantee

This is a **post-deployment** check. It cannot retroactively prevent a release
that has already gone live. Keep deterministic tests and release gates before
production promotion. The agent only makes a small subset of changes automatically,
and all proposed code changes require review and merge to reach production.

A GitHub deployment-status event must be proven for **each** Render/Cloudflare
service and deployment environment; the workflow also allows manual triggering.

## Coverage policy update
Security-sensitive implementation source is explicitly eligible for local review, including
files named for MFA, authorization, recovery, secrets-handling or private access. Only
actual credential stores and key material paths are excluded. A heuristic redacts some
credential-like assignments from local prompts, but it is not a complete secret scrubber.
Never use a cloud model or publish source-bearing reports. Existing Semgrep, Trivy,
Gitleaks and functional authorization tests remain mandatory independent controls.

## Full-codebase audit and bloat assessment

- The manual self-hosted Docker workflow now inventories **all Git-tracked** source and
  configuration files and reports size, line counts and byte-identical duplicate groups.
  Nothing is deleted automatically; duplicates can be intentional.
- The same manual workflow executes a priority Ollama pass after Docker tests. Its default
  25-file limit is **not** a complete AI review. It continues to report denominators.
- The post-deployment workflow runs the entire deterministic security scanner suite and
  tracked-file inventory before the final priority Ollama pass. Both provider event wiring
  and runner validation remain unverified.
- For deeper review, manually dispatch `The Fixer deep full-codebase Ollama audit
  (self-hosted)`. It sets `MAX_FILES=0` to attempt **all tracked eligible implementation
  files**. It fails if files are skipped, truncated or time out. It may exceed the
  360-minute job limit on local hardware. A nonzero job result means incomplete coverage,
  not proof that every file contains a vulnerability.
- The AI scanner currently accepts TypeScript, TSX, JS, JSX, MJS, CJS, Python, and Prisma
  source. Configuration, shell, SQL, CSS, HTML, JSON and YAML are covered by the separate
  tracked-file inventory and whichever deterministic scanners apply, not by full AI reasoning.
  The scanner processes only the first 12,000 characters by default for any eligible file
  and explicitly reports each truncation. Thus do not claim full AI coverage until these
  limitations have been resolved.
- The inventory identifies large and byte-identical files as **candidates**; dependency
  graph analysis, generated-code classification, and verified dead-code removal are still
  outstanding. Remove nothing without usage analysis, regression tests, and review.
- Before enabling deployment promotion, gate on the deterministic checks and smoke tests.
  A *post*-deploy scan cannot prevent an already-live release.
