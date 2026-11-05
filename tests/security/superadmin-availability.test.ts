import test from "node:test";
import assert from "node:assert/strict";
import { removesActiveSuperadmin, assertSuperadminRetirementAllowed } from "../../src/services/superadminAvailabilityPolicy.js";

test("last active superadministrator cannot be demoted or disabled", () => {
  const original = { role: "SUPERADMIN", active: true };
  for (const patch of [
    { active: false },
    { role: "ADMIN" },
    { role: "VIEWER", active: false },
  ]) {
    assert.equal(removesActiveSuperadmin(original, patch), true);
    assert.throws(() => assertSuperadminRetirementAllowed(original, patch, 1),
      /last active superadministrator/);
    assert.doesNotThrow(() => assertSuperadminRetirementAllowed(original, patch, 2));
  }
});

test("safe edits and promotions leave superadministrator availability unchanged", () => {
  for (const [current, patch] of [
    [{ role: "SUPERADMIN", active: true }, { role: "SUPERADMIN" }],
    [{ role: "SUPERADMIN", active: true }, { active: true }],
    [{ role: "ADMIN", active: true }, { role: "SUPERADMIN" }],
    [{ role: "VIEWER", active: true }, { role: "ADMIN" }],
    [{ role: "SUPERADMIN", active: false }, { role: "VIEWER" }],
  ] as Array<[{ role: string; active: boolean }, { role?: string; active?: boolean }]>) {
    assert.equal(removesActiveSuperadmin(current, patch), false);
    assert.doesNotThrow(() => assertSuperadminRetirementAllowed(current, patch, 0));
  }
});
