#!/usr/bin/env node
// Offline Render->Aiven configuration contract; NEVER connects to the database.
// Accepts private DATABASE_URL only from process environment. Does not print it.
import process from 'node:process';

function block(reason) {
  console.error('BLOCKED:',reason);
  process.exitCode=2;
}
try {
  const raw=process.env.DATABASE_URL;
  if (!raw) throw Error('DATABASE_URL is missing from the private runtime environment');
  const url=new URL(raw);
  if (!['postgres:','postgresql:'].includes(url.protocol) ||
      url.hostname!=='the-fixer-postgres-cay-bed7.b.aivencloud.com' ||
      url.port!=='26029' || url.pathname!=='/defaultdb')
    throw Error('DATABASE_URL does not target the approved Aiven PostgreSQL production service');
  if (decodeURIComponent(url.username)!=='newchanges_app_runtime' || !url.password)
    throw Error('Production backend must use the restricted newchanges_app_runtime login');
  if (!['require','verify-ca','verify-full'].includes(url.searchParams.get('sslmode')))
    throw Error('Explicit secure PostgreSQL sslmode required');
  if (url.searchParams.get('connection_limit')!=='2')
    throw Error('For Aiven Free configure connection_limit=2 to bound the Prisma pool');
  if (process.env.NEWCHANGES_EDGE_ORIGIN_GUARD_ENABLED!=='true' ||
      (process.env.NEWCHANGES_EDGE_ORIGIN_SHARED_SECRET||'').length<32)
    throw Error('Private Cloudflare-to-Render origin guard must be configured');
  if (process.env.COOKIE_SECURE!=='true' || process.env.TRUST_PROXY!=='true')
    throw Error('Secure cookies and trusted edge proxy configuration required');
  const standby=process.env.STANDBY_MODE;
  if (standby!=='true' && standby!=='false') throw Error('STANDBY_MODE must be explicit');
  if (standby==='false') {
    if (process.env.NEWCHANGES_CUTOVER_APPROVED!=='YES')
      throw Error('Writing mode requires separately verified production cutover approval');
    // Password-only administrators must never reach the first Aiven writer.
    if (process.env.ADMIN_MFA_ENFORCE!=='true')
      throw Error('Production writer requires mandatory administrator MFA enforcement');
    const rpID=String(process.env.MFA_RP_ID||'').trim();
    const origin=String(process.env.MFA_EXPECTED_ORIGIN||'').trim();
    let matched=false;
    try {
      const url=new URL(origin);
      matched=url.origin===origin && url.protocol==='https:' &&
        (url.hostname===rpID || url.hostname.endsWith('.'+rpID));
    } catch {}
    if (!rpID || !matched)
      throw Error('Production MFA relying party and HTTPS origin must match');
    if (process.env.ADMIN_MFA_TOTP_ENABLED!=='true' ||
        !/^[A-Za-z0-9_-]{43}$/.test(process.env.ADMIN_MFA_TOTP_ENCRYPTION_KEY||''))
      throw Error('Production MFA requires enabled TOTP with a private 32-byte encryption key');
  }
  if (process.env.ENABLE_AUTHORITATIVE_INCREMENTAL_SCHEDULER!=='false')
    throw Error('Free Render cannot run the authoritative background scheduler');
  console.log('PASS: Render Aiven connection contract; restricted role, TLS, pool<=2, private origin guard.');
  console.log('NO CONNECTIVITY OR CUTOVER PROOF: live DB access, backups, MFA and single-writer state unverified.');
} catch(e) {
  block(e instanceof Error?e.message:'Invalid Render runtime configuration');
}
