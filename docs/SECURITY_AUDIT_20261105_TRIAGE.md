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

## Detailed PDF and source-confirmed remediation update (2026-11-05)

A subsequent 577-page detailed PDF, `The_Fixer_Full_Detailed_Security_Audit_20261105_102117.pdf`, confirms the *same underlying scan*: scanner schema 4, 500/505 reviewable files and 1,288/1,293 chunks. It provides every AI-authored observation but still has no source-level proof. Do not treat a later PDF export as a new complete scan.

### Reviewed examples and dispositions

| Original PDF finding | Source verification | Disposition |
|---|---|---|
| #15, SQL injection from a migration's foreign-key `userId` | Declarative SQL foreign key alone is not SQL string interpolation | Unsupported / false-positive mechanism |
| #49, insecure strict-equality test assertion | `assert.equal` in Node strict assertion module is not insecure authorisation | Unsupported / false-positive mechanism |
| #2096, case-sensitive `ADMIN` or `SUPERADMIN` check | Explicit server-side role allowlist is expected; no vulnerability demonstrated | Unsupported |
| #2100 / #2101, alleged MFA bypass when MFA/recovery is missing | Inspected `src/server.ts` redirects administrators to `/mfa` and blocks protected API traffic | Not substantiated by inspected guard; still requires live tests |
| #2102, contact email HTML injection | Contact template escapes supplied values with `escAttr` | Not substantiated at cited path |
| #2156, unescaped admin name in test notification | Server interpolated account-controlled name and email directly into HTML email body | **Confirmed HTML-injection sink; patch added** |
| #2209, unhandled Slack fetch exceptions | `notifyAdmins` already wraps fetch in `try/catch` | Unsupported |

### Additional defects independently identified in GitHub code

These were found by inspecting the implementation, not by trusting AI severity labels:

- **Webhook credential disclosure**: `publicEmailConfig` returned the complete saved Slack incoming-webhook URL to the administrative browser. Incoming-webhook URLs are bearer credentials. Replace with `hasAlertSlackWebhook`, leave the input blank, explicitly preserve it on unrelated saves, and support an explicit removal checkbox. Admin role restrictions existed, so this is **not** an unauthenticated leak.
- **Outbound notification destination restriction**: `notifyAdmins` fetched whatever URL an administrator had saved. Add a strict HTTPS allowlist for Slack incoming-webhook URLs, enforced both at save time and when sending using historical DB configuration. This is a boundary-hardening change, not proof an internal endpoint was contacted.
- **HTML notification content**: Test alerts, inactivity reports and weekly digests interpolated names and event paths without consistent escaping. Encode values before insertion into HTML and remove special-control characters from plain Slack text.
- **Configured email origin and HTML-safe report fields**: Validate portal-link base URLs before including them in account setup, reset and report emails. Normalize CSS brand colors and escape nonnumeric monetary values when rendering report HTML.

### New regression coverage

- `tests/security/slack-webhook-policy.test.ts`: allow valid Slack/GovSlack endpoints; reject HTTP, localhost, metadata IPs, lookalike hosts, alternate ports, userinfo, queries and fragments.
- `tests/security/notification-text-safety.test.ts`: escape HTML, reject unsafe email-link schemes and invalid CSS colors.
- `tests/security/notification-settings-contract.test.mjs`: ensure API does not serialize webhook secrets; enforce saved-secret preservation in UI; reject unchecked notification egress.
- The existing `check:security` script now includes these tests. **No changed-commit Docker CI success has been confirmed yet.**

### Remaining risks / release blockers

- The source API's separate DNS lookup and `fetch` still permit an egress time-of-check/time-of-use race without pinned connections / network egress controls.
- Slack webhook URLs are stored in the application database in plaintext. At-rest field encryption, access auditing, redaction during backup/export and key rotation should be evaluated before production.
- Enforce the exact saved Slack webhook allowlist on existing configurations and rehearse a rotation of any previously displayed credentials. An existing non-Slack URL will no longer receive messages.
- Validate app-specific CSP, CSRF, authorised cross-tenant access, MFA superadmin recovery, transactional rate-limit concurrency and scheduled jobs with live synthetic HTTP tests.
- **Never claim the application is fully secure from AI observations alone. No PR merge, production toggle, cutover or deployment until approval.**

## Additional code-level security hardening (2026-11-05, second iteration)

### Forged security-event IP provenance

**Verified source pattern:** `src/services/securityService.ts` prioritized raw `X-Real-IP`, and even `X-Forwarded-For`, over Fastify's `req.ip`. A client-provided header may contaminate access-event IP attribution when the proxy does not sanitize it. This was *not* a proven rate-limit bypass: rate limiting elsewhere already uses Fastify `req.ip`.

