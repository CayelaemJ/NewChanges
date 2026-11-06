import test from "node:test";
import assert from "node:assert/strict";
import { publicReportScheduleFailure } from "../../src/services/reportScheduleFailure.js";

test("known schedule validation errors remain actionable", () => {
  assert.deepEqual(publicReportScheduleFailure(new Error("send time must be HH:MM")),
    { statusCode: 400, message: "send time must be HH:MM" });
  assert.deepEqual(publicReportScheduleFailure(new Error("invalid recipient email")),
    { statusCode: 400, message: "invalid recipient email" });
});

test("permission and owner revocation errors are forbidden", () => {
  for (const message of [
    "you cannot send this schedule",
    "you do not have access to this employer",
    "Report delivery blocked: owner access or recipient settings have changed.",
  ]) {
    assert.deepEqual(publicReportScheduleFailure(new Error(message)),
      { statusCode: 403, message });
  }
});

test("source not ready and sanitized email transport failures have distinct status codes", () => {
  assert.equal(publicReportScheduleFailure(new Error(
    "Dashboard source is not ready; report delivery is deferred until a successful sync."
  )).statusCode, 503);
  assert.deepEqual(publicReportScheduleFailure(new Error("Resend request failed (HTTP 429)")),
    { statusCode: 502, message: "Resend request failed (HTTP 429)" });
  assert.deepEqual(publicReportScheduleFailure(new Error("SMTP authentication failed")),
    { statusCode: 502, message: "SMTP authentication failed" });
});

test("database driver messages and upstream secret-bearing errors are never reflected", () => {
  for (const error of [
    new Error("postgresql://service:password@internal.example:5432/private"),
    new Error("P2002 Unique constraint failed on private_user_email"),
    new Error("Resend request failed (HTTP 429) token=private"),
    new Error("invalid recipient email: somebody@example.invalid"),
    new Error("send time must be HH:MM; SELECT * FROM secrets"),
    { code: "P2002", message: "database internal secret" },
    "Bearer confidential",
    null,
  ]) {
    assert.deepEqual(publicReportScheduleFailure(error),
      { statusCode: 500, message: "Report schedule operation failed. Please try again later." });
  }
});
