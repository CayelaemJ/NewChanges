// Single source of truth: NewChanges primary migration safety gates.
// This file is intentionally usable in Node, GitHub CI and Workers.
export const CAPABILITY_IDS=Object.freeze([
  "static_public","auth_sessions","tenant_scope","postgres",
  "mysql_reporting","imports","scheduling","notifications","audit_logs"
]);
export const BLOCKED_BEFORE_LAUNCH=Object.freeze([
  "auth_sessions","tenant_scope","postgres","mysql_reporting",
  "imports","scheduling","notifications","audit_logs"
]);
export function validatePrimaryMigrationConfig(input={}){
  const errors=[];
  const mode=String(input.mode||"").trim();
  const hostname=String(input.hostname||"").trim();
  const productionTarget=String(input.productionTarget||"").trim();
  const source=String(input.source||"").trim();
  const completed=Array.isArray(input.verifiedCapabilities)?input.verifiedCapabilities:[];
  if(!["staging","production"].includes(mode))errors.push("mode must be staging or production");
  let origin=null;
  try {
    const u=new URL(hostname);
    if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash||u.pathname!=="/")
      throw new Error("not an exact HTTPS origin");
    origin=u.origin;
  }catch{errors.push("hostname must be an exact HTTPS origin")}
  if(source!=="cloudflare-workers")errors.push("source must be cloudflare-workers");
  if(productionTarget==="railway"||productionTarget==="render")
    errors.push("Cloudflare primary cannot be marked complete while routed to legacy origin");
  const distinct=new Set(completed);
  if(distinct.size!==completed.length||completed.some(c=>!CAPABILITY_IDS.includes(c)))
    errors.push("capability list contains unknown/duplicate entries");
  if(mode==="production"){
    for(const capability of BLOCKED_BEFORE_LAUNCH)
      if(!distinct.has(capability))errors.push("missing independently verified capability: "+capability);
    if(input.authenticatedE2E!==true)errors.push("authenticated E2E verification required");
    if(input.tenantIsolationE2E!==true)errors.push("tenant isolation verification required");
    if(input.rollbackVerified!==true)errors.push("fallback rollback verification required");
    if(input.databaseSecretScope!=="cloudflare-production")
      errors.push("production secrets must be independently scoped");
    if(input.backgroundWorkersIdempotent!==true)
      errors.push("scheduled/import operations require idempotency proof");
  }
  return Object.freeze({valid:errors.length===0,mode,origin,errors});
}
export function safeReleaseStatement(config){
 const result=validatePrimaryMigrationConfig(config);
 return result.valid&&result.mode==="production"?"PRIMARY_READY":"NOT_READY";
}
