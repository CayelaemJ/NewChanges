import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {validateStagingCdcConnection,testStagingCdcConnection} from "../src/services/stagingCdcConnectionPreflight.js";

const admin=readFileSync(new URL("../public/admin.html",import.meta.url),"utf8");
const server=readFileSync(new URL("../src/server.ts",import.meta.url),"utf8");
const service=readFileSync(new URL("../src/services/stagingCdcConnectionPreflight.ts",import.meta.url),"utf8");
const environment={
  RAILWAY_PROJECT_ID:"f2f1bc4f-5de8-436e-9414-5dc125650e96",
  RAILWAY_ENVIRONMENT_ID:"9ff830b6-24c3-4319-bee1-82b6a74db270",
  FIXER_CDC_ADMIN_PREFLIGHT_ENABLED:"true",
  FIXER_CDC_PREFLIGHT_ALLOWED_HOST:"mysql.approved.example",
};
const input={host:"mysql.approved.example",port:3306,database:"ingest_stage",
  username:"cdc_preflight_reader",password:"local-only-not-a-real-password"};

test("new Live CDC UI never uses PostgreSQL integration settings or sync endpoints",()=>{
  assert(admin.includes('id="source-tab-cdc"'));
  assert(admin.includes('id="integ-cdc-panel"'));
  assert(admin.includes('onclick="testLiveCdc()"'));
  assert(admin.includes("$('#integ-legacy-actions').style.display = mode === 'CDC' ? 'none' : 'flex'"));
  assert(admin.includes("if(!requireLegacyIntegMode())return;"));
  assert(admin.includes("'/api/admin/cdc/connection/test'") ||
    admin.includes("`\${API}/api/admin/cdc/connection/test`"));
  const fn=admin.slice(admin.indexOf("async function testLiveCdc(){"),
    admin.indexOf("async function saveInteg(){"));
  assert(fn.includes("payload.password=''"));
  for(const unsafe of ["/api/admin/integration/sync","/api/admin/integration/stage-source",
    "saveSyncConfig","localStorage","sessionStorage"])assert(!fn.includes(unsafe));
});
test("CDC source preflight only accepts operator-approved stage and exact host",()=>{
  assert.equal(validateStagingCdcConnection(input,environment).host,input.host);
  assert.throws(()=>validateStagingCdcConnection(input,{}),/STAGING_DISABLED/);
  assert.throws(()=>validateStagingCdcConnection({...input,host:"127.0.0.1"},environment),/NOT_APPROVED/);
  assert.throws(()=>validateStagingCdcConnection(input,{...environment,RAILWAY_PROJECT_ID:"production"}),/STAGING_DISABLED/);
  assert.throws(()=>validateStagingCdcConnection({...input,password:""},environment),/NOT_APPROVED/);
});
test("disabled or unapproved preflight returns a safe result without contacting MySQL",async()=>{
  let calls=0;
  const neverConnect=(async()=>{calls++;throw Error("should not connect");}) as any;
  assert.deepEqual(await testStagingCdcConnection(input,{},neverConnect),
    {ok:false,code:"CDC_PREFLIGHT_STAGING_DISABLED",cdcActive:false});
  assert.deepEqual(await testStagingCdcConnection({...input,host:"other.example"},environment,neverConnect),
    {ok:false,code:"CDC_PREFLIGHT_CANDIDATE_INVALID_OR_HOST_NOT_APPROVED",cdcActive:false});
  assert.equal(calls,0);
});
test("staging preflight uses only fixed read-only MySQL statement, no PostgreSQL writes",()=>{
  const route=server.slice(server.indexOf('"/api/admin/cdc/connection/test"'),
    server.indexOf('app.post<{ Body: Record<string, unknown> }>("/api/admin/integration/test"'));
  assert(route.includes('admin.role!=="SUPERADMIN"'));
  assert(route.includes("testStagingCdcConnection("));
  assert(!route.includes("saveSyncConfig("));
  assert(!route.includes("prisma."));
  assert(service.includes("SELECT @@global.log_bin"));
  assert(service.includes("rejectUnauthorized:true"));
  assert(!service.includes("INSERT INTO"));
  assert(!service.includes("UPDATE fixer_"));
});
