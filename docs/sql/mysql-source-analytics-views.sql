-- NewChanges source-side analytics views for MySQL 8 / MariaDB-compatible source systems.
-- These views intentionally aggregate the canonical read-only source views instead of
-- copying raw source tables into PostgreSQL.
--
-- Preconditions:
--   v_journeys
--   v_salary_advances
--   v_debt_accounts
--   v_employees
-- must expose the canonical fields documented in src/services/reportFormats.ts.
--
-- Deploy these to the SOURCE database, not the NewChanges PostgreSQL database.
-- They are read-only reporting objects. The application never sends arbitrary SQL.

CREATE OR REPLACE VIEW v_monthly_cash_freed AS
SELECT
  DATE_FORMAT(completed_at, '%Y-%m-01') AS month_start,
  employer_ref,
  SUM(COALESCE(monthly_saving_rand, 0)) AS monthly_cash_freed,
  SUM(SUM(COALESCE(monthly_saving_rand, 0)))
    OVER (PARTITION BY employer_ref ORDER BY DATE_FORMAT(completed_at, '%Y-%m-01')) AS cumulative_cash_freed
FROM v_journeys
WHERE status = 'COMPLETED'
  AND completed_at IS NOT NULL
GROUP BY DATE_FORMAT(completed_at, '%Y-%m-01'), employer_ref;

CREATE OR REPLACE VIEW v_monthly_advances AS
SELECT
  DATE_FORMAT(advanced_at, '%Y-%m-01') AS month_start,
  employer_ref,
  COUNT(*) AS advance_count,
  SUM(COALESCE(amount, 0)) AS total_advanced
FROM v_salary_advances
WHERE salary_advance_status = 'FINALISED'
  AND advanced_at IS NOT NULL
GROUP BY DATE_FORMAT(advanced_at, '%Y-%m-01'), employer_ref;

CREATE OR REPLACE VIEW v_creditor_outcomes AS
SELECT
  employer_ref,
  creditor_name,
  DATE_FORMAT(observed_at, '%Y-%m-01') AS month_start,
  COUNT(*) AS account_observations,
  SUM(CASE WHEN in_arrears THEN 1 ELSE 0 END) AS accounts_in_arrears,
  SUM(CASE WHEN state IN ('CHALLENGED', 'GUIDED') THEN 1 ELSE 0 END) AS accounts_with_intervention,
  SUM(CASE WHEN challenge_status IN ('CREDITOR_CONCEDED', 'WRITTEN_OFF') THEN 1 ELSE 0 END) AS positive_challenge_outcomes,
  SUM(COALESCE(balance_rand, 0)) AS observed_balance
FROM v_debt_accounts
WHERE observed_at IS NOT NULL
GROUP BY employer_ref, creditor_name, DATE_FORMAT(observed_at, '%Y-%m-01');

CREATE OR REPLACE VIEW v_employee_income_bands AS
SELECT
  employer_ref,
  DATE_FORMAT(observed_at, '%Y-%m-01') AS month_start,
  income_band,
  COUNT(*) AS employee_observations
FROM v_employees
WHERE observed_at IS NOT NULL
  AND income_band IS NOT NULL
GROUP BY employer_ref, DATE_FORMAT(observed_at, '%Y-%m-01'), income_band;

CREATE OR REPLACE VIEW v_financial_problems_resolved AS
SELECT
  DATE_FORMAT(completed_at, '%Y-%m-01') AS month_start,
  employer_ref,
  COUNT(*) AS financial_problems_resolved,
  SUM(COALESCE(balance_impact_rand, 0)) AS balance_impact_rand,
  SUM(COALESCE(monthly_saving_rand, 0)) AS monthly_cash_freed
FROM v_journeys
WHERE status = 'COMPLETED'
  AND completed_at IS NOT NULL
GROUP BY DATE_FORMAT(completed_at, '%Y-%m-01'), employer_ref;
