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
