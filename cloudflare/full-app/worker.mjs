import {Container} from "@cloudflare/containers";
import {env as bindings} from "cloudflare:workers";
import {fullNewChangesGate} from "./gate.mjs";

// One complete Node application: actual repo backend and existing frontend.
export class NewChangesContainer extends Container{
 defaultPort=8080;
 sleepAfter="20m";
 envVars={
  NODE_ENV:"production",PORT:"8080",
  DATABASE_URL:bindings.DATABASE_URL,
  SESSION_SECRET:bindings.SESSION_SECRET,
  MYSQL_HOST:bindings.MYSQL_HOST,
  MYSQL_PORT:bindings.MYSQL_PORT,
  MYSQL_USER:bindings.MYSQL_USER,
  MYSQL_PASSWORD:bindings.MYSQL_PASSWORD,
  MYSQL_DATABASE:bindings.MYSQL_DATABASE,
  RESEND_API_KEY:bindings.RESEND_API_KEY,
  NEWCHANGES_CLOUDFLARE_WORKLOAD:"true",
  // Explicitly suppress automatic sync/scheduled jobs until independently proven.
  ENABLE_DAILY_INCREMENTAL_RECONCILIATION:"false",
  ENABLE_SEMANTIC_SHADOW_WORKER:"false",
  ENABLE_SEMANTIC_SHADOW_ENQUEUE:"false",
  ENABLE_SEMANTIC_OBJECT_PUBLISH:"false",
  STANDBY_MODE:"true"
 };
}
const JSON_HEADERS={"Cache-Control":"no-store","Content-Type":"application/json; charset=utf-8"};
export default {async fetch(request,env){
 const url=new URL(request.url);
 const gate=fullNewChangesGate(env,url.hostname);
 if(url.pathname==="/__migration/status")
  return new Response(JSON.stringify({product:"NewChanges",target:"full-fastify-application",enabled:gate.ready,production:false}),{headers:JSON_HEADERS});
 if(!gate.ready)return new Response(JSON.stringify({error:"Full NewChanges backend not activated"}),{status:503,headers:JSON_HEADERS});
 try {return await env.NEWCHANGES_APP.getByName("primary").fetch(request);}
 catch {return new Response(JSON.stringify({error:"NewChanges backend unavailable"}),{status:503,headers:JSON_HEADERS});}
}};
