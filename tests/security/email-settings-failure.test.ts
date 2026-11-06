import test from "node:test";
import assert from "node:assert/strict";
import { publicEmailSettingsFailure } from "../../src/services/emailSettingsFailure.js";

test("known email settings validation errors remain useful", () => {
  assert.deepEqual(publicEmailSettingsFailure(new Error("Enter a valid test recipient email")),
    { statusCode: 400, message: "Enter a valid test recipient email" });
  assert.deepEqual(publicEmailSettingsFailure(new Error("Production SMTP must verify the remote TLS certificate")),
    { statusCode: 400, message: "Production SMTP must verify the remote TLS certificate" });
});

test("classified provider failures have a safe response", () => {
  assert.deepEqual(publicEmailSettingsFailure(new Error("SMTP authentication failed")),
    { statusCode: 502, message: "SMTP authentication failed" });
  assert.deepEqual(publicEmailSettingsFailure(new Error("Resend request failed (HTTP 401)")),
    { statusCode: 502, message: "Resend request failed (HTTP 401)" });
});

test("driver errors, provider response bodies, and untrusted values cannot leak", () => {
  for (const error of [
    new Error("smtp://admin:password@internal-host:587"),
    new Error("Resend request failed (HTTP 401) Bearer secret"),
    new Error("P2002 Unique constraint failed on systemEmailConfig"),
    new Error("Production SMTP must verify the remote TLS certificate; private token"),
    Object.assign(new Error("credentials"), { code: "EAUTH" }),
    null,
    "Bearer secret",
  ]) {
    assert.deepEqual(publicEmailSettingsFailure(error),
      { statusCode: 500, message: "Email settings operation failed. Please try again later." });
  }
});
