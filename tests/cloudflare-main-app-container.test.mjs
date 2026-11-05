import test from "node:test";
import assert from "node:assert/strict";
import {evaluateNewChangesPrimary,allowWriteLeadership} from "../cloudflare/main-app/gate.mjs";
import {verifyDatabaseIdentity} from "../cloudflare/main-app/verify-database.mjs";
const mainHost="newchanges.example.org";
const base={NEWCHANGES_CANONICAL_HOST:mainHost,NEWCHANGES_BACKEND_ENABLED:"true",
  NEWCHANGES_AIVEN_DATABASE_URL:"synthetic-secret-never-used",NEWCHANGES_MAIN:{getByName(){return {fetch(){}}}},
  NEWCHANGES_WRITE_LEADER_ENABLED:"true", NEWCHANGES_CUTOVER_APPROVED:"true",
  NEWCHANGES_DATABASE_PERMISSIONS_VERIFIED:"true", NEWCHANGES_TENANT_E2E_VERIFIED:"true",
  NEWCHANGES_SOURCE_WRITERS_FENCED:"YES", NEWCHANGES_FINAL_SYNC_VERIFIED:"YES",
  NEWCHANGES_AIVEN_PRODUCTION_APPROVED:"YES"};
const verified={database_name:"newchanges",role_name:"newchanges_application_reader",is_superuser:false,can_create_database:false,
 can_create_roles:false,bypasses_rls:false,member_superuser:false,member_privileged_role:false,member_application_owner:false,
 can_create_database_objects:false,can_create_public_objects:false,can_read_session:true,can_read_employer:true,
 can_write_session:false,can_write_any_public_table:false,can_use_or_update_public_sequence:false};

test("disabled backend cannot start container traffic",()=>{
 for(const delta of [{NEWCHANGES_BACKEND_ENABLED:"false"},{NEWCHANGES_CANONICAL_HOST:""},
 {NEWCHANGES_AIVEN_DATABASE_URL:""},{NEWCHANGES_MAIN:null}]){
   assert.equal(evaluateNewChangesPrimary({...base,...delta},mainHost).ready,false,JSON.stringify(delta));
 }
});
test("NewChanges only accepts exact explicitly bound domain, not unrelated brands",()=>{
 assert.equal(evaluateNewChangesPrimary(base,mainHost).ready,true);
 for(const hostname of ["other.example.org","mainHost","newchanges.example.org.evil.tld","cabo-solutions-za.workers.dev"]){
   assert.equal(evaluateNewChangesPrimary(base,hostname).ready,false);
 }
});
test("active Cloudflare Aiven leadership requires all cutover, fencing and data gates",()=>{
 assert.equal(allowWriteLeadership({...base,NEWCHANGES_FINAL_SYNC_VERIFIED:"NO"}),false);
 const all={...base,NEWCHANGES_WRITE_LEADER_ENABLED:"true",NEWCHANGES_CUTOVER_APPROVED:"true",
  NEWCHANGES_DATABASE_PERMISSIONS_VERIFIED:"true",NEWCHANGES_TENANT_E2E_VERIFIED:"true"};
 assert.equal(allowWriteLeadership(all),true);
 for(const key of ["NEWCHANGES_WRITE_LEADER_ENABLED","NEWCHANGES_CUTOVER_APPROVED",
 "NEWCHANGES_DATABASE_PERMISSIONS_VERIFIED","NEWCHANGES_TENANT_E2E_VERIFIED",
 "NEWCHANGES_SOURCE_WRITERS_FENCED","NEWCHANGES_FINAL_SYNC_VERIFIED","NEWCHANGES_AIVEN_PRODUCTION_APPROVED"]){
   assert.equal(allowWriteLeadership({...all,[key]:"false"}),false,key);
 }
});
test("Neon connection role must be truly read only for migration staging",()=>{
 assert.equal(verifyDatabaseIdentity(verified).ok,true);
 for(const change of [{role_name:"newchanges_cf_migration_reader"},{role_name:"newchanges_owner"},
 {member_superuser:true},{member_privileged_role:true},{can_create_roles:true},{can_create_database:true},
 {can_write_session:true},{member_application_owner:true},{bypasses_rls:true},
 {can_create_database_objects:true},{can_create_public_objects:true},{can_write_any_public_table:true},
 {can_use_or_update_public_sequence:true},{database_name:"other"},{can_read_session:false},{can_read_employer:false}]){
  assert.equal(verifyDatabaseIdentity({...verified,...change}).ok,false,JSON.stringify(change));
 }
});
test("write leader requires separately reviewed write grants, not read-only session role",()=>{
 assert.equal(verifyDatabaseIdentity(verified,{allowWrites:true}).ok,false);
 assert.equal(verifyDatabaseIdentity({...verified,can_write_session:true,can_write_any_public_table:true},{allowWrites:true}).ok,true);
 assert.equal(verifyDatabaseIdentity({...verified,can_write_session:true,member_superuser:true},{allowWrites:true}).ok,false);
});
