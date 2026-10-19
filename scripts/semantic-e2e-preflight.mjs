// Read-only, fail-closed readiness probe for isolated Neon semantic E2E testing.
// Never touches Production and never prints connection credentials or source rows.
import pg from "pg";

const raw=process.env.DATABASE_URL;
if(!raw) throw new Error("DATABASE_URL must point to isolated Neon Testing");
const url=new URL(raw);
if(!["postgres:","postgresql:"].includes(url.protocol) ||
   !url.hostname.endsWith(".neon.tech") ||
   !/^\/newchanges_testing_[A-Za-z0-9_]+$/.test(url.pathname) ||
   url.searchParams.get("sslmode")!=="require")
  throw new Error("Refusing to inspect anything except isolated Neon newchanges_testing_* with sslmode=require");
const client=new pg.Client({connectionString:raw,application_name:"newchanges_semantic_e2e_preflight"});
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const actual=await client.query("SELECT current_database() AS name");
  if(actual.rows[0]?.name!==url.pathname.slice(1))
    throw new Error("Connected database identity does not match isolated Testing target");
  const result=await client.query(`
    SELECT
      (SELECT count(*)::int FROM "Employer") AS employers,
      (SELECT count(*)::int FROM "ScoreSnapshot") AS score_snapshots,
      (SELECT count(*)::int FROM "SourceGeneration" WHERE state='ACTIVE' AND "validatedAt" IS NOT NULL) AS active_generations,
      (SELECT count(*)::int FROM "SemanticRefreshJob") AS refresh_jobs,
      (SELECT count(*)::int FROM "SemanticSnapshotManifest") AS manifests,
      (SELECT count(*)::int FROM "SemanticPublicationPointer") AS pointers
  `);
  const counts=result.rows[0];
  console.log(JSON.stringify({database:actual.rows[0].name,counts,productionModified:false}));
  if(!counts.employers || !counts.active_generations)
    throw new Error("E2E BLOCKED: seed an approved synthetic employer and establish a validated ACTIVE Testing source generation first");
  if(!counts.score_snapshots)
    throw new Error("E2E BLOCKED: no baseline persisted score; rebuild a synthetic Testing score before attempting score delta verification");
  console.log("Semantic E2E database prerequisites present; worker and storage connectivity still require separate verification");
} finally {
  await client.query("ROLLBACK").catch(()=>{});
  await client.end().catch(()=>{});
}
