import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
const html=readFileSync("public/admin.html","utf8");
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter(([,attributes,body])=>body.trim() && !/type\s*=\s*["'](?:application\/json|module)["']/i.test(attributes));
assert(scripts.length>0,"admin console inline scripts must exist");
for(const [i,entry] of scripts.entries()){
  try{new Script(entry[2],{filename:`public/admin.html:inline-script-${i+1}`});}
  catch(error){throw new Error(`Admin inline script ${i+1} is invalid JavaScript: ${error.message}`);}
}
assert(html.includes("async function loadInteg()"),"Admin integration loader must support await");
console.log(`Admin console JavaScript parse guard passed (${scripts.length} inline scripts)`);
