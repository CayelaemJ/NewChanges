// Opt-in single-run Testing/Playground CLI for an approved MySQL-to-ten-feed rehearsal.
// Never writes to Neon or changes active source configuration.
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {validateCanonicalSchemaMapping,type CanonicalSchemaMapping} from "../src/services/canonicalSchemaMapping.js";
import {guardedMappedMysqlRehearsal} from "../src/services/playgroundMysqlRehearsalConfig.js";
import {rehearseMappedMysqlImport} from "../src/services/playgroundMappedImportRehearsal.js";

export async function buildApprovedRehearsalInput(
 args:readonly string[],env:NodeJS.ProcessEnv=process.env
){
 if(args.length!==1||!/\.json$/.test(args[0]))throw new Error("Expected exactly one approved mapping JSON file path");
 const path=resolve(args[0]);
 const source=await readFile(path,"utf8");
 if(Buffer.byteLength(source)>128*1024)throw new Error("Mapped source manifest exceeds 128 KiB limit");
 let mapping:CanonicalSchemaMapping;
 try{mapping=JSON.parse(source);}catch{throw new Error("Mapping JSON is malformed");}
 const validation=validateCanonicalSchemaMapping(mapping);
 if(!validation.valid)throw new Error("Invalid canonical mapping: "+validation.issues.join("; "));
 return guardedMappedMysqlRehearsal(env,mapping);
}
if(process.argv[1]&&import.meta.url===new URL("file://"+resolve(process.argv[1])).href){
 try {
  const input=await buildApprovedRehearsalInput(process.argv.slice(2));
  const outcome=await rehearseMappedMysqlImport(input);
  console.log(JSON.stringify({
   status:"staged-only",sourceGeneration:outcome.sourceGeneration,
   feeds:outcome.feeds,publicationEnabled:false,productionEnabled:false
  },null,2));
 } catch(error){
  // Do not print driver errors, connection URLs, row contents, SQL or secrets.
  console.error("Mapped staging rehearsal blocked or failed. Inspect restricted operator logs.");
  process.exitCode=1;
 }
}
