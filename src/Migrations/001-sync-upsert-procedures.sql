-- ═══════════════════════════════════════════════════════════════════════════
-- 001 — SERVER-SIDE UPSERT PROCEDURES FOR LIVE INTEGRATION SYNCS
--
-- Each function takes one JSONB array of CANONICAL SOURCE ROWS (exactly the
-- column names defined in src/services/reportFormats.ts) and merges them
-- into the portal tables with the same semantics as importService.ts:
--   · source refs are used as IDs where the app uses them (journey_ref, …)
--   · deterministic md5 IDs elsewhere, so re-runs never duplicate
--   · is_deleted tombstones set source_deleted_at = source_updated_at
--   · stale rows (older source_updated_at) are skipped, never resurrected
--   · rand decimals are converted to integer cents here
-- Verified against prisma/schema.prisma (no @map — quoted camelCase columns).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Employers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_upsert_employers(p_rows JSONB DEFAULT NULL)
RETURNS TABLE (inserted BIGINT, updated BIGINT, deleted BIGINT) AS $$
BEGIN
  RETURN QUERY
  WITH src AS (
    SELECT (r->>'employer_ref')::VARCHAR(64) AS employer_ref,
           (r->>'name')::VARCHAR(200) AS name,
           (r->>'eligible_count')::INT AS eligible_count,
           (r->>'eligible_count_as_at')::DATE AS eligible_count_as_at,
           (r->>'source_updated_at')::TIMESTAMP AS source_updated_at,
           COALESCE((r->>'is_deleted')::BOOLEAN, FALSE) AS is_deleted
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) r
    WHERE r->>'employer_ref' IS NOT NULL
  ),
  ups AS (
    INSERT INTO "Employer" ("id","name","eligibleCount","eligibleCountAsAt","sourceUpdatedAt","sourceDeletedAt","updatedAt")
    SELECT employer_ref, name, COALESCE(eligible_count, 0), eligible_count_as_at, source_updated_at,
           CASE WHEN is_deleted THEN source_updated_at ELSE NULL END, NOW()
    FROM src
    ON CONFLICT ("id") DO UPDATE SET
      "name"=EXCLUDED."name", "eligibleCount"=EXCLUDED."eligibleCount",
      "eligibleCountAsAt"=EXCLUDED."eligibleCountAsAt",
      "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt",
      "sourceDeletedAt"=EXCLUDED."sourceDeletedAt", "updatedAt"=NOW()
    WHERE EXCLUDED."sourceUpdatedAt" >= "Employer"."sourceUpdatedAt"
    RETURNING xmax = 0 AS is_ins
  )
  SELECT COUNT(*) FILTER (WHERE is_ins)::BIGINT,
         COUNT(*) FILTER (WHERE NOT is_ins)::BIGINT,
         0::BIGINT FROM ups;
END;
$$ LANGUAGE plpgsql;

-- ── Workforce snapshots (unique: employerId + asOfDate) ────────────────────
CREATE OR REPLACE FUNCTION sync_upsert_workforce_snapshots(p_rows JSONB DEFAULT NULL)
RETURNS TABLE (inserted BIGINT, updated BIGINT, deleted BIGINT) AS $$
BEGIN
  RETURN QUERY
  WITH src AS (
    SELECT (r->>'employer_ref')::VARCHAR(64) AS employer_ref,
           (r->>'as_of_date')::DATE AS as_of_date,
           (r->>'eligible_count')::INT AS eligible_count,
           (r->>'source_updated_at')::TIMESTAMP AS source_updated_at,
           COALESCE((r->>'is_deleted')::BOOLEAN, FALSE) AS is_deleted
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) r
    WHERE r->>'employer_ref' IS NOT NULL AND r->>'as_of_date' IS NOT NULL
  ),
  ups AS (
    INSERT INTO "EmployerHeadcountSnapshot"
      ("id","employerId","asOfDate","eligibleCount","sourceUpdatedAt","sourceDeletedAt","createdAt")
    SELECT md5(employer_ref || '|' || as_of_date::TEXT), employer_ref, as_of_date,
           COALESCE(eligible_count, 0), source_updated_at,
           CASE WHEN is_deleted THEN source_updated_at ELSE NULL END, NOW()
    FROM src
    ON CONFLICT ("employerId","asOfDate") DO UPDATE SET
      "eligibleCount"=EXCLUDED."eligibleCount",
      "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt",
      "sourceDeletedAt"=EXCLUDED."sourceDeletedAt"
    WHERE EXCLUDED."sourceUpdatedAt" >= "EmployerHeadcountSnapshot"."sourceUpdatedAt"
    RETURNING xmax = 0 AS is_ins
  )
  SELECT COUNT(*) FILTER (WHERE is_ins)::BIGINT,
         COUNT(*) FILTER (WHERE NOT is_ins)::BIGINT,
         0::BIGINT FROM ups;
