// Static integration contracts, complementing pure-policy unit tests.
// These prevent accidentally bypassing policy helpers in the real code paths.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source=(path)=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const security=source("src/services/securityService.ts");
const automation=source("src/services/automationService.ts");

test("login and security telemetry use Fastify's resolved IP, never raw forwarding headers",()=>{
  const context=security.slice(security.indexOf("export function requestSecurityContext("),
    security.indexOf("export async function enrichSecurityContext("));
  assert.match(context,/resolvedSecurityIp\(input\)/);
  assert.doesNotMatch(context,/headers\["x-real-ip"\]/);
  assert.doesNotMatch(context,/headers\["x-forwarded-for"\]/);
  assert.match(context,/TRUST_EDGE_GEO_HEADERS === "true"/);
  assert.doesNotMatch(context,/headers\["x-country-code"\]/);
  assert.match(security,/isPublicSecurityIp\(ip\)/);
});

test("stale account sweeps exclude superadmins at query and write boundaries",()=>{
  const sweep=automation.slice(automation.indexOf("export async function runStaleAccountCheck"),
    automation.indexOf("export async function runWeeklyDigestIfDue"));
  assert.match(sweep,/where: \{ active: true, role: \{ not: "SUPERADMIN" \} \}/);
  assert.match(sweep,/shouldAutoDeactivateAccount\(u, cutoff\)/);
  assert.match(sweep,/orderBy: \{ lastSeenAt: "desc" \}/);
  assert.match(sweep,/select: \{ createdAt: true, lastSeenAt: true \}/);
  assert.match(sweep,/await prisma\.user\.updateMany\(/);
  assert.match(sweep,/where: \{ id: u\.id, active: true, role: \{ not: "SUPERADMIN" \} \}/);
  assert.match(sweep,/if \(updated\.count !== 1\) continue;/);
  assert.match(sweep,/return \{ ran: true, deactivated: deactivated\.length \}/);
});


test("production SMTP transport cannot silently downgrade TLS verification",()=>{
  const scheduler=source("src/services/reportScheduler.ts");
  assert.match(scheduler,/import \{ assertSecureSmtpTls \} from/);
  assert.match(scheduler,/assertSecureSmtpTls\(cfg\)/);
  assert.match(scheduler,/assertSecureSmtpTls\(withEnv\(\{ \.\.\.current, \.\.\.data \}\)\)/);
});
