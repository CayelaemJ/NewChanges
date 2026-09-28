-- ═══════════════════════════════════════════════════════════════════════════
-- 002 — DIRECT SQL-TO-SQL SYNC. Same merge rules as 001, but reads source
-- views straight from a foreign schema (postgres_fdw), e.g. MySQL source
-- views mounted as source.v_employers … — zero JSONB, zero Node round-trips.
--
-- Prerequisites (one-time, in the portal database):
--   CREATE EXTENSION IF NOT EXISTS postgres_fdw;
--   CREATE SERVER source_srv FOREIGN DATA WRAPPER postgres_fdw
--     OPTIONS (host '<mysql-host>', port '3306', dbname '<mysql-db>');
--   CREATE USER MAPPING FOR CURRENT_USER SERVER source_srv
--     OPTIONS (username '<u>', password '<p>');
--   CREATE SCHEMA source;
--   IMPORT FOREIGN SCHEMA public LIMIT TO (v_employers, v_workforce_snapshots, v_employees)
--     FROM SERVER source_srv INTO source;
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE PROCEDURE sync_employers_direct(
  p_source_schema TEXT DEFAULT 'source', p_view_prefix TEXT DEFAULT 'v_',
  p_since TIMESTAMP DEFAULT NULL, p_through TIMESTAMP DEFAULT NOW(),
  OUT p_merged BIGINT)
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format($sql$
    INSERT INTO "Employer" ("id","name","eligibleCount","eligibleCountAsAt","sourceUpdatedAt","sourceDeletedAt","updatedAt")
    SELECT employer_ref, name, COALESCE(eligible_count,0), eligible_count_as_at, source_updated_at,
           CASE WHEN is_deleted THEN source_updated_at ELSE NULL END, NOW()
    FROM %I.%Iemployers
    WHERE source_updated_at <= $1 AND ($2::timestamp IS NULL OR source_updated_at > $2)
    ON CONFLICT ("id") DO UPDATE SET
      "name"=EXCLUDED."name", "eligibleCount"=EXCLUDED."eligibleCount",
      "eligibleCountAsAt"=EXCLUDED."eligibleCountAsAt",
      "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt",
      "sourceDeletedAt"=EXCLUDED."sourceDeletedAt", "updatedAt"=NOW()
    WHERE EXCLUDED."sourceUpdatedAt" >= "Employer"."sourceUpdatedAt"
  $sql$, p_source_schema, p_view_prefix)
  USING p_through, p_since;
  GET DIAGNOSTICS p_merged = ROW_COUNT;
END;
$$;

CREATE OR REPLACE PROCEDURE sync_workforce_snapshots_direct(
  p_source_schema TEXT DEFAULT 'source', p_view_prefix TEXT DEFAULT 'v_',
  p_since TIMESTAMP DEFAULT NULL, p_through TIMESTAMP DEFAULT NOW(),
  OUT p_merged BIGINT)
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format($sql$
    INSERT INTO "EmployerHeadcountSnapshot"
      ("id","employerId","asOfDate","eligibleCount","sourceUpdatedAt","sourceDeletedAt","createdAt")
    SELECT md5(employer_ref||'|'||as_of_date::text), employer_ref, as_of_date,
           COALESCE(eligible_count,0), source_updated_at,
           CASE WHEN is_deleted THEN source_updated_at ELSE NULL END, NOW()
    FROM %I.%Iworkforce_snapshots
    WHERE source_updated_at <= $1 AND ($2::timestamp IS NULL OR source_updated_at > $2)
    ON CONFLICT ("employerId","asOfDate") DO UPDATE SET
      "eligibleCount"=EXCLUDED."eligibleCount",
      "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt",
      "sourceDeletedAt"=EXCLUDED."sourceDeletedAt"
    WHERE EXCLUDED."sourceUpdatedAt" >= "EmployerHeadcountSnapshot"."sourceUpdatedAt"
  $sql$, p_source_schema, p_view_prefix)
  USING p_through, p_since;
  GET DIAGNOSTICS p_merged = ROW_COUNT;
END;
$$;

