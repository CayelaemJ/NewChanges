// Pure SQL plan for a disposable Docker rehearsal and the guarded Aiven cutover.
// Only public DataAccessEvent append and Session.lastSeenAt changes are allowed.
// Names are fixed by the verified application schema; paths are escaped SQL literals.
export const auditColumns=[
  'id','userId','actorEmail','method','route','resource','employerId',
  'ipAddress','deviceKey','deviceType','statusCode','durationMs','createdAt'
].map(x=>'"'+x+'"').join(', ');
const literal=s=>"'"+s.replaceAll("'","''")+"'";

export function buildAivenDeltaSql(auditCsvPath,sessionCsvPath) {
  if (!auditCsvPath.startsWith('/')||!sessionCsvPath.startsWith('/')||
      auditCsvPath.includes('\n')||sessionCsvPath.includes('\n'))
    throw new Error('Only absolute local staging paths are allowed');
  return [
    'BEGIN;',
    'CREATE TEMP TABLE audit_stage (LIKE public."DataAccessEvent" INCLUDING DEFAULTS) ON COMMIT DROP;',
    'CREATE TEMP TABLE session_stage ("id" text PRIMARY KEY, "lastSeenAt" timestamp without time zone) ON COMMIT DROP;',
    '\\copy audit_stage ('+auditColumns+') FROM '+literal(auditCsvPath)+" WITH (FORMAT csv, NULL '\\N')",
    '\\copy session_stage ("id","lastSeenAt") FROM '+literal(sessionCsvPath)+" WITH (FORMAT csv, NULL '\\N')",
    'DO $check$ BEGIN',
    ' IF (SELECT count(*) FROM session_stage) <> (SELECT count(*) FROM public."Session") OR',
    ' EXISTS (SELECT 1 FROM public."Session" t WHERE NOT EXISTS (SELECT 1 FROM session_stage s WHERE s.id=t.id))',
    " THEN RAISE EXCEPTION 'Session inventory changed; refusing delta'; END IF;",
    ' IF EXISTS (SELECT 1 FROM audit_stage s JOIN public."DataAccessEvent" t ON t.id=s.id WHERE to_jsonb(s)<>to_jsonb(t))',
    " THEN RAISE EXCEPTION 'Existing audit history differs; refusing delta'; END IF;",
    'END $check$;',
    'INSERT INTO public."DataAccessEvent" ('+auditColumns+') SELECT '+auditColumns+' FROM audit_stage WHERE true ON CONFLICT ("id") DO NOTHING;',
    'UPDATE public."Session" d SET "lastSeenAt"=s."lastSeenAt" FROM session_stage s',
    'WHERE d.id=s.id AND d."lastSeenAt" IS DISTINCT FROM s."lastSeenAt";',
    'COMMIT;'
  ].join('\n')+'\n';
}
