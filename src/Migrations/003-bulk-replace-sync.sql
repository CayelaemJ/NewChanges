-- 003 — BULK WINDOW REPLACE for the heaviest feeds (200k+ rows).
-- Deletes the touched window then bulk-inserts, in one transaction per call.
CREATE OR REPLACE PROCEDURE sync_employees_bulk(
  p_source_schema TEXT DEFAULT 'source', p_view_prefix TEXT DEFAULT 'v_',
  p_since TIMESTAMP DEFAULT NULL, p_through TIMESTAMP DEFAULT NOW(),
  OUT p_inserted BIGINT, OUT p_deleted BIGINT)
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "EmployeeVersion" v USING "Employee" e
  WHERE v."employeeId" = e."id"
    AND e."sourceUpdatedAt" <= p_through
    AND (p_since IS NULL OR e."sourceUpdatedAt" > p_since);
  GET DIAGNOSTICS p_deleted = ROW_COUNT;
  CALL sync_employees_direct(p_source_schema, p_view_prefix, p_since, p_through, p_inserted, p_deleted);
END;
$$;

CREATE OR REPLACE PROCEDURE sync_journeys_bulk(
  p_source_schema TEXT DEFAULT 'source', p_view_prefix TEXT DEFAULT 'v_',
  p_since TIMESTAMP DEFAULT NULL, p_through TIMESTAMP DEFAULT NOW(),
  OUT p_inserted BIGINT, OUT p_deleted BIGINT)
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "Journey"
  WHERE "sourceUpdatedAt" <= p_through
    AND (p_since IS NULL OR "sourceUpdatedAt" > p_since);
  GET DIAGNOSTICS p_deleted = ROW_COUNT;
  -- then upsert the fresh window via the canonical JSONB path (app can push rows),
  -- or extend 002 with a journeys_direct procedure following the same pattern.
  p_inserted := 0;
END;
$$;
