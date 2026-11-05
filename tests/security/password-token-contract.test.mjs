import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=(path)=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const users=source("src/services/userService.ts");
const suite=source("scripts/ci/run-docker-ci-suite.sh");
const integration=source("scripts/ci/password-token-replay-ci.mjs");

test("password setup token consumption and session invalidation use one transaction",()=>{
  const start=users.indexOf("export async function completeSetup");
  const end=users.indexOf("\nfunction sanitize", start);
  assert.ok(start>0&&end>start);
  const handler=users.slice(start,end);
  assert.match(handler,/await prisma\.\$transaction\(async tx =>/);
  assert.match(handler,/await tx\.user\.updateMany\(/);
  assert.match(handler,/setupExpires: \{ gt: now \}/);
  assert.match(handler,/active: true, \/\/ An old invitation/);
  assert.doesNotMatch(handler,/data: \{ passwordHash, setupToken: null, setupExpires: null, active: true \}/);
  assert.match(handler,/OR: \[\{ setupToken: digest \}, \{ setupToken: token \}\]/);
  assert.match(handler,/if \(used\.count !== 1\) throw invalid\(\)/);
  assert.match(handler,/await tx\.session\.updateMany\(/);
  assert.match(handler,/revokedAt: now/);
  assert.doesNotMatch(handler,/await prisma\.user\.update\(/);
});

test("administrator reset also invalidates sessions in the same database transaction",()=>{
  const start=users.indexOf("export async function resetPassword");
  const end=users.indexOf("// set-password flow",start);
  assert.ok(start>0&&end>start);
  const handler=users.slice(start,end);
  assert.match(handler,/await prisma\.\$transaction\(async tx =>/);
  assert.match(handler,/await tx\.user\.update\(/);
  assert.match(handler,/await tx\.session\.updateMany\(/);
});

test("physical DB replay test runs after schema deployment on isolated CI database",()=>{
  assert.match(suite,/run node scripts\/prisma-upgrade-integration\.mjs\nrun node scripts\/ci\/password-token-replay-ci\.mjs/);
  assert.match(integration,/assert\.equal\(process\.env\.DATABASE_URL, FIXTURE_DB/);
  assert.match(integration,/assert\.equal\(process\.env\.CI_RLS_PROBE_APPROVED, "CI_DISPOSABLE_ONLY"/);
  assert.match(integration,/Promise\.allSettled/);
  assert.match(integration,/adminSession\.id/);
  assert.match(integration,/expired token causes no account\/session mutation/);
  assert.match(integration,/revoked accounts cannot self-reactivate/);
});
