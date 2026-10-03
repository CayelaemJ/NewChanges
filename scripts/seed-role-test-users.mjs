import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

if (process.env.ROLE_TEST_SETUP_ENABLED !== "true") {
  console.log("Role test setup disabled.");
  process.exit(0);
}

const prisma = new PrismaClient();

function hashPassword(plain) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  }).toString("hex");
  return `v2$${salt}:${hash}`;
}

const password = process.env.ROLE_TEST_PASSWORD;
if (!password || password.length < 12) {
  throw new Error("ROLE_TEST_PASSWORD must be supplied and at least 12 characters");
}

const accounts = [
  ["role-test-viewer@example.invalid", "ROLE TEST - Viewer", "VIEWER"],
  ["role-test-employer-manager@example.invalid", "ROLE TEST - Employer Manager", "EMPLOYER_MANAGER"],
  ["role-test-portfolio-manager@example.invalid", "ROLE TEST - Portfolio Manager", "PORTFOLIO_MANAGER"],
  ["role-test-admin@example.invalid", "ROLE TEST - Admin", "ADMIN"],
  ["role-test-superadmin@example.invalid", "ROLE TEST - Super Admin", "SUPERADMIN"],
];

const employer = await prisma.employer.findFirst({
  where: { sourceDeletedAt: null },
  orderBy: { name: "asc" },
  select: { id: true, name: true },
});

if (!employer) throw new Error("No active employer exists for scoped role testing.");

for (const [email, name, role] of accounts) {
  const existing = await prisma.user.findUnique({ where: { email } });
  const user = existing
    ? await prisma.user.update({
        where: { email },
        data: {
          name,
          role,
          active: true,
          passwordHash: hashPassword(password),
          revokedAt: null,
          revokedReason: null,
          revokedBy: null,
          deletedAt: null,
        },
      })
    : await prisma.user.create({
        data: {
          email,
          name,
          role,
          active: true,
          passwordHash: hashPassword(password),
          createdBy: "ROLE_TEST_SETUP",
          links: {
            create: role === "ADMIN" || role === "SUPERADMIN"
              ? []
              : [{ employerId: employer.id }],
          },
        },
      });

  if (role !== "ADMIN" && role !== "SUPERADMIN") {
    await prisma.userEmployer.deleteMany({ where: { userId: user.id } });
    await prisma.userEmployer.create({ data: { userId: user.id, employerId: employer.id } });
  } else {
    await prisma.userEmployer.deleteMany({ where: { userId: user.id } });
  }

  console.log(`Role test account ready: ${email} [${role}]`);
}

console.log(`Scoped role accounts are linked to employer: ${employer.name} (${employer.id})`);
await prisma.$disconnect();
