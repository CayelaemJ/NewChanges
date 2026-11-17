"""Fail-closed planner for an isolated CDC INSERT/UPDATE/DELETE test.

This module does not connect to MySQL or execute SQL. Its SQL uses ONLY a
disposable Docker table name, not ingest_stage or the actual AWS source.
The eventual AWS writer needs separate explicit authorization and must not
call this harness or reinterpret its output as permission for an RDS write.
"""
from dataclasses import dataclass
from hashlib import sha256
import re

_FIXTURE_SCHEMA = "cdc_disposable_fixture"
_TABLE = "employers"
_ID_MIN = 900_000_000_000_000
_ID_MAX = 900_000_000_999_999
_APPROVAL = "YES_LOCAL_DISPOSABLE_ONLY"


@dataclass(frozen=True)
class DisposableChangePlan:
    schema: str
    table: str
    key: int
    approval: str

    def __post_init__(self):
        if self.schema != _FIXTURE_SCHEMA or self.table != _TABLE:
            raise ValueError("Only isolated disposable schema is permitted")
        if type(self.key) is not int or not _ID_MIN <= self.key <= _ID_MAX:
            raise ValueError("Disposable fixture key required")
        if self.approval != _APPROVAL:
            raise ValueError("Explicit LOCAL disposable approval required")

    @property
    def identity(self):
        return sha256(f"{self.schema}:{self.table}:{self.key}".encode()).hexdigest()


def execute_local_disposable_sequence(connection, plan):
    """Three separately committed mutations, never applied to an AWS schema.

    No DDL. The independent disposable table must already exist. A failure
    leaves a committed test row only after an INSERT/UPDATE step: caller must
    run explicit cleanup against the same disposable environment.
    """
    if not isinstance(plan, DisposableChangePlan):
        raise ValueError("Validated disposable plan required")
    if getattr(connection, "host_is_aws", True) is not False:
        raise RuntimeError("Local-only connection attestation required")
    cursor = connection.cursor()
    try:
        cursor.execute(
            "SELECT COUNT(*) FROM cdc_disposable_fixture.employers "
            "WHERE _ingest_id=%s", (plan.key,)
        )
        row = cursor.fetchone()
        if not isinstance(row, tuple) or len(row) != 1 or row[0] != 0:
            raise ValueError("Disposable fixture key not empty")
        cursor.execute(
            "INSERT INTO cdc_disposable_fixture.employers "
            "(_ingest_id,fixture_state,source_updated_at) "
            "VALUES (%s,%s,%s)",
            (plan.key, "CDC_TEST_CREATED", "2026-11-17 11:00:00")
        )
        if cursor.rowcount != 1:
            raise RuntimeError("Disposable INSERT count mismatch")
        connection.commit()
        cursor.execute(
            "UPDATE cdc_disposable_fixture.employers "
            "SET fixture_state=%s WHERE _ingest_id=%s AND fixture_state=%s",
            ("CDC_TEST_UPDATED", plan.key, "CDC_TEST_CREATED")
        )
        if cursor.rowcount != 1:
            raise RuntimeError("Disposable UPDATE count mismatch")
        connection.commit()
        cursor.execute(
            "DELETE FROM cdc_disposable_fixture.employers "
            "WHERE _ingest_id=%s AND fixture_state=%s",
            (plan.key, "CDC_TEST_UPDATED")
        )
        if cursor.rowcount != 1:
            raise RuntimeError("Disposable DELETE count mismatch")
        connection.commit()
        return {"status": "LOCAL_THREE_COMMITS_EXECUTED",
                "operations": ["INSERT", "UPDATE", "DELETE"],
                "plan_sha256": plan.identity,
                "aws_writes": False}
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
