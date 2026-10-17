// Operator-only Testing command. Works with production-pruned node_modules.
// No source rows, SQL, passwords or presigned URLs are logged.
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
const env=process.env;
if(env.RAILWAY_ENVIRONMENT_NAME!=="Testing"||
 env.TESTING_CLOUD_TEN_FEED_APPROVED!=="YES_I_APPROVE"||
 env.PLAYGROUND_MAPPED_SOURCE_APPROVED!=="yes"){
 console.error("Explicit Railway Testing cloud-source approval required");
 process.exitCode=1;
}else{
 try{
  if(process.argv.length!==3||!process.argv[2].endsWith(".json"))
   throw new Error("Approved JSON source mapping path required");
  const pathname=resolve(process.argv[2]);
  const raw=await readFile(pathname,"utf8");
  if(Buffer.byteLength(raw,"utf8")>128*1024)
   throw new Error("Source mapping exceeds manifest byte cap");
  const mapping=JSON.parse(raw);
  const [{guardedMappedMysqlRehearsal},{rehearseCloudMappedMysqlImport}]=await Promise.all([
   import("../dist/services/playgroundMysqlRehearsalConfig.js"),
   import("../dist/services/testingCloudMappedRehearsal.js"),
  ]);
  const config=guardedMappedMysqlRehearsal(env,mapping);
  const result=await rehearseCloudMappedMysqlImport(config,env);
  console.log(JSON.stringify({status:"verified-cloud-staging-only",...result}));
 }catch{
  console.error("Cloud mapped import rehearsal blocked or failed; inspect restricted operator logs.");
  process.exitCode=1;
 }
}
