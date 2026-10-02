-- Redesign portal roles without destructive enum replacement.
-- Existing users keep their permissions while the role names become explicit.
ALTER TYPE "Role" RENAME VALUE 'EMPLOYER_VIEW' TO 'EMPLOYER_MANAGER';
ALTER TYPE "Role" RENAME VALUE 'PORTFOLIO_VIEW' TO 'PORTFOLIO_MANAGER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'VIEWER';
