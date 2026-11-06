import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const server = source("src/server.ts");
const scheduler = source("src/services/reportScheduler.ts");
const suite = JSON.parse(source("package.json")).scripts["check:security"];
const routes = server.slice(server.indexOf('app.post<{ Body: any }>("/api/admin/email-settings"'),
  server.indexOf("// manual \"run now\" for automations"));

test("admin email save and test endpoints use allowlisted error responses", () => {
  assert.ok(routes.length > 300);
  assert.match(server, /import \{ publicEmailSettingsFailure \} from "\.\/services\/emailSettingsFailure\.js"/);
  const safe = "const safe = publicEmailSettingsFailure(e); return reply.code(safe.statusCode).send({ error: safe.message });";
  assert.equal(routes.split(safe).length - 1, 2);
  assert.doesNotMatch(routes, /error: e\?\.message/);
});

test("Resend transport has a hard timeout and forbids redirects with bearer credentials", () => {
  const start = scheduler.indexOf('const response = await fetch("https://api.resend.com/emails"');
  assert.ok(start >= 0);
  const call = scheduler.slice(start, scheduler.indexOf("if (!response.ok)", start));
  assert.match(call, /redirect: "error"/);
  assert.match(call, /signal: AbortSignal\.timeout\(20_000\)/);
  assert.match(call, /Authorization.*Bearer/);
});

test("email settings public failure tests are mandatory in Docker security suite", () => {
  assert.match(suite, /tests\/security\/email-settings-failure\.test\.ts/);
  assert.match(suite, /tests\/security\/email-settings-http-contract\.test\.mjs/);
});
