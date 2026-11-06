// Fail-closed server-side WebAuthn authentication verification adapter.
// Requires an installed, vetted @simplewebauthn/server package before use.
// No browser-supplied verification flags are accepted.
export async function verifyAdminPasskeyAssertion({
  response, challenge, origin, rpID, credential,
}) {
  if (!response || typeof response !== 'object' ||
      typeof challenge !== 'string' || !/^[-_A-Za-z0-9]{43}$/.test(challenge) ||
      typeof origin !== 'string' || typeof rpID !== 'string' ||
      !credential || typeof credential.id !== 'string' ||
      response.id !== credential.id ||
      typeof credential.publicKey !== 'string' ||
      !Number.isSafeInteger(credential.counter) || credential.counter < 0) return null;
  let site;
  try { site = new URL(origin); } catch { return null; }
  if (site.protocol !== 'https:' && site.hostname !== 'localhost') return null;
  if (site.hostname !== rpID && !site.hostname.endsWith('.'+rpID)) return null;
  try {
    // Deliberately fails closed when the library is absent; do not bypass verification.
    const {verifyAuthenticationResponse} = await import('@simplewebauthn/server');
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge:challenge,
      expectedOrigin:site.origin,
      expectedRPID:rpID,
      requireUserVerification:true,
      credential:{
        id:credential.id,
        publicKey:new Uint8Array(Buffer.from(credential.publicKey,'base64url')),
        counter:credential.counter,
        transports:credential.transports||[],
      },
    });
    if (result.verified !== true || result.authenticationInfo?.userVerified !== true ||
        !Number.isSafeInteger(result.authenticationInfo?.newCounter) ||
        result.authenticationInfo.newCounter < 0) return null;
    return {credentialId:credential.id,previousCounter:credential.counter,
      newCounter:result.authenticationInfo.newCounter};
  } catch { return null; }
}