**Remediation:** `src/services/securityNetworkPolicy.ts` now resolves the client address from Fastify's configured proxy-trust boundary, with a socket fallback only when a valid IP is supplied. It rejects non-public/reserved/malformed addresses before optional IP geolocation. `securityService.ts` requires explicit `TRUST_EDGE_GEO_HEADERS=true` to accept Cloudflare/Vercel geography headers, which must be enabled **only when the fronting edge strips and overwrites any incoming client-supplied geography headers**. When disabled, no origin-provided geography headers are trusted; optional external location lookup remains separately opt-in.

### Inactivity automation cannot disable superadministrators

**Verified source pattern:** `runStaleAccountCheck()` fetched all active users and deactivated every account past the age threshold without excluding `SUPERADMIN`. It could disable all control-plane administrators if the configured threshold caught them.

**Remediation:** The sweep now excludes `SUPERADMIN` both during candidate selection and atomically during its `updateMany` write. The role is reevaluated at update time to guard against promotions during the sweep. Only successfully deactivated accounts get session revocation and notification counts. The pure decision policy rejects invalid timestamps. This does not change deliberate superadmin deactivation or recovery routes.

### Tests and limits

- `tests/security/security-network-policy.test.ts` verifies spoofed forwarding-header data cannot override Fastify-resolved IPs and private/reserved IPs cannot be geo-enriched.
- `tests/security/stale-account-policy.test.ts` verifies superadmin protection, ordinary-user inactivity handling and invalid date rejection.
- `tests/security/security-boundaries-contract.test.mjs` verifies integration with real telemetry and write-path guards.
- All new tests are wired to `npm run check:security` within the existing isolated CI script.

**Verification is pending**: source inspection/wiring checks have passed, but there are no successful changed-commit Node 24 full-suite or physical MFA results. Do not set `TRUST_EDGE_GEO_HEADERS=true` until the proxy-header contract has been independently verified in the target environment.

## Production SMTP transport hardening (2026-11-05, third iteration)

**Verified risk:** The admin email settings schema exposed `smtpRequireTls` and `smtpRejectUnauthorized` flags. While both default to safe values in Prisma (`true`), previously the runtime accepted `false` for both. Such settings could permit cleartext SMTP or skip server certificate verification.

**Draft change:** `src/services/smtpTlsPolicy.ts` refuses these insecure combinations whenever `NODE_ENV=production`. Implicit TLS (e.g. port 465) and mandatory STARTTLS (e.g. port 587) remain supported if the remote certificate is verified. Test/local environments may use isolated SMTP fixtures without external credentials. The rule runs when opening the actual SMTP transport, and when saving production TLS-setting changes.

**Compatibility caution:** If a production SMTP provider depends on a self-signed certificate or currently has TLS-verification flags disabled, this change will prevent outbound SMTP until a valid trust chain or approved provider configuration is installed. Review SMTP settings and verify a **non-production test mail** before merging. No production SMTP settings were modified in this draft.

**Coverage:** `tests/security/smtp-tls-policy.test.ts` plus the source-integration contract have been added to `check:security`; full npm/Docker execution on the changed branch is still pending.

## Source audit coverage correction and retry hardening (2026-11-05)

The user supplied the full 577-page local scanner export (schema 4), confirming five original failed chunks:

| Failed chunk | Actual source type | Current disposition |
|---|---|---|
| `frontend/src/enterprise.css:1395-1521` | Stylesheet, malformed Ollama output (ValueError) | **Still requires successful rescanning.** Retry prompt now provides bounded validation feedback rather than resending the same deterministic prompt. |
| `src/services/sourceAdapter.ts:1-128` | Critical HTTPS/SQL ingestion adapter, malformed output (ValueError) | **Still requires successful rescanning and independent review.** Retry prompt improved. |
| `tests/fixtures/mono_black.json:1` | 300x100 RGBA image encoded as one-line Base64 JSON | Explicitly excluded as validated binary-equivalent fixture. |
| `tests/fixtures/navy_gold_aa.json:1` | 300x100 RGBA image encoded as one-line Base64 JSON | Explicitly excluded as validated binary-equivalent fixture. |
| `tests/fixtures/pastel_mint.json:1` | 300x100 RGBA image encoded as one-line Base64 JSON | Explicitly excluded as validated binary-equivalent fixture. |

`is_encoded_raster_fixture` checks the exact `{w,h,data}` object shape, integer pixel dimensions, valid Base64 and exact RGBA byte count (`width*height*4`). It applies **only** to `tests/fixtures/*.json`. Ordinary JSON source and suspicious JSON with extra keys remain reviewable. Tests document this separation.

The old twelve exclusions from the original report are `.env.example` (key-material policy), `docs/Optimise_Integration_Spec_v2.docx` (binary document) and ten `public/*` images/icons (binary assets). None of those files was presented as scanned source code; they require separate artifact/document handling if relevant to an independent release review.

