// Short-lived Neon TESTING delivery test: two independent PostgreSQL sessions.
// Never creates tables, jobs, source records, buckets or a long-running worker.
// Emits three diagnostic NOTIFY messages on an isolated test channel only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Client } from "pg";
import { semanticListenerConnectionString } from "../src/services/semanticQueueWake.js";

const database="newchanges_testing_20261017";
const diagnosticChannel="newchanges_semantic_testing_probe";
const maxSamples=3;
const timeoutMs=5000;

function settings() {
  if(process.env.SEMANTIC_SYNTHETIC_E2E_APPROVED!=="YES_TEST_ONLY" ||
     process.env.SEMANTIC_NOTIFY_PROBE_APPROVED!=="YES_TEST_ONLY")
    throw new Error("Explicit isolated notification probe approval is required");
  const dataUrl=process.env.DATABASE_URL??"";
  const listenerUrl=process.env.SEMANTIC_LISTEN_DATABASE_URL??"";
  let u:URL;
  try{u=new URL(dataUrl);}
  catch{throw new Error("Isolated Neon Testing DATABASE_URL required");}
  if(!["postgres:","postgresql:"].includes(u.protocol) ||
     !u.hostname.endsWith(".neon.tech") ||
     u.pathname!=="/"+database ||
     u.searchParams.get("sslmode")!=="require")
    throw new Error("Refusing LISTEN/NOTIFY probe outside isolated Neon Testing");
  // Require exactly the same direct-vs-pooler relationship as the real worker,
  // without enabling the worker or changing its environment flags.
  const direct=semanticListenerConnectionString({
    DATABASE_URL:dataUrl,SEMANTIC_LISTEN_DATABASE_URL:listenerUrl,
    ENABLE_SEMANTIC_EVENT_WORKER:"true",ENABLE_SEMANTIC_SHADOW_WORKER:"true",
    ENABLE_SEMANTIC_OBJECT_PUBLISH:"true",ENABLE_SEMANTIC_RECOMPUTE:"true",
    STANDBY_MODE:"false",
  });
  return {dataUrl,direct};
}

async function main(){
  const cfg=settings(); // Fail closed before opening either connection.
  const listening=new Client({connectionString:cfg.direct,connectionTimeoutMillis:10_000});
  const sending=new Client({connectionString:cfg.dataUrl,connectionTimeoutMillis:10_000});
  try {
    await listening.connect();
    await sending.connect();
    const a=await listening.query<{db:string}>("SELECT current_database() AS db");
    const b=await sending.query<{db:string}>("SELECT current_database() AS db");
    assert.equal(a.rows[0]?.db,database);
    assert.equal(b.rows[0]?.db,database);
    await listening.query("LISTEN "+diagnosticChannel);
    const deliveryMs:number[]=[];
    for(let i=0;i<maxSamples;i++){
      const marker=randomUUID();
      const started=performance.now();
      // Attach the handler before publishing, so fast deliveries are observed.
      const message=new Promise<number>((resolve,reject)=>{
        const timer=setTimeout(()=>{
          listening.off("notification",onNotification);
          reject(new Error("Neon Testing notification was not delivered within "+timeoutMs+"ms"));
        },timeoutMs);
        const onNotification=(msg:{channel:string;payload?:string})=>{
          if(msg.channel!==diagnosticChannel || msg.payload!==marker)return;
          clearTimeout(timer);
          listening.off("notification",onNotification);
          resolve(performance.now()-started);
        };
        listening.on("notification",onNotification);
      });
      try {
        await sending.query("SELECT pg_notify($1,$2)",[diagnosticChannel,marker]);
        const observed=await message;
        assert(Number.isFinite(observed)&&observed>=0);
        deliveryMs.push(Math.round(observed*100)/100);
      }catch(error){
        // Consume the waiter if the publisher failed before NOTIFY was sent.
        await message.catch(()=>{});
        throw error;
      }
    }
    const sorted=[...deliveryMs].sort((a,b)=>a-b);
    const p95=sorted[Math.ceil(sorted.length*0.95)-1];
    console.log(JSON.stringify({
      test:"neon-isolated-listen-notify-delivery",database,
      samples:deliveryMs.length,deliveryMs,
      maximumObservedMs:Math.max(...deliveryMs),p95ObservedMs:p95,
      measured:true,
      scope:"diagnostic-notification-only",
      noApplicationJobsCreated:true,workerStarted:false,
      sourceToDashboardSlaVerified:false,productionModified:false,
    }));
  }finally{
    await Promise.allSettled([listening.end(),sending.end()]);
  }
}
main().catch(error=>{
  console.error("Isolated Neon LISTEN/NOTIFY delivery probe failed",
    error instanceof Error && /notification was not delivered/.test(error.message)
      ? "notification delivery timeout" : "connection, authorization or assertion failure");
  process.exitCode=1;
});
