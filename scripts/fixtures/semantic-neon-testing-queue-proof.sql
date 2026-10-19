-- PostgreSQL/Neon TESTING only. One atomic transaction.
-- This SQL was exercised against isolated Neon Testing on 2026-10-19.
-- Verifies insert/dedupe/immediate claim/lease/finish/cleanup using
-- an ACTIVE synthetic generation, without real employer data.
DO $synthetic_queue$
DECLARE changed_rows integer;
BEGIN
  IF current_database() <> 'newchanges_testing_20261017' THEN
    RAISE EXCEPTION 'Refusing non-Testing database';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "SourceGeneration" WHERE id='__synthetic_semantic_generation_20261019__' AND state='ACTIVE') OR
     NOT EXISTS(SELECT 1 FROM "Employer" WHERE id='__synthetic_semantic_e2e_20261019__' AND name LIKE 'SYNTHETIC QA ONLY%') THEN
    RAISE EXCEPTION 'Missing synthetic Testing prerequisites';
  END IF;
  IF EXISTS(SELECT 1 FROM "SemanticRefreshJob"
    WHERE id='__synthetic_sql_queue_probe_20261019__' OR "idempotencyKey"='__synthetic_sql_queue_probe_20261019__') THEN
    RAISE EXCEPTION 'Existing synthetic job; refusing to overwrite';
  END IF;
  INSERT INTO "SemanticRefreshJob"
    ("id","idempotencyKey","generationId","employerId","period","partitionKey","sourceWatermark","changedFeeds","status","updatedAt")
  VALUES
    ('__synthetic_sql_queue_probe_20261019__','__synthetic_sql_queue_probe_20261019__','__synthetic_semantic_generation_20261019__',
     '__synthetic_semantic_e2e_20261019__','2026-10','all',now(),'["journeys"]'::jsonb,'PENDING',now());
  GET DIAGNOSTICS changed_rows=ROW_COUNT;
  IF changed_rows<>1 THEN RAISE EXCEPTION 'Queue insert failed'; END IF;

  INSERT INTO "SemanticRefreshJob"
    ("id","idempotencyKey","generationId","employerId","period","partitionKey","sourceWatermark","changedFeeds","status","updatedAt")
  VALUES
    ('__synthetic_sql_queue_probe_duplicate_20261019__','__synthetic_sql_queue_probe_20261019__','__synthetic_semantic_generation_20261019__',
     '__synthetic_semantic_e2e_20261019__','2026-10','all',now(),'["journeys"]'::jsonb,'PENDING',now())
  ON CONFLICT ("idempotencyKey") DO NOTHING;
  GET DIAGNOSTICS changed_rows=ROW_COUNT;
  IF changed_rows<>0 THEN RAISE EXCEPTION 'Idempotent duplicate unexpectedly inserted'; END IF;

  UPDATE "SemanticRefreshJob"
  SET status='RUNNING',"workerId"='synthetic_sql_probe',"leasedUntil"=now()+interval '60 seconds',
      attempts=attempts+1,"updatedAt"=now()
  WHERE id='__synthetic_sql_queue_probe_20261019__' AND status='PENDING'
    AND "availableAt"<=now()+interval '1 millisecond' AND attempts<5;
  GET DIAGNOSTICS changed_rows=ROW_COUNT;
  IF changed_rows<>1 THEN RAISE EXCEPTION 'Immediate claim failed'; END IF;

  UPDATE "SemanticRefreshJob"
  SET status='COMPLETED',"workerId"=NULL,"leasedUntil"=NULL,"updatedAt"=now()
  WHERE id='__synthetic_sql_queue_probe_20261019__' AND status='RUNNING'
    AND "workerId"='synthetic_sql_probe' AND "leasedUntil">now() AND attempts=1;
  GET DIAGNOSTICS changed_rows=ROW_COUNT;
  IF changed_rows<>1 THEN RAISE EXCEPTION 'Lease completion failed'; END IF;

  DELETE FROM "SemanticRefreshJob"
  WHERE id='__synthetic_sql_queue_probe_20261019__'
    AND "employerId"='__synthetic_semantic_e2e_20261019__' AND status='COMPLETED';
  GET DIAGNOSTICS changed_rows=ROW_COUNT;
  IF changed_rows<>1 THEN RAISE EXCEPTION 'Synthetic cleanup failed'; END IF;
END $synthetic_queue$;
