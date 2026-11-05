import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const users = read("src/services/userService.ts");
const server = read("src/server.ts");
const suite = read("scripts/ci/run-docker-ci-suite.sh");
const dbTest = read("scripts/ci/admin-permission-atomic-ci.mjs");
const start = users.indexOf("export async function updateUser(");
const end = users.indexOf("// self-service: a user disables", start);
const update = users.slice(start, end);

test("all role, employer-link and session authorization changes share one transaction", () => {
  assert.ok(start >= 0 && end > start);
  assert.match(update, /return prisma\.\$transaction\(async tx =>/);
  assert.match(update, /await tx\.user\.updateMany\(/);
  assert.match(update, /await tx\.userEmployer\.deleteMany\(/);
  assert.match(update, /await tx\.userEmployer\.createMany\(/);
  assert.match(update, /await tx\.session\.updateMany\(/);
  assert.match(update, /if \(updated\.count !== 1\) throw/);
  assert.doesNotMatch(update, /await prisma\.userEmployer\./);
  assert.doesNotMatch(update, /await destroyAllSessionsForUser\(userId\)/);
});

test("superadmin protection is enforced in database update and actual route", () => {
  assert.match(update, /options\.forbidSuperadminTarget \? \{ role: \{ not: "SUPERADMIN"/);
  assert.match(server, /updateUser\(req\.params\.id, body, \{ forbidSuperadminTarget: admin\.role !== "SUPERADMIN" \}\)/);
  assert.match(update, /if \(existing\.length !== requested\.length\)/);
  assert.match(update, /if \(accessChanged\) \{/);
});

test("full Docker CI runs real disposable DB authorization rollback regression", () => {
  assert.match(suite, /run node scripts\/ci\/admin-permission-atomic-ci\.mjs/);
  assert.match(dbTest, /assert\.equal\(process\.env\.DATABASE_URL, DB/);
  assert.match(dbTest, /CI_RLS_PROBE_APPROVED/);
  assert.match(dbTest, /await assert\.rejects\(updateUser\(superadmin/);
  assert.match(dbTest, /Invalid employer references must NEVER wipe existing grants/);
});

test("password-reset and hard-delete routes enforce privileged-target guards at write time", () => {
  assert.match(server, /resetPassword\(req\.params\.id, String\(req\.body\?\.password \?\? ""\), \{ forbidSuperadminTarget: admin\.role !== "SUPERADMIN" \}\)/);
  assert.match(server, /deleteUserPermanently\(req\.params\.id, \{ forbidSuperadminTarget: admin\.role !== "SUPERADMIN" \}\)/);

  const password = users.slice(users.indexOf("export async function resetPassword("),
    users.indexOf("// set-password flow"));
  const remove = users.slice(users.indexOf("export async function deleteUserPermanently("),
    users.indexOf("export async function resetPassword("));
  assert.match(password, /await tx\.user\.updateMany\(/);
  assert.match(password, /options\.forbidSuperadminTarget \? \{ role: \{ not: "SUPERADMIN"/);
  assert.match(password, /if \(updated\.count !== 1\) throw/);
  assert.match(remove, /await prisma\.user\.deleteMany\(/);
  assert.match(remove, /active: false/);
  assert.match(remove, /options\.forbidSuperadminTarget \? \{ role: \{ not: "SUPERADMIN"/);
  assert.match(dbTest, /superadmin password reset is privileged and transactional/);
  assert.match(dbTest, /retired superadmin deletion requires privileged actor/);
});

test("all superadmin role retirements serialize and preserve the final active control-plane account", () => {
  const policy = read("src/services/superadminAvailabilityPolicy.ts");
  assert.match(update, /SELECT 1 AS locked FROM pg_advisory_xact_lock\(761231, 20261105\)/);
  assert.match(update, /await tx\.user\.count\(\{/);
  assert.match(update, /assertSuperadminRetirementAllowed\(current, patch, activeSuperadmins\)/);
  assert.match(policy, /activeSuperadminCount <= 1/);
  assert.match(dbTest, /last active superadministrator cannot be retired/);
  assert.match(dbTest, /privileged retirement preserves another active superadministrator/);
  assert.match(dbTest, /Promise\.allSettled/);
  assert.match(dbTest, /concurrent superadministrator retirements preserve the last account/);
  assert.match(dbTest, /assert\.equal\(currentSuperadmins, 1,/);
  assert.match(dbTest, /assert\.equal\(beforeRace, 1,/);
  assert.doesNotMatch(dbTest, /last-superadmin (?:DB check|concurrency scenario) skipped/);
});

test("superadmin self-deactivation is denied at HTTP and database mutation boundaries", () => {
  assert.match(server, /if \(user\.role === "SUPERADMIN"\)/);
  const self = users.slice(users.indexOf("export async function deactivateSelf("),
    users.indexOf("export async function listRevokedUsers("));
  assert.match(self, /return prisma\.\$transaction\(async tx =>|const user = await prisma\.\$transaction\(async tx =>/);
  assert.match(self, /await tx\.user\.updateMany\(/);
  assert.match(self, /role: \{ not: "SUPERADMIN" \}/);
  assert.match(self, /await tx\.session\.updateMany\(/);
  assert.match(dbTest, /superadministrator cannot self-deactivate/);
});
