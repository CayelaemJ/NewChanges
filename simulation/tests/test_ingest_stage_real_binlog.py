"""Real local MySQL XID -> opaque marker + durable checkpoint integration.

Runs only inside disposable Docker. The ingest_stage source fixture is
EMPTY at startup; it is not connected to, or copied from, AWS RDS.
"""
import hashlib
import os
import unittest
from datetime import datetime, timezone

from runtime.common import connect, connection_config
from runtime.ingest_stage_contract import FEED_TABLES, SnapshotHandoff
from runtime.ingest_stage_sink import bootstrap_local_sink
from runtime.ingest_stage_stream import run_local_binlog

SECRET = b"test-ingest-real-xid-hmac-key-is-32-bytes"
CONSUMER = "test-ingest-real-xid-v1"
# Explicit SQL allowlist: no dynamic table identifier from any event or input.
# These are minimal disposable fixture tables, never the live RDS schema.
LOCAL_FIXTURE_INSERTS = {
    "employers": "INSERT INTO employers (_ingest_id,fixture_state,source_updated_at) VALUES(%s,%s,%s)",
    "workforce_snapshots": "INSERT INTO workforce_snapshots (_ingest_id,fixture_state,source_updated_at) VALUES(%s,%s,%s)",
    "platform_users": "INSERT INTO platform_users (_ingest_id,fixture_state,source_updated_at) VALUES(%s,%s,%s)",
    "journeys": "INSERT INTO journeys (_ingest_id,fixture_state,source_updated_at) VALUES(%s,%s,%s)",
    "policies": "INSERT INTO policies (_ingest_id,fixture_state,source_updated_at) VALUES(%s,%s,%s)",
    "ratings": "INSERT INTO ratings (_ingest_id,fixture_state,source_updated_at) VALUES(%s,%s,%s)",
    "referrals": "INSERT INTO referrals (_ingest_id,fixture_state,source_updated_at) VALUES(%s,%s,%s)",
    "salary_advances": "INSERT INTO salary_advances (_ingest_id,fixture_state,source_updated_at) VALUES(%s,%s,%s)",
}


