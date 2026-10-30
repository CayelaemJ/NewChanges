// Cloudflare Pages front door for the ORIGINAL NewChanges full application.
// This is an independent service-binding route, NOT an external Render proxy.
// Publish only after verifying the full Container + Neon production release.
export function createNewChangesPagesGateway(){
 const json={"Cache-Control":"no-store","Content-Type":"application/json; charset=utf-8"};
 return {async fetch(request,env={}){
  const url=new URL(request.url);
  if(url.pathname==="/__migration/status")
   return new Response(JSON.stringify({product:"NewChanges",frontend:"Pages",fullBackendEnabled:false,productionReady:false}),{headers:json});
  // Do not let staging hosts be promoted into the primary traffic route.
  const approved=url.hostname==="newchanges-app.pages.dev"&&
    env.NEWCHANGES_GATEWAY_ENABLED==="true"&&
    env.NEWCHANGES_GATEWAY_PRODUCTION_APPROVED==="true"&&
    Boolean(env.NEWCHANGES_FULL_APP_SERVICE?.fetch);
  if(!approved)
   return new Response(JSON.stringify({error:"NewChanges full application route is not activated"}),{status:503,headers:json});
  const headers=new Headers(request.headers);
  // Client-provided forwarding headers must not override the trusted origin.
  headers.delete("x-forwarded-host");
  headers.delete("x-forwarded-proto");
  headers.set("x-forwarded-proto","https");
  try{
   const downstream=await env.NEWCHANGES_FULL_APP_SERVICE.fetch(new Request(request,{headers}));
   return downstream;
  }catch{
   return new Response(JSON.stringify({error:"NewChanges primary backend unavailable"}),{status:503,headers:json});
  }
 }};
}
export default createNewChangesPagesGateway();
