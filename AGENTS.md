# Security rules for human and AI contributors

Mandatory on every change:
- Never hardcode or commit secrets, database URLs, credentials, access tokens, or personal data. Rotate suspected exposed secrets using the issuing provider, verify dependent applications, then revoke old secrets.
- Authenticate and authorize on the server for every protected operation, including per-record ownership and tenant isolation. Never trust a client-provided role, tenant ID or user ID.
- Validate and bound request payloads, uploads and outputs; use parameterized SQL, safe output encoding and secure cookies/CSRF defenses.
- Protect login, signup, reset, exports, uploads, AI and expensive APIs with measurable rate limits; distributed deployments need distributed limiting, correct proxy trust and regression tests.
- Treat AI responses, documents, retrieval, generated SQL and tool requests as untrusted. Sandbox tools and require human approval for high-impact actions.
- Apply least privilege, encryption in transit, secure database roles, privacy by design and tested backup recovery; protect children and applicants' personal information.
- Scan dependencies, secrets, containers and IaC where relevant. Do not equate a configured check to a passed check.
- Add negative tests for unauthorized access, tenant crossing, injection and abusive requests with every security-sensitive feature.
- Use isolated branches and focused PRs; record executed tests, failures and skips. Never merge failing security checks or bypass branch protections.
- Do not run destructive tests or unapproved infrastructure/database changes in production.
- Escalate suspected exposures privately without copying sensitive values into tickets. Preserve logs, contain safely and verify remediation.
- A scanner finding no issues is not proof of security. Record residual risks and verification evidence.

Follow repository-specific SECURITY.md and existing stricter requirements where present.
