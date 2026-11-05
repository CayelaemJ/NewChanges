#!/usr/bin/env node
// Read-only verification of Neon against the point-in-time Aiven copy.
// Uses the already-required PostgreSQL psql client; no npm packages needed.
import { spawnSync } from 'node:child_process';

const sourceUrl = process.env.DR_SOURCE_DATABASE_URL;
const targetUrl = process.env.DR_TARGET_DATABASE_URL;
if (!sourceUrl || !targetUrl) {
  console.error('BLOCKED: configure both DR_SOURCE_DATABASE_URL and DR_TARGET_DATABASE_URL.');
  process.exit(2);
}

function identify(raw) {
  const u = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(u.protocol)) throw new Error('Invalid PostgreSQL URL.');
  return `${u.hostname.toLowerCase()}|${decodeURIComponent(u.pathname.slice(1))}`;
}
try {
  const sourceId = identify(sourceUrl);
  const targetId = identify(targetUrl);
  if (!sourceId.endsWith('.neon.tech|newchanges') ||
      targetId !== 'the-fixer-postgres-cay-bed7.b.aivencloud.com|defaultdb') {
    console.error('BLOCKED: unexpected database endpoints.');
    process.exit(2);
  }
} catch {
  console.error('BLOCKED: invalid connection URL.');
  process.exit(2);
}

const allowAuditDrift = process.env.AIVEN_POINT_IN_TIME_TEST === 'YES';
const metadataQueries = {
  tables: `SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
  columns: `SELECT table_name, column_name, ordinal_position, data_type, udt_schema, udt_name, is_nullable,
    COALESCE(column_default,'') AS column_default, COALESCE(is_identity,'') AS is_identity
    FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`,
  indexes: `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`,
  constraints: `SELECT c.conrelid::regclass::text AS table_name, c.conname, c.contype,
    pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
    JOIN pg_namespace n ON n.oid=c.connamespace
    WHERE n.nspname='public' ORDER BY table_name,c.conname`,
  sequences: `SELECT sequencename, data_type, start_value, min_value, max_value, increment_by, cycle
    FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename`,
  views: `SELECT viewname FROM pg_views WHERE schemaname='public'
    AND viewname NOT IN ('pg_stat_statements','pg_stat_statements_info') ORDER BY viewname`,
};

const quote = value => '"' + value.replaceAll('"', '""') + '"';
const canonical = rows => JSON.stringify(rows);

// Parse the URI into libpq environment variables. PGDATABASE must contain the
// database NAME, not a full connection URI. Never pass passwords as CLI args.
function connectionEnv(raw) {
  const u = new URL(raw);
  const env = { ...process.env };
  // Override inherited PG* defaults so they cannot silently redirect the query.
  for (const name of ['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGCHANNELBINDING','PGSERVICE','PGSERVICEFILE','PGHOSTADDR']) delete env[name];
  env.PGHOST = u.hostname;
  env.PGPORT = u.port || '5432';
  env.PGUSER = decodeURIComponent(u.username);
  env.PGPASSWORD = decodeURIComponent(u.password);
  env.PGDATABASE = decodeURIComponent(u.pathname.slice(1));
  env.PGSSLMODE = u.searchParams.get('sslmode') || 'require';
  if (u.searchParams.has('channel_binding')) env.PGCHANNELBINDING = u.searchParams.get('channel_binding');
  env.PGCONNECT_TIMEOUT = '15';
  // Do not send PGOPTIONS during pooled connection startup.
  delete env.PGOPTIONS;
  return env;
}
function query(url, sql, step, side) {
  const result = spawnSync('psql', ['-w', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    env: connectionEnv(url),
    input: `BEGIN TRANSACTION READ ONLY;\nSET LOCAL statement_timeout = '120s';\n${sql};\nCOMMIT;\n`,
    encoding: 'utf8',
    timeout: 130000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const stderr = result.stderr ?? '';
    let category = 'SQL or client error';
    if (/password authentication failed|no password supplied|fe_sendauth/i.test(stderr)) category = 'authentication failed';
    else if (/could not translate host name|name or service not known/i.test(stderr)) category = 'DNS failed';
    else if (/timeout|timed out/i.test(stderr) || result.error?.code === 'ETIMEDOUT') category = 'connection timeout';
    else if (/connection refused|could not connect/i.test(stderr)) category = 'connection refused or unavailable';
    else if (/ssl|certificate|channel binding/i.test(stderr)) category = 'TLS/channel-binding failed';
    else if (/permission denied/i.test(stderr)) category = 'permission denied';
    throw new Error('PostgreSQL read-only query failed (' + side + ', ' + step + '; ' + category + '; exit=' + String(result.status) + ').');
  }
  return result.stdout.trim();
}

function inspect(url, side) {
  const meta = {};
  for (const [kind, innerQuery] of Object.entries(metadataQueries)) {
    const sql = `SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json)::text FROM (${innerQuery}) x`;
    meta[kind] = JSON.parse(query(url, sql, 'metadata ' + kind, side));
  }
  const counts = {};
  for (const { name } of meta.tables) {
    // Table names originate from PostgreSQL metadata and are always quoted as identifiers.
    const n = query(url, `SELECT count(*)::text FROM public.${quote(name)}`, 'table count ' + name, side);
    if (!/^\d+$/.test(n)) throw new Error('Invalid table count.');
    counts[name] = n;
  }
  return { meta, counts };
}

try {
  const source = inspect(sourceUrl, 'Neon source');
  const target = inspect(targetUrl, 'Aiven target');
  let structureDifferences = 0;
  for (const kind of Object.keys(metadataQueries)) {
    const s = source.meta[kind], t = target.meta[kind];
    if (canonical(s) !== canonical(t)) {
      structureDifferences++;
      console.log(`STRUCTURE MISMATCH: ${kind} (source=${s.length}, target=${t.length})`);
    } else {
      console.log(`STRUCTURE MATCH: ${kind} (${s.length})`);
    }
  }
  const sourceNames = Object.keys(source.counts), targetNames = Object.keys(target.counts);
  const differences = [];
  for (const table of new Set([...sourceNames, ...targetNames])) {
    if (source.counts[table] !== target.counts[table]) {
      differences.push(table);
      console.log(`ROW COUNT DRIFT: ${table} source=${source.counts[table] ?? 'missing'} target=${target.counts[table] ?? 'missing'}`);
    }
  }
  console.log(`SUMMARY: source_tables=${sourceNames.length}, target_tables=${targetNames.length}, structure_mismatches=${structureDifferences}, row_count_differences=${differences.length}`);
  console.log('Live writes can cause differences. This does not compare historical row contents or prove cutover readiness.');
  if (structureDifferences || sourceNames.length !== 57 || targetNames.length !== 57) process.exitCode = 1;
  else if (differences.length && !(allowAuditDrift && differences.every(n => n === 'DataAccessEvent'))) process.exitCode = 1;
  else console.log('PASS: structure matches and row counts satisfy the chosen live-drift policy.');
} catch (error) {
  console.error('VALIDATION FAILED:', error?.message?.startsWith('PostgreSQL read-only') ? error.message : 'reconciliation failed');
  process.exitCode = 1;
}
