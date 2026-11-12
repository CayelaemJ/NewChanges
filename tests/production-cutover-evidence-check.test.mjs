import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const checker=new URL('../scripts/production-cutover-evidence-check.mjs',import.meta.url).pathname;
const run=(path)=>spawnSync(process.execPath,[checker,...(path?[path]:[])],{encoding:'utf8'});
test('missing evidence fails closed without production credentials',()=>{
 const r=run();
 assert.equal(r.status,2);
 assert.match(r.stderr,/BLOCKED/);
});
test('incomplete evidence cannot authorize a cutover',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cutover-proof-'));
 try {
   const file=join(dir,'evidence.json');
   writeFileSync(file,JSON.stringify({environment:'production',source:'Neon:newchanges',target:'Aiven:the-fixer-postgres/defaultdb'}));
   const r=run(file);
   assert.equal(r.status,2);
   assert.match(r.stderr,/sourceBackup/);
   assert.match(r.stderr,/sourceWritersFenced/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('complete synthetic manifest validates structure, not a real release',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cutover-proof-'));
 try {
   const file=join(dir,'synthetic.json');
   const names=['sourceBackup','targetBackup','sourceWritersFenced','backgroundJobsFenced','finalDeltaComplete','contentReconciliation','authenticationAndMfaVerified','singleWriterVerified','rollbackReviewed'];
   const manifest={environment:'production',source:'Neon:newchanges',target:'Aiven:the-fixer-postgres/defaultdb',
     oldWriterStoppedAt:'2026-11-06T10:00:00Z',finalDeltaFinishedAt:'2026-11-06T10:01:00Z'};
   for(const name of names) manifest[name]={verified:true,evidence:'SYNTHETIC TEST ONLY',checkedAt:'2026-11-06T10:01:00Z'};
   for(const name of ['sourceBackup','targetBackup'])Object.assign(manifest[name],{
     restoreTested:true,offsiteCopy:true,sha256:'a'.repeat(64),
     scope:'full_database',
     recoveryMethod:name==='sourceBackup'?'neon_compatible_full_restore':'isolated_postgresql18_full_restore',
     extensionCompatibilityVerified:true,authenticationRecoveryVerified:true
   });
   writeFileSync(file,JSON.stringify(manifest));
   const r=run(file);
   assert.equal(r.status,0,r.stderr);
   assert.match(r.stdout,/NOT AUTHORIZATION/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('portable Neon source restoration never qualifies as full disaster recovery',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cutover-proof-'));
 try{
   const file=join(dir,'portable.json');
   const names=['sourceBackup','targetBackup','sourceWritersFenced','backgroundJobsFenced',
     'finalDeltaComplete','contentReconciliation','authenticationAndMfaVerified',
     'singleWriterVerified','rollbackReviewed'];
   const manifest={environment:'production',source:'Neon:newchanges',
     target:'Aiven:the-fixer-postgres/defaultdb',
     oldWriterStoppedAt:'2026-11-06T10:00:00Z',finalDeltaFinishedAt:'2026-11-06T10:01:00Z'};
   for(const name of names)manifest[name]={
     verified:true,evidence:'SYNTHETIC ONLY',checkedAt:'2026-11-06T10:01:00Z'
   };
   for(const name of ['sourceBackup','targetBackup'])Object.assign(manifest[name],{
     restoreTested:true,offsiteCopy:true,sha256:'a'.repeat(64),
     scope:'full_database',extensionCompatibilityVerified:true,
     authenticationRecoveryVerified:true,
     recoveryMethod:name==='sourceBackup'?'neon_compatible_full_restore':'isolated_postgresql18_full_restore'
   });
   manifest.sourceBackup.scope='portable_public_only';
   manifest.sourceBackup.extensionCompatibilityVerified=false;
   writeFileSync(file,JSON.stringify(manifest));
   const r=run(file);
   assert.equal(r.status,2,r.stderr);
   assert.match(r.stderr,/sourceBackup: full database scope/);
 } finally{rmSync(dir,{recursive:true,force:true});}
});
