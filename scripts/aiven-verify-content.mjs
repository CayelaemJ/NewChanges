#!/usr/bin/env node
// Read-only final-sync rehearsal. Compares row CONTENT, not merely row counts.
// Never prints passwords, tokens, session IDs, row contents or fingerprints.
import { spawnSync } from 'node:child_process';

const source = process.env.DR_SOURCE_DATABASE_URL;
const target = process.env.DR_TARGET_DATABASE_URL;
function connection(raw, side) {
  if (!raw) throw new Error('Missing ' + side + ' database URL');
  const u = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(u.protocol)) throw new Error('Invalid database URL');
  const host = u.hostname.toLowerCase(), db = decodeURIComponent(u.pathname.slice(1));
  if (side === 'source' && (!host.endsWith('.neon.tech') || db !== 'newchanges')) throw new Error('Unexpected source');
  if (side === 'target' && (host !== 'the-fixer-postgres-cay-bed7.b.aivencloud.com' || db !== 'defaultdb' || u.port !== '26029')) throw new Error('Unexpected target');
  const env = { ...process.env };
  for (const key of ['PGHOST','PGHOSTADDR','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGOPTIONS','PGSERVICE','PGSERVICEFILE','PGSSLMODE','PGCHANNELBINDING']) delete env[key];
  Object.assign(env, {
    PGHOST: host, PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: db, PGSSLMODE: u.searchParams.get('sslmode') || 'require',
    PGCONNECT_TIMEOUT: '15'
  });
  if (u.searchParams.has('channel_binding')) env.PGCHANNELBINDING = u.searchParams.get('channel_binding');
  return env;
}

function query(env, sql, stage) {
  const r = spawnSync('psql', ['-X','-w','-A','-t','-q','-v','ON_ERROR_STOP=1','-f','-'], {
    input: "BEGIN TRANSACTION READ ONLY;\nSET LOCAL statement_timeout='120s';\n" + sql + ";\nCOMMIT;\n",
    env, encoding: 'utf8', timeout: 130000, maxBuffer: 1024 * 1024
  });
  if (r.status !== 0 || r.error) throw new Error('Read-only query failed at ' + stage + ' (credentials and SQL omitted)');
  return r.stdout.trim();
}
function json(env, sql, stage) {
  const wrapped = 'SELECT COALESCE(json_agg(row_to_json(x)), \'[]\'::json)::text FROM (' + sql + ') x';
  return JSON.parse(query(env, wrapped, stage));
}
const quote = x => '"' + x.replaceAll('"','""') + '"';
const digest = (table, limit = null) => {
  let inner = 'SELECT * FROM public.' + quote(table);
  if (limit !== null) inner += ' ORDER BY "createdAt", id LIMIT ' + limit;
  const normalization = table === 'Session' ? "to_jsonb(t) - 'lastSeenAt'" : 'row_to_json(t)';
  return 'SELECT md5(' + normalization + '::text) AS h FROM (' + inner + ') t';
};
const aggregate = (table, limit = null) =>
  'SELECT ' + "'" + table + "'" +
  ' AS table_name, count(*)::text AS row_count,' +
  ' md5(coalesce(string_agg(h,' + "',' ORDER BY h COLLATE \"C\"), 'EMPTY')) AS fingerprint" +
  ' FROM (' + digest(table, limit) + ') v';

try {
  const senv = connection(source, 'source'), tenv = connection(target, 'target');
  const meta = 'SELECT tablename AS name FROM pg_tables WHERE schemaname=\'public\' ORDER BY tablename';
  const a = json(senv,meta,'source table metadata').map(x=>x.name);
  const b = json(tenv,meta,'target table metadata').map(x=>x.name);
  if (a.length !== 57 || a.join('|') !== b.join('|')) throw new Error('Application table inventory differs: stop');
  const tables = a.filter(x=>x !== 'DataAccessEvent');
  let mismatch = 0;
  for (let i=0;i<tables.length;i+=8) {
    const batch = tables.slice(i,i+8);
    const sql = batch.map(name => aggregate(name)).join(' UNION ALL ');
    const s = json(senv,sql,'source content batch');
    const t = json(tenv,sql,'target content batch');
    const targetByName = new Map(t.map(x=>[x.table_name,x]));
    for (const row of s) {
      const compared=targetByName.get(row.table_name);
      if (!compared || row.row_count !== compared.row_count || row.fingerprint !== compared.fingerprint) {
        mismatch++;
        console.log('CONTENT MISMATCH:', row.table_name, '(source=' + row.row_count + ', target=' + (compared?.row_count ?? '?') + ')');
      }
    }
  }
  const count = 'SELECT count(*)::text AS n FROM public."DataAccessEvent"';
  const targetAudit = Number(json(tenv,count,'target audit count')[0].n);
  const sourceAudit = Number(json(senv,count,'source audit count')[0].n);
  if (!Number.isSafeInteger(targetAudit) || !Number.isSafeInteger(sourceAudit) || targetAudit > sourceAudit) throw new Error('Invalid audit inventory');
  const sa = json(senv,aggregate('DataAccessEvent',targetAudit),'source audit prefix')[0];
  const ta = json(tenv,aggregate('DataAccessEvent'),'target audit prefix')[0];
  const auditHistoryMatches = sa.row_count===ta.row_count && sa.fingerprint===ta.fingerprint;
  // Each source/target session is compared by an in-memory hash of its ID. Nothing identifiable is printed.
  const lastSeenSql = 'SELECT md5(id) AS id_hash, md5(coalesce(to_jsonb("lastSeenAt")::text,\'null\')) AS seen_hash FROM public."Session"';
  const ss = json(senv,lastSeenSql,'source session activity'), st = json(tenv,lastSeenSql,'target session activity');
  const tm = new Map(st.map(x=>[x.id_hash,x.seen_hash]));
  const sessionChanges = ss.filter(x=>tm.get(x.id_hash)!==x.seen_hash).length;
  const sessionMissing = ss.filter(x=>!tm.has(x.id_hash)).length;
  console.log('CONTENT SUMMARY: identical_application_tables=' + (tables.length-mismatch) +
    '/' + tables.length + '; mismatches=' + mismatch);
  console.log('AUDIT PREFIX: ' + (auditHistoryMatches ? 'MATCH' : 'MISMATCH') +
    '; source_rows=' + sourceAudit + '; target_rows=' + targetAudit +
    '; new_source_events=' + (sourceAudit-targetAudit));
  console.log('SESSION ACTIVITY: changed_or_missing=' + sessionChanges +
    '; missing_keys=' + sessionMissing);
  console.log('READ-ONLY REHEARSAL ONLY. No source fencing, replication, restore, production configuration or cutover was performed.');
  if (!auditHistoryMatches || mismatch || sessionMissing) process.exitCode=1;
  else console.log('PASS: data differences are limited to append-only audit records and Session.lastSeenAt; recheck at frozen source checkpoint before cutover.');
} catch (e) {
  console.error('BLOCKED:', /Missing|Unexpected|inventory|Invalid/.test(e.message) ? e.message : 'Read-only reconciliation failed');
  process.exitCode=2;
}