END;
$$ LANGUAGE plpgsql;

-- ── Employees: Site upsert + projection (unique: employerId+payrollRef)
--   + one EmployeeVersion observation per (employee, observed_at) ───────────
CREATE OR REPLACE FUNCTION sync_upsert_employees(p_rows JSONB DEFAULT NULL)
RETURNS TABLE (inserted BIGINT, updated BIGINT, deleted BIGINT) AS $$
DECLARE v_ins BIGINT := 0; v_upd BIGINT := 0;
BEGIN
  INSERT INTO "Site" ("id","employerId","name")
  SELECT DISTINCT
         md5((r->>'employer_ref') || '|' || (r->>'site_name')),
         (r->>'employer_ref')::VARCHAR(64),
         (r->>'site_name')::VARCHAR(150)
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) r
  WHERE r->>'employer_ref' IS NOT NULL
    AND NULLIF(r->>'site_name','') IS NOT NULL
  ON CONFLICT ("employerId","name") DO NOTHING;

  WITH src AS (
    SELECT (r->>'employer_ref')::VARCHAR(64) AS employer_ref,
           (r->>'payroll_ref')::VARCHAR(64) AS payroll_ref,
           (r->>'observed_at')::DATE AS observed_at,
           NULLIF(r->>'site_name','')::VARCHAR(150) AS site_name,
           NULLIF(r->>'income_band','')::"IncomeBand" AS income_band,
           (r->>'eligible_from')::DATE AS eligible_from,
           (r->>'eligible_to')::DATE AS eligible_to,
           (r->>'active')::BOOLEAN AS active,
           (r->>'source_updated_at')::TIMESTAMP AS source_updated_at,
           COALESCE((r->>'is_deleted')::BOOLEAN, FALSE) AS is_deleted
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) r
    WHERE r->>'employer_ref' IS NOT NULL AND r->>'payroll_ref' IS NOT NULL
  ),
  projection AS (
    SELECT DISTINCT ON (employer_ref, payroll_ref) *
    FROM src
    ORDER BY employer_ref, payroll_ref, observed_at DESC, source_updated_at DESC
  ),
  ups AS (
    INSERT INTO "Employee"
      ("id","employerId","payrollRef","siteId","incomeBand","active","observedAt",
       "eligibleFrom","eligibleTo","sourceUpdatedAt","sourceDeletedAt","updatedAt")
    SELECT md5(employer_ref || '|' || payroll_ref), employer_ref, payroll_ref,
           (SELECT s."id" FROM "Site" s WHERE s."employerId" = employer_ref AND s."name" = projection.site_name),
           income_band,
           CASE WHEN is_deleted THEN FALSE ELSE COALESCE(active, eligible_to IS NULL) END,
           observed_at, eligible_from, eligible_to, source_updated_at,
           CASE WHEN is_deleted THEN source_updated_at ELSE NULL END, NOW()
    FROM projection
    ON CONFLICT ("employerId","payrollRef") DO UPDATE SET
      "siteId"=EXCLUDED."siteId", "incomeBand"=EXCLUDED."incomeBand",
      "active"=EXCLUDED."active", "observedAt"=EXCLUDED."observedAt",
      "eligibleFrom"=EXCLUDED."eligibleFrom", "eligibleTo"=EXCLUDED."eligibleTo",
      "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt",
      "sourceDeletedAt"=EXCLUDED."sourceDeletedAt", "updatedAt"=NOW()
    WHERE EXCLUDED."observedAt" > "Employee"."observedAt"
       OR (EXCLUDED."observedAt" = "Employee"."observedAt"
           AND EXCLUDED."sourceUpdatedAt" >= "Employee"."sourceUpdatedAt")
    RETURNING xmax = 0 AS is_ins
  )
  SELECT COUNT(*) FILTER (WHERE is_ins), COUNT(*) FILTER (WHERE NOT is_ins)
  INTO v_ins, v_upd FROM ups;

  INSERT INTO "EmployeeVersion"
    ("id","employeeId","observedAt","siteName","incomeBand","active","eligibleFrom","eligibleTo",
     "isDeleted","sourceUpdatedAt","createdAt")
  SELECT md5(e."id" || '|' || s.observed_at::TEXT), e."id", s.observed_at, s.site_name, s.income_band,
         CASE WHEN s.is_deleted THEN FALSE ELSE COALESCE(s.active, s.eligible_to IS NULL) END,
         s.eligible_from, s.eligible_to, s.is_deleted, s.source_updated_at, NOW()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) r
  JOIN "Employee" e ON e."employerId" = r->>'employer_ref' AND e."payrollRef" = r->>'payroll_ref'
  CROSS JOIN LATERAL (SELECT (r->>'observed_at')::DATE AS observed_at,
                             NULLIF(r->>'site_name','')::VARCHAR(150) AS site_name,
                             NULLIF(r->>'income_band','')::"IncomeBand" AS income_band,
                             (r->>'eligible_from')::DATE AS eligible_from,
                             (r->>'eligible_to')::DATE AS eligible_to,
                             (r->>'active')::BOOLEAN AS active,
                             COALESCE((r->>'is_deleted')::BOOLEAN, FALSE) AS is_deleted,
                             (r->>'source_updated_at')::TIMESTAMP AS source_updated_at) s
  ON CONFLICT ("employeeId","observedAt") DO UPDATE SET
    "siteName"=EXCLUDED."siteName", "incomeBand"=EXCLUDED."incomeBand", "active"=EXCLUDED."active",
    "eligibleFrom"=EXCLUDED."eligibleFrom", "eligibleTo"=EXCLUDED."eligibleTo",
    "isDeleted"=EXCLUDED."isDeleted", "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt"
  WHERE EXCLUDED."sourceUpdatedAt" >= "EmployeeVersion"."sourceUpdatedAt";

  RETURN QUERY SELECT v_ins, v_upd, 0::BIGINT;
