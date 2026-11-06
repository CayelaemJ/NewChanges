import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const scheduler = read("src/services/reportScheduler.ts");
const publicErrors = read("src/services/emailSettingsFailure.ts");
const suite = JSON.parse(read("package.json")).scripts["check:security"];
const save = scheduler.slice(scheduler.indexOf("export async function saveEmailConfig("),
  scheduler.indexOf("async function smtpTransport("));

test("admin SMTP, automation and synthetic mode settings reject coercion", () => {
  assert.ok(save.length > 1500);
  assert.match(scheduler, /import \{ strictEmailSettingBoolean, strictSmtpPort, strictStaleDeactivateDays \} from "\.\/emailSettingsInputPolicy\.js"/);
  assert.match(save, /data\.smtpPort = strictSmtpPort\(input\.smtpPort\)/);
  assert.match(save, /data\.staleDeactivateDays = strictStaleDeactivateDays\(input\.staleDeactivateDays\)/);
  for (const field of ["smtpSecure", "smtpRequireTls", "smtpRejectUnauthorized", "digestEnabled", "scoreChangeAlertsEnabled", "syntheticDataMode"]) {
    assert.ok(save.includes('data.' + field + ' = strictEmailSettingBoolean(input.' + field + ', "' + field + '")'));
    assert.doesNotMatch(save, new RegExp("Boolean\\(input\\." + field + "\\)"));
    assert.ok(publicErrors.includes('"' + field + ' must be true or false"'));
  }
});

test("new validation errors remain safe actionable 400 responses", () => {
  assert.match(publicErrors, /SMTP port must be an integer between 1 and 65535/);
  assert.match(publicErrors, /Inactivity threshold must be 0 \(off\) or 7 to 3650 whole days/);
});

test("strict admin setting tests run in Docker security gate", () => {
  assert.match(suite, /tests\/security\/email-settings-input-policy\.test\.ts/);
  assert.match(suite, /tests\/security\/email-settings-input-contract\.test\.mjs/);
});
