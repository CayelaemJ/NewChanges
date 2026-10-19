// Measures one real PostgreSQL LISTEN/NOTIFY roundtrip via an existing
// session listener. Pure transport contract: no jobs or database writes.
import { performance } from "node:perf_hooks";

type Notification={channel:string;payload?:string};
export type PgNotificationReceiver={
  on(event:"notification",listener:(message:Notification)=>void):unknown;
  off(event:"notification",listener:(message:Notification)=>void):unknown;
};

export async function measureSemanticNotificationDelivery(input:{
  receiver:PgNotificationReceiver;channel:string;payload:string;
  publish:()=>Promise<unknown>;timeoutMs:number;
}):Promise<number> {
  if(!/^[a-z][a-z0-9_]{1,62}$/.test(input.channel) ||
     !/^[a-f0-9-]{36}$/.test(input.payload) ||
     !Number.isInteger(input.timeoutMs) || input.timeoutMs<100 || input.timeoutMs>10_000)
    throw new Error("Invalid semantic notification probe parameters");
  const started=performance.now();
  return new Promise<number>((resolve,reject)=>{
    let finished=false;
    const finish=(error?:Error)=>{
      if(finished)return false;
      finished=true;
      clearTimeout(timeout);
      input.receiver.off("notification",onMessage);
      if(error)reject(error);
      return true;
    };
    const onMessage=(message:Notification)=>{
      if(message.channel!==input.channel || message.payload!==input.payload)return;
      if(finish())resolve(performance.now()-started);
    };
    const timeout=setTimeout(()=>
      finish(new Error("Neon Testing notification delivery timeout")),input.timeoutMs);
    input.receiver.on("notification",onMessage);
    void Promise.resolve().then(input.publish).catch(error=>{
      finish(error instanceof Error?error:new Error("PostgreSQL publication failed"));
    });
  });
}