END;
$$ LANGUAGE plpgsql;

-- ── Platform users (unique: employeeId; resolved via Employee) ─────────────
CREATE OR REPLACE FUNCTION sync_upsert_platform_users(p_rows JSONB DEFAULT NULL)
RETURNS TABLE (inserted BIGINT, updated BIGINT, deleted BIGINT) AS $$
BEGIN
  RETURN QUERY
  WITH src AS (
    SELECT (r->>'employer_ref')::VARCHAR(64) AS employer_ref,
           (r->>'payroll_ref')::VARCHAR(64) AS payroll_ref,
           (r->>'enrolled_at')::DATE AS enrolled_at,
           (r->>'activated_at')::DATE AS activated_at,
           COALESCE((r->>'has_credit_profile')::BOOLEAN, FALSE) AS has_credit_profile,
           (r->>'source_updated_at')::TIMESTAMP AS source_updated_at,
           COALESCE((r->>'is_deleted')::BOOLEAN, FALSE) AS is_deleted
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) r
    WHERE r->>'employer_ref' IS NOT NULL AND r->>'payroll_ref' IS NOT NULL
  ),
  resolved AS (
    SELECT e."id" AS employee_id, s.*
    FROM src s JOIN "Employee" e ON e."employerId" = s.employer_ref AND e."payrollRef" = s.payroll_ref
  ),
  ups AS (
    INSERT INTO "PlatformUser"
      ("id","employeeId","enrolledAt","activatedAt","hasCreditProfile",
       "sourceUpdatedAt","sourceDeletedAt","updatedAt")
    SELECT md5(employee_id), employee_id, enrolled_at, activated_at, has_credit_profile,
           source_updated_at,
           CASE WHEN is_deleted THEN source_updated_at ELSE NULL END, NOW()
    FROM resolved
    ON CONFLICT ("employeeId") DO UPDATE SET
      "enrolledAt"=EXCLUDED."enrolledAt", "activatedAt"=EXCLUDED."activatedAt",
      "hasCreditProfile"=EXCLUDED."hasCreditProfile",
      "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt",
      "sourceDeletedAt"=EXCLUDED."sourceDeletedAt", "updatedAt"=NOW()
    WHERE EXCLUDED."sourceUpdatedAt" >= "PlatformUser"."sourceUpdatedAt"
    RETURNING xmax = 0 AS is_ins
  )
  SELECT COUNT(*) FILTER (WHERE is_ins)::BIGINT,
         COUNT(*) FILTER (WHERE NOT is_ins)::BIGINT,
         0::BIGINT FROM ups;
END;
$$ LANGUAGE plpgsql;

