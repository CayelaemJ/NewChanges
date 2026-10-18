#!/usr/bin/env node
// Explicit, read-only connectivity canary for a Railway-hosted PostgreSQL
// candidate. Does NOT update NewChanges' DATABASE_URL, schemas or data.
import { fileURLToPath } from "node:url";

const APPROVAL="YES_READ_ONLY_RAILWAY_TEST";
export function validateRailwayPgProbe(env=process.env){
 if(env.RENDER_RAILWAY_PG_PROBE_APPROVED!==APPROVAL)
  throw new Error("Explicit read-only Railway PostgreSQL probe approval required");
 const raw=env.RAILWAY_PG_TEST_URL;
 const expected=(env.RAILWAY_PG_EXPECTED_DB??"").trim();
 if(!raw||raw===env.DATABASE_URL||!expected||!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(expected))
  throw new Error("Separate Railway PostgreSQL test URL and expected database required");
 let url;
 try{url=new URL(raw);}catch{throw new Error("Invalid Railway PostgreSQL test URL");}
 const host=url.hostname.toLowerCase();
 const railwayHost=host.endsWith(".rlwy.net")||host.endsWith(".railway.app")||
  host.endsWith(".railway.internal")||host.endsWith(".proxy.rlwy.net");
 if(!["postgres:","postgresql:"].includes(url.protocol)||
    !railwayHost||host.endsWith(".railway.internal")||
    url.pathname!=="/"+expected||!url.username||!url.password||
    !["require","verify-full","verify-ca"].includes(url.searchParams.get("sslmode")??""))
  throw new Error("A public TLS-required Railway PostgreSQL connection is required");
 return {connectionString:raw,expectedDatabase:expected,hostClass:"railway-public" };
}

export async function probeRailwayPostgres(env=process.env){
 const input=validateRailwayPgProbe(env);
 const {default:pg}=await import("pg");
 const client=new pg.Client({connectionString:input.connectionString,
  connectionTimeoutMillis:7000,
  query_timeout:6000,
  application_name:"newchanges_render_readonly_probe"});
 const started=Date.now();
 try{
  await client.connect();
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '4000ms'");
  const identity=await client.query(`SELECT current_database() AS database,
    (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,
    current_setting('transaction_read_only') AS read_only`);
  const row=identity.rows[0];
  if(row?.database!==input.expectedDatabase||row?.tls!==true||row?.read_only!=="on")
   throw new Error("Railway PostgreSQL read-only TLS or database validation failed");
  await client.query("ROLLBACK");
  return {ok:true,provider:"railway-postgresql",database:input.expectedDatabase,
   readOnly:true,tlsVerifiedByServer:true,elapsedMs:Date.now()-started,
   schemaModified:false,applicationStorageSwitched:false};
 }finally{
  await client.end().catch(()=>{});
 }
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
 try{const result=await probeRailwayPostgres();console.log(JSON.stringify(result));}
 catch{console.error("Railway PostgreSQL probe refused or failed. No credentials logged.");
  process.exitCode=1;}
}
