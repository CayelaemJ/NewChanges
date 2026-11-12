import test from "node:test";
import assert from "node:assert/strict";
import { assertSecureSmtpTls } from "../../src/services/smtpTlsPolicy.js";

test("production SMTP requires secure transport and validated peer certificate",()=>{
  for (const config of [
    {smtpSecure:false,smtpRequireTls:false,smtpRejectUnauthorized:true},
    {smtpSecure:false,smtpRequireTls:true,smtpRejectUnauthorized:false},
    {smtpSecure:true,smtpRequireTls:false,smtpRejectUnauthorized:false},
    {smtpSecure:false,smtpRequireTls:true,smtpRejectUnauthorized:undefined},
  ]) assert.throws(()=>assertSecureSmtpTls(config,"production"),/Production SMTP/);
});

test("valid implicit TLS and mandatory STARTTLS configurations remain supported",()=>{
  assert.doesNotThrow(()=>assertSecureSmtpTls({smtpSecure:true,smtpRequireTls:false,smtpRejectUnauthorized:true},"production"));
  assert.doesNotThrow(()=>assertSecureSmtpTls({smtpSecure:false,smtpRequireTls:true,smtpRejectUnauthorized:true},"production"));
});

test("local test SMTP may use a disposable insecure fixture",()=>{
  assert.doesNotThrow(()=>assertSecureSmtpTls({smtpSecure:false,smtpRequireTls:false,smtpRejectUnauthorized:false},"test"));
});
