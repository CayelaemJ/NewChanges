import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { Script } from "node:vm";

const html=readFileSync("public/admin.html","utf8");
const server=readFileSync("src/server.ts","utf8");
const inline=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter(([,attrs,body])=>body.trim()&&!/type\s*=\s*["'](?:application\/json|module)["']/i.test(attrs));
assert(inline.length>=1,"Expected admin page scripts");
for(const [index,script] of inline.entries())
  new Script(script[2],{filename:"admin.html script "+(index+1)});
const refs=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]);
for(const src of refs){
  if(!src.startsWith("/static/"))continue;
  const name=src.split("?")[0].replace("/static/","public/");
  assert(existsSync(name),"Admin referenced asset missing: "+name);
  if(name.endsWith(".js"))new Script(readFileSync(name,"utf8"),{filename:name});
}
const ids=[...html.matchAll(/\bid=["']([^"']+)["']/gi)].map(x=>x[1]);
const duplicates=ids.filter((id,i)=>ids.indexOf(id)!==i);
assert.deepEqual([...new Set(duplicates)],[],"Duplicate IDs on Admin Console");
assert(html.includes("async function loadInteg()"),"The integration loader must be async");
for(const route of ["/api/admin/integration","/api/admin/database-status","/api/admin/security/overview","/api/admin/compliance/overview"])
  assert(server.includes(route),"Required admin API route missing: "+route);
assert(html.includes('id="integ-enabled"'),"Scheduled sync control missing");
assert(html.includes('id="integ-hours"'),"Sync cadence control missing");
assert(html.includes('id="reset-confirm"'),"Confirmed reset control missing");
console.log("Admin UI static checks passed: "+inline.length+" inline scripts, "+refs.length+" linked scripts, "+ids.length+" IDs");
