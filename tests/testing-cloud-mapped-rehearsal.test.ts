import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {LOAD_ORDER,getFormat} from "../src/services/reportFormats.js";
import {validateTestingCloudRun} from "../src/services/testingCloudMappedRehearsal.js";
const mapping={sourceGeneration:"candidate1",feeds:LOAD_ORDER.map(feed=>({
 feed,sourceTable:"legacy."+feed,
 columns:Object.fromEntries(getFormat(feed)!.fields.filter(f=>f.required).map(f=>[f.name,f.name]))
}))};
const config={approvedForPlayground:true as const,
 source:{host:"mysql.example.test",database:"legacy",user:"readonly",password:"fixture-only",
 ssl:true as const,rejectUnauthorized:true as const},
 mapping,stagingRoot:"/tmp/newchanges-playground-fixture",
 upperWatermark:"2026-10-17T12:00:00Z",pageSize:20,maxRowsPerFeed:100,
 maxBytesPerFeed:2048,maxPagesPerFeed:10,
 maxTotalRows:1000,maxTotalBytes:20480,maxTotalPages:100};
const env={RAILWAY_ENVIRONMENT_NAME:"Testing",
 TESTING_CLOUD_TEN_FEED_APPROVED:"YES_I_APPROVE",
 PLAYGROUND_MAPPED_SOURCE_APPROVED:"yes",
 DATABASE_URL:"postgresql://fixture:fixture@ep-example.neon.tech/newchanges_testing_20261017?sslmode=require",
 SEMANTIC_S3_BUCKET:"newchanges-semantic-testing-2-fixture",
 ENABLE_GOVERNED_SOURCE_CUTOVER:"false",
 ENABLE_SEMANTIC_SHADOW_ENQUEUE:"false"};
const allowed=validateTestingCloudRun(config,env);
assert.equal(allowed.database,"newchanges_testing_20261017");
assert.equal(allowed.owner,"testing_worker");
assert(allowed.networkBytes>=config.maxTotalBytes*2);
const deny=(c:any,e:any,msg:RegExp)=>assert.throws(()=>validateTestingCloudRun(c,e),msg);
deny(config,{...env,RAILWAY_ENVIRONMENT_NAME:"Production"},/Testing-only/);
deny(config,{...env,TESTING_CLOUD_TEN_FEED_APPROVED:""},/approval/);
deny(config,{...env,DATABASE_URL:"postgresql://x:y@prod.db/not_testing?sslmode=require"},/isolated Neon/);
deny(config,{...env,SEMANTIC_S3_BUCKET:"newchanges-production"},/Testing object bucket/);
deny(config,{...env,ENABLE_GOVERNED_SOURCE_CUTOVER:"true"},/cannot activate/);
deny({...config,source:{...config.source,user:"root"}},env,/Restricted/);
deny({...config,source:{...config.source,ssl:false}},env,/Restricted/);
deny({...config,maxTotalBytes:70*1024*1024},env,/budget/);
deny({...config,upperWatermark:"yesterday"},env,/watermark/);
const path=new URL("../scripts/run-testing-cloud-rehearsal.mjs",import.meta.url).pathname;
const execution=spawnSync(process.execPath,[path],{encoding:"utf8",
 env:{...process.env,RAILWAY_ENVIRONMENT_NAME:"Production",TESTING_CLOUD_TEN_FEED_APPROVED:"YES_I_APPROVE"}});
assert.notEqual(execution.status,0);
assert.match(String(execution.stderr),/Testing cloud-source approval required/);
console.log("Ten-feed cloud runner refuses Production and requires isolated source, Neon and S3 approvals");
