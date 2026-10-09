// ════════════════════════════════════════════════════════════════════
//  CROSS-REPLICA LEADER LOCK
//  In-process timers (setInterval) run on every application replica. When the
//  service is scaled beyond one instance, that means scheduled work such as
//  account cleanup or the weekly digest would run once per replica. This helper
//  uses a PostgreSQL session advisory lock so only one replica performs the
//  work for a given tick.
//
//  It uses the same shared lock namespace ("EFS" = 0x454653) as the daily
//  full-refresh lease, with a distinct second key per task.
// ════════════════════════════════════════════════════════════════════

import { Client } from "pg";

const LOCK_NAMESPACE = 0x454653; // "EFS" — shared with the full-refresh lease

// Reserve a distinct second key for each coordinated task. Keep these stable.
export const LEADER_LOCKS = {
  AUTOMATION: 80,
  RETENTION: 81,
} as const;

/**
 * Run `fn` only if this process can acquire the advisory lock for `lockB`.
 * Returns `fn`'s result, or `null` if another replica holds the lock.
 *
 * When `DATABASE_URL` is not configured (local development / tests) the
 * function is run directly, because there is no shared database to coordinate
 * through and only one process is assumed to be running.
 */
export async function runWithLeaderLock<T>(
  lockB: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return fn();

  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch {
    return null;
  }
  try {
    const result = await client.query("SELECT pg_try_advisory_lock($1, $2) AS acquired", [
      LOCK_NAMESPACE,
      lockB,
    ]);
    if (!result.rows?.[0]?.acquired) return null;
    try {
      return await fn();
    } finally {
      await client
        .query("SELECT pg_advisory_unlock($1, $2)", [LOCK_NAMESPACE, lockB])
        .catch(() => {});
    }
  } finally {
    await client.end().catch(() => {});
  }
}
