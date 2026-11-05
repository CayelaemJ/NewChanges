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
- The Docker scanner now attempts every Git-tracked UTF-8 reviewable text file by default
  (MAX_FILES=0), prioritizing security-related implementation. Files are chunked into
  bounded prompts rather than truncated. The report distinguishes excluded binaries,
  generated paths and credential material from reviewed text and failed chunks.
- Scan exclusions and a conservative source-credential heuristic reduce the chance
  of secrets entering prompts but are **not a complete secrets detector**.
- Model findings can be wrong or incomplete. Validate with Semgrep, Gitleaks, Trivy,
  unit/integration tests, and manual review.
- Malformed JSON and transient Ollama failures are retried up to four times, with
  a configurable per-request timeout (360 seconds by default). Repeated errors remain
  visible as failures, not clean results. No promise of zero errors or runtime limit.
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

## Local Ubuntu full scan and resume

Keep your Ollama process running on Windows. This uses the downloaded local
`qwen2.5-coder:7b` model without cloud-model usage fees or request quotas.
Local RAM/VRAM, model context, disk space, response reliability and runtime
still impose real technical limits.

```bash
cd ~/NewChanges-pr219
git pull --ff-only origin chore/manual-self-hosted-docker-ci-20261029
install -d -m 700 "$HOME/.cache/the-fixer-ollama"
python3 tests/ci/ollama-scanner-contract.test.py -v
mkdir -p test-reports/ai-security
docker compose -f docker-compose.ai-security.yml run --build --rm \\
  --user "$(id -u):$(id -g)" ai-security-review
cat test-reports/ai-security/report.md
```

If a request fails or the local machine restarts, rerun the same Docker command.
Checkpoint content is stored under `~/.cache/the-fixer-ollama` and keyed by
model, source path, line boundaries and exact source content, so unchanged chunks
will not need to be reviewed again. Reports live under
`test-reports/ai-security`, not Git. Protect that folder and your cache because
AI findings can quote source code.

Note that the first full scan may be very slow on local hardware and could exceed
GitHub Actions' per-job timeout. In that case rerun and resume: incomplete jobs
are not a successful security verdict.

## NVIDIA RTX 5060 GPU acceleration (Windows-hosted Ollama)

The Docker image is a Python HTTP client; Ollama itself runs on Windows.
Do **not** install an additional Ollama daemon inside Docker, and do not
add `gpus: all` to this scanner Compose service: that would not control the
Windows-hosted Ollama server. The actual GPU selection and drivers belong to
the Windows Ollama process.

On Windows PowerShell:
```powershell
nvidia-smi
ollama run qwen2.5-coder:7b "Reply OK."
ollama ps
```
`ollama ps` should show a GPU percentage in the Processor column. The
RTX 5060 is on Ollama's documented NVIDIA supported list, subject to a recent
compatible NVIDIA driver. In Ubuntu Docker the scanner now warms the local model,
checks Ollama's `GET /api/ps` `size_vram` value, and **refuses a CPU-only run**
when `OLLAMA_REQUIRE_GPU=true` (default).

A positive `size_vram` proves GPU memory is being used; it does **not**
prove every layer is on GPU. If the RTX 5060 cannot hold model plus context,
Ollama can still place some work on CPU. To diagnose use `ollama ps`, driver
status, available VRAM and model settings before changing anything.

A laptop GPU is **not a cloud request quota**. Hardware memory, driver
compatibility, available compute and thermal limits still apply. The full
scan is sequential and checkpointed, rather than spawning many model
requests concurrently.

If you intentionally want CPU fallback for troubleshooting only, override
the Compose service with `-e OLLAMA_REQUIRE_GPU=false`; routine security
checks should retain GPU-required mode.

## Export a private PDF to Windows Downloads from Ubuntu

The audit can now create a compact PDF directly in the signed-in Windows
user's Downloads folder through WSL. The exporter is pure Python and needs
no third-party PDF library.

Export an **existing** completed or incomplete audit immediately:
```bash
cd ~/NewChanges-pr219
python3 scripts/ci/export-ollama-pdf.py
```

Run the scan and export a PDF automatically on exit:
```bash
cd ~/NewChanges-pr219
bash scripts/ci/run-and-export-ollama.sh
```

The exporter determines the Windows profile using `powershell.exe` and
converts its path with `wslpath`. It saves
`The_Fixer_Security_Audit_YYYYMMDD_HHMMSS.pdf` inside `Downloads`,
including unresolved-error status if the scan is incomplete. If Windows
profile discovery fails, give an explicit directory:
```bash
python3 scripts/ci/export-ollama-pdf.py --output-dir "/mnt/c/Users/YOUR_USER/Downloads"
```

The PDF contains coverage, error accounting, severity caveats, file-category
counts, most flagged files and up to 75 unverified application/database
titles. Full findings remain in the local `report.json`. The PDF intentionally
omits model evidence excerpts and raw source. The local PDF and JSON may still
contain sensitive filenames, so keep them private; do not upload as public
GitHub artifacts. The exporter does not write to production or alter source.
