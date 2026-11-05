# The Fixer security audit triage: 2026-11-05

## Source and confidence

Source: local PDF `The_Fixer_Security_Audit_20261105_091424.pdf` generated 2026-11-05 09:14 by local Ollama `qwen2.5-coder:7b`.

**This is NOT a confirmed vulnerability inventory or a production release approval.**
The PDF contains selected finding titles only, omits source snippets and model evidence, and says the complete `test-reports/ai-security/report.json` remains on the operator's computer. Do not publish that JSON, any credential, or raw production data without redaction/review.

| PDF field | Value |
|---|---:|
| Reviewable files completed | 500 / 505 |
| Chunks completed | 1,288 / 1,293 |
| Failed chunks | 5 |
| Excluded tracked paths | 12 |
| Model observations | 3,223 |
| Model-assigned critical / high / medium / low | 0 / 3,142 / 65 / 16 |
| Confirmed exploitable findings in the PDF | Not established |

The scanner has a historical HIGH-severity prompt example. The 3,142 HIGH labels cannot be trusted without source inspection. A model labeling CSS text overflow, CSS classes or React text rendering as HIGH is not sufficient evidence of a vulnerability.

## Source-level review performed on PR #219's branch

- `frontend/src/App.tsx:64` is part of a generic browser `fetch` wrapper, not a direct SQL interpreter. The PDF's SQL-injection assertion at that location is **not supported by the line examined**. This does not prove the entire frontend/backend is free of injection.
- The React theme utility `normaliseHex` checks for six hex digits. Some frontend XSS classifications are therefore lower confidence, but all untrusted HTML/URL sinks still need a dedicated review.
- MFA routes contain passkey challenge consumption, role checks, encrypted TOTP secrets, and atomic replay protection on the draft PR #219 branch. This is **not** a substitute for live MFA testing.
- The source API address classifier had narrow IPv4-mapped IPv6 checks and missed internal IPv4 ranges such as 172.31/12. This change introduces a shared deny policy with deterministic address tests. Treat as **preventive SSRF hardening**, not evidence of an observed exploit.
- Source API DNS lookup followed by an independent `fetch` still presents a potential DNS rebind time-of-check/time-of-use gap. Full closure requires pinning the vetted resolved address at connection time or enforcing trusted network egress controls. Do not claim full SSRF prevention yet.
- The scanner checkpoint key previously omitted the prompt and JSON schema. Reusing checkpoints after an in-place review-contract change could preserve old observations. The key now includes both and a version bump invalidates the old cache.

## Missing coverage that must be resolved

1. `frontend/src/enterprise.css:1395-1521` (ValueError)
2. `src/services/sourceAdapter.ts:1-128` (ValueError)
3. `tests/fixtures/mono_black.json:1` (HTTPError)
4. `tests/fixtures/navy_gold_aa.json:1` (HTTPError)
5. `tests/fixtures/pastel_mint.json:1` (HTTPError)

All 12 excluded tracked paths must be listed with reasons and reviewed for coverage relevance. Do not silently count excluded paths as scanned.

## Workstream acceptance checks

- [x] Separate code changes on a non-production branch based on PR #219.
- [x] Add source-address-policy regression tests and wire them into `check:source-sync-safety`.
- [x] Bind Ollama checkpoints to the review prompt and schema; correct chunk line-range accounting.
- [ ] Run offline scanner contract tests on the *changed commit*: `python3 tests/ci/ollama-scanner-contract.test.py -v`.
- [ ] Run source policy tests and full synthetic Docker suite with the dedicated self-hosted runner.
- [ ] Re-run the local deep scanner from scratch/equivalent invalidated checkpoints; require 505/505 reviewable files, 1293/1293 chunks or updated explicit coverage counts with zero unexplained failures.
- [ ] Independently classify the full **local** raw JSON observations by risk and exploit path; track confirmed issues with source-level reproductions.
- [ ] Validate server-side admin role and MFA enforcement, enrolled and existing accounts, recovery, passkey and TOTP replay, lockout concurrency, browser flows and tenant isolation.
- [ ] Check SQL identifiers/parameters, untrusted HTML and redirects, source URL rebinding, state-changing endpoint CSRF, dependency advisories, secret handling and response headers.
- [ ] Run all deterministic security, integration, migration, type, lint, browser and performance checks using synthetic isolated services.
- [ ] Security review and release sign-off for PR #219, then assess PR #217 (Cloudflare) and PR #225 (Aiven) independently.

## Operational constraints

Do not merge, deploy, migrate, modify production flags, or move customer records based on this audit or on AI-only claims. Use only the dedicated self-hosted runner and disposable test databases. PR #219 remains an unmerged draft and production MFA is not certified by this audit.
