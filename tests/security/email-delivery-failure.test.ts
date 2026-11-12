import test from "node:test";
import assert from "node:assert/strict";
import { safeEmailDeliveryFailure } from "../../src/services/emailDeliveryFailure.js";

test("returns actionable safe classifications for known transport failures", () => {
  assert.equal(
    safeEmailDeliveryFailure(new Error("Resend request failed (HTTP 401)")),
    "Resend request failed (HTTP 401)",
  );
  assert.equal(
    safeEmailDeliveryFailure(Object.assign(new Error("user:supersecret@host"), { code: "EAUTH" })),
    "SMTP authentication failed",
  );
  assert.equal(
    safeEmailDeliveryFailure(Object.assign(new Error("internal.host.local"), { code: "ETIMEDOUT" })),
    "Email delivery timed out",
  );
});

test("never returns arbitrary provider text or raw credentials", () => {
  const raw = [
    "https://hooks.slack.com/services/Fake/Fake/Fake",
    "smtp://account:password@example.internal:587",
    "Bearer re_sample_secret_not_real",
    "Resend request failed (HTTP 401): API key re_sample_secret_not_real",
    "Server wrote raw headers and private request URLs",
  ];
  for (const message of raw) {
    const safe = safeEmailDeliveryFailure(new Error(message));
    assert.equal(safe, "Email delivery test failed. Check provider settings and delivery logs.");
    assert.ok(!safe.includes(message));
  }
  assert.equal(safeEmailDeliveryFailure(null), "Email delivery test failed. Check provider settings and delivery logs.");
});

test("unknown or malicious error codes cannot be reflected", () => {
  const dangerous = Object.assign(new Error("secret"), { code: "EAUTH: secret" });
  assert.equal(safeEmailDeliveryFailure(dangerous), "Email delivery test failed. Check provider settings and delivery logs.");
});
