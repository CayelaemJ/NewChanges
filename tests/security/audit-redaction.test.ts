import test from "node:test";
import assert from "node:assert/strict";
import { redactAuditDetail } from "../../src/services/auditRedaction.js";

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
