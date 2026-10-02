-- Safely rename legacy portal roles in-place before Prisma schema sync.
-- The guards make this migration safe to run on every Railway deployment.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = '"Role"'::regtype AND enumlabel = 'EMPLOYER_VIEW')
     AND NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = '"Role"'::regtype AND enumlabel = 'EMPLOYER_MANAGER') THEN
    ALTER TYPE "Role" RENAME VALUE 'EMPLOYER_VIEW' TO 'EMPLOYER_MANAGER';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = '"Role"'::regtype AND enumlabel = 'PORTFOLIO_VIEW')
     AND NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = '"Role"'::regtype AND enumlabel = 'PORTFOLIO_MANAGER') THEN
    ALTER TYPE "Role" RENAME VALUE 'PORTFOLIO_VIEW' TO 'PORTFOLIO_MANAGER';
  END IF;
END $$;

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'VIEWER';