-- ── Journeys (PK id = journey_ref) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_upsert_journeys(p_rows JSONB DEFAULT NULL)
RETURNS TABLE (inserted BIGINT, updated BIGINT, deleted BIGINT) AS $$
BEGIN
  RETURN QUERY
  WITH src AS (
    SELECT (r->>'journey_ref')::VARCHAR(64) AS journey_ref,
           (r->>'employer_ref')::VARCHAR(64) AS employer_ref,
           (r->>'payroll_ref')::VARCHAR(64) AS payroll_ref,
           (r->>'type')::"JourneyType" AS type,
           (r->>'status')::"JourneyStatus" AS status,
           (r->>'started_at')::DATE AS started_at,
           (r->>'completed_at')::DATE AS completed_at,
           (r->>'monthly_saving_rand')::INT AS monthly_saving_cents,
           (r->>'balance_impact_rand')::INT AS balance_impact_cents,
           (r->>'source_updated_at')::TIMESTAMP AS source_updated_at,
           COALESCE((r->>'is_deleted')::BOOLEAN, FALSE) AS is_deleted
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) r
    WHERE r->>'journey_ref' IS NOT NULL
  ),
  resolved AS (
    SELECT pu."id" AS platform_user_id, s.*
    FROM src s
    JOIN "Employee" e ON e."employerId" = s.employer_ref AND e."payrollRef" = s.payroll_ref
    JOIN "PlatformUser" pu ON pu."employeeId" = e."id"
  ),
  ups AS (
    INSERT INTO "Journey"
      ("id","platformUserId","type","status","startedAt","completedAt",
       "monthlySavingCents","balanceImpactCents","sourceUpdatedAt","sourceDeletedAt","updatedAt")
    SELECT journey_ref, platform_user_id, type, status, started_at, completed_at,
           monthly_saving_cents, balance_impact_cents, source_updated_at,
           CASE WHEN is_deleted THEN source_updated_at ELSE NULL END, NOW()
    FROM resolved
    ON CONFLICT ("id") DO UPDATE SET
      "type"=EXCLUDED."type", "status"=EXCLUDED."status",
      "startedAt"=EXCLUDED."startedAt", "completedAt"=EXCLUDED."completedAt",
      "monthlySavingCents"=EXCLUDED."monthlySavingCents",
      "balanceImpactCents"=EXCLUDED."balanceImpactCents",
      "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt",
      "sourceDeletedAt"=EXCLUDED."sourceDeletedAt", "updatedAt"=NOW()
    WHERE EXCLUDED."sourceUpdatedAt" >= "Journey"."sourceUpdatedAt"
    RETURNING xmax = 0 AS is_ins
  )
  SELECT COUNT(*) FILTER (WHERE is_ins)::BIGINT,
         COUNT(*) FILTER (WHERE NOT is_ins)::BIGINT,
         0::BIGINT FROM ups;
END;
$$ LANGUAGE plpgsql;

