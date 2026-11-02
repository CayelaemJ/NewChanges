import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {decodeTotpSecret,decryptTotpSecret,encryptTotpSecret,
 findTotpStep,generateTotpSecret,makeTotpUri,makeTotpQrSvgDataUri,
 requireTotpEncryptionKey,totpCode,totpIsEnabled} from '../../src/services/adminTotp.js';

const rfcSeed='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
test('RFC 6238 SHA1 test vectors and code window',()=>{
 assert.equal(totpCode(rfcSeed,Math.floor(59/30),8),'94287082');
 assert.equal(totpCode(rfcSeed,Math.floor(1111111109/30),8),'07081804');
 assert.equal(totpCode(rfcSeed,Math.floor(1111111111/30),8),'14050471');
 const code=totpCode(rfcSeed,Math.floor(59/30));
 assert.equal(findTotpStep(rfcSeed,code,59000),1n);
 assert.equal(findTotpStep(rfcSeed,code,59000,1n),null);
 assert.equal(findTotpStep(rfcSeed,code,59000,2n),null);
 assert.equal(findTotpStep(rfcSeed,'00000a',59000),null);
 assert.equal(findTotpStep(rfcSeed,'1234567',59000),null);
});
test('generated secrets are unique 160-bit Base32 and encrypted with authenticated GCM',()=>{
 const key=randomBytes(32);
 const a=generateTotpSecret(),b=generateTotpSecret();
 assert.match(a,/^[A-Z2-7]{32}$/);
 assert.notEqual(a,b);
 assert.equal(decodeTotpSecret(a).length,20);
 const ciphertext=encryptTotpSecret(a,key);
 assert.doesNotMatch(ciphertext,new RegExp(a));
 assert.equal(decryptTotpSecret(ciphertext,key),a);
 assert.throws(()=>decryptTotpSecret(ciphertext,randomBytes(32)));
 const bad=ciphertext.slice(0,-1)+(ciphertext.endsWith('A')?'B':'A');
 assert.throws(()=>decryptTotpSecret(bad,key));
});
test('TOTP is feature-gated and requires distinct random configured encryption key',()=>{
 assert.equal(totpIsEnabled({ADMIN_MFA_TOTP_ENABLED:'true'}),true);
 assert.equal(totpIsEnabled({ADMIN_MFA_TOTP_ENABLED:'false'}),false);
 const key=randomBytes(32).toString('base64url');
 assert.equal(requireTotpEncryptionKey({ADMIN_MFA_TOTP_ENCRYPTION_KEY:key}).length,32);
 assert.throws(()=>requireTotpEncryptionKey({}));
 assert.throws(()=>requireTotpEncryptionKey({ADMIN_MFA_TOTP_ENCRYPTION_KEY:'not-secure'}));
});
test('QR is an actual locally generated scannable SVG and never invokes remote image APIs',async()=>{
 const otpauth=makeTotpUri('mfa-superadmin-a@example.invalid',generateTotpSecret());
 assert.match(otpauth,/^otpauth:\/\/totp\//);
 assert.match(otpauth,/issuer=The%20Fixer/);
 const svgUri=await makeTotpQrSvgDataUri(otpauth);
 assert.match(svgUri,/^data:image\/svg\+xml;base64,/);
 const svg=Buffer.from(svgUri.slice(svgUri.indexOf(',')+1),'base64').toString('utf8');
 assert.match(svg,/<svg/);
 assert.match(svg,/<path|<rect/);
 assert.doesNotMatch(svg,/<image[^>]+href=["']https?:/i);
 assert.doesNotMatch(svg,/<script\b/i);
 const implementation=readFileSync('src/services/adminTotp.ts','utf8');
 assert.doesNotMatch(implementation,/fetch\(|https:\/\//);
});
test('authenticator app has a dedicated grant and private QR user flow',()=>{
 const html=readFileSync('public/admin-mfa.html','utf8');
 const js=readFileSync('public/admin-mfa.js','utf8');
 assert.match(html,/id="totp-grant"/);
 assert.match(html,/id="totp-qr"/);
 assert.match(html,/id="totp-confirm-code"/);
 assert.match(html,/id="totp-code"/);
 assert.match(js,/getElementById\('totp-grant'\)\.value\.trim\(\)/);
 assert.match(js,/api\('totp\/setup'/);
 assert.match(js,/api\('totp\/confirm'/);
 assert.match(js,/api\('totp\/verify'/);
 assert.doesNotMatch(js,/localStorage\.setItem\([^)]*totp/i);
});
test('existing administrator MFA is required on read-only business APIs as well as dashboard pages',()=>{
 const server=readFileSync('src/server.ts','utf8');
 assert.match(server,/protectedAdminRead = path\.startsWith\("\/api\/"\)/);
 assert.match(server,/!scope\.adminOnly && !scope\.adminMutation && !protectedAdminRead/);
 assert.match(server,/if \(MFA_ENFORCE && isAdminRole\(user\) && !await hasFreshAdminMfa\(req,user\.id\)\)/);
 assert.match(server,/mfaRequired:true/);
 assert.match(server,/sections:\[\],employers:\[\]/);
});
test('TOTP and passkey rate limits have separate tight buckets and status is read-only',()=>{
 const server=readFileSync('src/server.ts','utf8');
 assert.match(server,/path\.startsWith\("\/api\/auth\/mfa\/totp\/"\) \? "mfa-totp"/);
 assert.match(server,/bucket === "mfa-status" \? 60 : 16/);
 assert.match(server,/!rateLimit\(reply, `\$\{bucket\}:\$\{ip\}`, limit, 5 \* 60_000\)/);
});
test('all protected MFA routes and two-superadmin recovery treat TOTP separately',()=>{
 const s=readFileSync('src/services/adminMfaRoutes.ts','utf8');
 assert.match(s,/\/api\/auth\/mfa\/totp\/setup/);
 assert.match(s,/\/api\/auth\/mfa\/totp\/confirm/);
 assert.match(s,/\/api\/auth\/mfa\/totp\/verify/);
 assert.match(s,/hasFreshAdminMfa\(req,session\.userId,'PASSKEY'\)/);
 assert.match(s,/adminMfaTotp\.deleteMany\(\{where:\{userId:target\.id\}\}\)/);
 assert.match(s,/mfaMethod:method/);
 assert.match(s,/lastUsedStep:\{lt:step\}/);
});
