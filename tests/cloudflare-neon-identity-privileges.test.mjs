import test from 'node:test';
import assert from 'node:assert/strict';
import {requireNeonIdentityReader,verifyNeonIdentityPrivileges} from '../cloudflare/neon-identity-privileges.mjs';
const safe={database_name:'newchanges',role_name:'newchanges_cf_reader_verified',is_superuser:false,can_create_database:false,can_create_roles:false,member_of_neon_superuser:false,session_read:true,user_read:true,user_employer_read:true,session_write:false,employer_read:false};
test('a genuinely scoped Neon identity role is accepted',async()=>{
 assert.equal(verifyNeonIdentityPrivileges(safe).allowed,true);
 const prisma={$queryRaw:async ()=>[safe]};
 assert.equal(await requireNeonIdentityReader(prisma),true);
});
test('the originally created Neon migration role is denied even if explicit grants look narrow',()=>{
 const unsafe={...safe,role_name:'newchanges_cf_migration_reader',can_create_database:true,can_create_roles:true,member_of_neon_superuser:true,session_write:true,employer_read:true};
 const result=verifyNeonIdentityPrivileges(unsafe);
 assert.equal(result.allowed,false);
 assert.ok(result.violations.some(x=>x.includes('Elevated')));
});
test('silently inherited privileges, wrong database, or overly broad permissions fail closed',()=>{
 for(const change of [{member_of_neon_superuser:true},{is_superuser:true},{can_create_roles:true},{can_create_database:true},{session_write:true},{employer_read:true},{database_name:'other'},{session_read:false},{user_read:false},{user_employer_read:false},{role_name:null}]){
  assert.equal(verifyNeonIdentityPrivileges({...safe,...change}).allowed,false,JSON.stringify(change));
 }
});
test('missing or incomplete audit evidence rejects the connection',async()=>{
 assert.equal(verifyNeonIdentityPrivileges(null).allowed,false);
 await assert.rejects(()=>requireNeonIdentityReader({$queryRaw:async()=>[]}));
 await assert.rejects(()=>requireNeonIdentityReader({}));
});