CREATE OR REPLACE PROCEDURE sync_employees_direct(
  p_source_schema TEXT DEFAULT 'source', p_view_prefix TEXT DEFAULT 'v_',
  p_since TIMESTAMP DEFAULT NULL, p_through TIMESTAMP DEFAULT NOW(),
  OUT p_merged BIGINT)
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format($sql$
    INSERT INTO "Site" ("id","employerId","name")
    SELECT DISTINCT md5(employer_ref||'|'||site_name), employer_ref, site_name
    FROM %I.%Iemployees
    WHERE site_name IS NOT NULL
      AND source_updated_at <= $1 AND ($2::timestamp IS NULL OR source_updated_at > $2)
    ON CONFLICT ("employerId","name") DO NOTHING
  $sql$, p_source_schema, p_view_prefix) USING p_through, p_since;

  EXECUTE format($sql$
    WITH src AS (
      SELECT employer_ref, payroll_ref, observed_at, site_name, income_band,
             eligible_from, eligible_to, active, source_updated_at,
             COALESCE(is_deleted,FALSE) AS is_deleted
      FROM %I.%Iemployees
      WHERE source_updated_at <= $1 AND ($2::timestamp IS NULL OR source_updated_at > $2)
    ),
    ins AS (
      INSERT INTO "Employee"
        ("id","employerId","payrollRef","siteId","incomeBand","active","observedAt",
         "eligibleFrom","eligibleTo","sourceUpdatedAt","sourceDeletedAt","updatedAt")
      SELECT md5(employer_ref||'|'||payroll_ref), employer_ref, payroll_ref,
             (SELECT s."id" FROM "Site" s WHERE s."employerId"=employer_ref AND s."name"=src.site_name),
             income_band,
             CASE WHEN is_deleted THEN FALSE ELSE COALESCE(active, eligible_to IS NULL) END,
             observed_at, eligible_from, eligible_to, source_updated_at,
             CASE WHEN is_deleted THEN source_updated_at ELSE NULL END, NOW()
      FROM src
      ON CONFLICT ("employerId","payrollRef") DO UPDATE SET
        "siteId"=EXCLUDED."siteId", "incomeBand"=EXCLUDED."incomeBand",
        "active"=EXCLUDED."active", "observedAt"=EXCLUDED."observedAt",
        "eligibleFrom"=EXCLUDED."eligibleFrom", "eligibleTo"=EXCLUDED."eligibleTo",
        "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt",
        "sourceDeletedAt"=EXCLUDED."sourceDeletedAt", "updatedAt"=NOW()
      WHERE EXCLUDED."observedAt" > "Employee"."observedAt"
         OR (EXCLUDED."observedAt" = "Employee"."observedAt"
             AND EXCLUDED."sourceUpdatedAt" >= "Employee"."sourceUpdatedAt")
      RETURNING "id" AS employee_id, "observedAt" AS observed_at, xmax = 0 AS is_ins
    )
    INSERT INTO "EmployeeVersion"
      ("id","employeeId","observedAt","siteName","active","eligibleFrom","eligibleTo",
       "isDeleted","sourceUpdatedAt","createdAt")
    SELECT md5(i.employee_id||'|'||s.observed_at::text), i.employee_id, s.observed_at,
           s.site_name,
           CASE WHEN s.is_deleted THEN FALSE ELSE COALESCE(s.active, s.eligible_to IS NULL) END,
           s.eligible_from, s.eligible_to, s.is_deleted, s.source_updated_at, NOW()
    FROM ins i JOIN src s ON md5(s.employer_ref||'|'||s.payroll_ref) = i.employee_id
    ON CONFLICT ("employeeId","observedAt") DO UPDATE SET
      "siteName"=EXCLUDED."siteName", "active"=EXCLUDED."active",
      "eligibleFrom"=EXCLUDED."eligibleFrom", "eligibleTo"=EXCLUDED."eligibleTo",
      "isDeleted"=EXCLUDED."isDeleted", "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt"
    WHERE EXCLUDED."sourceUpdatedAt" >= "EmployeeVersion"."sourceUpdatedAt"
  $sql$, p_source_schema, p_view_prefix) USING p_through, p_since;
  GET DIAGNOSTICS p_merged = ROW_COUNT;
END;
$$;
