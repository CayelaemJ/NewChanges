import test from 'node:test';
import assert from 'node:assert/strict';
import {CAPABILITY_IDS,validatePrimaryMigrationConfig,safeReleaseStatement} from '../cloudflare/primary-readiness.mjs';
const base={mode:"staging",hostname:"https://migration.newchanges-app.pages.dev",source:"cloudflare-workers",productionTarget:"cloudflare",verifiedCapabilities:["static_public"]};
test('staging releases are allowed without pretending the authenticated app is migrated',()=>{
 const r=validatePrimaryMigrationConfig(base);assert.equal(r.valid,true);
 assert.equal(r.mode,"staging");assert.equal(safeReleaseStatement(base),"NOT_READY");
});
test('production cannot cut over when any dependency is unverified',()=>{
 const r=validatePrimaryMigrationConfig({...base,mode:"production"});
 assert.equal(r.valid,false);assert.ok(r.errors.some(x=>x.includes("auth_sessions")));
 assert.ok(r.errors.some(x=>x.includes("tenant_scope")));
 assert.ok(r.errors.some(x=>x.includes("rollback")));
});
test('do not count Render or Railway as a Cloudflare-native production backend',()=>{
 for(const productionTarget of ["render","railway"]){
  const r=validatePrimaryMigrationConfig({...base,productionTarget});
  assert.equal(r.valid,false,productionTarget);
 }
});
test('credential-bearing URLs and deceptive hosts cannot become the allowed origin',()=>{
 for(const hostname of ["https://user:pass@foo.example","http://foo.example","https://foo.example/private","https://foo.example?x=1","not-a-url"]){
  assert.equal(validatePrimaryMigrationConfig({...base,hostname}).valid,false,hostname);
 }
});
test('complete signoff can be represented only with all explicitly passed gates',()=>{
 const config={...base,mode:"production",verifiedCapabilities:[...CAPABILITY_IDS],authenticatedE2E:true,tenantIsolationE2E:true,rollbackVerified:true,databaseSecretScope:"cloudflare-production",backgroundWorkersIdempotent:true};
 assert.equal(validatePrimaryMigrationConfig(config).valid,true);
 assert.equal(safeReleaseStatement(config),"PRIMARY_READY");
 assert.equal(validatePrimaryMigrationConfig({...config,rollbackVerified:false}).valid,false);
});
