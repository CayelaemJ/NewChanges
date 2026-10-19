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
