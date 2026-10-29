// The actual NewChanges backend must not be exposed because a static preview is live.
export function fullNewChangesGate(env={},hostname=""){
 const failed=[];
 const allowed=typeof env.NEWCHANGES_CANONICAL_HOST==="string"?env.NEWCHANGES_CANONICAL_HOST.trim():"";
 if(env.NEWCHANGES_FULL_APP_ENABLED!=="true")failed.push("explicit activation missing");
 if(!allowed||allowed!==hostname||allowed.includes("/")||allowed.includes(":"))failed.push("hostname mismatch");
 if(!allowed.endsWith(".newchanges-app.pages.dev")&&allowed!=="newchanges-app.pages.dev")failed.push("unapproved hostname");
 for(const [key,expected] of [["NEWCHANGES_NEON_PRIMARY_PROJECT","wild-base-70222190"],["NEWCHANGES_NEON_DATABASE","newchanges"]]){
  if(env[key]!==expected)failed.push("Neon primary configuration mismatch");
 }
 for(const k of ["NEWCHANGES_NEON_GRANTS_VERIFIED","NEWCHANGES_TENANT_E2E_VERIFIED","NEWCHANGES_MFA_E2E_VERIFIED","NEWCHANGES_SYNC_IDEMPOTENCY_VERIFIED","NEWCHANGES_ROLLBACK_VERIFIED"]){
  if(env[k]!=="true")failed.push(k+" missing");
 }
 if(!env.DATABASE_URL||!env.SESSION_SECRET)failed.push("required server-side bindings missing");
 return {ready:failed.length===0,failed};
}
