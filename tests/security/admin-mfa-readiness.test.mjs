import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Intentionally separate from the green CI gate until genuine MFA is implemented.
// This is a readiness contract, NOT proof that MFA is installed.
const read = p => readFileSync(p,'utf8').replace(/\r\n/g,'\n');
test('privileged admin guard requires MFA step-up in addition to role authentication',()=>{
  const server=read('src/server.ts');
  const guard=server.match(/async function requireAdmin\([\s\S]*?\n}\n/);
  assert.ok(guard,'Admin guard must exist');
  assert.match(guard[0],/ADMIN|SUPERADMIN/,'Admin guard must check roles');
  assert.match(guard[0],/mfa|stepUp|secondFactor|webauthn|totp/i,
    'MFA is NOT enforced by requireAdmin: implement verified, session-bound MFA step-up before privileged changes');
});
test('MFA verification state has a server-side persistence contract',()=>{
  const schema=read('prisma/schema.prisma');
  assert.match(schema,/mfa|secondFactor|authenticator|webauthn|totp/i,
    'No persisted MFA enrollment/verification model found; do not claim admin MFA enforcement');
});
