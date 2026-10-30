import { timingSafeEqual } from 'node:crypto';

// Additional HTTP Basic gate for isolated synthetic staging only.
// Normal application authentication and passkey MFA remain mandatory.
export function isMfaStagingAccessValid(header: unknown, password: unknown): boolean {
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') < 24 ||
      Buffer.byteLength(password, 'utf8') > 256 || typeof header !== 'string' ||
      header.length > 512 || !/^Basic [A-Za-z0-9+/]+=*$/.test(header)) return false;
  let decoded: string;
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); }
  catch { return false; }
  if (!decoded.startsWith('mfa-staging:')) return false;
  const supplied = Buffer.from(decoded.slice('mfa-staging:'.length), 'utf8');
  const expected = Buffer.from(password, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
