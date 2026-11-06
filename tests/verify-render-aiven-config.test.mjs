import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const script=new URL('../scripts/verify-render-aiven-config.mjs',import.meta.url).pathname;
const base={
  DATABASE_URL:'postgresql://newchanges_app_runtime:synthetic@the-fixer-postgres-cay-bed7.b.aivencloud.com:26029/defaultdb?sslmode=require&connection_limit=2',
  STANDBY_MODE:'true',
  NEWCHANGES_EDGE_ORIGIN_GUARD_ENABLED:'true',
  NEWCHANGES_EDGE_ORIGIN_SHARED_SECRET:'synthetic-only-unguessable-token-32-chars',
  COOKIE_SECURE:'true',
  TRUST_PROXY:'true',
  ENABLE_AUTHORITATIVE_INCREMENTAL_SCHEDULER:'false',
};
const run=(add={})=>spawnSync(process.execPath,[script],{encoding:'utf8',env:{PATH:process.env.PATH??'',...base,...add}});
test('valid restricted synthetic contract is accepted without a connection',()=>{
 const r=run();assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/NO CONNECTIVITY OR CUTOVER PROOF/);
});
test('missing URL, wrong host, admin role and unbounded pool all fail',()=>{
 for(const add of [
  {DATABASE_URL:''},
  {DATABASE_URL:base.DATABASE_URL.replace('the-fixer-postgres-cay-bed7.b.aivencloud.com','bad.invalid')},
  {DATABASE_URL:base.DATABASE_URL.replace('newchanges_app_runtime','avnadmin')},
  {DATABASE_URL:base.DATABASE_URL.replace('connection_limit=2','connection_limit=20')},
  {DATABASE_URL:base.DATABASE_URL.replace('sslmode=require','sslmode=prefer')},
 ]){const r=run(add);assert.equal(r.status,2,r.stderr);assert.match(r.stderr,/BLOCKED/);assert.doesNotMatch(r.stderr,/synthetic@/);}
});
test('backend remains fenced without authenticated private edge and cutover',()=>{
 for(const add of [
  {NEWCHANGES_EDGE_ORIGIN_SHARED_SECRET:''},
  {NEWCHANGES_EDGE_ORIGIN_GUARD_ENABLED:'false'},
  {STANDBY_MODE:'false'},
  {ENABLE_AUTHORITATIVE_INCREMENTAL_SCHEDULER:'true'}
 ]){const r=run(add);assert.equal(r.status,2,r.stderr);}
});

test('writer mode rejects missing MFA enforcement, RP, HTTPS origin and TOTP key',()=>{
 const approved={STANDBY_MODE:'false',NEWCHANGES_CUTOVER_APPROVED:'YES'};
 for (const missing of [
   {},
   {ADMIN_MFA_ENFORCE:'true'},
   {ADMIN_MFA_ENFORCE:'true',MFA_RP_ID:'thefixer.invalid',MFA_EXPECTED_ORIGIN:'http://thefixer.invalid'},
   {ADMIN_MFA_ENFORCE:'true',MFA_RP_ID:'thefixer.invalid',MFA_EXPECTED_ORIGIN:'https://thefixer.invalid'},
   {ADMIN_MFA_ENFORCE:'true',MFA_RP_ID:'thefixer.invalid',MFA_EXPECTED_ORIGIN:'https://thefixer.invalid',
     ADMIN_MFA_TOTP_ENABLED:'true',ADMIN_MFA_TOTP_ENCRYPTION_KEY:'invalid'}
 ]) {
   const r=run({...approved,...missing});
   assert.equal(r.status,2,r.stderr);
   assert.match(r.stderr,/BLOCKED/);
 }
 const r=run({...approved,ADMIN_MFA_ENFORCE:'true',MFA_RP_ID:'thefixer.invalid',
   MFA_EXPECTED_ORIGIN:'https://thefixer.invalid',ADMIN_MFA_TOTP_ENABLED:'true',
   ADMIN_MFA_TOTP_ENCRYPTION_KEY:'a'.repeat(43)});
 assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/PASS: Render Aiven connection contract/);
});
