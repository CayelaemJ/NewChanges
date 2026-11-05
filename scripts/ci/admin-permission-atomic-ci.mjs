// Real PostgreSQL transaction checks for admin authorization updates.
// This test is STRICTLY for the isolated, disposable localhost CI database.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const DB = "postgresql://ci_fixture:ci_fixture@127.0.0.1:5432/newchanges_ci";
assert.equal(process.env.CI, "true", "Must run in local CI");
assert.equal(process.env.CI_RLS_PROBE_APPROVED, "CI_DISPOSABLE_ONLY");
assert.equal(process.env.DATABASE_URL, DB, "Refusing access to anything but disposable local CI PostgreSQL");

const { prisma } = await import("../../dist/services/database.js");
const { updateUser, resetPassword, deleteUserPermanently, deactivateSelf } = await import("../../dist/services/userService.js");
const digest = token => createHash("sha256").update(token).digest("hex");
const employerIds = [];
const userIds = [];

const makeEmployer = async () => {
  const row = await prisma.employer.create({
    data: { id: "SYNTH-CI-" + randomUUID(), name: "Synthetic authorization fixture " + randomUUID() },
  });
  employerIds.push(row.id);
  return row.id;
};
const makeUser = async (role = "VIEWER", employerId) => {
  const user = await prisma.user.create({
    data: {
      email: "synthetic-permission-" + randomUUID() + "@example.invalid",
      name: "Synthetic permission transaction user",
      role,
      active: true,
      ...(employerId ? { links: { create: [{ employerId }] } } : {}),
    },
  });
  userIds.push(user.id);
  return user.id;
};
const makeSession = async userId => prisma.session.create({
  data: { userId, token: digest(randomBytes(32).toString("hex")),
    expiresAt: new Date(Date.now() + 864e5) },
});
const links = async userId => (await prisma.userEmployer.findMany({
  where: { userId }, select: { employerId: true },
})).map(x => x.employerId).sort();

