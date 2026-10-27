import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTenantIsolation } from "./tenant-isolation-audit.mjs";

test("flags a bypass-RLS runtime role and unprotected scoped tables", () => {
  const result = assessTenantIsolation([
    { table_name: "Employee", rls_enabled: false, rls_forced: false, scope_columns: ["employerId"] },
    { table_name: "Journey", rls_enabled: true, rls_forced: false, scope_columns: ["platformUserId"] },
    { table_name: "ComplianceVendor", rls_enabled: false, rls_forced: false, scope_columns: [] },
  ], { rolbypassrls: true });
  assert.equal(result.publicTables, 3);
  assert.equal(result.candidateScopedTables, 2);
  assert.deepEqual(result.candidateScopedWithoutRls, ["Employee"]);
  assert.deepEqual(result.candidateScopedNotForced, ["Journey"]);
  assert.equal(result.runtimeRoleBypassesRls, true);
  assert.equal(result.releaseGatePassed, false);
});

test("passes a scoped RLS-enabled schema accessed through a non-bypass runtime role", () => {
  const result = assessTenantIsolation([
    { table_name: "Employee", rls_enabled: true, rls_forced: true, scope_columns: ["employerId"] },
    { table_name: "Journey", rls_enabled: true, rls_forced: true, scope_columns: ["platformUserId"] },
    { table_name: "SystemEmailConfig", rls_enabled: false, rls_forced: false, scope_columns: [] },
  ], { rolbypassrls: false });
  assert.equal(result.releaseGatePassed, true);
  assert.deepEqual(result.candidateScopedWithoutRls, []);
  assert.equal(result.rlsEnabled, 2);
});

test("fails closed when execution role cannot be established", () => {
  assert.equal(assessTenantIsolation([], null).releaseGatePassed, false);
});