-- ── Debt accounts (PK id = account_ref; projection + DebtAccountVersion) ───
CREATE OR REPLACE FUNCTION sync_upsert_debt_accounts(p_rows JSONB DEFAULT NULL)
RETURNS TABLE (inserted BIGINT, updated BIGINT, deleted BIGINT) AS $$
DECLARE v_ins BIGINT := 0; v_upd BIGINT := 0;
BEGIN
  WITH src AS (
    SELECT (r->>'account_ref')::VARCHAR(64) AS account_ref,
           (r->>'employer_ref')::VARCHAR(64) AS employer_ref,
           (r->>'payroll_ref')::VARCHAR(64) AS payroll_ref,
           (r->>'observed_at')::DATE AS observed_at,
           (r->>'closed_at')::DATE AS closed_at,
           (r->>'creditor_name')::VARCHAR(150) AS creditor_name,
           (r->>'credit_type')::"CreditType" AS credit_type,
           (r->>'balance_rand')::INT AS balance_cents,
           COALESCE((r->>'in_arrears')::BOOLEAN, FALSE) AS in_arrears,
           COALESCE(NULLIF(r->>'state','')::"DebtState", 'NONE'::"DebtState") AS state,
           NULLIF(r->>'challenge_status','')::"ChallengeStatus" AS challenge_status,
           NULLIF(r->>'journey_ref','')::VARCHAR(64) AS journey_ref,
           (r->>'source_updated_at')::TIMESTAMP AS source_updated_at,
           COALESCE((r->>'is_deleted')::BOOLEAN, FALSE) AS is_deleted
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) r
    WHERE r->>'account_ref' IS NOT NULL
  ),
  resolved AS (
    SELECT pu."id" AS platform_user_id, s.*
    FROM src s
    JOIN "Employee" e ON e."employerId" = s.employer_ref AND e."payrollRef" = s.payroll_ref
    JOIN "PlatformUser" pu ON pu."employeeId" = e."id"
  ),
  projection AS (
    SELECT DISTINCT ON (account_ref) *
    FROM resolved
    ORDER BY account_ref, observed_at DESC, source_updated_at DESC
  ),
  ups AS (
    INSERT INTO "DebtAccount"
      ("id","platformUserId","journeyId","creditorName","creditType","balanceCents",
       "inArrears","state","challengeStatus","observedAt","closedAt",
       "sourceUpdatedAt","sourceDeletedAt","updatedAt")
    SELECT account_ref, platform_user_id, journey_ref, creditor_name, credit_type,
           balance_cents, in_arrears, state, challenge_status, observed_at, closed_at,
           source_updated_at,
           CASE WHEN is_deleted THEN source_updated_at ELSE NULL END, NOW()
    FROM projection
    ON CONFLICT ("id") DO UPDATE SET
      "journeyId"=EXCLUDED."journeyId", "creditorName"=EXCLUDED."creditorName",
      "creditType"=EXCLUDED."creditType", "balanceCents"=EXCLUDED."balanceCents",
      "inArrears"=EXCLUDED."inArrears", "state"=EXCLUDED."state",
      "challengeStatus"=EXCLUDED."challengeStatus", "observedAt"=EXCLUDED."observedAt",
      "closedAt"=EXCLUDED."closedAt", "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt",
      "sourceDeletedAt"=EXCLUDED."sourceDeletedAt", "updatedAt"=NOW()
    WHERE EXCLUDED."observedAt" > "DebtAccount"."observedAt"
       OR (EXCLUDED."observedAt" = "DebtAccount"."observedAt"
           AND EXCLUDED."sourceUpdatedAt" >= "DebtAccount"."sourceUpdatedAt")
    RETURNING xmax = 0 AS is_ins
  )
  SELECT COUNT(*) FILTER (WHERE is_ins), COUNT(*) FILTER (WHERE NOT is_ins)
  INTO v_ins, v_upd FROM ups;

  INSERT INTO "DebtAccountVersion"
    ("id","accountId","observedAt","creditorName","creditType","balanceCents","inArrears",
     "state","challengeStatus","journeyId","closedAt","isDeleted","sourceUpdatedAt","createdAt")
  SELECT md5(d."id" || '|' || s.observed_at::TEXT), d."id", s.observed_at,
         s.creditor_name, s.credit_type, s.balance_cents, s.in_arrears, s.state,
         s.challenge_status, s.journey_ref, s.closed_at, s.is_deleted, s.source_updated_at, NOW()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) r
  CROSS JOIN LATERAL (SELECT (r->>'account_ref')::VARCHAR(64) AS account_ref,
                             (r->>'observed_at')::DATE AS observed_at,
                             (r->>'creditor_name')::VARCHAR(150) AS creditor_name,
                             (r->>'credit_type')::"CreditType" AS credit_type,
                             (r->>'balance_rand')::INT AS balance_cents,
                             COALESCE((r->>'in_arrears')::BOOLEAN, FALSE) AS in_arrears,
                             COALESCE(NULLIF(r->>'state','')::"DebtState", 'NONE'::"DebtState") AS state,
                             NULLIF(r->>'challenge_status','')::"ChallengeStatus" AS challenge_status,
                             NULLIF(r->>'journey_ref','')::VARCHAR(64) AS journey_ref,
                             (r->>'closed_at')::DATE AS closed_at,
                             COALESCE((r->>'is_deleted')::BOOLEAN, FALSE) AS is_deleted,
                             (r->>'source_updated_at')::TIMESTAMP AS source_updated_at) s
  JOIN "DebtAccount" d ON d."id" = s.account_ref
  ON CONFLICT ("accountId","observedAt") DO UPDATE SET
    "creditorName"=EXCLUDED."creditorName", "creditType"=EXCLUDED."creditType",
    "balanceCents"=EXCLUDED."balanceCents", "inArrears"=EXCLUDED."inArrears",
    "state"=EXCLUDED."state", "challengeStatus"=EXCLUDED."challengeStatus",
    "journeyId"=EXCLUDED."journeyId",
    "closedAt"=EXCLUDED."closedAt", "isDeleted"=EXCLUDED."isDeleted",
    "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt"
  WHERE EXCLUDED."sourceUpdatedAt" >= "DebtAccountVersion"."sourceUpdatedAt";

  RETURN QUERY SELECT v_ins, v_upd, 0::BIGINT;
END;
$$ LANGUAGE plpgsql;

