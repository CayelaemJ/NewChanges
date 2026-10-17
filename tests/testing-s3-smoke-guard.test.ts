import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
const file=new URL("../scripts/smoke-semantic-storage.mjs",import.meta.url).pathname;
const source=readFileSync(file,"utf8");
assert(source.includes('envName==="Testing"'));
assert(source.includes('TESTING_S3_SMOKE_APPROVED==="YES_I_APPROVE"'));
assert(source.includes('includes("testing")'));
for(const environment of ["Production","Testing","Playground and new ideas"]){
 const args={...process.env,
  RAILWAY_ENVIRONMENT_NAME:environment,
  SEMANTIC_STORAGE_SMOKE_TEST:"false",
  TESTING_S3_SMOKE_APPROVED:"YES_I_APPROVE"};
 const run=spawnSync(process.execPath,[file],{env:args,encoding:"utf8"});
 assert.notEqual(run.status,0,"Disabled smoke must reject in "+environment);
 assert.match(String(run.stderr),/Refusing object storage write/);
}
const production=spawnSync(process.execPath,[file],{env:{...process.env,
 RAILWAY_ENVIRONMENT_NAME:"Production",SEMANTIC_STORAGE_SMOKE_TEST:"true",
 TESTING_S3_SMOKE_APPROVED:"YES_I_APPROVE"},encoding:"utf8"});
assert.notEqual(production.status,0);
assert.match(String(production.stderr),/Refusing object storage write/);
const unapproved=spawnSync(process.execPath,[file],{env:{...process.env,
 RAILWAY_ENVIRONMENT_NAME:"Testing",SEMANTIC_STORAGE_SMOKE_TEST:"true",
 TESTING_S3_SMOKE_APPROVED:"no"},encoding:"utf8"});
assert.notEqual(unapproved.status,0);
assert.match(String(unapproved.stderr),/Refusing object storage write/);
console.log("S3 rehearsal guard refuses Production, disabled and unapproved writes");
