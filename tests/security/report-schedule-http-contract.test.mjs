import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const server = read("src/server.ts");
const scheduler = read("src/services/reportScheduler.ts");
const suite = JSON.parse(read("package.json")).scripts["check:security"];
const routes = server.slice(
  server.indexOf('app.post<{ Body: ScheduleInput }>("/api/report-schedules"'),
  server.indexOf("// ── channel partners", server.indexOf('app.post<{ Body: ScheduleInput }>("/api/report-schedules"')),
);

test("all four report schedule write routes use the allowlisted public error boundary", () => {
  assert.ok(routes.length > 500);
  assert.match(server, /import \{ publicReportScheduleFailure \} from "\.\/services\/reportScheduleFailure\.js"/);
  const expected = 'const safe = publicReportScheduleFailure(e); return reply.code(safe.statusCode).send({ error: safe.message });';
  assert.equal(routes.split(expected).length - 1, 4);
  assert.doesNotMatch(routes, /error: e\?\.message/);
});

test("report validation does not echo arbitrary submitted email addresses", () => {
  assert.match(scheduler, /if \(invalid\) throw new Error\("invalid recipient email"\)/);
  assert.doesNotMatch(scheduler, /invalid recipient email: \$\{/);
});

test("HTTP regression tests are in the Docker security gate", () => {
  assert.match(suite, /tests\/security\/report-schedule-failure\.test\.ts/);
  assert.match(suite, /tests\/security\/report-schedule-http-contract\.test\.mjs/);
});
