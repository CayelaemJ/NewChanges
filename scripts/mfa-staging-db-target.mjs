// Exact database target identity for the SYNTHETIC Render MFA preview.
// Never accept arbitrary PostgreSQL URLs or customer/production databases.
export const RENDER_STAGING_DB_ID='dpg-dbib30142hec73cus92g-a';
export const RENDER_STAGING_DB_NAME='newchanges_mfa_synthetic_staging_db';
export const EPHEMERAL_STAGING_URL='postgresql://node@127.0.0.1:55432/newchanges_mfa_ephemeral';

export function isApprovedManagedStagingUrl(raw) {
  if(typeof raw!=='string' || !raw || raw.length>4096) return false;
  try {
    const parsed=new URL(raw);
    const host=parsed.hostname.toLowerCase();
    const exactHost=host===RENDER_STAGING_DB_ID;
    const regionalHost=host===RENDER_STAGING_DB_ID+'.frankfurt-postgres.render.com';
    return ['postgresql:','postgres:'].includes(parsed.protocol) &&
      (exactHost || regionalHost) &&
      parsed.pathname==='/'+RENDER_STAGING_DB_NAME &&
      !!parsed.username && !!parsed.password &&
      (!parsed.port || parsed.port==='5432') &&
      !parsed.hash && !parsed.searchParams.has('schema');
  }catch {return false;}
}

export function approvedStagingDatabaseEnvironment(env) {
  if(env.MFA_STAGING_ONLY!=='true' ||
    env.MFA_STAGING_SYNTHETIC_ONLY!=='true' ||
    env.STANDBY_MODE!=='true' ||
    env.TRAFFIC_SAVER_MODE!=='true' ||
    env.NODE_ENV!=='production') return false;
  if(env.MFA_STAGING_LOCAL_EPHEMERAL_DB==='true')
    return env.MFA_STAGING_MANAGED_DB!=='true' &&
      env.DATABASE_URL===EPHEMERAL_STAGING_URL;
  return env.MFA_STAGING_LOCAL_EPHEMERAL_DB==='false' &&
    env.MFA_STAGING_MANAGED_DB==='true' &&
    isApprovedManagedStagingUrl(env.DATABASE_URL);
}
