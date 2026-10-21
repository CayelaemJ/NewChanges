// Explicitly gated, READ ONLY readiness probe for manual Neon Testing CI.
// No production writes, fixture modifications, semantic workers or storage access.
import assert from "node:assert/strict";
import { Client } from "pg";
import { semanticListenerConnectionString } from "../src/services/semanticQueueWake.js";
const database="newchanges_testing_20261017";
const employer="__synthetic_semantic_e2e_20261019__";
const generation="__synthetic_semantic_generation_20261019__";
if(process.env.SEMANTIC_SYNTHETIC_E2E_APPROVED!=="YES_TEST_ONLY")
  throw new Error("Testing context preflight requires explicit approval");
const url=process.env.DATABASE_URL??"";
let parsed:URL;
try{parsed=new URL(url);}catch{throw new Error("Missing isolated Testing DATABASE_URL");}
if(!["postgres:","postgresql:"].includes(parsed.protocol) ||
   parsed.pathname!=="/"+database ||
   !parsed.hostname.endsWith(".neon.tech") ||
   parsed.searchParams.get("sslmode")!=="require")
  throw new Error("Refusing to preflight any non-isolated Neon Testing database");
const direct=semanticListenerConnectionString({
  DATABASE_URL:url,SEMANTIC_LISTEN_DATABASE_URL:process.env.SEMANTIC_LISTEN_DATABASE_URL,
  ENABLE_SEMANTIC_EVENT_WORKER:"true",ENABLE_SEMANTIC_SHADOW_WORKER:"true",
  ENABLE_SEMANTIC_OBJECT_PUBLISH:"true",ENABLE_SEMANTIC_RECOMPUTE:"true",
  STANDBY_MODE:"false",
});
const pooledClient=new Client({connectionString:url,connectionTimeoutMillis:10_000});
const directClient=new Client({connectionString:direct,connectionTimeoutMillis:10_000});
try{
  await pooledClient.connect();
  await directClient.connect();
  await pooledClient.query("BEGIN READ ONLY");
  await directClient.query("BEGIN READ ONLY");
  const main=await pooledClient.query("SELECT current_database() AS db");
  const listener=await directClient.query("SELECT current_database() AS db");
  assert.equal(main.rows[0]?.db,database);
  assert.equal(listener.rows[0]?.db,database);
  const fixtures=await pooledClient.query(`
    SELECT
      (SELECT COUNT(*)::int FROM "Employer" WHERE id=$1 AND name LIKE 'SYNTHETIC QA ONLY%') AS employers,
      (SELECT COUNT(*)::int FROM "SourceGeneration" WHERE id=$2 AND state='ACTIVE') AS generations,
      (SELECT COUNT(*)::int FROM "SourceGenerationCursor" WHERE "generationId"=$2 AND "reconciledAt" IS NOT NULL) AS cursors,
      (SELECT COUNT(*)::int FROM "SemanticRefreshJob" WHERE "employerId"=$1 AND status IN ('PENDING','RUNNING')) AS active_jobs,
      (SELECT COUNT(*)::int FROM "SemanticPublicationPointer" WHERE "employerId"=$1) AS pointers
  `,[employer,generation]);
  const f=fixtures.rows[0];
  assert.equal(f.employers,1);
  assert.equal(f.generations,1);
  assert.equal(f.cursors,10);
  assert.equal(f.active_jobs,0,"Synthetic queue already active; manual acceptance unsafe");
  assert.equal(f.pointers,0,"Existing synthetic publication pointer; do not overwrite");
  console.log(JSON.stringify({test:"isolated-Neon-context-readiness",database,
    pooledConnection:true,directSessionConnection:true,
    syntheticFixtureFeeds:f.cursors,activeSyntheticJobs:0,existingSyntheticPointers:0,
    performedWrites:false,storageVerified:false,productionModified:false}));
}finally{
  await Promise.allSettled([
    pooledClient.query("ROLLBACK"),directClient.query("ROLLBACK")
  ]);
  await Promise.allSettled([pooledClient.end(),directClient.end()]);
}
