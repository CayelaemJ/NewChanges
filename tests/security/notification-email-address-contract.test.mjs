import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const policy = read("src/services/reportDeliveryPolicy.ts");
const scheduler = read("src/services/reportScheduler.ts");
const suite = JSON.parse(read("package.json")).scripts["check:security"];

test("scheduled report authorization and email settings share one strict address policy", () => {
  assert.match(policy, /import \{ validNotificationEmailAddress \} from "\.\/notificationEmailAddress\.js"/);
  assert.match(scheduler, /import \{ validNotificationEmailAddress \} from "\.\/notificationEmailAddress\.js"/);
  assert.match(policy, /validNotificationEmailAddress\(owner\.email\)/);
  assert.match(policy, /validNotificationEmailAddress\(value\)/);
  assert.match(scheduler, /validNotificationEmailAddress\(data\.fromEmail\)/);
  assert.match(scheduler, /validNotificationEmailAddress\(recipient\)/);
});

test("every SMTP and Resend send validates recipient and reply-to before network calls", () => {
  const start = scheduler.indexOf("async function sendEmail(");
  const end = scheduler.indexOf("// reusable low-level sender", start);
  const send = scheduler.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(send, /addresses\.some\(address => !validNotificationEmailAddress\(address\)\)/);
  assert.match(send, /!validNotificationEmailAddress\(opts\.replyTo\)/);
  assert.match(send, /!validNotificationEmailAddress\(cfg\.replyTo\)/);
  assert.ok(send.indexOf("addresses.some(") < send.indexOf('fetch("https://api.resend.com/emails"'));
  assert.ok(send.indexOf("addresses.some(") < send.indexOf("transporter.sendMail("));
});

test("address tests and adoption contracts run in Docker security gate", () => {
  assert.match(suite, /tests\/security\/notification-email-address\.test\.ts/);
  assert.match(suite, /tests\/security\/notification-email-address-contract\.test\.mjs/);
});
