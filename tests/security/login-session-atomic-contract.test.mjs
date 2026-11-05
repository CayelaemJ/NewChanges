import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../../"+path,import.meta.url), "utf8");
const auth = read("src/services/authService.ts");
const replay = read("scripts/ci/password-token-replay-ci.mjs");
const runner = read("scripts/ci/run-docker-ci-suite.sh");

test("session creation takes a user-row lock and revalidates active state and password hash",()=>{
  const start = auth.indexOf("export async function createSession(");
  const end = auth.indexOf("export async function resolveSession(", start);
  assert.ok(start>=0 && end>start);
  const create=auth.slice(start,end);
  assert.match(create,/return prisma\.\$transaction\(async tx =>/);
  assert.match(create,/FROM "User"/);
  assert.match(create,/AND "active" = true/);
  assert.match(create,/FOR UPDATE/);
  assert.match(create,/accounts\[0\]\.passwordHash !== expectedPasswordHash/);
  assert.match(create,/await tx\.session\.create\(/);
  assert.doesNotMatch(create,/await prisma\.session\.create\(/);
});

test("legacy credential upgrade cannot overwrite concurrent password changes",()=>{
  const login=auth.slice(auth.indexOf("export async function login("));
  assert.match(login,/const upgraded = await prisma\.user\.updateMany\(/);
  assert.match(login,/where: \{ id: user\.id, active: true, passwordHash: user\.passwordHash \}/);
  assert.match(login,/if \(upgraded\.count !== 1\) return null/);
  assert.match(login,/context, expectedPasswordHash/);
  assert.match(login,/Credentials changed during sign-in/);
});

test("disposable PostgreSQL suite exercises physical row locks and old-password denial",()=>{
  assert.match(runner,/run node scripts\/ci\/password-token-replay-ci\.mjs/);
  assert.match(replay,/assert\.equal\(process\.env\.DATABASE_URL, FIXTURE_DB/);
  assert.match(replay,/pendingDisabledLogin = Promise\.allSettled/);
  assert.match(replay,/pendingOldPassword = Promise\.allSettled/);
  assert.match(replay,/password-change race rejects old password sessions/);
  assert.match(replay,/legacy password upgrade uses guarded session creation/);
});
