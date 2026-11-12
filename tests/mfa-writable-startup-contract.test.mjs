import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
const contract=readFileSync(new URL('../scripts/verify-render-aiven-config.mjs',import.meta.url),'utf8');
test('writable production candidate fails closed without MFA at application startup',()=>{
 const gate=server.slice(server.indexOf('const MFA_ENFORCE ='),server.indexOf('if (MFA_ENFORCE) {'));
 assert.match(gate,/NODE_ENV === "production"/);
 assert.match(gate,/STANDBY_MODE === "false"/);
 assert.match(gate,/if \(!MFA_ENFORCE\) throw new Error/);
 assert.match(gate,/ADMIN_MFA_TOTP_ENABLED/);
 assert.match(gate,/ADMIN_MFA_TOTP_ENCRYPTION_KEY/);
});
test('release configuration independently requires all-account MFA, RP and encrypted TOTP',()=>{
 assert.match(contract,/MFA_ENFORCE/);
 assert.match(contract,/every account/);
 assert.match(contract,/MFA_RP_ID/);
 assert.match(contract,/MFA_EXPECTED_ORIGIN/);
 assert.match(contract,/ADMIN_MFA_TOTP_ENABLED/);
 assert.match(contract,/ADMIN_MFA_TOTP_ENCRYPTION_KEY/);
});
