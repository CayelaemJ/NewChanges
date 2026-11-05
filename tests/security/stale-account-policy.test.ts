import test from "node:test";
import assert from "node:assert/strict";
import { shouldAutoDeactivateAccount } from "../../src/services/staleAccountPolicy.js";

const cutoff = new Date("2026-11-01T00:00:00.000Z");
const old = new Date("2026-01-01T00:00:00.000Z");
const fresh = new Date("2026-11-04T00:00:00.000Z");
test("even a long-inactive superadministrator cannot be disabled automatically", () => {
  assert.equal(shouldAutoDeactivateAccount({role:"SUPERADMIN",createdAt:old,sessions:[]},cutoff),false);
  assert.equal(shouldAutoDeactivateAccount({role:"SUPERADMIN",createdAt:old,sessions:[{createdAt:old}]},cutoff),false);
});
test("inactivity policy still applies to ordinary accounts", () => {
  assert.equal(shouldAutoDeactivateAccount({role:"VIEWER",createdAt:old,sessions:[]},cutoff),true);
  assert.equal(shouldAutoDeactivateAccount({role:"EMPLOYER_MANAGER",createdAt:old,sessions:[{createdAt:fresh}]},cutoff),false);
  assert.equal(shouldAutoDeactivateAccount({role:"ADMIN",createdAt:old,sessions:[{createdAt:old}]},cutoff),true);
});
test("bad timestamps fail closed and cannot trigger deactivation", () => {
  assert.equal(shouldAutoDeactivateAccount({role:"VIEWER",createdAt:"invalid date",sessions:[]},cutoff),false);
});
