// Synthetic PostgreSQL proof that Resend credentials and sender settings
// persist through the *real* app service without a phantom Prisma column.
// No third-party email is sent. Refuses every database except disposable CI.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const EXPECTED = "postgresql://ci_fixture:ci_fixture@127.0.0.1:5432/newchanges_ci";
assert.equal(process.env.CI, "true", "Synthetic CI only");
assert.equal(process.env.NODE_ENV, "test", "No production settings permitted");
assert.equal(process.env.CI_RLS_PROBE_APPROVED, "CI_DISPOSABLE_ONLY");
assert.equal(process.env.DATABASE_URL, EXPECTED, "Refusing non-disposable database");

const { prisma } = await import("../../dist/services/database.js");
const { saveEmailConfig, publicEmailConfig } = await import("../../dist/services/reportScheduler.js");
let before;
let rowCreated = false;

try {
  before = await prisma.systemEmailConfig.findUnique({ where: { id: "default" } });
  if (!before) {
    await prisma.systemEmailConfig.create({ data: { id: "default" } });
    rowCreated = true;
  }
  const apiKey = "re_synthetic_ci_" + randomBytes(12).toString("hex");
  const response = await saveEmailConfig({
    emailProvider: "resend",
    resendApiKey: apiKey,
    // The form can submit both fields. Resend must win when selected.
    fromEmail: "generic@example.invalid",
    resendFromEmail: "resend@example.invalid",
  });
  const persisted = await prisma.systemEmailConfig.findUniqueOrThrow({
    where: { id: "default" },
  });
  assert.equal(persisted.emailProvider, "resend");
  assert.equal(persisted.resendApiKey, apiKey);
  assert.equal(persisted.fromEmail, "resend@example.invalid");
  assert.equal(response.resendFromEmail, "resend@example.invalid");
  assert.equal(response.resendConfigured, true);
  assert.ok(!Object.hasOwn(response, "resendApiKey"));
  assert.ok(!Object.hasOwn(await publicEmailConfig(), "resendApiKey"));
  assert.ok(!JSON.stringify(response).includes(apiKey),
    "Admin response cannot leak stored provider secrets");
  console.log("[mail-config] PASS synthetic Resend save, Prisma sender mapping and API-key redaction");
} finally {
  try {
    if (rowCreated) {
      await prisma.systemEmailConfig.delete({ where: { id: "default" } });
    } else if (before) {
      await prisma.systemEmailConfig.update({
        where: { id: "default" },
        data: {
          emailProvider: before.emailProvider,
          resendApiKey: before.resendApiKey,
          fromEmail: before.fromEmail,
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}
