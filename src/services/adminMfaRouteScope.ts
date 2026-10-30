// Pure request scope policy for administrator MFA enforcement.
// Only classify routes; authentication and verification happen server-side.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function requiresAdminMfaStepUp(method: string, rawPath: string): {
  adminOnly: boolean;
  adminMutation: boolean;
} {
  const path = rawPath.split('?', 1)[0];
  if (!path.startsWith('/api/')) return { adminOnly: false, adminMutation: false };
  const adminOnly = path === '/api/admin' || path.startsWith('/api/admin/');
  // The auth ceremony, sign-in, sign-out, reset and public contact endpoint
  // must remain usable before any MFA state exists.
  const isPublicOrCeremony = path === '/api/contact' ||
    path === '/api/auth' || path.startsWith('/api/auth/');
  return {
    adminOnly,
    adminMutation: MUTATING_METHODS.has(method.toUpperCase()) && !isPublicOrCeremony,
  };
}
