import test from "node:test";
import assert from "node:assert/strict";
import { reportDeliveryAllowed, type ReportDeliveryOwner } from "../../src/services/reportDeliveryPolicy.js";

const owner = (patch: Partial<ReportDeliveryOwner> = {}): ReportDeliveryOwner => ({
  active: true,
  role: "EMPLOYER_MANAGER",
  email: "owner@example.invalid",
  links: [{ employerId: "employer-a" }],
  ...patch,
});

test("report delivery requires an active owner with current employer access", () => {
  assert.equal(reportDeliveryAllowed(owner(), "employer-a", ["owner@example.invalid"]), true);
  assert.equal(reportDeliveryAllowed(owner({ active: false }), "employer-a", ["owner@example.invalid"]), false);
  assert.equal(reportDeliveryAllowed(owner({ links: [] }), "employer-a", ["owner@example.invalid"]), false);
  assert.equal(reportDeliveryAllowed(owner(), "employer-b", ["owner@example.invalid"]), false);
  assert.equal(reportDeliveryAllowed(owner({ role: "UNKNOWN" }), "employer-a", ["owner@example.invalid"]), false);
  assert.equal(reportDeliveryAllowed(null, "employer-a", ["owner@example.invalid"]), false);
});

test("non-admins can deliver only to their current own email address", () => {
  assert.equal(reportDeliveryAllowed(owner(), "employer-a", ["other@example.invalid"]), false);
  assert.equal(reportDeliveryAllowed(owner(), "employer-a", ["owner@example.invalid", "other@example.invalid"]), false);
  assert.equal(reportDeliveryAllowed(owner(), "employer-a", ["OWNER@EXAMPLE.INVALID"]), true);
  assert.equal(reportDeliveryAllowed(owner({ role: "VIEWER" }), "employer-a", ["owner@example.invalid"]), true);
  assert.equal(reportDeliveryAllowed(owner({ role: "PORTFOLIO_MANAGER" }), "employer-a", ["owner@example.invalid"]), true);
});

test("admin external-recipient permissions expire when role is downgraded", () => {
  const external = ["finance@example.invalid", "owner@example.invalid"];
  assert.equal(reportDeliveryAllowed(owner({ role: "ADMIN", links: [] }), "employer-a", external), true);
  assert.equal(reportDeliveryAllowed(owner({ role: "SUPERADMIN", links: [] }), "employer-a", external), true);
  assert.equal(reportDeliveryAllowed(owner({ role: "VIEWER" }), "employer-a", external), false);
  assert.equal(reportDeliveryAllowed(owner({ role: "ADMIN", active: false }), "employer-a", external), false);
});

test("corrupt, missing and excessive recipient lists fail closed", () => {
  const admin = owner({ role: "ADMIN" });
  for (const recipients of [null, {}, [], "owner@example.invalid", [42],
    ["not an email"], ["owner@example.invalid\nBcc: outsider@example.invalid"],
    Array.from({ length: 11 }, (_, i) => `recipient${i}@example.invalid`)]) {
    assert.equal(reportDeliveryAllowed(admin, "employer-a", recipients), false, String(recipients));
  }
});
