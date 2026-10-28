// Cloudflare isolated API migration canary. No production credentials, databases,
// sessions, Render proxying, background jobs, or customer records.
const headers={
 "Content-Type":"application/json; charset=utf-8",
 "Cache-Control":"no-store",
 "X-Content-Type-Options":"nosniff",
 "X-Frame-Options":"DENY",
 "Referrer-Policy":"no-referrer",
 "X-Robots-Tag":"noindex, nofollow",
 "Access-Control-Allow-Origin":"null"
};
const JSON_RESPONSE=(status,body,method="GET")=>new Response(method==="HEAD"?null:JSON.stringify(body),{status,headers});
const capabilities=Object.freeze({
 environment:"cloudflare-isolated-canary",
 version:"1",
 runtime:"cloudflare-workers",
 application_api:"not_migrated",
 auth:"disabled",
 dashboard:"disabled",
 imports:"disabled",
 database:"disconnected",
 schedulers:"disabled",
 notifications:"disabled",
 production_render:"unchanged"
});
export default {
 async fetch(req){
   const u=new URL(req.url);
   if(!["GET","HEAD"].includes(req.method))
     return JSON_RESPONSE(405,{error:"Read-only canary. Mutation endpoints not available."},req.method);
   if(u.pathname==="/api/health")
     return JSON_RESPONSE(200,{status:"ok",environment:capabilities.environment,production:false},req.method);
   if(u.pathname==="/api/migration/capabilities")
     return JSON_RESPONSE(200,capabilities,req.method);
   return JSON_RESPONSE(404,{error:"API route not enabled on staging canary"},req.method);
 }
};
