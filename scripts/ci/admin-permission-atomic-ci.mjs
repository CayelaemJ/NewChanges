// Real PostgreSQL transaction checks for admin authorization updates.
// This test is STRICTLY for the isolated, disposable localhost CI database.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const DB = "postgresql://ci_fixture:ci_fixture@127.0.0.1:5432/newchanges_ci";
assert.equal(process.env.CI, "true", "Must run in local CI");
assert.equal(process.env.CI_RLS_PROBE_APPROVED, "CI_DISPOSABLE_ONLY");
assert.equal(process.env.DATABASE_URL, DB, "Refusing access to anything but disposable local CI PostgreSQL");

const { prisma } = await import("../../dist/services/database.js");
const { updateUser } = await import("../../dist/services/userService.js");
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
} finally {
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (employerIds.length) await prisma.employer.deleteMany({ where: { id: { in: employerIds } } });
  await prisma.$disconnect();
}
