// Operator-invoked only: never registered with the server or scheduler.
import {readFile,stat} from "node:fs/promises";
import {guardedMappedMysqlRehearsal} from "../src/services/playgroundMysqlRehearsalConfig.js";
import {rehearseMappedMysqlImport} from "../src/services/playgroundMappedImportRehearsal.js";
import type {CanonicalSchemaMapping} from "../src/services/canonicalSchemaMapping.js";
async function run(){
 const path=process.argv[2];
 if(!path)throw new Error("Supply the operator-reviewed mapping JSON file");
 if(process.env.PLAYGROUND_MAPPED_SOURCE_APPROVED!=="yes")
  throw new Error("Playground rehearsal requires explicit approval");
 const details=await stat(path);
 if(!details.isFile()||details.size<1||details.size>256*1024)
  throw new Error("Mapping file must be a regular file under 256 KiB");
 const mapping=JSON.parse(await readFile(path,"utf8")) as CanonicalSchemaMapping;
 const config=guardedMappedMysqlRehearsal(process.env,mapping);
 const result=await rehearseMappedMysqlImport(config);
 console.log(JSON.stringify(result,null,2));
}
run().catch(err=>{
 // Never print credentials, source rows, or full SQL driver error objects.
 console.error("Mapped Playground rehearsal refused or failed:",err instanceof Error?err.message:"unknown error");
 process.exitCode=1;
});
