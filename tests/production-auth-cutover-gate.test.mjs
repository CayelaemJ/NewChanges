import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const gate=new URL('../scripts/production-auth-cutover-gate.mjs',import.meta.url);
const source=readFileSync(gate,'utf8');
function runFixture(server,schema){
  const home=mkdtempSync(join(tmpdir(),'fixer-mfa-gate-'));
  try{
    for(const dir of ['scripts','src','prisma'])mkdirSync(join(home,dir));
    writeFileSync(join(home,'scripts','production-auth-cutover-gate.mjs'),source);
    writeFileSync(join(home,'src','server.ts'),server);
    writeFileSync(join(home,'prisma','schema.prisma'),schema);
    return spawnSync(process.execPath,[join(home,'scripts','production-auth-cutover-gate.mjs')],{
      encoding:'utf8',timeout:10000
    });
  }finally{rmSync(home,{recursive:true,force:true});}
}
const serverFixture=`
registerAdminMfaRoutes(app);
const stepUp = requiresAdminMfaStepUp(req.method,req.url);
const verified=await hasFreshAdminMfa(req, user.id);
if(!await hasIssuedAdminRecoveryKey(user.id)) return reply.redirect("/mfa");
throw Error("MFA_REQUIRED");
`;
const schemaFixture=`
model AdminMfaTotp { id String @id }
model AdminMfaCredential { id String @id }
model AdminMfaChallenge { id String @id }
model Session { mfaVerifiedAt DateTime? }
`;
test('MFA cutover gate parses and never connects to production or exposes credentials',()=>{
  const syntax=spawnSync(process.execPath,['--check',gate.pathname],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr);
  assert.doesNotMatch(source,/DATABASE_URL|fetch\(|pg\.Client|docker run/);
});
test('synthetic non-MFA release is blocked, without touching a database',()=>{
  const r=runFixture('app.post("/api/auth/login", login);','model Session { id String @id }');
  assert.equal(r.status,2,r.stderr);
  assert.match(r.stdout,/BLOCKED: MFA route wiring/);
  assert.match(r.stdout,/BLOCKED: Persistent MFA credential schema/);
  assert.match(r.stderr,/MFA implementation is absent or incomplete/);
});
test('synthetic integrated MFA source passes only the wiring gate',()=>{
  const r=runFixture(serverFixture,schemaFixture);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/SOURCE GATE PASS/);
  assert.match(r.stdout,/NOT release approval/);
});
test('synthetic partially integrated MFA source still fails closed',()=>{
  const r=runFixture(serverFixture,'model Session { id String @id }');
  assert.equal(r.status,2,r.stderr);
  assert.match(r.stdout,/BLOCKED: Persistent MFA credential schema/);
});