-- ── Insurance policies (PK id = policy_ref; projection + version) ──────────
CREATE OR REPLACE FUNCTION sync_upsert_policies(p_rows JSONB DEFAULT NULL)
RETURNS TABLE (inserted BIGINT, updated BIGINT, deleted BIGINT) AS $$
DECLARE v_ins BIGINT := 0; v_upd BIGINT := 0;
BEGIN
  WITH src AS (
    SELECT (r->>'policy_ref')::VARCHAR(64) AS policy_ref,
           (r->>'employer_ref')::VARCHAR(64) AS employer_ref,
           (r->>'payroll_ref')::VARCHAR(64) AS payroll_ref,
           (r->>'observed_at')::DATE AS observed_at,
           (r->>'effective_from')::DATE AS effective_from,
           (r->>'effective_to')::DATE AS effective_to,
           (r->>'resolved_at')::DATE AS resolved_at,
           (r->>'type')::"PolicyType" AS type,
           (r->>'premium_rand')::INT AS premium_cents,
           COALESCE((r->>'is_wasteful')::BOOLEAN, FALSE) AS is_wasteful,
           COALESCE((r->>'is_resolved')::BOOLEAN, FALSE) AS is_resolved,
           (r->>'source_updated_at')::TIMESTAMP AS source_updated_at,
           COALESCE((r->>'is_deleted')::BOOLEAN, FALSE) AS is_deleted
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) r
    WHERE r->>'policy_ref' IS NOT NULL
  ),
  resolved AS (
    SELECT pu."id" AS platform_user_id, s.*
    FROM src s
    JOIN "Employee" e ON e."employerId" = s.employer_ref AND e."payrollRef" = s.payroll_ref
    JOIN "PlatformUser" pu ON pu."employeeId" = e."id"
  ),
  projection AS (
    SELECT DISTINCT ON (policy_ref) *
    FROM resolved
    ORDER BY policy_ref, observed_at DESC, source_updated_at DESC
  ),
  ups AS (
    INSERT INTO "InsurancePolicy"
      ("id","platformUserId","type","premiumCents","isWasteful","isResolved",
       "observedAt","effectiveFrom","effectiveTo","resolvedAt",
       "sourceUpdatedAt","sourceDeletedAt","updatedAt")
    SELECT policy_ref, platform_user_id, type, premium_cents, is_wasteful, is_resolved,
           observed_at, effective_from, effective_to, resolved_at,
           source_updated_at,
           CASE WHEN is_deleted THEN source_updated_at ELSE NULL END, NOW()
    FROM projection
    ON CONFLICT ("id") DO UPDATE SET
      "type"=EXCLUDED."type", "premiumCents"=EXCLUDED."premiumCents",
      "isWasteful"=EXCLUDED."isWasteful", "isResolved"=EXCLUDED."isResolved",
      "observedAt"=EXCLUDED."observedAt", "effectiveFrom"=EXCLUDED."effectiveFrom",
      "effectiveTo"=EXCLUDED."effectiveTo", "resolvedAt"=EXCLUDED."resolvedAt",
      "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt",
      "sourceDeletedAt"=EXCLUDED."sourceDeletedAt", "updatedAt"=NOW()
    WHERE EXCLUDED."observedAt" > "InsurancePolicy"."observedAt"
       OR (EXCLUDED."observedAt" = "InsurancePolicy"."observedAt"
           AND EXCLUDED."sourceUpdatedAt" >= "InsurancePolicy"."sourceUpdatedAt")
    RETURNING xmax = 0 AS is_ins
  )
  SELECT COUNT(*) FILTER (WHERE is_ins), COUNT(*) FILTER (WHERE NOT is_ins)
  INTO v_ins, v_upd FROM ups;

  INSERT INTO "InsurancePolicyVersion"
    ("id","policyId","observedAt","type","premiumCents","isWasteful","isResolved",
     "effectiveFrom","effectiveTo","resolvedAt","isDeleted","sourceUpdatedAt","createdAt")
  SELECT md5(p."id" || '|' || s.observed_at::TEXT), p."id", s.observed_at,
         s.type, s.premium_cents, s.is_wasteful, s.is_resolved, s.effective_from,
         s.effective_to, s.resolved_at, s.is_deleted, s.source_updated_at, NOW()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) r
  CROSS JOIN LATERAL (SELECT (r->>'policy_ref')::VARCHAR(64) AS policy_ref,
                             (r->>'observed_at')::DATE AS observed_at,
                             (r->>'type')::"PolicyType" AS type,
                             (r->>'premium_rand')::INT AS premium_cents,
                             COALESCE((r->>'is_wasteful')::BOOLEAN, FALSE) AS is_wasteful,
                             COALESCE((r->>'is_resolved')::BOOLEAN, FALSE) AS is_resolved,
                             (r->>'effective_from')::DATE AS effective_from,
                             (r->>'effective_to')::DATE AS effective_to,
                             (r->>'resolved_at')::DATE AS resolved_at,
                             COALESCE((r->>'is_deleted')::BOOLEAN, FALSE) AS is_deleted,
                             (r->>'source_updated_at')::TIMESTAMP AS source_updated_at) s
  JOIN "InsurancePolicy" p ON p."id" = s.policy_ref
  ON CONFLICT ("policyId","observedAt") DO UPDATE SET
    "type"=EXCLUDED."type", "premiumCents"=EXCLUDED."premiumCents", "isWasteful"=EXCLUDED."isWasteful",
    "isResolved"=EXCLUDED."isResolved", "effectiveFrom"=EXCLUDED."effectiveFrom",
    "effectiveTo"=EXCLUDED."effectiveTo", "resolvedAt"=EXCLUDED."resolvedAt",
    "isDeleted"=EXCLUDED."isDeleted", "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt"
  WHERE EXCLUDED."sourceUpdatedAt" >= "InsurancePolicyVersion"."sourceUpdatedAt";

  RETURN QUERY SELECT v_ins, v_upd, 0::BIGINT;
