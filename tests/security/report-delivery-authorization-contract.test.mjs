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

test("report policy tests are included in the Docker security suite", () => {
  assert.match(suite, /tests\/security\/report-delivery-policy\.test\.ts/);
  assert.match(suite, /tests\/security\/report-delivery-authorization-contract\.test\.mjs/);
});
