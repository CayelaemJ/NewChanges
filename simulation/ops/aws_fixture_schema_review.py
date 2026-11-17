"""Read-only AWS synthetic CDC fixture feasibility audit.

Never writes to AWS. Does not inspect real row values, disclose column names
other than approved CDC columns, or infer insertability from a local fixture.
The actual source schema may differ substantially from the Docker fixture.
"""
import json
import os
import sys

from ops.aws_test_readiness import validate_environment, safe_failure_code
from runtime.ingest_stage_contract import FEED_TABLES

_DENIED_TYPES = {"blob", "tinyblob", "mediumblob", "longblob",
                 "geometry", "point", "polygon", "multipolygon"}
_DEFAULT_FUNCTIONS = ("DEFAULT_GENERATED",)


def inspect_fixture_feasibility(conn):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,IS_NULLABLE,COLUMN_DEFAULT,"
            "COLUMN_KEY,EXTRA,GENERATION_EXPRESSION "
            "FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA=%s AND TABLE_NAME IN ("
            + ",".join(["%s"] * len(FEED_TABLES)) + ") "
            "ORDER BY TABLE_NAME,ORDINAL_POSITION",
            ("ingest_stage", *sorted(FEED_TABLES)),
        )
        columns = cur.fetchall()
        cur.execute(
            "SELECT TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE "
            "FROM information_schema.TABLE_CONSTRAINTS "
            "WHERE TABLE_SCHEMA=%s AND TABLE_NAME IN ("
            + ",".join(["%s"] * len(FEED_TABLES)) + ")",
            ("ingest_stage", *sorted(FEED_TABLES)),
        )
        constraints = cur.fetchall()
        cur.execute(
            "SELECT EVENT_OBJECT_TABLE,COUNT(*) FROM information_schema.TRIGGERS "
            "WHERE EVENT_OBJECT_SCHEMA=%s AND EVENT_OBJECT_TABLE IN ("
            + ",".join(["%s"] * len(FEED_TABLES)) + ") "
            "GROUP BY EVENT_OBJECT_TABLE",
            ("ingest_stage", *sorted(FEED_TABLES)),
        )
        triggers = dict(cur.fetchall())

    by_feed = {name: [] for name in FEED_TABLES}
    for record in columns:
        if len(record) != 8:
            raise ValueError("Unexpected column metadata shape")
        table, name, dtype, nullable, default, key, extra, expression = record
        if table not in FEED_TABLES:
            raise ValueError("Unexpected source table metadata")
        by_feed[table].append((name,dtype,nullable,default,key,extra,expression))
    types = {name: set() for name in FEED_TABLES}
    for table, cname, ctype in constraints:
        if table not in FEED_TABLES:
            raise ValueError("Unexpected table constraints")
        types[table].add(ctype)
    report = {}
    for table in sorted(FEED_TABLES):
        rows = by_feed[table]
        pk = [row for row in rows if row[4] == "PRI"]
        required = [
            row for row in rows if row[2] == "NO" and row[3] is None
            and "GENERATED" not in str(row[5]).upper()
            and "AUTO_INCREMENT" not in str(row[5]).upper()
        ]
        report[table] = {
            "columns_total":len(rows),
            "required_without_default":len(required),
            "has_ingest_id_primary_key":len(pk) == 1 and pk[0][0] == "_ingest_id",
            "foreign_key_constraints_present":"FOREIGN KEY" in types[table],
            "unique_constraints_present":"UNIQUE" in types[table],
            "triggers_present":triggers.get(table,0) > 0,
            "generated_columns_present":any(
                "GENERATED" in str(row[5]).upper() or bool(row[6])
                for row in rows
            ),
            "unsupported_or_complex_types_present":any(
                row[1].lower() in _DENIED_TYPES for row in rows
            ),
            # DDL metadata cannot guarantee insertability, business validity,
            # or that a synthetic row cannot be accidentally exposed.
            "safe_to_write":False,
        }
    return {
        "mode":"AWS_SYNTHETIC_CDC_FIXTURE_METADATA_ONLY",
        "status":"PASS" if all(item["has_ingest_id_primary_key"]
                               for item in report.values()) else "REVIEW_REQUIRED",
        "feeds":report,
        "writer_account_used":False,
        "source_rows_read":False,
        "aws_writes_performed":False,
        "test_fixture_authorized":False,
    }


def main():
    try:
        if os.environ.get("FIXER_CDC_FIXTURE_SCHEMA_REVIEW_APPROVED") != "YES_METADATA_ONLY":
            raise ValueError("SCHEMA_REVIEW_APPROVAL_REQUIRED")
        env=dict(os.environ)
        if env.get("FIXER_RDS_TEST_USER") != "fixer_cdc_reader":
            raise ValueError("DEDICATED_METADATA_READER_REQUIRED")
        env["FIXER_AWS_TEST_READONLY_APPROVED"]="YES_METADATA_ONLY"
        # This uses the same limited SELECT-only reader account.
        config=validate_environment(env)
        import pymysql
        conn=pymysql.connect(
            host=config["host"],port=config["port"],user=config["user"],
            password=config["password"],database="information_schema",
            ssl_ca=config["ca"],ssl_verify_cert=True,
            ssl_verify_identity=True,connect_timeout=8,read_timeout=15,
            write_timeout=5,autocommit=False
        )
        try:
            result=inspect_fixture_feasibility(conn)
        finally:
            conn.rollback()
            conn.close()
        print(json.dumps(result,sort_keys=True))
        return 0 if result["status"]=="PASS" else 2
    except Exception as exc:
        code=(str(exc) if type(exc) is ValueError and str(exc) in {
            "SCHEMA_REVIEW_APPROVAL_REQUIRED","DEDICATED_METADATA_READER_REQUIRED"
        } else safe_failure_code(exc))
        print(json.dumps({
            "mode":"AWS_SYNTHETIC_CDC_FIXTURE_METADATA_ONLY",
            "status":"FAILED","reason_code":code,
            "aws_writes_performed":False,
        },sort_keys=True))
        return 1


if __name__=="__main__":
    sys.exit(main())
