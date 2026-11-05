import test from "node:test";
import assert from "node:assert/strict";
import { resolveEmailProviderConfig } from "../../src/services/emailProviderConfig.js";

test("saved Resend configuration works without EMAIL_PROVIDER environment override",()=>{
  const cfg=resolveEmailProviderConfig({
    emailProvider:"resend",
    resendApiKey:"re_test_fixture_only",
    resendFromEmail:"no-reply@example.invalid",
  },{}, {});
  assert.deepEqual(cfg,{
    emailProvider:"resend",
    resendApiKey:"re_test_fixture_only",
    resendFromEmail:"no-reply@example.invalid",
  });
});

test("explicit provider env overrides database; it does not silently default to SMTP",()=>{
  const saved={emailProvider:"resend",resendApiKey:"re_saved",resendFromEmail:"saved@example.invalid"};
  assert.equal(resolveEmailProviderConfig(saved,{},{}).emailProvider,"resend");
  assert.equal(resolveEmailProviderConfig(saved,{}, {EMAIL_PROVIDER:"smtp"}).emailProvider,"smtp");
  assert.equal(resolveEmailProviderConfig(saved,{emailProvider:"resend"},
    {EMAIL_PROVIDER:"smtp"}).emailProvider,"resend");
});

test("Resend secrets obey explicit draft > environment > saved precedence",()=>{
  const saved={emailProvider:"resend",resendApiKey:"re_saved",resendFromEmail:"saved@example.invalid"};
  assert.equal(resolveEmailProviderConfig(saved,{},{}).resendApiKey,"re_saved");
  assert.equal(resolveEmailProviderConfig(saved,{}, {RESEND_API_KEY:"re_env"}).resendApiKey,"re_env");
  assert.equal(resolveEmailProviderConfig(saved,{resendApiKey:"re_draft"},
    {RESEND_API_KEY:"re_env"}).resendApiKey,"re_draft");
  assert.equal(resolveEmailProviderConfig(saved,{resendApiKey:""},
    {}).resendApiKey,"re_saved");
  assert.equal(resolveEmailProviderConfig(saved,{resendFromEmail:null},
    {}).resendFromEmail,null);
});

test("invalid provider configuration fails instead of hiding a deployment error",()=>{
  assert.throws(()=>resolveEmailProviderConfig({}, {},{EMAIL_PROVIDER:"arbitrary"}),
    /EMAIL_PROVIDER must be/);
  assert.equal(resolveEmailProviderConfig({}, {},{}).emailProvider,"smtp");
});
