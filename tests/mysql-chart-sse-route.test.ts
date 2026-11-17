import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const server=readFileSync(new URL("../src/server.ts",import.meta.url),"utf8");
const path='"/api/reporting/mysql/events/:employerId"';
const start=server.indexOf(path);
const route=server.slice(start,start+2900);

test("MySQL event SSE endpoint is mounted separately from legacy dashboard events",()=>{
  assert(start>=0);
  assert(server.includes('"/api/dashboard/events"'));
  assert(server.includes("createChartInvalidationHub()"));
});

test("event stream authorization and rollout gates precede subscription",()=>{
  for(const label of [
    "await requireUser(req, reply)",
    'canAccessModule(user,"dashboard")',
    "canViewEmployer(user,req.params.employerId)",
    "mysqlChartPreviewEnabled()",
    "mysqlChartInvalidations.subscribe(",
  ])assert(route.includes(label),label);
  assert(route.indexOf("mysqlChartInvalidations.subscribe(")>
         route.indexOf("mysqlChartPreviewEnabled()"));
});

test("event stream omits employer identifiers and limits its lifetime",()=>{
  assert(route.includes('"text/event-stream; charset=utf-8"'));
  assert(route.includes('"Cache-Control":"private, no-store, no-transform"'));
  assert(route.includes("setTimeout(()=>reply.raw.end(),60_000)"));
  assert(route.includes("clearInterval(heartbeat)"));
  assert(route.includes("unsubscribe?.()"));
  assert(route.includes('event: chart-invalidated'));
  assert(route.includes(String.raw`event: chart-invalidated\ndata:`));
  assert(!route.includes(String.raw`event: chart-invalidated\\ndata:`));
  assert(route.includes(String.raw`retry: 3000\n\n: connected\n\n`));
  assert(!route.includes("prisma."));
  assert(!route.includes("sourceRows"));
  assert(!route.includes("INSERT INTO"));
});

test("there is no externally callable producer route or synthetic event publisher",()=>{
  assert(!server.includes('/api/reporting/mysql/notify'));
  assert(!server.includes('mysqlChartInvalidations.notify('));
});
