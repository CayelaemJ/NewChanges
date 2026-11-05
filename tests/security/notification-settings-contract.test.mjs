// Read-only contract for sensitive admin notification configuration.
// No database, credentials, network access or third-party delivery is required.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=(path)=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const scheduler=read("src/services/reportScheduler.ts");
const automation=read("src/services/automationService.ts");
const admin=read("public/admin.html");
const server=read("src/server.ts");

test("public admin config never serializes Slack webhook credentials",()=>{
  const start=scheduler.indexOf("export async function publicEmailConfig()");
  const end=scheduler.indexOf("export async function saveEmailConfig",start);
  assert.ok(start>=0 && end>start);
  const publicConfig=scheduler.slice(start,end);
  assert.match(publicConfig,/hasAlertSlackWebhook:\s*Boolean/);
  assert.doesNotMatch(publicConfig,/alertSlackWebhookUrl\s*:/);
  assert.match(scheduler,/allowedSlackWebhookUrl\(webhook\)/);
});

test("notification transport never contacts an unchecked historical URL",()=>{
  assert.match(automation,/if \(allowedSlackWebhookUrl\(cfg\.alertSlackWebhookUrl\)\)/);
  assert.match(automation,/redirect:\s*"error"/);
});

test("admin UI never pre-fills the saved webhook, preserves it by default and supports explicit removal",()=>{
  assert.doesNotMatch(admin,/value\s*=\s*c\.alertSlackWebhookUrl/);
  assert.match(admin,/slackInput\.value='';/);
  assert.match(admin,/if\(removeSlack\) body\.alertSlackWebhookUrl=null/);
  assert.match(admin,/else if\(newSlack\) body\.alertSlackWebhookUrl=newSlack/);
  assert.match(admin,/id="auto-slack-remove"/);
});

test("email notices escape account names and the HTML report fields",()=>{
  assert.match(server,/escapeNotificationHtml\(admin\.name\)/);
  assert.match(automation,/escapeNotificationHtml\(u\.name\)/);
  assert.match(automation,/escapeNotificationHtml\(p\.path\)/);
  assert.match(scheduler,/safeEmailColor\(theme\?\.primaryColor/);
  assert.match(scheduler,/safePortalBaseUrl\(\(schedule as any\)\.portalBaseUrl\)/);
});

test("saved Resend API configuration is resolved without leaking secrets to the browser",()=>{
  const provider=read("src/services/emailProviderConfig.ts");
  const start=scheduler.indexOf("function withEnv(");
  const end=scheduler.indexOf("export async function publicEmailConfig",start);
  assert.ok(start>0 && end>start);
  const resolver=scheduler.slice(start,end);
  assert.match(resolver,/resolveEmailProviderConfig\(cfg, draft\)/);
  assert.match(resolver,/\.\.\.provider/);
  assert.doesNotMatch(resolver,/envString\("EMAIL_PROVIDER"\) \|\| "smtp"/);
  assert.match(provider,/nonempty\(stored\.resendApiKey\)/);
  assert.match(provider,/nonempty\(stored\.resendFromEmail\)/);
  const publicResponse=scheduler.slice(end,scheduler.indexOf("export async function saveEmailConfig",end));
  assert.match(publicResponse,/resendConfigured: Boolean/);
  assert.doesNotMatch(publicResponse,/resendApiKey\s*:/);
});
