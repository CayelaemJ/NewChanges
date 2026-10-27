# NewChanges tenant isolation: release gate — 27 October 2026

**Status: OPEN; RLS is NOT enabled and this commit performs no database mutations.**

## Evidence (read-only Neon catalog, 27 October 2026)
- Production primary `main` and the existing testing-rehearsal branch each contain **57 ordinary public tables**.
- **0/57** have RLS enabled; **0/57** have FORCE RLS.
- Runtime/owner account inspected: `newchanges_owner` has `BYPASSRLS = true`. This role must not serve as the normal application runtime identity for a proposed RLS-backed boundary.
- Direct scope references include `employerId`; other tables only have `employeeId`, `platformUserId`, `userId` or `partnerId`. Global configuration and audit entities must be separately classified. **A column name is not proof of correct tenancy policy.**
- This is a serious defence-in-depth gap, not proof of an actual exploit.

## Read-only audit tool
`TENANT_AUDIT_READ_ONLY=YES DATABASE_URL=<database-URL-in-secret-store> npm run security:tenant-audit`

The tool reads only the PostgreSQL catalog in a `BEGIN READ ONLY` transaction, prints table-level control metadata and returns non-zero while candidate-scoped tables lack RLS or the execution role bypasses it. The tool deliberately does **not** query tenant business records, write a policy, enable RLS or grant privileges. Run only against an authorised isolated branch first. CI runs the pure unit tests, not live database audits.

## Migration and acceptance criteria
1. List and review every one of the 57 tables, identifying global/configuration versus employer-scoped and indirect-dependent records. Review the complete foreign-key graph and admin/import/backup access patterns.
2. Add a separate least-privilege application role with no `BYPASSRLS`, a separate elevated migrator role, and audited GRANTs. Never switch the current production credential until all permissions and app behaviour are proven.
3. Establish authenticated server-derived tenant context, and transaction-scoped context propagation compatible with PgBouncer/Neon pooled connections (no persistent cross-request session `SET`). Design trusted elevated operations explicitly.
4. Author policies for each scoped table. Parent-linked records need join-validated visibility; cross-tenant foreign-key inserts and writes must be denied. Enforce `WITH CHECK`, default-deny missing tenant context, and FORCE RLS where appropriate.
5. On a disposable Neon branch, exercise negative access tests: employer A cannot read, insert, update, delete, infer or elevate employer B's records through joins, APIs, reports, exports, imports, scheduled jobs or admin impersonation.
6. Test legitimate authentication, password resets, global admin operations, source refresh, snapshots, reporting and every existing CI integration after policy activation.
7. Verify backup/restore and rollback; get app owner and security approver sign-off. Only then deploy role/policy migration and rotate production runtime credentials.

**Do not run** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` across all tables in production or reuse a bypass-enabled owner role as application runtime. See GitHub issue #199.
