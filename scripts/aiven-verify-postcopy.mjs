#!/usr/bin/env node
// Post-copy comparison of live Neon and the Aiven test copy. Read-only, no user data printed.
import pg from 'pg';

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
const sourceId = identify(sourceUrl);
const targetId = identify(targetUrl);
if (!sourceId.endsWith('.neon.tech|newchanges') ||
    targetId !== 'the-fixer-postgres-cay-bed7.b.aivencloud.com|defaultdb') {
  console.error('BLOCKED: unexpected database endpoints.');
  process.exit(2);
}
const skipAuditDrift = process.env.AIVEN_POINT_IN_TIME_TEST === 'YES';
const { Client } = pg;

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
function normalized(v) {
  return JSON.stringify(v, (k, value) => typeof value === 'bigint' ? value.toString() : value);
}
const quote = s => '"' + s.replaceAll('"', '""') + '"';
async function inspect(url) {
  const db = new Client({connectionString: url, connectionTimeoutMillis: 15000, query_timeout: 120000});
  await db.connect();
  try {
    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await db.query("SET LOCAL statement_timeout = '120s'");
    const meta = {};
    for (const [key, sql] of Object.entries(metadataQueries)) meta[key] = (await db.query(sql)).rows;
    const counts = {};
    for (const { name } of meta.tables) {
      const result = await db.query(`SELECT count(*)::text AS n FROM public.${quote(name)}`);
      counts[name] = result.rows[0].n;
    }
    await db.query('COMMIT');
    return {meta, counts};
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}
try {
  const [src, dst] = await Promise.all([inspect(sourceUrl), inspect(targetUrl)]);
  let structuralMismatches = 0;
  for (const category of Object.keys(metadataQueries)) {
    const sourceRows = src.meta[category], targetRows = dst.meta[category];
    if (normalized(sourceRows) !== normalized(targetRows)) {
      structuralMismatches++;
      console.log(`STRUCTURE MISMATCH: ${category} (source=${sourceRows.length}, target=${targetRows.length})`);
    } else console.log(`STRUCTURE MATCH: ${category} (${sourceRows.length})`);
  }
  const sourceNames = Object.keys(src.counts);
  const targetNames = Object.keys(dst.counts);
  const countMismatches = [];
  for (const table of new Set([...sourceNames, ...targetNames])) {
    if (src.counts[table] !== dst.counts[table]) {
      countMismatches.push(table);
      console.log(`ROW COUNT DRIFT: ${table} source=${src.counts[table] ?? 'missing'} target=${dst.counts[table] ?? 'missing'}`);
    }
  }
  console.log(`SUMMARY: source_tables=${sourceNames.length}, target_tables=${targetNames.length}, structure_mismatches=${structuralMismatches}, row_count_differences=${countMismatches.length}`);
  console.log('Live source writes may produce row differences. This does NOT compare historical row contents or prove cutover readiness.');
  if (structuralMismatches || sourceNames.length !== 57 || targetNames.length !== 57) process.exitCode = 1;
  else if (countMismatches.length && !(skipAuditDrift && countMismatches.every(n => n === 'DataAccessEvent'))) process.exitCode = 1;
  else console.log('PASS: application structure matches and row counts satisfy chosen live-drift policy.');
} catch (error) {
  console.error('VALIDATION FAILED:', error?.code ?? 'database query error');
  process.exitCode = 1;
}
