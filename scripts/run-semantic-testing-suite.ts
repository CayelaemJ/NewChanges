// Run the isolated Neon synthetic suite serially under one DB advisory lock.
// No source data is touched unless the lock is acquired first. A second
// concurrent CircleCI pipeline fails closed rather than corrupting fixtures.
import { spawn } from "node:child_process";
import { Client } from "pg";
import { semanticListenerConnectionString } from "../src/services/semanticQueueWake.js";

const database="newchanges_testing_20261017";
const lockKey=16920261019;
const commands=[
  "semantic:e2e:preflight",
  "semantic:e2e:score-delta",
  "semantic:e2e:queue",
  "semantic:e2e:publication-metadata",
  "semantic:e2e:storage-publication",
  "semantic:e2e:canonical-to-canary",
];

function validate() {
  if(process.env.SEMANTIC_SYNTHETIC_E2E_APPROVED!=="YES_TEST_ONLY")
    throw new Error("Explicit synthetic Testing approval required");
  let u:URL;
  try{u=new URL(process.env.DATABASE_URL??"");}
  catch{throw new Error("Isolated Neon Testing URL required");}
  if(!["postgres:","postgresql:"].includes(u.protocol) ||
    !u.hostname.endsWith(".neon.tech") ||
    u.pathname!=="/"+database ||
    u.searchParams.get("sslmode")!=="require")
    throw new Error("Refusing synthetic suite outside exact isolated Neon Testing database");
}
async function child(script:string) {
  const command=process.platform==="win32"?"npm.cmd":"npm";
  const proc=spawn(command,["run",script],{stdio:"inherit",env:process.env});
  await new Promise<void>((resolve,reject)=>{
    proc.once("error",reject);
    proc.once("exit",(code,signal)=>{
      if(code===0)resolve();
      else reject(new Error("Testing stage "+script+" failed ("+(signal??code)+")"));
    });
  });
}

async function main() {
  validate();
  // The lock must live on a direct session: transaction poolers cannot
  // provide safe session-level advisory lock semantics.
  const direct=semanticListenerConnectionString({
    ...process.env,
    ENABLE_SEMANTIC_EVENT_WORKER:"true",
    ENABLE_SEMANTIC_SHADOW_WORKER:"true",
    ENABLE_SEMANTIC_OBJECT_PUBLISH:"true",
    ENABLE_SEMANTIC_RECOMPUTE:"true",
    STANDBY_MODE:"false",
  });
  const client=new Client({connectionString:direct,connectionTimeoutMillis:10_000});
  let acquired=false;
  try {
    await client.connect();
    const db=await client.query<{name:string}>("SELECT current_database() AS name");
    if(db.rows[0]?.name!==database)throw new Error("Testing connection identity mismatch");
    const result=await client.query<{locked:boolean}>("SELECT pg_try_advisory_lock($1) AS locked",[lockKey]);
    if(result.rows[0]?.locked!==true)
      throw new Error("Another isolated semantic acceptance suite is running; refusing concurrent run");
    acquired=true;
    console.log("Exclusive isolated Testing suite lock acquired");
    for(const script of commands)await child(script);
    console.log("All isolated semantic Testing acceptance stages completed");
  }finally {
    try {
      if(acquired)await client.query("SELECT pg_advisory_unlock($1)",[lockKey]).catch(()=>{});
    }finally{await client.end().catch(()=>{});}
  }
}
main().catch(e=>{
  console.error("Isolated semantic acceptance suite stopped:",e instanceof Error?e.message:"Unknown failure");
  process.exitCode=1;
});
