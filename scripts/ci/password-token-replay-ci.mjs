// Disposable CI-only verification of atomic, one-time password setup tokens.
// NEVER run against live, staging, paid, or remotely hosted PostgreSQL.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const FIXTURE_DB = "postgresql://ci_fixture:ci_fixture@127.0.0.1:5432/newchanges_ci";
assert.equal(process.env.CI, "true", "CI-only approval required");
assert.equal(process.env.CI_RLS_PROBE_APPROVED, "CI_DISPOSABLE_ONLY", "Disposable DB proof required");
assert.equal(process.env.DATABASE_URL, FIXTURE_DB, "Refusing non-disposable database");
const { prisma } = await import("../../dist/services/database.js");
const { completeSetup, resetPassword, updateUser, deactivateSelf } = await import("../../dist/services/userService.js");
const { createSession, login, hashPassword } = await import("../../dist/services/authService.js");
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

  // A previously issued setup/reset token must never re-enable an account
  // deactivated by its administrator after that token was issued.
  const disabled = await createFixture();
  await prisma.user.update({
    where: { id: disabled.userId },
    data: { active: false, revokedAt: new Date(),
      revokedBy: "synthetic-ci-admin", revokedReason: "CI revocation boundary" },
  });
  await assert.rejects(completeSetup(disabled.token, "CannotReactivate123"),
    /this setup link is invalid or has expired/);
  const stillDisabled = await prisma.user.findUniqueOrThrow({ where: { id: disabled.userId } });
  assert.equal(stillDisabled.active, false);
  assert.equal(stillDisabled.passwordHash, null);
  assert.ok(stillDisabled.setupToken, "A rejected token claim must not update the user");
  console.log("[password-reset] PASS revoked accounts cannot self-reactivate with stale setup links");

  // Normal administrative deactivation must also DESTROY any pending token,
  // so a later administrator reactivation cannot make the old link valid again.
  const adminDisabled = await createFixture();
  await updateUser(adminDisabled.userId, { active: false, revokedReason: "Synthetic CI account revocation" });
  const afterDisable = await prisma.user.findUniqueOrThrow({ where: { id: adminDisabled.userId } });
  assert.equal(afterDisable.active, false);
  assert.equal(afterDisable.setupToken, null);
  assert.equal(afterDisable.setupExpires, null);
  await updateUser(adminDisabled.userId, { active: true });
  await assert.rejects(completeSetup(adminDisabled.token, "CannotReuseReset123"),
    /this setup link is invalid or has expired/);
  console.log("[password-reset] PASS administrator deactivation permanently invalidates prior links");

  // Self-deactivation also clears outstanding password reset tokens.
  const selfDisabled = await createFixture();
  await deactivateSelf(selfDisabled.userId, "Synthetic CI self-deactivation");
  const afterSelfDisable = await prisma.user.findUniqueOrThrow({ where: { id: selfDisabled.userId } });
  assert.equal(afterSelfDisable.setupToken, null);
  assert.equal(afterSelfDisable.setupExpires, null);
  console.log("[password-reset] PASS self-deactivation clears recovery/reset links");

  // Admin-issued password changes must also revoke sessions atomically.
  const admin = await createFixture();
  const adminSession = await createSession(admin.userId);
  await resetPassword(admin.userId, "AdminAssigned123");
  const afterAdmin = await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } });
  assert.ok(afterAdmin.passwordHash);
  assert.equal(afterAdmin.setupToken, null);
  assert.ok((await prisma.session.findUniqueOrThrow({ where: { id: adminSession.id } })).endedAt);
  console.log("[password-reset] PASS admin password reset revokes existing sessions");

  // Simulate a deactivation racing a login that already verified a password.
  // The session insert must WAIT behind the user's row lock and then fail.
  const guarded = await createFixture();
  const initialPasswordHash = hashPassword("OriginalLogin123");
  await prisma.user.update({
    where: { id: guarded.userId },
    data: { passwordHash: initialPasswordHash },
  });
  const activeSession = await createSession(guarded.userId, 7, {}, initialPasswordHash);
  assert.ok(activeSession.sessionId);
  let pendingDisabledLogin;
  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: guarded.userId }, data: { active: false } });
    pendingDisabledLogin = Promise.allSettled([
      createSession(guarded.userId, 7, {}, initialPasswordHash),
    ]);
    await new Promise(resolve => setTimeout(resolve, 40));
  });
  const [disabledLoginResult] = await pendingDisabledLogin;
  assert.equal(disabledLoginResult.status, "rejected");
  assert.match(String(disabledLoginResult.reason), /no longer active/);
  console.log("[password-reset] PASS concurrent deactivation blocks late session creation");

  // A password reset racing session creation must reject the stale verified
  // hash, rather than minting a token accepted after credential replacement.
  const changedHash = hashPassword("ReplacementLogin123");
  let pendingOldPassword;
  await prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id: guarded.userId },
      data: { active: true, passwordHash: changedHash },
    });
    pendingOldPassword = Promise.allSettled([
      createSession(guarded.userId, 7, {}, initialPasswordHash),
    ]);
    await new Promise(resolve => setTimeout(resolve, 40));
  });
  const [oldPasswordResult] = await pendingOldPassword;
  assert.equal(oldPasswordResult.status, "rejected");
  assert.match(String(oldPasswordResult.reason), /Credentials changed during sign-in/);
  const current = await createSession(guarded.userId, 7, {}, changedHash);
  assert.ok(current.sessionId);
  console.log("[password-reset] PASS password-change race rejects old password sessions");

  // The legacy hash upgrade path must remain usable but the stored hash is
  // upgraded conditionally, not overwritten after a concurrent password reset.
  const upgradedUser = await createFixture();
  const oldSalt = randomBytes(16).toString("hex");
  const { scryptSync } = await import("node:crypto");
  const legacyPassword = "LegacyLoginPassword123";
  const legacyHash = oldSalt + ":" +
    scryptSync(legacyPassword, oldSalt, 64).toString("hex");
  await prisma.user.update({
    where: { id: upgradedUser.userId },
    data: { passwordHash: legacyHash },
  });
  const signedIn = await login(
    (await prisma.user.findUniqueOrThrow({ where: { id: upgradedUser.userId } })).email,
    legacyPassword,
  );
  assert.ok(signedIn?.token);
  assert.ok((await prisma.user.findUniqueOrThrow({
    where: { id: upgradedUser.userId },
  })).passwordHash.startsWith("v2$"));
  console.log("[password-reset] PASS legacy password upgrade uses guarded session creation");
} finally {
  if (fixtures.length) await prisma.user.deleteMany({ where: { id: { in: fixtures } } });
  await prisma.$disconnect();
}
