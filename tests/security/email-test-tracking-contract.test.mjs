import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const scheduler = read("src/services/reportScheduler.ts");
const suite = JSON.parse(read("package.json")).scripts["check:security"];
const start = scheduler.indexOf("export async function testEmailConnection(");
const end = scheduler.indexOf("function parseTime(", start);
const testEmail = scheduler.slice(start, end);

test("successful test send is never classified as failure because audit persistence fails", () => {
  assert.ok(start >= 0 && end > start);
  const send = testEmail.indexOf("await sendEmail(");
  const failed = testEmail.indexOf('lastTestStatus: "FAILED"');
  const succeeded = testEmail.indexOf('lastTestStatus: "SUCCESS"');
  const warning = testEmail.indexOf("trackingWarning = true");
  assert.ok(send >= 0 && failed > send && succeeded > failed && warning > succeeded);
  const transportTry = testEmail.lastIndexOf("try {", send);
  const transportCatch = testEmail.indexOf("} catch (error: unknown)", send);
  assert.ok(transportTry >= 0 && transportTry < send && transportCatch > send && transportCatch < succeeded);
  assert.match(testEmail, /return \{ ok: true, recipient, trackingWarning \}/);
  assert.match(testEmail, /catch \{\s+trackingWarning = true;/);
});

test("test email audit failures do not log raw database errors", () => {
  assert.doesNotMatch(testEmail, /console\.error\([^)]*error/);
  assert.match(testEmail, /catch \{\s+\/\/ Preserve the classified transport failure/);
});

test("email test tracking contract is in the Docker security suite", () => {
  assert.match(suite, /tests\/security\/email-test-tracking-contract\.test\.mjs/);
});
