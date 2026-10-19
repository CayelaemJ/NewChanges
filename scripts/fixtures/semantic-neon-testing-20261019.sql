-- NewChanges SYNTHETIC fixture; database is an isolated Neon branch testing DB only.
-- No real people, employers, credentials, or source-system connections.
DO $$ BEGIN IF current_database() <> 'newchanges_testing_20261017' THEN RAISE EXCEPTION 'Refusing non-Testing database'; END IF; END $$;

INSERT INTO "Employer" ("id","name","eligibleCount","eligibleCountAsAt") VALUES ('__synthetic_semantic_e2e_20261019__','SYNTHETIC QA ONLY — NOT A REAL EMPLOYER',1,'2026-10-01') ON CONFLICT ("id") DO NOTHING;

INSERT INTO "EmployerHeadcountSnapshot" ("id","employerId","asOfDate","eligibleCount") VALUES ('__synthetic_semantic_e2e_20261019__-headcount','__synthetic_semantic_e2e_20261019__','2026-10-01',1) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Employee" ("id","employerId","payrollRef","incomeBand","active","observedAt","eligibleFrom") VALUES ('__synthetic_semantic_e2e_20261019__-employee','__synthetic_semantic_e2e_20261019__','SYNTHETIC-NONPERSON-001','BAND_20_40K',true,'2026-10-01','2026-10-01') ON CONFLICT ("id") DO NOTHING;

INSERT INTO "PlatformUser" ("id","employeeId","enrolledAt","hasCreditProfile") VALUES ('__synthetic_semantic_e2e_20261019__-user','__synthetic_semantic_e2e_20261019__-employee','2026-10-01',true) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Journey" ("id","platformUserId","type","status","startedAt","completedAt","monthlySavingCents") VALUES ('__synthetic_semantic_e2e_20261019__-journey','__synthetic_semantic_e2e_20261019__-user','ARREARS','COMPLETED','2026-10-01','2026-10-02',10000) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "DebtAccount" ("id","platformUserId","creditorName","creditType","balanceCents","inArrears","state","observedAt") VALUES ('__synthetic_semantic_e2e_20261019__-debt','__synthetic_semantic_e2e_20261019__-user','SYNTHETIC-CREDITOR','BANK_LOAN',500000,true,'ACTIVE_INTERVENTION','2026-10-01') ON CONFLICT ("id") DO NOTHING;

INSERT INTO "InsurancePolicy" ("id","platformUserId","type","premiumCents","isWasteful","isResolved","observedAt") VALUES ('__synthetic_semantic_e2e_20261019__-policy','__synthetic_semantic_e2e_20261019__-user','FUNERAL',15000,true,false,'2026-10-01') ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Rating" ("id","platformUserId","stars","createdAt") VALUES ('__synthetic_semantic_e2e_20261019__-rating','__synthetic_semantic_e2e_20261019__-user',4,'2026-10-03') ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Referral" ("id","platformUserId","channel","sharedAt","converted") VALUES ('__synthetic_semantic_e2e_20261019__-referral','__synthetic_semantic_e2e_20261019__-user','synthetic','2026-10-03',false) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "SalaryAdvance" ("id","advanceRef","employerId","employeeId","clientId","amountCents","status","advancedAt") VALUES ('__synthetic_semantic_e2e_20261019__-advance','SYNTHETIC-E2E-ADVANCE-20261019','__synthetic_semantic_e2e_20261019__','__synthetic_semantic_e2e_20261019__-employee','SYNTHETIC-CLIENT',10000,'FINALISED','2026-10-03') ON CONFLICT ("id") DO NOTHING;

INSERT INTO "AchievableTarget" ("id","employerId","driver","config","effectiveFrom") VALUES ('__synthetic_semantic_e2e_20261019__-target','__synthetic_semantic_e2e_20261019__','CASHFLOW','{"monthlyAchievableRand":500}'::jsonb,'2026-10-01') ON CONFLICT ("id") DO NOTHING;

INSERT INTO "SourceGeneration" ("id","fingerprint","sourceMode","endpointLabel","state","validation","validatedAt","activatedAt") VALUES ('__synthetic_semantic_generation_20261019__','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','SYNTHETIC','SYNTHETIC TEST DATA ONLY','ACTIVE','{"synthetic":true,"testingOnly":true}'::jsonb,now(),now()) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "SourceGenerationCursor" ("id","generationId","reportKey","reconciledAt","rowCount") VALUES ('__synthetic_semantic_generation_20261019__-cursor-0','__synthetic_semantic_generation_20261019__','employers',now(),1) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "SourceGenerationCursor" ("id","generationId","reportKey","reconciledAt","rowCount") VALUES ('__synthetic_semantic_generation_20261019__-cursor-1','__synthetic_semantic_generation_20261019__','workforce_snapshots',now(),1) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "SourceGenerationCursor" ("id","generationId","reportKey","reconciledAt","rowCount") VALUES ('__synthetic_semantic_generation_20261019__-cursor-2','__synthetic_semantic_generation_20261019__','employees',now(),1) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "SourceGenerationCursor" ("id","generationId","reportKey","reconciledAt","rowCount") VALUES ('__synthetic_semantic_generation_20261019__-cursor-3','__synthetic_semantic_generation_20261019__','platform_users',now(),1) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "SourceGenerationCursor" ("id","generationId","reportKey","reconciledAt","rowCount") VALUES ('__synthetic_semantic_generation_20261019__-cursor-4','__synthetic_semantic_generation_20261019__','journeys',now(),1) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "SourceGenerationCursor" ("id","generationId","reportKey","reconciledAt","rowCount") VALUES ('__synthetic_semantic_generation_20261019__-cursor-5','__synthetic_semantic_generation_20261019__','debt_accounts',now(),1) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "SourceGenerationCursor" ("id","generationId","reportKey","reconciledAt","rowCount") VALUES ('__synthetic_semantic_generation_20261019__-cursor-6','__synthetic_semantic_generation_20261019__','policies',now(),1) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "SourceGenerationCursor" ("id","generationId","reportKey","reconciledAt","rowCount") VALUES ('__synthetic_semantic_generation_20261019__-cursor-7','__synthetic_semantic_generation_20261019__','ratings',now(),1) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "SourceGenerationCursor" ("id","generationId","reportKey","reconciledAt","rowCount") VALUES ('__synthetic_semantic_generation_20261019__-cursor-8','__synthetic_semantic_generation_20261019__','referrals',now(),1) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "SourceGenerationCursor" ("id","generationId","reportKey","reconciledAt","rowCount") VALUES ('__synthetic_semantic_generation_20261019__-cursor-9','__synthetic_semantic_generation_20261019__','salary_advances',now(),1) ON CONFLICT ("id") DO NOTHING;
