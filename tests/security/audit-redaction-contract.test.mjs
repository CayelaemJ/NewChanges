import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../../"+path, import.meta.url),"utf8");
const service=read("src/services/auditService.ts");
const server=read("src/server.ts");

test("every structured admin audit detail is redacted at the database writer",()=>{
  assert.match(service,/import \{ redactAuditDetail, redactAuditText \} from "\.\/auditRedaction\.js"/);
  assert.match(service,/JSON\.parse\(JSON\.stringify\(redactAuditDetail\(opts\.detail\)\)\)/);
  assert.doesNotMatch(service,/JSON\.stringify\(opts\.detail\)/);
});

test("administrative routes share the same redaction policy as audit persistence",()=>{
  assert.match(server,/import \{ redactAuditDetail \} from "\.\/services\/auditRedaction\.js"/);
  assert.doesNotMatch(server,/function redactAuditDetail\(/);
  assert.match(server,/detail: redactAuditDetail\(body\)/);
});

test("audit and security-alert summaries use the shared free-text secret filter",()=>{
  assert.match(service,/import \{ redactAuditDetail, redactAuditText \} from "\.\/auditRedaction\.js"/);
  assert.match(service,/const safeSummary = redactAuditText\(summary\)/);
  assert.match(service,/summary: safeSummary/);
  assert.match(service,/:\s*safeSummary,/);
  assert.match(service,/actorName: redactAuditText\(actor\.name\)/);
  assert.match(service,/targetId: opts\.targetId == null \? undefined : redactAuditText\(opts\.targetId\)/);
  assert.match(service,/userAgent: opts\.context\?\.userAgent == null \? undefined : redactAuditText\(opts\.context\.userAgent\)/);
  assert.doesNotMatch(service,/^\s*summary,\s*$/m);
});
