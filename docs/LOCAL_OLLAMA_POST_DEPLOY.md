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
- The remediation planner produces a draft only. Any fixes require an isolated
  change branch, deterministic regression tests, and human-reviewed PR.
- Never automatically run remediation changes against live databases or deployed services.

## Deployment integration still required
1. Verify actual Render and Cloudflare deployment events reaching GitHub.
2. If a provider does not publish them, use its authenticated deployment-completion
   integration to trigger a trusted GitHub workflow or dispatch this review; do not
   treat repository push as confirmation of deployment.
3. Test the event trigger and timestamps with a real, approved staging deploy.
4. Keep the scanner last in the release verification sequence, after existing
   deterministic tests and deployment smoke checks.