END;
$$ LANGUAGE plpgsql;

-- ── Ratings (PK id = rating_ref) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_upsert_ratings(p_rows JSONB DEFAULT NULL)
RETURNS TABLE (inserted BIGINT, updated BIGINT, deleted BIGINT) AS $$
BEGIN
  RETURN QUERY
  WITH src AS (
    SELECT (r->>'rating_ref')::VARCHAR(64) AS rating_ref,
           (r->>'employer_ref')::VARCHAR(64) AS employer_ref,
           (r->>'payroll_ref')::VARCHAR(64) AS payroll_ref,
           NULLIF(r->>'journey_type','')::"JourneyType" AS journey_type,
           (r->>'stars')::INT AS stars,
           (r->>'created_at')::DATE AS created_at,
           (r->>'source_updated_at')::TIMESTAMP AS source_updated_at,
           COALESCE((r->>'is_deleted')::BOOLEAN, FALSE) AS is_deleted
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) r
    WHERE r->>'rating_ref' IS NOT NULL
  ),
  resolved AS (
    SELECT pu."id" AS platform_user_id, s.*
    FROM src s
    JOIN "Employee" e ON e."employerId" = s.employer_ref AND e."payrollRef" = s.payroll_ref
    JOIN "PlatformUser" pu ON pu."employeeId" = e."id"
  ),
  ups AS (
    INSERT INTO "Rating"
      ("id","platformUserId","journeyType","stars","createdAt",
       "sourceUpdatedAt","sourceDeletedAt","updatedAt")
    SELECT rating_ref, platform_user_id, journey_type, stars, created_at,
           source_updated_at,
           CASE WHEN is_deleted THEN source_updated_at ELSE NULL END, NOW()
    FROM resolved
    ON CONFLICT ("id") DO UPDATE SET
      "journeyType"=EXCLUDED."journeyType", "stars"=EXCLUDED."stars",
      "createdAt"=EXCLUDED."createdAt",
      "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt",
      "sourceDeletedAt"=EXCLUDED."sourceDeletedAt", "updatedAt"=NOW()
    WHERE EXCLUDED."sourceUpdatedAt" >= "Rating"."sourceUpdatedAt"
    RETURNING xmax = 0 AS is_ins
  )
  SELECT COUNT(*) FILTER (WHERE is_ins)::BIGINT,
         COUNT(*) FILTER (WHERE NOT is_ins)::BIGINT,
         0::BIGINT FROM ups;
END;
$$ LANGUAGE plpgsql;

-- ── Referrals (PK id = referral_ref) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_upsert_referrals(p_rows JSONB DEFAULT NULL)
RETURNS TABLE (inserted BIGINT, updated BIGINT, deleted BIGINT) AS $$
BEGIN
  RETURN QUERY
  WITH src AS (
    SELECT (r->>'referral_ref')::VARCHAR(64) AS referral_ref,
           (r->>'employer_ref')::VARCHAR(64) AS employer_ref,
           (r->>'payroll_ref')::VARCHAR(64) AS payroll_ref,
           NULLIF(r->>'channel','')::VARCHAR(60) AS channel,
           (r->>'shared_at')::DATE AS shared_at,
           COALESCE((r->>'converted')::BOOLEAN, FALSE) AS converted,
           (r->>'converted_at')::DATE AS converted_at,
           (r->>'source_updated_at')::TIMESTAMP AS source_updated_at,
           COALESCE((r->>'is_deleted')::BOOLEAN, FALSE) AS is_deleted
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) r
    WHERE r->>'referral_ref' IS NOT NULL
  ),
  resolved AS (
    SELECT pu."id" AS platform_user_id, s.*
    FROM src s
    JOIN "Employee" e ON e."employerId" = s.employer_ref AND e."payrollRef" = s.payroll_ref
    JOIN "PlatformUser" pu ON pu."employeeId" = e."id"
  ),
  ups AS (
    INSERT INTO "Referral"
      ("id","platformUserId","channel","sharedAt","converted","convertedAt",
       "sourceUpdatedAt","sourceDeletedAt","updatedAt")
    SELECT referral_ref, platform_user_id, channel, shared_at, converted, converted_at,
           source_updated_at,
           CASE WHEN is_deleted THEN source_updated_at ELSE NULL END, NOW()
    FROM resolved
    ON CONFLICT ("id") DO UPDATE SET
      "channel"=EXCLUDED."channel", "sharedAt"=EXCLUDED."sharedAt",
      "converted"=EXCLUDED."converted", "convertedAt"=EXCLUDED."convertedAt",
      "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt",
      "sourceDeletedAt"=EXCLUDED."sourceDeletedAt", "updatedAt"=NOW()
    WHERE EXCLUDED."sourceUpdatedAt" >= "Referral"."sourceUpdatedAt"
    RETURNING xmax = 0 AS is_ins
  )
  SELECT COUNT(*) FILTER (WHERE is_ins)::BIGINT,
         COUNT(*) FILTER (WHERE NOT is_ins)::BIGINT,
         0::BIGINT FROM ups;
