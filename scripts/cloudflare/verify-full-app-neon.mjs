// Cloudflare Container startup check for the ORIGINAL full NewChanges server.
// Audit the actual connected Neon PostgreSQL role before executing Fastify.
// Never print credentials, connection strings, SQL parameters, or user rows.
export const REQUIRED_DATABASE="newchanges";
export const BLOCKED_ROLES=new Set(["newchanges_cf_migration_reader"]);
const NEON_HOST=/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech$/i;

export function validateNeonUrl(raw){
 try{
  const url=new URL(raw);
  if(!["postgres:","postgresql:"].includes(url.protocol)||!NEON_HOST.test(url.hostname)||
     url.pathname!=="/"+REQUIRED_DATABASE||url.username.length===0||url.password.length===0||
     BLOCKED_ROLES.has(decodeURIComponent(url.username))||url.searchParams.get("sslmode")!=="require")
    return false;
  return true;
 }catch{return false;}
}

export function verifyFullAppRole(row){
 return Boolean(row&&row.database_name===REQUIRED_DATABASE&&
   typeof row.role_name==="string"&&!BLOCKED_ROLES.has(row.role_name)&&
   row.is_superuser===false&&row.can_create_database===false&&
   row.can_create_roles===false&&row.can_bypass_rls===false&&
   row.member_of_neon_superuser===false&&row.session_read===true&&
   row.session_write===true&&row.user_read===true);
}

export const FULL_APP_ROLE_AUDIT=`SELECT current_database() AS database_name, current_user AS role_name,
  r.rolsuper AS is_superuser, r.rolcreatedb AS can_create_database,
  r.rolcreaterole AS can_create_roles, r.rolbypassrls AS can_bypass_rls,
  pg_has_role(r.oid,'neon_superuser','MEMBER') AS member_of_neon_superuser,
  has_table_privilege(current_user,'public."Session"','SELECT') AS session_read,
  has_table_privilege(current_user,'public."Session"','INSERT') AS session_write,
  has_table_privilege(current_user,'public."User"','SELECT') AS user_read
  FROM pg_roles AS r WHERE r.rolname = current_user`;

export async function verifyCloudflareNeonPreflight({env=process.env,connect}={}){
 if(env.NEWCHANGES_CLOUDFLARE_WORKLOAD!=="true")throw Error("Wrong NewChanges workload");
 if(env.NEWCHANGES_NEON_PRIMARY_PROJECT!=="wild-base-70222190")throw Error("Wrong Neon project selection");
 if(!validateNeonUrl(env.DATABASE_URL))throw Error("Neon origin/role is not approved");
 if(typeof connect!=="function")throw Error("PostgreSQL driver unavailable");
 let db;
 try{
  db=await connect(env.DATABASE_URL);
  const result=await db.query(FULL_APP_ROLE_AUDIT);
  if(!verifyFullAppRole(result?.rows?.[0]))throw Error("Connected Neon role has unsafe effective privileges");
  return true;
 }finally{await db?.end?.();}
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  const {Client}=await import("pg");
  await verifyCloudflareNeonPreflight({connect:async connectionString=>{
    const client=new Client({connectionString,connectionTimeoutMillis:6000});
    await client.connect();
    return client;
  }});
  console.log("NewChanges Cloudflare primary Neon safety preflight passed");
 }catch{console.error("NewChanges Cloudflare Neon safety preflight blocked startup");process.exitCode=1;}
}
