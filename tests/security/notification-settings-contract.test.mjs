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

test("score change emails escape employer, recipient and period fields",()=>{
  const start=automation.indexOf("export async function notifyScoreChangeIfCurrentPeriod(");
  assert.ok(start>=0, "score-change notification function must exist");
  const scoreEmail=automation.slice(start);
  assert.match(scoreEmail,/notificationPlainText\(employer\?\.name \|\| "Your employer"\)/);
  assert.match(scoreEmail,/escapeNotificationHtml\(r\.name \|\| ""\)/);
  assert.match(scoreEmail,/escapeNotificationHtml\(employer\?\.name \|\| "Your employer"\)/);
  assert.match(scoreEmail,/escapeNotificationHtml\(period\)/);
  assert.match(scoreEmail,/escapeNotificationHtml\(previous\.period\)/);
  assert.doesNotMatch(scoreEmail,/<p>Hi \$\{r\.name/);
});

test("email delivery failures never persist or return untrusted provider details",()=>{
  const testStart=scheduler.indexOf("export async function testEmailConnection(");
  const testEnd=scheduler.indexOf("function parseTime(",testStart);
  assert.ok(testStart>=0 && testEnd>testStart);
  const delivery=scheduler.slice(testStart,testEnd);
  assert.match(delivery,/safeEmailDeliveryFailure\(error\)/);
  assert.match(delivery,/lastTestNote: safeMessage/);
  assert.match(delivery,/throw new Error\(safeMessage\)/);
  assert.doesNotMatch(delivery,/lastTestNote:\s*String\(error/);
  const sendStart=scheduler.indexOf("async function sendEmail(");
  const sendEnd=scheduler.indexOf("export async function sendMail(",sendStart);
  assert.ok(sendStart>=0 && sendEnd>sendStart);
  const sender=scheduler.slice(sendStart,sendEnd);
  assert.match(sender,/Resend request failed \(HTTP/);
  assert.doesNotMatch(sender,/response\.text\(\)/);
});

test("scheduled delivery history never persists untrusted transport or sync diagnostics",()=>{
  const start=scheduler.indexOf("async function assertDashboardPublishable()");
  const end=scheduler.indexOf("export async function sendReportNow",start);
  assert.ok(start>=0 && end>start);
  const delivery=scheduler.slice(start,end);
  assert.match(delivery,/safeEmailDeliveryFailure\(error\)/);
  assert.match(delivery,/lastError: message/);
  assert.match(delivery,/error: message/);
  assert.match(delivery,/throw new Error\(message\)/);
  assert.doesNotMatch(delivery,/String\(error\?\.message/);
  assert.doesNotMatch(delivery,/lastSyncNote/);
});

test("failed onboarding emails never reflect raw provider diagnostics",()=>{
  const userService=read("src/services/userService.ts");
  assert.match(userService,/import \{ safeEmailDeliveryFailure \} from/);
  assert.match(userService,/emailError = safeEmailDeliveryFailure\(e\)/);
  assert.doesNotMatch(userService,/emailError = String\(e\?\.message/);
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
  assert.match(provider,/nonempty\(stored\.fromEmail\)/);
  const publicResponse=scheduler.slice(end,scheduler.indexOf("export async function saveEmailConfig",end));
  assert.match(publicResponse,/resendConfigured: Boolean/);
  assert.doesNotMatch(publicResponse,/resendApiKey\s*:/);
});

test("Resend sender persists to a real Prisma field, with no phantom column",()=>{
  const schema=read("prisma/schema.prisma");
  const a=schema.indexOf("model SystemEmailConfig {");
  const b=schema.indexOf("\nmodel ",a+2);
  assert.ok(a>=0 && b>a,"SystemEmailConfig model must exist");
  const model=schema.slice(a,b);
  assert.match(model,/\bfromEmail\s+String\?/);
  assert.doesNotMatch(model,/\bresendFromEmail\s+/);
  const saveStart=scheduler.indexOf("export async function saveEmailConfig(");
  const saveEnd=scheduler.indexOf("async function smtpTransport(",saveStart);
  const saving=scheduler.slice(saveStart,saveEnd);
  assert.match(saving,/data\.fromEmail = clean\(input\.resendFromEmail\)/);
  assert.doesNotMatch(saving,/data\.resendFromEmail\s*=/);
  assert.ok(saving.indexOf('if ("fromEmail" in input)') < saving.indexOf('if ("resendFromEmail" in input'),
    "Resend field must override generic form field when the selected provider is Resend");
});

test("disposable database CI verifies real Resend save, readback and secret redaction",()=>{
  const suite=read("scripts/ci/run-docker-ci-suite.sh");
  const integration=read("scripts/ci/email-provider-persistence-ci.mjs");
  assert.match(suite,/run node scripts\/ci\/email-provider-persistence-ci\.mjs/);
  assert.match(integration,/process\.env\.DATABASE_URL, EXPECTED/);
  assert.match(integration,/CI_RLS_PROBE_APPROVED/);
  assert.match(integration,/assert\.equal\(persisted\.fromEmail, "resend@example\.invalid"\)/);
  assert.match(integration,/assert\.equal\(persisted\.resendApiKey, apiKey\)/);
  assert.match(integration,/!Object\.hasOwn\(response, "resendApiKey"\)/);
});


// The same safe sender name must be used by SMTP and the Resend formatted From.
test("sender display name is normalized for both providers", () => {
  const safety=read("src/services/notificationTextSafety.ts");
  assert.match(safety,/export function safeSenderDisplayName\(/);
  assert.match(safety,/\\p\{Cc\}/);
  assert.match(safety,/\\p\{Cf\}/);
  assert.match(safety,/<>"\x27,;\\\\/);
  assert.match(scheduler,/from: `\$\{safeSenderDisplayName\(cfg\.fromName\)\} <\$\{fromEmail\}>`/);
  assert.match(scheduler,/from: \{ name: safeSenderDisplayName\(cfg\.fromName\), address: cfg\.fromEmail! \}/);
});

test("administrator alert emails validate at save and before sending legacy data", () => {
  const helper=read("src/services/alertEmailRecipients.ts");
  assert.match(helper,/validNotificationEmailAddress\(address\)/);
  assert.match(helper,/recipients\.length > 10/);
  const automation=read("src/services/automationService.ts");
  assert.match(automation,/parseAlertEmailRecipients\(cfg\.alertEmails\)/);
  assert.match(automation,/catch \{ return \[\]; \}/);
  const save=scheduler.slice(scheduler.indexOf("export async function saveEmailConfig("), scheduler.indexOf("async function smtpTransport("));
  assert.match(save,/parseAlertEmailRecipients\(input\.alertEmails\)/);
});
