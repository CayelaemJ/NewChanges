// Static boundary contracts complement the pure policy tests: the scheduler
// must actually enforce the policy immediately before external email delivery.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const scheduler = read("src/services/reportScheduler.ts");
const suite = read("package.json");

test("scheduled and manual reports both revalidate current permissions before email", () => {
  const start = scheduler.indexOf("async function sendSchedule(");
  const end = scheduler.indexOf("export async function sendReportNow(", start);
  assert.ok(start >= 0 && end > start);
  const send = scheduler.slice(start, end);
  assert.match(send, /await assertScheduleDeliveryAuthorized\(schedule, triggeredBy\)/);
  assert.equal(send.split("await assertScheduleDeliveryAuthorized(schedule, triggeredBy)").length - 1, 2,
    "validate before report generation and immediately before external delivery");
  assert.ok(send.lastIndexOf("await assertScheduleDeliveryAuthorized(schedule, triggeredBy)") <
    send.indexOf("await sendEmail("));
  const guardStart = scheduler.indexOf("async function assertScheduleDeliveryAuthorized(");
  assert.ok(guardStart >= 0 && guardStart < start);
  const guard = scheduler.slice(guardStart, start);
  assert.match(guard, /reportDeliveryLog\.create/);
  assert.match(guard, /status: "BLOCKED"/);
  assert.match(guard, /active: false/);
});

test("scheduler re-reads owner role, active state, and employer links from database", () => {
  assert.match(scheduler, /prisma\.user\.findUnique\(/);
  assert.match(scheduler, /active: true, role: true, email: true/);
  assert.match(scheduler, /links: \{ select: \{ employerId: true \} \}/);
  assert.match(scheduler, /reportDeliveryAllowed\(owner, schedule\.employerId, schedule\.recipients\)/);
  assert.match(scheduler, /!isAdminRole\(user\) && schedule\.userId !== user\.id/);
});

test("reactivation validates current permissions and patch input is a real boolean", () => {
  const start = scheduler.indexOf("export async function updateReportSchedule(");
  const end = scheduler.indexOf("export async function deleteReportSchedule(", start);
  assert.ok(start >= 0 && end > start);
  const update = scheduler.slice(start, end);
  assert.match(update, /typeof patch\.active === "boolean"/);
  assert.match(update, /currentReportOwner\(current\.userId\)/);
  assert.match(update, /reportDeliveryAllowed\(owner, current\.employerId, current\.recipients\)/);
  assert.match(update, /active: patch\.active/);
  assert.doesNotMatch(update, /Boolean\(patch\.active\)/);
});

test("only email transport failure can trigger retries, never post-send audit failure", () => {
  const start = scheduler.indexOf("async function sendSchedule(");
  const end = scheduler.indexOf("export async function sendReportNow(", start);
  const send = scheduler.slice(start, end);
  const transport = send.indexOf("await sendEmail({ to: recipients, subject, html })");
  const failedCatch = send.indexOf("} catch (error: unknown)", transport);
  const sentLog = send.indexOf('status: "SENT"');
  assert.ok(transport >= 0 && failedCatch > transport && sentLog > failedCatch);
  const transportTry = send.lastIndexOf("try {", transport);
  const retry = send.indexOf('triggeredBy === "scheduled" && failed <= 3');
  assert.ok(transportTry >= 0 && transportTry < transport && retry > failedCatch && retry < sentLog);
  assert.match(send, /trackingWarning = true/);
  assert.match(send, /return \{ ok: true, subject, recipients, trackingWarning \}/);
  assert.doesNotMatch(send.slice(sentLog), /lastStatus: "FAILED"/,
    "a successful send must not be marked failed if audit persistence fails");
});

test("report policy tests are included in the Docker security suite", () => {
  assert.match(suite, /tests\/security\/report-delivery-policy\.test\.ts/);
  assert.match(suite, /tests\/security\/report-delivery-authorization-contract\.test\.mjs/);
});

test("scheduled report job logs no raw provider or database exception", () => {
  const job = scheduler.slice(scheduler.indexOf("export async function runDueReports("));
  assert.match(job, /reason: "SCHEDULE_DELIVERY_FAILED"/);
  assert.match(job, /logger\?\.error\?\.\(\{ scheduleId: row\.id, reason:/);
  assert.doesNotMatch(job, /\{\s*err(?:or)?:\s*error/);
  assert.doesNotMatch(job, /logger\?\.error\?\.\(\{[^\n]*error\b/);
});
