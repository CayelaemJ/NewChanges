#!/usr/bin/env node
// Non-destructive source review gate: never reads real accounts, tokens or database URLs.
// This detects whether the migration release branch contains the required MFA
// enforcement mechanism from the dedicated MFA workstream. It is NOT a proof
// of end-to-end authentication or tenant isolation.
import { readFileSync } from 'node:fs';
const base=new URL('../',import.meta.url);
const file=path=>readFileSync(new URL(path,base),'utf8');
const checks=[
  ['MFA route wiring',()=>/registerAdminMfaRoutes\(app\)/.test(file('src/server.ts'))],
  ['Sensitive-route step-up enforcement',()=>/requiresAdminMfaStepUp\(/.test(file('src/server.ts'))&&/hasFreshAdminMfa\(/.test(file('src/server.ts'))],
  ['Account enrollment and recovery gating',()=>/hasIssuedAdminRecoveryKey\(/.test(file('src/server.ts'))&&/MFA_REQUIRED|\/mfa/.test(file('src/server.ts'))],
  ['Persistent MFA credential schema',()=>/model AdminMfaTotp\s*\{/.test(file('prisma/schema.prisma'))&&/model AdminMfaCredential\s*\{/.test(file('prisma/schema.prisma'))],
  ['MFA challenge/session schema',()=>/model AdminMfaChallenge\s*\{/.test(file('prisma/schema.prisma'))&&/mfaVerifiedAt\s+DateTime\?/.test(file('prisma/schema.prisma'))]
];
let blocked=0;
for(const [label,verify] of checks){
  let ok=false;
  try{ok=Boolean(verify());}catch{}
  console.log((ok?'PASS':'BLOCKED')+': '+label);
  if(!ok)blocked++;
}
if(blocked){
  console.error('BLOCKED: MFA implementation is absent or incomplete on this release branch. '+blocked+' gate(s) failed.');
  console.error('The MFA workstream must be integrated, built, tested and deployed before any production cutover.');
  process.exitCode=2;
}else{
  console.log('SOURCE GATE PASS: mandatory MFA wiring is present. NOT release approval.');
  console.log('Still required: isolated MFA E2E, cross-tenant authorization, production-compatible recovery and operator review.');
}
