import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNeonUrl,verifyFullAppRole,verifyCloudflareNeonPreflight} from '../scripts/cloudflare/verify-full-app-neon.mjs';
const uri='postgresql://allowed-role:synthetic@ep-example.eu-central-1.aws.neon.tech/newchanges?sslmode=require';
const role={database_name:'newchanges',role_name:'allowed-role',is_superuser:false,can_create_database:false,can_create_roles:false,can_bypass_rls:false,member_of_neon_superuser:false,session_read:true,session_write:true,user_read:true};
const env={NEWCHANGES_CLOUDFLARE_WORKLOAD:'true',NEWCHANGES_NEON_PRIMARY_PROJECT:'wild-base-70222190',DATABASE_URL:uri};
test('reject wrong database, non-Neon hosts, bad TLS and forbidden elevated role',()=>{
 assert.equal(validateNeonUrl(uri),true);
 for(const bad of [
 'postgresql://allowed-role:synthetic@evil.invalid/newchanges?sslmode=require',
 'postgresql://allowed-role:synthetic@ep-example.neon.tech/other?sslmode=require',
 'postgresql://allowed-role:synthetic@ep-example.neon.tech/newchanges',
 'postgresql://newchanges_cf_migration_reader:synthetic@ep-example.neon.tech/newchanges?sslmode=require',
 'postgresql://allowed-role:synthetic@ep-example.neon.tech.evil.invalid/newchanges?sslmode=require',
 'postgresql://allowed-role:synthetic@127.0.0.1/newchanges?sslmode=require'
 ])assert.equal(validateNeonUrl(bad),false,bad.replace(/:synthetic@/,'***@'));
});
test('full app requires safe effective role and necessary write permissions',()=>{
 assert.equal(verifyFullAppRole(role),true);
 for(const prop of ['is_superuser','can_create_database','can_create_roles','can_bypass_rls','member_of_neon_superuser'])
 assert.equal(verifyFullAppRole({...role,[prop]:true}),false,prop);
 for(const prop of ['session_read','session_write','user_read'])
 assert.equal(verifyFullAppRole({...role,[prop]:false}),false,prop);
 assert.equal(verifyFullAppRole({...role,role_name:'newchanges_cf_migration_reader'}),false);
});
test('real preflight blocks startup if no actual DB verification is possible',async()=>{
 let calls=0,closed=0;
 const connect=async()=>{calls++;return {query:async()=>({rows:[role]}),end:async()=>{closed++}}};
 assert.equal(await verifyCloudflareNeonPreflight({env,connect}),true);
 assert.equal(calls,1);assert.equal(closed,1);
 await assert.rejects(()=>verifyCloudflareNeonPreflight({env:{...env,DATABASE_URL:'garbage'},connect}));
 assert.equal(calls,1);
 await assert.rejects(()=>verifyCloudflareNeonPreflight({env:{...env,NEWCHANGES_NEON_PRIMARY_PROJECT:'snowy-flower-31527242'},connect}));
 assert.equal(calls,1);
 await assert.rejects(()=>verifyCloudflareNeonPreflight({env,connect:async()=>({query:async()=>({rows:[{...role,member_of_neon_superuser:true}]}),end:async()=>{closed++}})}));
 assert.equal(closed,2);
});