END;
$$ LANGUAGE plpgsql;

-- ── Salary advances (PK id = salary_advance_id) ────────────────────────────
CREATE OR REPLACE FUNCTION sync_upsert_salary_advances(p_rows JSONB DEFAULT NULL)
RETURNS TABLE (inserted BIGINT, updated BIGINT, deleted BIGINT) AS $$
BEGIN
  RETURN QUERY
  WITH src AS (
    SELECT (r->>'salary_advance_id')::VARCHAR(64) AS salary_advance_id,
           (r->>'employer_ref')::VARCHAR(64) AS employer_ref,
           (r->>'client_id')::VARCHAR(64) AS client_id,
           (r->>'payroll_ref')::VARCHAR(64) AS payroll_ref,
           (r->>'amount')::INT AS amount_cents,
           (r->>'salary_advance_status')::"AdvanceStatus" AS status,
           NULLIF(r->>'bank_account_verification_status','')::VARCHAR(30) AS bank_status,
           COALESCE((r->>'blacklisted')::BOOLEAN, FALSE) AS blacklisted,
           (r->>'advanced_at')::DATE AS advanced_at,
           (r->>'source_updated_at')::TIMESTAMP AS source_updated_at,
           COALESCE((r->>'is_deleted')::BOOLEAN, FALSE) AS is_deleted
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) r
    WHERE r->>'salary_advance_id' IS NOT NULL
  ),
  resolved AS (
    SELECT (SELECT e."id" FROM "Employee" e
            WHERE e."employerId" = s.employer_ref AND e."payrollRef" = s.payroll_ref
            LIMIT 1) AS employee_id, s.*
    FROM src s
  ),
  ups AS (
    INSERT INTO "SalaryAdvance"
      ("id","advanceRef","employerId","employeeId","clientId","amountCents","status",
       "bankVerified","blacklisted","advancedAt","sourceUpdatedAt","sourceDeletedAt","updatedAt")
    SELECT md5('salary-advance|' || salary_advance_id), salary_advance_id, employer_ref, employee_id, client_id,
           amount_cents, status, (bank_status = 'PASSED'), blacklisted, advanced_at,
           source_updated_at,
           CASE WHEN is_deleted THEN source_updated_at ELSE NULL END, NOW()
    FROM resolved
    ON CONFLICT ("advanceRef") DO UPDATE SET
      "employerId"=EXCLUDED."employerId",
      "employeeId"=EXCLUDED."employeeId", "clientId"=EXCLUDED."clientId",
      "amountCents"=EXCLUDED."amountCents", "status"=EXCLUDED."status",
      "bankVerified"=EXCLUDED."bankVerified", "blacklisted"=EXCLUDED."blacklisted",
      "advancedAt"=EXCLUDED."advancedAt",
      "sourceUpdatedAt"=EXCLUDED."sourceUpdatedAt",
      "sourceDeletedAt"=EXCLUDED."sourceDeletedAt", "updatedAt"=NOW()
    WHERE EXCLUDED."sourceUpdatedAt" >= "SalaryAdvance"."sourceUpdatedAt"
    RETURNING xmax = 0 AS is_ins
  )
  SELECT COUNT(*) FILTER (WHERE is_ins)::BIGINT,
         COUNT(*) FILTER (WHERE NOT is_ins)::BIGINT,
         0::BIGINT FROM ups;
END;
$$ LANGUAGE plpgsql;
