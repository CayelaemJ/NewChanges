# The Fixer — post-deployment monitoring

This is the release-monitoring view for PR #219. It is **not live yet**; test and
merge the workflow, and configure GitHub deployment status integrations.

## Where to see deployment results

Open **GitHub > NewChanges > Actions > The Fixer final post-deploy Ollama check**.
Each run includes:

- Provider deployment status (success / failure / error), environment and expected commit.
- Three read-only observations of Render and Cloudflare across approximately 90 seconds.
- HTTP result and elapsed time for `/health`, `/ready` and `/version`.
- Whole-repository deterministic security checks, followed by local Ollama analysis.
- AI review and auto-fix status, with GitHub issue escalation for problems.
- A downloadable **newchanges-post-deploy-health-<run>** artifact retaining the
  sanitized health time-series and static scanner status for 14 days.

The GitHub Actions **job summary** is the dashboard. Health is measured using
unauthenticated GET requests only: no database credentials, administrative logins,
production writes, request/response bodies or source snippets are uploaded.

## One-time configuration

In GitHub repository settings, add two **Actions variables** (not secrets):
- `FIXER_RENDER_BASE_URL` — the actual HTTPS base URL of the Render environment to watch.
- `FIXER_CLOUDFLARE_BASE_URL` — the actual HTTPS base URL of the Cloudflare deployment to watch.

These values must be configured by an authorized owner using the actual service
URLs. Never infer the Cloudflare deployment URL or accept an untrusted deployment
payload URL. Missing or invalid URLs fail monitoring and trigger an escalation.

The workflow listens to GitHub `deployment_status` events for the **main**
branch reporting `success`, `failure` or `error`, and also supports a
manual GitHub Actions run. **Do not assume Render or Cloudflare publishes these
events**: verify provider integration for each release, or configure a trusted
post-deploy completion dispatcher. GitHub notifications must be enabled for
new issues to reach you. The self-hosted runner and local Ollama must be online.

## Meaning of a result

- **Healthy:** last sampled `/health`, `/ready`, `/version` returned HTTP 200
  for a configured target. Earlier failed observations remain in evidence.
- **Degraded:** at least one endpoint failed on last sample.
- **Unconfigured:** no monitoring URL is provided; never report a false pass.
- **Scanner failure:** not a verified security pass. Review the failed scanner step.
- **AI finding:** an unverified hypothesis, not a confirmed vulnerability.
- **Deployment failure or error:** escalate, even if endpoint health is still 200
  because the old deployment might still be serving.
- **Unexpected run absence:** indicates missing provider event delivery, sleeping/offline
  self-hosted runner, or workflow configuration, not guaranteed good status.

## Limits

This observes availability briefly after deployment; it does not yet run continuously.
It does not verify the actual deployed commit digest, browser sign-in, authenticated
MFA flows, tenant data correctness, monitoring history across deployments, or
provider-level rollback. Keep the existing pre-deploy tests and staging acceptance
criteria; a post-deploy scan cannot protect an already-deployed release.

Do not enable automated production rollback or merge from model results.
