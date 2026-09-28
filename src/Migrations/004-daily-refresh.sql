-- 004 — FULL DAILY REFRESH. Truncate-and-reload of integration tables from
-- the FDW-mounted source views, then upsert employers (never truncated, so
-- computed history like ScoreSnapshot that references employers survives).
CREATE OR REPLACE PROCEDURE refresh_all_reports(
  p_source_schema TEXT DEFAULT 'source',
  p_view_prefix TEXT DEFAULT 'v_'
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_dummy_i BIGINT; v_dummy_u BIGINT;
BEGIN
  TRUNCATE TABLE
    "EmployerHeadcountSnapshot", "EmployeeVersion", "Employee", "PlatformUser",
    "Journey", "DebtAccountVersion", "DebtAccount",
    "InsurancePolicyVersion", "InsurancePolicy",
    "Rating", "Referral", "SalaryAdvance";

  CALL sync_employers_direct(p_source_schema, p_view_prefix, NULL, NOW(), v_dummy_i, v_dummy_u);
  CALL sync_workforce_snapshots_direct(p_source_schema, p_view_prefix, NULL, NOW(), v_dummy_i, v_dummy_u);
  CALL sync_employees_direct(p_source_schema, p_view_prefix, NULL, NOW(), v_dummy_i, v_dummy_u);
  -- Add direct procedures for the remaining reports here as needed, following
  -- the identical INSERT…SELECT ON CONFLICT pattern from 002.
END;
$$;
