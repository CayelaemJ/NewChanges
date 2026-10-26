# Rate-limiting verification and deployment gates (26 October 2026)

Status: **PARTIALLY REMEDIATED — NOT CERTIFIED**.

## Evidence from main application source
- The Fastify `onRequest` hook applies a global per-client budget of 240/minute.
- Authentication login, forgotten password and set-password routes have a 12/10-minute in-process budget.
- Contact, bulk ingestion, and reporting routes have additional scoped budgets.
- The rate limiter is still **process-local**. Distributing traffic across multiple app instances or restarts can reset the effective limit; one-per-instance tests do not prove production protection.
- This change bounds rate-limit bucket state to 100,000 keys and rejects previously unseen keys while at capacity. It preserves existing rates and Retry-After behaviour. Saturation can temporarily reject legitimate new visitors; monitor HTTP 429 and memory use.

## Production release gate — unresolved
1. Confirm the actual Render/Railway deployment topology and whether the app uses multiple replicas, workers or horizontal autoscaling. **REQUIRES OPERATIONS INPUT**.
2. If more than one instance handles requests, implement a shared atomic limiter (e.g., trusted ingress/WAF or Redis-backed central counter) and verify reset and retry semantics with concurrent requests across instances.
3. Configure trusted proxy IP extraction only for controlled ingress; reject client-supplied identity headers where untrusted.
4. Stage-test legitimate login, failed login, password reset, contact, reporting and upload endpoints. Test limits by endpoint, user/IP and tenant, and verify no easy route alias bypass.
5. Verify monitoring and alert thresholds for sustained 429s, credential stuffing and limiter backend failures.
6. Record staging test evidence and deployment owner sign-off before treating rate-limiting coverage as verified.

## Regression coverage added
- Saturation cannot grow the in-memory key collection indefinitely.
- Existing keys continue to work at capacity.
- Expired keys are freed and capacity can be reused.
- Per-key Retry-After stays bounded and invalid configuration fails.

## Governance scope
This technical change does not establish POPIA, PAIA, ECTA, CPA or Cybercrimes Act compliance. Legal processing roles, Information Officer registration, actual vendor/transfer terms and incident procedures require independent evidence and accountable review.