@unittest.skipUnless(
    os.getenv("SIM_ENV") == "local"
    and os.getenv("RUN_LOCAL_MYSQL_TESTS") == "yes"
    and os.getenv("SIM_REPL_HOST") == "mysql"
    and os.getenv("SIM_DB_HOST") == "mysql"
    and os.getenv("SIM_CDC_HOST") == "mysql",
    "Disposable local MySQL source fixture required",
)
class LocalSourceXidIntegration(unittest.TestCase):
    def test_real_row_binlog_transaction_commits_metadata_atomically(self):
        import pymysql

        # Use an explicit local fixture database, never the AWS source.
        settings = connection_config("writer")
        self.assertEqual(settings["host"], "mysql")
        settings["database"] = "ingest_stage"
        source = pymysql.connect(**settings)
        sink = connect("cdc")
        repl = connect("replica")
        try:
            with source.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM employees")
                self.assertEqual(cur.fetchone()[0], 0)
                cur.execute("SELECT COUNT(*) FROM debt_accounts")
                self.assertEqual(cur.fetchone()[0], 0)
            source.rollback()

            # This test-only handoff is valid because the fixture is empty,
            # test execution is sequential, and no remote source is involved.
            with repl.cursor() as cur:
                cur.execute("SHOW BINARY LOG STATUS")
                coordinate = cur.fetchone()
            repl.rollback()
            self.assertIsNotNone(coordinate)
            file, position = coordinate[:2]
            handoff = SnapshotHandoff(
                schema="ingest_stage", binlog_file=file,
                binlog_position=int(position),
                snapshot_consistent=True, snapshot_import_verified=True,
                snapshot_manifest_sha256=hashlib.sha256(
                    b"verified-empty-local-ingest-stage-fixture"
                ).hexdigest(),
                retention_hours=1,
            )
            self.assertEqual(
                bootstrap_local_sink(sink, handoff, consumer_name=CONSUMER),
                "BOOTSTRAPPED",
            )
            with source.cursor() as cur:
                cur.execute("""INSERT INTO employees
                    (_ingest_id,employee_status,source_updated_at)
                    VALUES(%s,%s,%s)""",
                    (777, "PRIVATE_OLD_STATUS", "2025-01-01T10:00:00Z"))
                cur.execute("""UPDATE employees SET employee_status=%s
                    WHERE _ingest_id=%s""", ("PRIVATE_NEW_STATUS", 777))
                cur.execute("DELETE FROM employees WHERE _ingest_id=%s", (777,))
            source.commit()

            result = run_local_binlog(
                sink_db=sink, handoff=handoff, hmac_secret=SECRET,
                consumer_name=CONSUMER, max_commits=1,
                max_packets=200, max_seconds=20,
            )
            self.assertEqual(result["commits"], 1)
            self.assertEqual(result["markers"], 3)
            self.assertGreater(result["last_checkpoint"][1], int(position))
            with sink.cursor() as cur:
                cur.execute("""SELECT operation,source_timestamp_state,
                    needs_tombstone FROM fixer_ingest_cdc.ingest_change_markers
                    WHERE consumer_name=%s AND feed=%s
                    ORDER BY binlog_event_at_utc,
                    captured_at_utc, event_key""", (CONSUMER,"employees"))
                markers = cur.fetchall()
                # Order within this one transaction is not inferred from
                # timestamps: the event keys are opaque hashes.
                self.assertCountEqual(
                    [row[0] for row in markers], ["INSERT", "UPDATE", "DELETE"]
                )
                self.assertIn(
                    ("UPDATE", "NOT_ADVANCED_ON_UPDATE", 0), markers
                )
                self.assertIn(
                    ("DELETE", "DELETED_NO_LIVE_WATERMARK", 1), markers
                )
                cur.execute("""SELECT log_pos FROM fixer_ingest_cdc.ingest_checkpoint
                    WHERE consumer_name=%s""", (CONSUMER,))
                self.assertEqual(cur.fetchone()[0], result["last_checkpoint"][1])
                cur.execute("""SELECT generation FROM
                    fixer_ingest_cdc.ingest_feed_notifications
                    WHERE consumer_name=%s AND feed=%s""",
                    (CONSUMER,"employees"))
                self.assertEqual(cur.fetchone()[0], 1)
                cur.execute("""SELECT COUNT(*) FROM fixer_ingest_cdc.ingest_change_markers
                    WHERE consumer_name=%s AND feed=%s""",
                    (CONSUMER,"employees"))
                self.assertEqual(cur.fetchone()[0], 3)
            sink.rollback()

            # A NEW committed source transaction must be picked up on
            # restart using the original snapshot handoff + the sink's
            # committed checkpoint, not skipped or replayed twice.
            with source.cursor() as cur:
                cur.execute("""INSERT INTO debt_accounts
                    (_ingest_id,debt_balance,source_updated_at)
                    VALUES(%s,%s,%s)""",
                    (888, "12.50", "2025-01-01T10:00:00Z"))
            source.commit()
            resumed = run_local_binlog(
                sink_db=sink, handoff=handoff, hmac_secret=SECRET,
                consumer_name=CONSUMER, max_commits=1,
                max_packets=300, max_seconds=20,
            )
            self.assertEqual(resumed["commits"], 1)
            self.assertEqual(resumed["markers"], 1)
            self.assertNotEqual(
                resumed["last_checkpoint"], result["last_checkpoint"]
            )
            with sink.cursor() as cur:
                cur.execute("""SELECT feed,COUNT(*) FROM
                    fixer_ingest_cdc.ingest_change_markers
                    WHERE consumer_name=%s GROUP BY feed""", (CONSUMER,))
                self.assertCountEqual(
                    cur.fetchall(), [("employees", 3), ("debt_accounts", 1)]
                )
                cur.execute("""SELECT generation FROM
                    fixer_ingest_cdc.ingest_feed_notifications
                    WHERE consumer_name=%s AND feed=%s""",
                    (CONSUMER,"debt_accounts"))
                self.assertEqual(cur.fetchone()[0], 1)
                cur.execute("""SELECT log_file,log_pos FROM
                    fixer_ingest_cdc.ingest_checkpoint WHERE consumer_name=%s""",
                    (CONSUMER,))
                self.assertEqual(cur.fetchone(), resumed["last_checkpoint"])
            sink.rollback()

            # One THIRD local source transaction spans all ten canonical
            # feed tables. A single XID must protect all ten opaque markers,
            # even though two feeds already had prior committed events.
            self.assertEqual(len(FEED_TABLES), 10)
            with source.cursor() as cur:
                cur.execute("""INSERT INTO employees
                    (_ingest_id,employee_status,source_updated_at)
                    VALUES(%s,%s,%s)""",
                    (1777, "LOCAL_TEST_ONLY", "2025-01-01T10:00:00Z"))
                cur.execute("""INSERT INTO debt_accounts
                    (_ingest_id,debt_balance,source_updated_at)
                    VALUES(%s,%s,%s)""",
                    (1888, "15.50", "2025-01-01T10:00:00Z"))
                other_feeds = sorted(FEED_TABLES - {"employees", "debt_accounts"})
                self.assertEqual(set(LOCAL_FIXTURE_INSERTS), set(other_feeds))
                for offset, feed in enumerate(other_feeds, start=1):
                    # Whitelisted static SQL, no f-string interpolation of
                    # table names. No live RDS source columns are modelled.
                    cur.execute(
                        LOCAL_FIXTURE_INSERTS[feed],
                        (2000 + offset, "LOCAL_TEST_ONLY", "2025-01-01T10:00:00Z"),
                    )
            source.commit()
            complete = run_local_binlog(
                sink_db=sink, handoff=handoff, hmac_secret=SECRET,
                consumer_name=CONSUMER, max_commits=1,
                max_packets=500, max_seconds=20,
            )
            self.assertEqual(complete["commits"], 1)
            self.assertEqual(complete["markers"], 10)
            self.assertNotEqual(complete["last_checkpoint"], resumed["last_checkpoint"])
            with sink.cursor() as cur:
                cur.execute("""SELECT feed,COUNT(*) FROM
                    fixer_ingest_cdc.ingest_change_markers
                    WHERE consumer_name=%s GROUP BY feed""", (CONSUMER,))
                counts = dict(cur.fetchall())
                self.assertEqual(set(counts), FEED_TABLES)
                self.assertEqual(counts["employees"], 4)
                self.assertEqual(counts["debt_accounts"], 2)
                for feed in other_feeds:
                    self.assertEqual(counts[feed], 1, feed)
                self.assertEqual(sum(counts.values()), 14)
                cur.execute("""SELECT feed,generation FROM
                    fixer_ingest_cdc.ingest_feed_notifications
                    WHERE consumer_name=%s""", (CONSUMER,))
                generations = dict(cur.fetchall())
                self.assertEqual(set(generations), FEED_TABLES)
                self.assertEqual(generations["employees"], 2)
                self.assertEqual(generations["debt_accounts"], 2)
                for feed in other_feeds:
                    self.assertEqual(generations[feed], 1, feed)
                cur.execute("""SELECT log_file,log_pos FROM
                    fixer_ingest_cdc.ingest_checkpoint
                    WHERE consumer_name=%s""", (CONSUMER,))
                self.assertEqual(cur.fetchone(), complete["last_checkpoint"])
        finally:
            source.rollback()
            sink.rollback()
            repl.rollback()
            source.close()
            sink.close()
            repl.close()


if __name__ == "__main__":
    unittest.main()
