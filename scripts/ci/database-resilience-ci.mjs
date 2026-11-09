import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Synthetic CI-only PostgreSQL reliability checks. Never run against a live database.
const expected = 'postgresql://ci_fixture:ci_fixture@127.0.0.1:5432/newchanges_ci';
assert.equal(process.env.CI, 'true', 'CI opt-in required');
assert.equal(process.env.CI_RLS_PROBE_APPROVED, 'CI_DISPOSABLE_ONLY');
assert.equal(process.env.DATABASE_URL, expected, 'Refusing any non-disposable database');

const pool = new pg.Pool({
  connectionString: expected,
  max: 3,
  connectionTimeoutMillis: 7000,
  idleTimeoutMillis: 5000,
  query_timeout: 15000,
  statement_timeout: 15000,
  application_name: 'newchanges-synthetic-db-resilience',
});
const schema = 'ci_resilience_' + randomUUID().replaceAll('-', '').slice(0, 20);
const table = '"' + schema + '"."ledger"';
const safeQuery = (sql, params) => pool.query(sql, params);
const log = (name) => console.log('[database-resilience] PASS', name);

try {
  await safeQuery('CREATE SCHEMA "' + schema + '"');
  await safeQuery('CREATE TABLE ' + table + ' (id text PRIMARY KEY, tenant text NOT NULL, amount integer NOT NULL CHECK(amount >= 0), version integer NOT NULL DEFAULT 0, UNIQUE(tenant,id))');
  await safeQuery('INSERT INTO ' + table + ' (id, tenant, amount) VALUES ($1,$2,$3),($4,$5,$6)', ['a','tenant-a',100,'b','tenant-b',200]);

  // Atomicity: a failed second statement must not partially commit the first.
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('UPDATE ' + table + ' SET amount=amount-50 WHERE id=$1', ['a']);
    await assert.rejects(c.query('UPDATE ' + table + ' SET amount=-1 WHERE id=$1', ['b']), e => e.code === '23514');
    await c.query('ROLLBACK');
  } finally { c.release(); }
  assert.equal((await safeQuery('SELECT amount FROM ' + table + ' WHERE id=$1', ['a'])).rows[0].amount, 100);
  log('transaction fully rolls back after constraint failure');

  await assert.rejects(
    safeQuery('INSERT INTO ' + table + ' (id,tenant,amount) VALUES ($1,$2,$3)', ['a','tenant-b',50]),
    e => e.code === '23505'
  );
  assert.equal((await safeQuery('SELECT count(*)::int AS total FROM ' + table)).rows[0].total, 2);
  log('duplicate primary keys fail closed');

  // Optimistic locking: two requests using the same version cannot both win.
  const update = () => safeQuery('UPDATE ' + table + ' SET amount=amount+1,version=version+1 WHERE id=$1 AND version=$2 RETURNING version', ['a',0]);
  const settled = await Promise.all([update(), update()]);
  assert.deepEqual(settled.map(x => x.rowCount).sort(), [0,1]);
  const row = (await safeQuery('SELECT amount,version FROM ' + table + ' WHERE id=$1', ['a'])).rows[0];
  assert.deepEqual(row, {amount:101,version:1});
  log('simultaneous optimistic updates allow exactly one winner');

  // A failed savepoint can recover without discarding valid earlier work.
  const d = await pool.connect();
  try {
    await d.query('BEGIN');
    await d.query('SAVEPOINT invalid_change');
    await assert.rejects(d.query('UPDATE ' + table + ' SET amount=-5 WHERE id=$1', ['a']), e => e.code === '23514');
    await d.query('ROLLBACK TO SAVEPOINT invalid_change');
    await d.query('UPDATE ' + table + ' SET amount=102 WHERE id=$1', ['a']);
    await d.query('COMMIT');
  } catch (e) { await d.query('ROLLBACK').catch(() => {}); throw e; }
  finally { d.release(); }
  assert.equal((await safeQuery('SELECT amount FROM ' + table + ' WHERE id=$1', ['a'])).rows[0].amount, 102);
  log('savepoint recovery preserves valid transaction work');

  console.log('All synthetic PostgreSQL resilience checks passed.');
} finally {
  await pool.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE').catch(e => console.error('CI schema cleanup failed:', e.message));
  await pool.end();
}