**Release-gate defect corrected:** Previously the scanner could report `complete=true` after `MAX_FILES` excluded source, after a text-size cap, or after a path could not be read. The scanner now exposes `scope_gaps`, fails completion for `file_limit`, `exceeds_max_text_bytes`, `unreadable_or_non_utf8` and `not_regular_file`, and returns exit code 2. The self-hosted workflow independently checks that `scope_gaps` is an empty array.

Offline tests cover both incomplete-scope rejection and justified binary/image exclusions. **These new tests have not yet passed on the actual self-hosted Node 24/Docker runner.** The previous schema-4 PDF still describes the old scan and must not be used to claim current branch coverage.

Do not upload raw unredacted reports, source credentials or external SMTP/Slack secrets to public PRs. The new scan must be run against the reviewed branch with a local Ollama model and synthetic test environment only.

## Source HTTPS DNS-rebinding boundary (2026-11-05, fifth iteration)

**Verified implementation problem:** `src/services/sourceAdapter.ts` previously called `assertSafeApiBaseUrl` to resolve and reject unsafe IPs, then used an independent global `fetch(url, ...)` call. An attacker controlling the domain's DNS could answer with a public IP during validation and a blocked internal IP during the actual connection.

**Draft fix:** `src/services/pinnedSourceHttps.ts` performs a fresh all-address DNS lookup, rejects the entire answer set if any IP is invalid, reserved, private, loopback, mapped or otherwise blocked, and passes the already-vetted addresses to Node's native `https.request` via an explicit lookup callback. This binds DNS approval to the actual TLS socket. The URL remains the original hostname so standard TLS hostname/SNI verification is preserved (`rejectUnauthorized: true`). Each page receives a new unpooled connection (`agent: false`), no redirects are followed, aborted requests retain the 60-second deadline, and the existing `readSourceJson` 8 MiB response budget is reused.

The API adapter now calls `readPinnedSourceApiJson(url, token)` for every page and retains the existing URL/allowed-host preflight. The new transport also refuses content encoding other than identity rather than risking compressed response expansion beyond the byte budget.

**Testing:**
- `tests/pinned-source-https.test.ts`: all DNS answers public, mixed public/private rebinding, hostname pinning, family mismatch, direct IP literals, invalid URL schemes and credential-bearing URLs.
- `tests/security/pinned-source-transport-contract.test.mjs`: the actual adapter must use this pinned transport, reject unpinned `fetch`, and preserve TLS/certificate, redirect and size limits.
- Both tests run in `npm run check:source-sync-safety` within isolated self-hosted Docker CI.

**Preliminary execution:** The new transport module passed an isolated **Node 22 TypeScript strict-check** and a smoke test with a synthetic DNS resolver. The full target application requires **Node 24** and its full build, integration, source API compatibility and CI tests are **not yet verified**. No real source API was contacted. The new transport intentionally only supports uncompressed bounded JSON over HTTPS/1.1, does not use HTTP proxies or connection pools and rejects HTTPS redirects; test against the actual source provider in staging before deployment.

**Residual:** SQL connectors have separate network and TLS policies, and should be reviewed independently. Network-level outbound allowlists are still recommended as additional defense. Source destination address pinning removes the specific HTTP DNS lookup/connect race, not every possible SSRF variant.

## CSV export and spreadsheet formula handling (2026-11-05, sixth iteration)

**Source-confirmed issue:** `src/services/exportService.ts` used a local `csvEscape` implementation that only quoted CSV delimiters and newlines. Administrative exports (audit/user/security data), imported batch row exports and template CSV examples could contain attacker-influenced strings beginning with spreadsheet formula operators (`=`, `+`, `-`, `@`). The previous exporter also did not quote carriage-return characters.

**Draft remediation:** Shared `src/services/csvSafety.ts` now prefixes a literal apostrophe for text values whose first significant character is a formula operator after spaces/control/invisible prefixes; properly quotes commas, double quotes, CR and LF; and preserves typed numeric cells (including negative numbers). `exportService.toCsv` and `templateGenerator.csvTemplate` use the same encoder. Fixed headers and data values use the shared helper, rather than one-off duplicated logic.

**Compatibility:** Security-safe CSV exports deliberately modify suspicious text cells with a leading apostrophe so that spreadsheet applications treat them as text. Automated round-trip consumers that previously expected byte-identical raw data must be reviewed before rollout. This is a presentation/export safeguard, not a replacement for server-side CSV import validation. The XLSX template generator remains separate and should be assessed independently against string/formula cell types.

**Tests:** `tests/security/csv-safety.test.ts` covers leading formula characters, spaces/tab/CR/LF/Unicode prefixes, carriage-return quoting, quoted text, typed numerics, dates and object JSON. `tests/security/csv-safety-contract.test.mjs` asserts adoption by both CSV output paths. Both are wired to `npm run check:security`.

**Executed:** isolated strict TypeScript compilation and 16 synthetic CSV assertions passed on Node 22. **Not yet run:** full project build/Node 24, production export format compatibility or self-hosted Docker suite.

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
