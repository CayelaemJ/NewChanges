/**
 * One-shot staging CDC MySQL connection preflight, with ZERO PostgreSQL use.
 *
 * Accepts candidate credentials only for a restricted, operator-approved
 * MySQL hostname. No persistence, replication, binlog stream or writes.
 * The admin UI deliberately never passes credentials to the sync endpoint.
 */
import mysql from "mysql2/promise";

export type CdcConnectionInput={
  host?:unknown;port?:unknown;database?:unknown;
  username?:unknown;password?:unknown;
};
const HOST=/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/;
const IDENTIFIER=/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
const USER=/^[^\s\x00-\x1f]{1,128}$/;
export function validateStagingCdcConnection(input:CdcConnectionInput,env:NodeJS.ProcessEnv=process.env){
  if(env.RAILWAY_PROJECT_ID!=="f2f1bc4f-5de8-436e-9414-5dc125650e96" ||
     env.RAILWAY_ENVIRONMENT_ID!=="9ff830b6-24c3-4319-bee1-82b6a74db270" ||
     env.FIXER_CDC_ADMIN_PREFLIGHT_ENABLED!=="true")
    throw Error("CDC_PREFLIGHT_STAGING_DISABLED");
  const allowedHost=env.FIXER_CDC_PREFLIGHT_ALLOWED_HOST??"";
  const host=input.host;
  const port=Number(input.port??3306);
  const database=input.database;
  const username=input.username;
  const password=input.password;
  if(typeof host!=="string"||!HOST.test(host)||
     !HOST.test(allowedHost)||host.toLowerCase()!==allowedHost.toLowerCase()||
     !Number.isSafeInteger(port)||port<1||port>65535||
     typeof database!=="string"||!IDENTIFIER.test(database)||
     typeof username!=="string"||!USER.test(username)||
     typeof password!=="string"||!password||password.length>512)
    throw Error("CDC_PREFLIGHT_CANDIDATE_INVALID_OR_HOST_NOT_APPROVED");
  return {host,port,database,username,password};
}
export async function testStagingCdcConnection(
  input:CdcConnectionInput,env:NodeJS.ProcessEnv=process.env,
  connector:typeof mysql.createConnection=mysql.createConnection,
){
  const options=validateStagingCdcConnection(input,env);
  let db:Awaited<ReturnType<typeof mysql.createConnection>>|null=null;
  try {
    db=await connector({
      host:options.host,port:options.port,
      user:options.username,password:options.password,
      database:options.database,
      ssl:{rejectUnauthorized:true},
      connectTimeout:4000,multipleStatements:false,
    });
    // Read-only metadata, no arbitrary SQL or user-supplied table names.
    const [configuration]=await db.query({
      sql:"SELECT @@global.log_bin AS log_bin, @@global.binlog_format AS binlog_format, @@global.binlog_row_image AS binlog_row_image",
      timeout:4000,
    });
    const row=(configuration as Record<string,unknown>[])[0];
    if(!row||Number(row.log_bin)!==1||
       String(row.binlog_format).toUpperCase()!=="ROW"||
       String(row.binlog_row_image).toUpperCase()!=="FULL")
      return {ok:false,code:"CDC_PREFLIGHT_BINLOG_PREREQUISITES_MISSING"};
    // A connection test proves only source reachability and binlog settings,
    // never that the CDC worker/metadata writer/SSE is live.
    return {ok:true,code:"CDC_SOURCE_PREFLIGHT_OK",cdcActive:false,
      note:"Read-only MySQL connection established; ROW/FULL binlog prerequisites confirmed. No settings or data saved."};
  }catch{
    return {ok:false,code:"CDC_PREFLIGHT_CONNECTION_UNAVAILABLE"};
  }finally{
    try{await db?.end();}catch{}
  }
}
