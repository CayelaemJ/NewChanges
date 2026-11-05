// Disposable CI-only verification of atomic, one-time password setup tokens.
// NEVER run against live, staging, paid, or remotely hosted PostgreSQL.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const FIXTURE_DB = "postgresql://ci_fixture:ci_fixture@127.0.0.1:5432/newchanges_ci";
assert.equal(process.env.CI, "true", "CI-only approval required");
assert.equal(process.env.CI_RLS_PROBE_APPROVED, "CI_DISPOSABLE_ONLY", "Disposable DB proof required");
assert.equal(process.env.DATABASE_URL, FIXTURE_DB, "Refusing non-disposable database");
const { prisma } = await import("../../dist/services/database.js");
const { completeSetup, resetPassword } = await import("../../dist/services/userService.js");
const tokenDigest = value => createHash("sha256").update(value).digest("hex");
const nowPlus = ms => new Date(Date.now() + ms);
const fixtures = [];

try {
  const createFixture = async (expiresAt = nowPlus(60 * 60 * 1000)) => {
    const token = randomBytes(32).toString("hex");
    const user = await prisma.user.create({
      data: {
        email: "ci-reset-" + randomUUID() + "@example.invalid",
        name: "Synthetic CI password reset fixture",
        role: "VIEWER",
        active: true,
        setupToken: tokenDigest(token),
        setupExpires: expiresAt,
      },
    });
    fixtures.push(user.id);
    return { token, userId: user.id };
  };
  const createSession = async (userId, elevated = false) => prisma.session.create({
    data: {
      userId,
      token: tokenDigest(randomBytes(32).toString("hex")),
      expiresAt: nowPlus(7 * 864e5),
      ...(elevated ? { mfaVerifiedAt: new Date(), mfaMethod: "PASSKEY" } : {}),
    },
  });

  // Two simultaneous consumers of the SAME token must not both succeed.
  const shared = await createFixture();
  const oldSession = await createSession(shared.userId);
  const oldMfaSession = await createSession(shared.userId, true);
  const raced = await Promise.allSettled([
    completeSetup(shared.token, "AcceptedPassword123"),
    completeSetup(shared.token, "RejectedPassword456"),
  ]);
  assert.equal(raced.filter(x => x.status === "fulfilled").length, 1,
    "One-time setup token must have exactly one successful consumer");
  assert.equal(raced.filter(x => x.status === "rejected").length, 1,
    "Concurrent replay must be rejected");
  const account = await prisma.user.findUniqueOrThrow({ where: { id: shared.userId } });
  assert.equal(account.setupToken, null);
  assert.equal(account.setupExpires, null);
  assert.ok(account.passwordHash, "Password must be set after exactly one claim");
  for (const sessionId of [oldSession.id, oldMfaSession.id]) {
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    assert.ok(session.endedAt && session.revokedAt,
      "Old password and MFA sessions must be revoked by the same transaction");
  }
  await assert.rejects(completeSetup(shared.token, "AnotherPassword789"),
    /this setup link is invalid or has expired/);
  console.log("[password-reset] PASS concurrent single-consumer and MFA session revocation");

  // Expired tokens must not modify an account or revoke an unrelated session.
  const expired = await createFixture(nowPlus(-60_000));
  const expiredSession = await createSession(expired.userId);
  await assert.rejects(completeSetup(expired.token, "ExpiredPassword123"),
    /this setup link is invalid or has expired/);
  const notChanged = await prisma.user.findUniqueOrThrow({ where: { id: expired.userId } });
  assert.equal(notChanged.passwordHash, null);
  assert.ok(notChanged.setupToken, "Rejected token must not be consumed");
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: expiredSession.id } })).endedAt, null);
  console.log("[password-reset] PASS expired token causes no account/session mutation");

  // Admin-issued password changes must also revoke sessions atomically.
  const admin = await createFixture();
  const adminSession = await createSession(admin.userId);
  await resetPassword(admin.userId, "AdminAssigned123");
  const afterAdmin = await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } });
  assert.ok(afterAdmin.passwordHash);
  assert.equal(afterAdmin.setupToken, null);
  assert.ok((await prisma.session.findUniqueOrThrow({ where: { id: adminSession.id } })).endedAt);
  console.log("[password-reset] PASS admin password reset revokes existing sessions");
} finally {
  if (fixtures.length) await prisma.user.deleteMany({ where: { id: { in: fixtures } } });
  await prisma.$disconnect();
}
