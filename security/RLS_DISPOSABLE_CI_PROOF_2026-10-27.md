# Synthetic RLS proof on disposable CircleCI PostgreSQL

This is a CI-only negative-authorization test, **not** a production RLS migration. It proves PostgreSQL row-level-policy mechanics for direct employer-keyed rows with a role that does not bypass RLS.

## Guardrails
- Requires `CI_RLS_PROBE_APPROVED=CI_DISPOSABLE_ONLY`, a loopback PostgreSQL host, database `newchanges_ci` and user `ci_fixture`.
- Creates synthetic employers/employees and a NOLOGIN/non-bypass role **within a transaction** that is always rolled back. No existing NewChanges tables are altered and no production connection is allowed.
- Verifies no tenant context returns no rows; employer A cannot see or edit B; cross-tenant INSERT or UPDATE fails; context set to B sees only B.
- The simulated application role is used through `SET LOCAL ROLE`, not an owner/BYPASSRLS role.
- The SQL session custom setting must be established only by authenticated, trusted server code inside a transaction. Do not accept request-provided tenant identifiers or keep state across pooled sessions.

## Work still required
This test is a proof of mechanics, not proof that real NewChanges data is isolated. Issue #199 remains open. Classify the 57 public tables, implement real policies for indirect references and admin functions, use non-bypass runtime credentials, use pooled transaction-local tenant context, and run real negative end-to-end tests in an isolated Neon branch. Rotate old owner credentials after a verified cutover, never before.
