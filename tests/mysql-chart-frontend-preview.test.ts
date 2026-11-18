import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";

const server=readFileSync(new URL("../src/server.ts",import.meta.url),"utf8");
const app=readFileSync(new URL("../frontend/src/App.tsx",import.meta.url),"utf8");
const preview=readFileSync(new URL("../frontend/src/components/MysqlChartPreview.tsx",import.meta.url),"utf8");
const capabilities=server.slice(server.indexOf('"/api/reporting/mysql/capabilities"'),server.indexOf('// Independent MySQL reporting pilot: default-off'));

test("capabilities are authenticated, default-off, and explicitly say CDC producer is disconnected",()=>{
  assert(capabilities.includes("await requireUser(req,reply)"));
  assert(capabilities.includes('canAccessModule(user,"dashboard")'));
  assert(capabilities.includes("chartPreviewEnabled:mysqlChartPreviewEnabled()"));
  assert(capabilities.includes("cdcAutoRefreshConnected:false"));
  assert(!capabilities.includes("password"));
});

test("frontend keeps legacy dashboard while mounting independent MySQL chart preview",()=>{
  assert(app.includes("<MysqlChartPreview key={employer.id} employerId={employer.id} />"));
  assert(app.includes('"/api/employers/"+encodeURIComponent(employer.id)+"/dashboard?"'));
  assert(preview.includes('if(!capabilities?.chartPreviewEnabled)return null'));
  assert(preview.includes('fetch("/api/reporting/mysql/capabilities"'));
});

test("chart preview refetches only journeys after verified event notification",()=>{
  assert(preview.includes('new EventSource('));
  assert(preview.includes("!capabilities.cdcAutoRefreshConnected"));
  assert(preview.includes("CDC producer not connected; on-demand preview only"));
  assert(preview.includes('source.addEventListener("chart-invalidated",onInvalidation)'));
  assert(preview.includes('message.feed!=="journeys"'));
  assert(preview.includes('message.generation<=generation.current'));
  assert(preview.includes('feed=journeys&dimension=status'));
  assert(preview.includes('cache:"no-store"'));
  assert(preview.includes('source.close()'));
  assert(preview.includes('queued.current=true'));
});

test("frontend does not claim live CDC connectivity while producer is absent",()=>{
  assert(preview.includes("CDC producer not connected; on-demand preview only"));
  assert(!server.includes("mysqlChartInvalidations.notify("));
});
