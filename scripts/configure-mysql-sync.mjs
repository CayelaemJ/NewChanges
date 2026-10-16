#!/usr/bin/env node
/**
 * One-time, consent-gated, non-destructive MySQL source bootstrap.
 * Not invoked by deployment or background schedules.
 * Operators should use the authenticated Admin connection workflow for
 * existing sources or for any update to refresh cadence and source TLS.
 */
import pg from "pg";
const {Pool}=pg;

function readBootstrapConfig(env=process.env){
 if(env.ALLOW_INITIAL_SOURCE_BOOTSTRAP!=="YES_I_APPROVE")
  throw new Error("Source bootstrap requires explicit operator approval");
 const host=env.MYSQLHOST??"",user=env.MYSQLUSER??"",
  password=env.SOURCE_SQL_PASSWORD??"",database=env.MYSQLDATABASE??"";
 const port=Number(env.MYSQLPORT??3306);
 if(!host||!database||!user||!password||
   !/^[a-zA-Z0-9_.-]{1,253}$/.test(host)||
   !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(database)||
   !Number.isSafeInteger(port)||port<1||port>65535)
  throw new Error("Incomplete or invalid restricted MySQL bootstrap configuration");
 if(user.trim().toLowerCase()==="root")
  throw new Error("Use a restricted read-only MySQL source user, not root");
 if(env.SOURCE_SQL_SSL!=="true"||env.SOURCE_SQL_TRUST_SERVER_CERTIFICATE==="true")
  throw new Error("Verified MySQL TLS must be explicitly enabled");
 if(!env.DATABASE_URL)throw new Error("DATABASE_URL is required for source bootstrap");
 return {host,port,database,user,password};
}
async function main(){
 const config=readBootstrapConfig();
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 try{
  const response=await pool.query(`
   UPDATE "IntegrationConfig" SET
      "enabled"=true,"sourceMode"='SQL',"sqlDialect"='MYSQL',
      "sqlHost"=$1,"sqlPort"=$2,"sqlDatabase"=$3,
      "sqlUsername"=$4,"sqlPassword"=NULL,"sqlSsl"=true,
      "sqlTrustServerCertificate"=false
   WHERE "id"='default'
     AND ("sqlHost" IS NULL OR btrim("sqlHost")='')
     AND ("sqlUsername" IS NULL OR btrim("sqlUsername")='')
   RETURNING "id"`,
   [config.host,config.port,config.database,config.user]);
  if(response.rowCount===1)
   console.log("Initial MySQL source configured without changing the saved refresh schedule.");
  else
   console.log("Existing source settings preserved; use authenticated Admin settings for changes.");
 }finally{await pool.end();}
}
main().catch(()=>{
 // Never include source credentials, DB URLs or driver error details in logs.
 console.error("Source bootstrap refused or failed. Check restricted operator logs.");
 process.exitCode=1;
});
