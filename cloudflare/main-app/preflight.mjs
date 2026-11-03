// Runs BEFORE starting the unmodified NewChanges Fastify server.
// Never prints connection strings, SQL rows, tokens or account details.
// No migrations, inserts or changes to the Neon PG18 database.
import pg from "pg";
import { spawn } from "node:child_process";
import { verifyDatabaseIdentity } from "./verify-database.mjs";

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("NewChanges Neon database binding missing");
  const target = new URL(url);
  if (!["postgres:","postgresql:"].includes(target.protocol) ||
      !target.hostname.endsWith(".neon.tech") ||
      target.pathname !== "/newchanges")
    throw new Error("Database must be existing NewChanges Neon primary");
  if (decodeURIComponent(target.username)==="newchanges_cf_migration_reader")
    throw new Error("Unsafe migration role cannot be used");
  if (process.env.NEWCHANGES_CLOUDFLARE_RUNTIME!=="true")
    throw new Error("Wrong NewChanges runtime context");
  if (process.env.STANDBY_MODE!=="true" && process.env.NEWCHANGES_ALLOW_WRITES!=="true")
    throw new Error("Write-leading runtime not independently approved");
  const connection = new pg.Client({connectionString:url,connectionTimeoutMillis:5000,ssl:{rejectUnauthorized:true}});
  try {
    await connection.connect();
    const result = await connection.query(`SELECT
      current_database() AS database_name, current_user AS role_name,
      r.rolsuper AS is_superuser, r.rolcreatedb AS can_create_database,
      r.rolcreaterole AS can_create_roles, r.rolbypassrls AS bypasses_rls,
      pg_has_role(r.oid,'neon_superuser','MEMBER') AS member_superuser,
      EXISTS (SELECT 1 FROM pg_roles privileged_role
        WHERE (privileged_role.rolsuper OR privileged_role.rolcreatedb OR privileged_role.rolcreaterole)
          AND pg_has_role(r.oid,privileged_role.oid,'MEMBER')) AS member_privileged_role,
      EXISTS (SELECT 1 FROM pg_roles owner_role
        WHERE owner_role.rolname='newchanges_owner'
          AND pg_has_role(r.oid,owner_role.oid,'MEMBER')) AS member_application_owner,
      has_database_privilege(r.oid,current_database(),'CREATE') AS can_create_database_objects,
      has_schema_privilege(r.oid,'public','CREATE') AS can_create_public_objects,
      has_table_privilege(r.oid,'public."Session"','SELECT') AS can_read_session,
      has_table_privilege(r.oid,'public."Employer"','SELECT') AS can_read_employer,
      has_table_privilege(r.oid,'public."Session"','INSERT') AS can_write_session,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
          AND (has_table_privilege(r.oid,c.oid,'INSERT')
            OR has_table_privilege(r.oid,c.oid,'UPDATE')
            OR has_table_privilege(r.oid,c.oid,'DELETE')
            OR has_table_privilege(r.oid,c.oid,'TRUNCATE')
            OR has_table_privilege(r.oid,c.oid,'REFERENCES')
            OR has_table_privilege(r.oid,c.oid,'TRIGGER'))) AS can_write_any_public_table,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='S'
          AND (has_sequence_privilege(r.oid,c.oid,'USAGE')
            OR has_sequence_privilege(r.oid,c.oid,'UPDATE'))) AS can_use_or_update_public_sequence
      FROM pg_roles r WHERE r.rolname=current_user`);
    const check=verifyDatabaseIdentity(result.rows?.[0],{
      allowWrites:process.env.NEWCHANGES_ALLOW_WRITES==="true"
    });
    if (!check.ok) throw new Error("Database identity/permissions preflight failed");
  } finally {
    await connection.end().catch(()=>{});
  }
  const child=spawn(process.execPath,["dist/server.js"],{stdio:"inherit",env:process.env});
  const relay=(signal)=>{if(!child.killed)child.kill(signal);};
  process.on("SIGINT",()=>relay("SIGINT"));
  process.on("SIGTERM",()=>relay("SIGTERM"));
  child.on("exit",(code,signal)=>process.exit(code??(signal?1:0)));
  child.on("error",()=>process.exit(1));
}
run().catch(()=>{console.error("NewChanges container preflight rejected unverified database or runtime");process.exit(1);});
