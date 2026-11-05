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

test("production Cloudflare is an active Aiven writer, never standby",()=>{
  const p=readFileSync(new URL("./preflight.mjs",import.meta.url),"utf8");
  const d=readFileSync(new URL("../../Dockerfile.cloudflare",import.meta.url),"utf8");
  for(const gate of ["NEWCHANGES_ALLOW_WRITES", "NEWCHANGES_CLOUDFLARE_PRIMARY", "NEWCHANGES_SOURCE_WRITERS_FENCED", "NEWCHANGES_FINAL_SYNC_VERIFIED"]){
    assert.ok(p.includes(gate),gate);
  }
  assert.match(p,/const active = process.env.STANDBY_MODE==="false"/);
  assert.match(p,/if \(!validAiven/);
  assert.match(d,/STANDBY_MODE=false TRAFFIC_SAVER_MODE=false/);
  assert.match(d,/verify-database\.mjs/);
  const runCommands=d.split("\\n").filter(line=>/^(RUN|CMD|ENTRYPOINT)\\s/.test(line)).join("\\n");
  assert.doesNotMatch(runCommands,/db:deploy|db:push|db:migrate/);
});

test("runtime role bootstrap is single-use and keeps passwords outside Git and CLI args",()=>{
  const p=readFileSync(new URL("../../scripts/provision-aiven-cloudflare-runtime.sh",import.meta.url),"utf8");
  assert.match(p,/DR_TARGET_DATABASE_URL/);
  assert.match(p,/role exists; inspect it/);
  assert.match(p,/read -r -s -p/);
  assert.match(p,/\\getenv app_password AV_APP_ROLE_PASSWORD/);
  assert.match(p,/NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION/);
  assert.doesNotMatch(p,/DROP ROLE|ALTER ROLE|REVOKE|--password=/);
});
