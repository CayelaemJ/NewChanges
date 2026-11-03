import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNeonUrl,verifyFullAppRole,verifyCloudflareNeonPreflight} from '../scripts/cloudflare/verify-full-app-neon.mjs';
// Build wholly synthetic connection fixtures at runtime so credential scanners
// remain strict; never store even realistic-looking credentialed URLs in Git.
function fixture(host='ep-example.eu-central-1.aws.neon.tech',db='newchanges',user='allowed-role',tls=true){
 const url=new URL('postgresql://' + user + '@' + host + '/' + db);
 url.password='synthetic';
 if(tls)url.searchParams.set('sslmode','require');
 return url.toString();
}
const uri=fixture();
const role={database_name:'newchanges',role_name:'allowed-role',is_superuser:false,can_create_database:false,can_create_roles:false,can_bypass_rls:false,member_of_neon_superuser:false,session_read:true,session_write:true,user_read:true};
const env={NEWCHANGES_CLOUDFLARE_WORKLOAD:'true',NEWCHANGES_NEON_PRIMARY_PROJECT:'wild-base-70222190',DATABASE_URL:uri};
test('reject wrong database, non-Neon hosts, bad TLS and forbidden elevated role',()=>{
 assert.equal(validateNeonUrl(uri),true);
 const bad=[
  fixture('evil.invalid'),fixture('ep-example.neon.tech','other'),
  fixture('ep-example.neon.tech','newchanges','allowed-role',false),
  fixture('ep-example.neon.tech','newchanges','newchanges_cf_migration_reader'),
  fixture('ep-example.neon.tech.evil.invalid'),fixture('127.0.0.1')
 ];
 for(const item of bad)assert.equal(validateNeonUrl(item),false);
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
