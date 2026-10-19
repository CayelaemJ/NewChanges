// Optional low-cost PostgreSQL wake signal. Queue rows remain authoritative;
// an unobserved or failed NOTIFY must never lose work.
export const SEMANTIC_QUEUE_WAKE_CHANNEL="newchanges_semantic_refresh_ready";

export function semanticQueueWakeEnabled(env:NodeJS.ProcessEnv=process.env):boolean {
  return env.ENABLE_SEMANTIC_QUEUE_WAKE==="true" &&
    env.ENABLE_SEMANTIC_SHADOW_ENQUEUE==="true" &&
    env.STANDBY_MODE!=="true";
}

export function semanticListenerEnabled(env:NodeJS.ProcessEnv=process.env):boolean {
  return env.ENABLE_SEMANTIC_EVENT_WORKER==="true" &&
    env.ENABLE_SEMANTIC_SHADOW_WORKER==="true" &&
    env.ENABLE_SEMANTIC_OBJECT_PUBLISH==="true" &&
    env.ENABLE_SEMANTIC_RECOMPUTE==="true" &&
    env.STANDBY_MODE!=="true";
}

// Analysis only. The actual queue implementation sends the notification
// after successful row insertion, never instead of durable enqueue.
export function shouldWakeSemanticWorker(queued:number,env:NodeJS.ProcessEnv=process.env):boolean {
  return Number.isSafeInteger(queued) && queued>0 && semanticQueueWakeEnabled(env);
}

export function semanticListenerConnectionString(env:NodeJS.ProcessEnv=process.env):string {
  if(!semanticListenerEnabled(env)) throw new Error("Semantic event listener is disabled");
  const main=env.DATABASE_URL??"";
  const direct=env.SEMANTIC_LISTEN_DATABASE_URL??"";
  let source:URL,listen:URL;
  try {source=new URL(main);listen=new URL(direct);}
  catch {throw new Error("Semantic listener needs a separate direct PostgreSQL connection URL");}
  const normalizedHost=(hostname:string)=>hostname.replace(/-pooler(?=\\.)/g,"");
  if(!["postgres:","postgresql:"].includes(listen.protocol) ||
     listen.hostname.includes("-pooler.") ||
     !listen.hostname.endsWith(".neon.tech") ||
     listen.searchParams.get("sslmode")!=="require" ||
     listen.pathname!==source.pathname ||
     normalizedHost(listen.hostname)!==normalizedHost(source.hostname))
    throw new Error("Semantic listener requires a direct non-pooler connection to the SAME Neon database");
  return direct;
}
