import {readExistingSession,safeSessionResponse} from "./session-compat.mjs";

// Production-facing NewChanges identity migration boundary.
// None of these handlers replace the app's /api/auth/* routes yet.
// They require an independently scoped PostgreSQL Hyperdrive binding.
// Connection/migration handling is injected to keep denial tests offline.
const NO_STORE={
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store, private",
  "X-Content-Type-Options":"nosniff",
  "X-Frame-Options":"DENY",
  "Referrer-Policy":"no-referrer",
  "X-Robots-Tag":"noindex, nofollow",
  "Vary":"Cookie"
};
function respond(status,payload,method="GET"){
 return new Response(method==="HEAD"?null:JSON.stringify(payload),{status,headers:NO_STORE});
}

export function createNativeAuthRouter({openDatabase}={}){
 return {async fetch(request,env={}){
   let url;
   try{url=new URL(request.url)}catch{return respond(400,{error:"Bad request"})}
   const {pathname}=url;
   if(!["GET","HEAD"].includes(request.method))
     return respond(405,{error:"Read-only migration routes"},request.method);
   if(pathname==="/health")return respond(200,{ok:true,product:"NewChanges",runtime:"Cloudflare"},request.method);
   if(pathname==="/version")return respond(200,{product:"The Fixer (Pty) Ltd Dashboard Portal",version:"0.10.0",cloudflareStage:"migration"},request.method);
   if(!["/ready","/api/migration/auth-check"].includes(pathname))
     return respond(404,{error:"Route not migrated"},request.method);
   if(pathname==="/api/migration/auth-check"){
     const cookie=request.headers.get("cookie")||"";
     if(!/(?:^|;\s*)session=/.test(cookie))return respond(401,{authenticated:false},request.method);
     if(env.MIGRATION_AUTH_CHECK_ENABLED!=="true")
       return respond(503,{error:"Isolated authentication stage not enabled"},request.method);
   }
   if(!env.HYPERDRIVE?.connectionString||!openDatabase)
     return respond(503,{ok:false,error:"Isolated staging PostgreSQL adapter not configured"},request.method);
   let client;
   try{
     client=await openDatabase(env);
     if(pathname==="/ready"){
       // Liveness must not be conflated with database/tenant readiness.
       await client.$queryRaw`SELECT 1`;
       return respond(200,{ok:true,database:"reachable",environment:"staging"},request.method);
     }
     const result=await readExistingSession({
       cookie:request.headers.get("cookie"),prisma:client
     });
     if(!result.authenticated)return respond(401,{authenticated:false},request.method);
     return respond(200,safeSessionResponse(result),request.method);
   }catch{
     // Never return raw SQL/Prisma errors, connection strings or query details.
     return respond(503,{ok:false,error:"NewChanges staging data service unavailable"},request.method);
   }finally{
     try{await client?.$disconnect?.()}catch{/* log no secrets, best effort */}
   }
 }};
}
