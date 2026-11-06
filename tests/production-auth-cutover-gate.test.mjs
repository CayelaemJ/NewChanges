import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const gate=new URL('../scripts/production-auth-cutover-gate.mjs',import.meta.url);
const source=readFileSync(gate,'utf8');
test('MFA release gate is valid JavaScript, local-only and requires real enforcement symbols',()=>{
  const syntax=spawnSync(process.execPath,['--check',gate.pathname],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr);
  assert.match(source,/registerAdminMfaRoutes/);
  assert.match(source,/requiresAdminMfaStepUp/);
  assert.match(source,/hasFreshAdminMfa/);
  assert.match(source,/AdminMfaTotp/);
  assert.match(source,/AdminMfaCredential/);
  assert.match(source,/mfaVerifiedAt/);
  assert.doesNotMatch(source,/DATABASE_URL|fetch\(|pg\.Client|docker run/);
});
test('current migration branch is blocked because actual MFA implementation is not merged',()=>{
  const r=spawnSync(process.execPath,[gate.pathname],{encoding:'utf8',timeout:10000});
  assert.equal(r.status,2,r.stderr);
  assert.match(r.stdout,/BLOCKED: MFA route wiring/);
  assert.match(r.stdout,/BLOCKED: Persistent MFA credential schema/);
  assert.match(r.stderr,/MFA implementation is absent or incomplete/);
  assert.doesNotMatch(r.stdout,/SOURCE GATE PASS/);
});
