import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyDatabaseIdentity } from "./verify-database.mjs";

const allowed = {
  role_name:"newchanges_app_runtime", database_name:"defaultdb",
  is_superuser:false, can_create_database:false, can_create_roles:false,
  bypasses_rls:false, member_superuser:false, member_privileged_role:false,
  member_application_owner:false, can_create_database_objects:false,
  can_create_public_objects:false, can_read_session:true, can_read_employer:true,
  can_write_session:true, can_write_any_public_table:true,
  can_use_or_update_public_sequence:false
};
test("restricted Aiven application writer accepted only by provider-specific policy",()=>{
  assert.equal(verifyDatabaseIdentity(allowed,{provider:"aiven",allowWrites:true}).ok,true);
  assert.equal(verifyDatabaseIdentity(allowed,{provider:"neon",allowWrites:true}).ok,false);
  assert.equal(verifyDatabaseIdentity(allowed,{provider:"aiven",allowWrites:false}).ok,false);
});
test("Aiven admin and elevated database principals are never accepted",()=>{
  for(const changes of [{role_name:"avnadmin"},{can_create_public_objects:true},
    {member_application_owner:true},{is_superuser:true},{member_privileged_role:true}]){
    assert.equal(verifyDatabaseIdentity({...allowed,...changes},{provider:"aiven",allowWrites:true}).ok,false);
  }
});
test("Cloudflare Aiven production target requires explicit provider and approval",()=>{
  const p=readFileSync(new URL("./preflight.mjs",import.meta.url),"utf8");
  assert.match(p,/NEWCHANGES_DATABASE_PROVIDER/);
  assert.match(p,/NEWCHANGES_AIVEN_PRODUCTION_APPROVED/);
  assert.match(p,/the-fixer-postgres-cay-bed7/);
  assert.match(p,/pg_has_role\(r.oid,nr.oid,'MEMBER'\)/);
});