try {
  const employerA = await makeEmployer();
  const employerB = await makeEmployer();

  const userId = await makeUser("VIEWER", employerA);
  const initialSession = await makeSession(userId);
  const afterGrant = await updateUser(userId, {
    role: "EMPLOYER_MANAGER", employerIds: [employerB],
  }, { forbidSuperadminTarget: true });
  assert.equal(afterGrant.role, "EMPLOYER_MANAGER");
  assert.deepEqual(afterGrant.employers, [employerB]);
  assert.deepEqual(await links(userId), [employerB]);
  const revoked = await prisma.session.findUniqueOrThrow({ where: { id: initialSession.id } });
  assert.ok(revoked.endedAt && revoked.revokedAt,
    "The old session must be revoked in the same transaction as permission changes");
  console.log("[admin-access] PASS atomic role/employer updates revoke old sessions");

  // Invalid employer references must NEVER wipe existing grants or change the
  // role, and a rejected transaction must leave the live session untouched.
  const preservedSession = await makeSession(userId);
  await assert.rejects(updateUser(userId, {
    role: "PORTFOLIO_MANAGER", employerIds: [employerA, "synthetic-nonexistent-id"],
  }, { forbidSuperadminTarget: true }), /employer IDs do not exist/);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).role,
    "EMPLOYER_MANAGER");
  assert.deepEqual(await links(userId), [employerB]);
  assert.equal((await prisma.session.findUniqueOrThrow({
    where: { id: preservedSession.id },
  })).endedAt, null);
  console.log("[admin-access] PASS invalid references roll back without permission changes");

  const superadmin = await makeUser("SUPERADMIN", employerA);
  const superadminSession = await makeSession(superadmin);

  // A superadministrator must never deactivate their own control-plane
  // access through the generic user endpoint, even with an authenticated
  // session. The denial must not revoke that session.
  await assert.rejects(deactivateSelf(superadmin, "synthetic self retirement"),
    /cannot self-deactivate/);
  assert.equal((await prisma.user.findUniqueOrThrow({
    where: { id: superadmin },
  })).active, true);
  assert.equal((await prisma.session.findUniqueOrThrow({
    where: { id: superadminSession.id },
  })).endedAt, null);
  console.log("[admin-access] PASS superadministrator cannot self-deactivate");

  // Fail when disposable CI fixtures are contaminated with extra admins;
  // security release gates must never report success after skipping the case.
  const currentSuperadmins = await prisma.user.count({
    where: { active: true, role: "SUPERADMIN" },
  });
  assert.equal(currentSuperadmins, 1,
    "Disposable CI fixture must contain exactly one active SUPERADMIN here; do not silently skip this release gate");
  await assert.rejects(updateUser(superadmin, { active: false }, {
    forbidSuperadminTarget: false,
  }), /last active superadministrator/);
  await assert.rejects(updateUser(superadmin, { role: "ADMIN" }, {
    forbidSuperadminTarget: false,
  }), /last active superadministrator/);
  console.log("[admin-access] PASS last active superadministrator cannot be retired");

  // With at least two active superadmins, privileged retirement is allowed,
  // while preserving the originally active administrator above.
  const additionalSuperadmin = await makeUser("SUPERADMIN");
  await updateUser(additionalSuperadmin, { active: false }, { forbidSuperadminTarget: false });
  assert.equal((await prisma.user.findUniqueOrThrow({
    where: { id: additionalSuperadmin },
  })).active, false);
  console.log("[admin-access] PASS privileged retirement preserves another active superadministrator");
  await assert.rejects(updateUser(superadmin, {
    role: "VIEWER", active: false, employerIds: [employerB],
  }, { forbidSuperadminTarget: true }), /no longer editable/);
  const unchangedAdmin = await prisma.user.findUniqueOrThrow({ where: { id: superadmin } });
  assert.equal(unchangedAdmin.role, "SUPERADMIN");
  assert.equal(unchangedAdmin.active, true);
  assert.deepEqual(await links(superadmin), [employerA]);
  assert.equal((await prisma.session.findUniqueOrThrow({
    where: { id: superadminSession.id },
  })).endedAt, null);
  console.log("[admin-access] PASS ordinary admins cannot change superadmin targets at write boundary");

  // A genuinely privileged caller can still update the target legitimately.
  await updateUser(superadmin, { name: "Authorized superadmin update" }, {
    forbidSuperadminTarget: false,
  });
  assert.equal((await prisma.user.findUniqueOrThrow({
    where: { id: superadmin },
  })).name, "Authorized superadmin update");
  console.log("[admin-access] PASS privileged admin updates remain functional");

  // Ordinary administrators must not be able to reset passwords on the
  // superadmin control plane, regardless of the submitted user ID.
  await assert.rejects(
    resetPassword(superadmin, "OrdinaryAdminAttempt123", { forbidSuperadminTarget: true }),
    /no longer editable/,
  );
  assert.equal((await prisma.user.findUniqueOrThrow({
    where: { id: superadmin },
  })).passwordHash, null);
  assert.equal((await prisma.session.findUniqueOrThrow({
    where: { id: superadminSession.id },
  })).endedAt, null);
  await resetPassword(superadmin, "PrivilegedAdminReset123", {
    forbidSuperadminTarget: false,
  });
  assert.ok((await prisma.user.findUniqueOrThrow({
    where: { id: superadmin },
  })).passwordHash);
  assert.ok((await prisma.session.findUniqueOrThrow({
    where: { id: superadminSession.id },
  })).endedAt);
  console.log("[admin-access] PASS superadmin password reset is privileged and transactional");

  const retiredSuperadmin = await makeUser("SUPERADMIN");
  await prisma.user.update({
    where: { id: retiredSuperadmin },
    data: { active: false },
  });
  await assert.rejects(
    deleteUserPermanently(retiredSuperadmin, { forbidSuperadminTarget: true }),
    /deactivated and editable/,
  );
  assert.ok(await prisma.user.findUnique({ where: { id: retiredSuperadmin } }));
  await deleteUserPermanently(retiredSuperadmin, { forbidSuperadminTarget: false });
  assert.equal(await prisma.user.findUnique({ where: { id: retiredSuperadmin } }), null);
  console.log("[admin-access] PASS retired superadmin deletion requires privileged actor");

  // Race two synthetic retirements. The transaction advisory lock must
  // let exactly one succeed; fail CI rather than skipping when contaminated.
  const beforeRace = await prisma.user.count({
    where: { role: "SUPERADMIN", active: true },
  });
  assert.equal(beforeRace, 1, "Disposable CI fixture must have exactly one active SUPERADMIN before concurrency test");
  const other = await makeUser("SUPERADMIN");
  const outcomes = await Promise.allSettled([
    updateUser(superadmin, { active: false }, { forbidSuperadminTarget: false }),
    updateUser(other, { active: false }, { forbidSuperadminTarget: false }),
  ]);
  assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1,
    "Concurrent retirements must allow only one successful operation");
  assert.equal(outcomes.filter(x => x.status === "rejected").length, 1,
    "The second final-superadmin retirement must be rejected");
  assert.equal(await prisma.user.count({
    where: { role: "SUPERADMIN", active: true },
  }), 1, "At least one active superadministrator must survive the race");
  console.log("[admin-access] PASS concurrent superadministrator retirements preserve the last account");
} finally {
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (employerIds.length) await prisma.employer.deleteMany({ where: { id: { in: employerIds } } });
  await prisma.$disconnect();
}
