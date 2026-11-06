import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const scheduler = source("src/services/reportScheduler.ts");
const suite = JSON.parse(source("package.json")).scripts["check:security"];
const sendStart = scheduler.indexOf("async function sendSchedule(");
const sendEnd = scheduler.indexOf("export async function sendReportNow(", sendStart);
const send = scheduler.slice(sendStart, sendEnd);
const dueStart = scheduler.indexOf("export async function runDueReports(");
const due = scheduler.slice(dueStart);

test("scheduled delivery rechecks a fresh active flag before and after dashboard generation", () => {
  assert.match(scheduler, /async function assertScheduledReportStillActive\(scheduleId: string\)/);
  const guard = scheduler.slice(scheduler.indexOf("async function assertScheduledReportStillActive("), sendStart);
  assert.match(guard, /prisma\.reportSchedule\.findUnique\(/);
  assert.match(guard, /select: \{ active: true \}/);
  assert.match(guard, /current\?\.active !== true/);
  const call = 'if (triggeredBy === "scheduled") await assertScheduledReportStillActive(schedule.id)';
  assert.equal(send.split(call).length - 1, 2);
  assert.ok(send.lastIndexOf(call) < send.indexOf("await sendEmail("));
});

test("a failed email must not reactivate a schedule paused during transport", () => {
  const transport = send.indexOf("await sendEmail(");
  const failure = send.slice(transport, send.indexOf('status: "SENT"'));
  assert.match(failure, /prisma\.reportSchedule\.updateMany\(/);
  assert.match(failure, /where: \{ id: schedule\.id, active: true \}/);
  assert.match(failure, /triggeredBy === "scheduled"/);
  assert.doesNotMatch(failure, /active: true, nextRunAt: retry/);
});

test("ONCE stays active while claimed and deactivates only after successful send", () => {
  assert.match(due, /data: \{ lastRunAt: now, nextRunAt: next \}/);
  assert.doesNotMatch(due, /row\.frequency === "ONCE" \? \{ active: false \}/);
  assert.match(send, /triggeredBy === "scheduled" && schedule\.frequency === "ONCE" \? \{ active: false \}/);
  const accepted = send.indexOf('status: "SENT"');
  assert.ok(accepted >= 0);
  assert.ok(send.indexOf('schedule.frequency === "ONCE"') > accepted);
});

test("pause race regression contracts are mandatory in Docker security checks", () => {
  assert.match(suite, /tests\/security\/report-pause-delivery-contract\.test\.mjs/);
});
