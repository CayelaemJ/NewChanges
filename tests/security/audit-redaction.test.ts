import test from "node:test";
import assert from "node:assert/strict";
import { redactAuditDetail, redactAuditText } from "../../src/services/auditRedaction.js";

test("log writer redacts persisted provider and recovery credentials",()=>{
  const input={
    resendApiKey:"re_private_fixture",
    alertSlackWebhookUrl:"https://hooks.slack.com/services/fixture/fixture/fixture",
    smtpPassword:"smtp-pass",
    grantCode:"grant",
    mfaRecoveryKey:"mfa-secret",
    cookie:"session-secret",
    clientSecret:"client-secret",
    connectionString:"postgresql://user:pass@host/",
    normalField:"retain this",
  };
  assert.deepEqual(redactAuditDetail(input),{
    resendApiKey:"[REDACTED]",
    alertSlackWebhookUrl:"[REDACTED]",
    smtpPassword:"[REDACTED]",
    grantCode:"[REDACTED]",
    mfaRecoveryKey:"[REDACTED]",
    cookie:"[REDACTED]",
    clientSecret:"[REDACTED]",
    connectionString:"[REDACTED]",
    normalField:"retain this",
  });
});

test("nested arrays and auth header fields cannot bypass audit redaction",()=>{
  assert.deepEqual(redactAuditDetail({
    events:[{Headers:{Authorization:"Bearer secret", Accept:"application/json"}},
      {nested:{accessToken:"secret",notes:"approved"}}],
  }),{
    events:[{Headers:{Authorization:"[REDACTED]", Accept:"application/json"}},
      {nested:{accessToken:"[REDACTED]",notes:"approved"}}],
  });
});

test("redaction never mutates the original application request",()=>{
  const input={data:{apiKey:"secret",other:"ok"}};
  const redacted=redactAuditDetail(input);
  assert.equal(input.data.apiKey,"secret");
  assert.deepEqual(redacted,{data:{apiKey:"[REDACTED]",other:"ok"}});
});

test("primitive data remains available for non-secret audit investigations",()=>{
  assert.deepEqual(redactAuditDetail({count:5,flagged:false,id:null,role:"ADMIN"}),
    {count:5,flagged:false,id:null,role:"ADMIN"});
});

test("embedded secrets are redacted even under benign-looking keys", () => {
  assert.deepEqual(redactAuditDetail({
    message: "Connection failed: postgresql://ci_user:ci_pass@db.invalid/app",
    notes: "Upstream says Authorization: Bearer abcdefghijklmnop",
    url: "https://hooks.slack.com/services/T111/B222/ABCDEF",
    error: "api_key=sk_fake_123456789",
    normal: "password updated successfully",
  }), {
    message: "[REDACTED]", notes: "[REDACTED]", url: "[REDACTED]",
    error: "[REDACTED]", normal: "password updated successfully",
  });
});

test("audit summary text uses the same secret filter", () => {
  assert.equal(redactAuditText("provider rejected Authorization: Bearer abcdefghijklmnop"), "[REDACTED]");
  assert.equal(redactAuditText("Bearer abcdefghijklmnop"), "[REDACTED]");
  assert.equal(redactAuditText("No credentials supplied"), "No credentials supplied");
});

test("cyclic and excessively deep structures fail closed without crashing", () => {
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.deepEqual(redactAuditDetail(cyclic), { self: "[REDACTED]" });
  const nested: { child?: unknown } = {};
  let cursor = nested;
  for (let i = 0; i < 30; i++) {
    const next: { child?: unknown } = {};
    cursor.child = next;
    cursor = next;
  }
  assert.match(JSON.stringify(redactAuditDetail(nested)), /\[REDACTED\]/);
});

test("dates remain useful in serialized audit details", () => {
  assert.deepEqual(redactAuditDetail({ when: new Date("2026-11-06T00:00:00.000Z") }),
    { when: "2026-11-06T00:00:00.000Z" });
});

test("credentials in object property names cannot leak into audit JSON", () => {
  assert.deepEqual(redactAuditDetail({ "Authorization: Bearer abcdefghijklmnop": "test" }),
    { "[REDACTED_KEY]": "[REDACTED]" });
});
