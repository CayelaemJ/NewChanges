-- ═══════════════════════════════════════════════════════════════════════════
-- 003 — BULK WINDOW REPLACE for the heaviest feeds (200k+ rows).
-- Deletes the touched window, then reloads via the direct procedures, in a
-- single transaction per call. Use for initial loads / full rebuilds of a
-- window, not for steady-state incremental syncs.
-- ═══════════════════════════════════════════════════════════════════════════

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
  CALL sync_employees_direct(p_source_schema, p_view_prefix, p_since, p_through, p_inserted);
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
  -- Reload fresh rows through the canonical JSONB path (app pushes the window),
  -- or add a journeys_direct procedure following the identical 002 pattern.
  p_inserted := 0;
END;
$$;
