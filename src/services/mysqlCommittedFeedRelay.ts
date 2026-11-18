/**
 * Default-off, injected durable-generation observer. No DB connection here.
 * A future approved worker can supply an independently verified shared-store
 * reader. Never confuse this with live binlog consumption or multi-host relay.
 */
import {
  diffCommittedFeedGenerations, type DurableFeedGenerations,
} from "./mysqlCommittedFeedGenerations.js";

export interface FeedGenerationConsumer {
  notifyFeed(sourceId:string,event:{
    readonly type:"MYSQL_FEED_INVALIDATION";
    readonly feed:string;readonly generation:number;
  }):number;
}

export function createCommittedFeedSnapshotRelay(options:{
  read:()=>Promise<DurableFeedGenerations>;
  publish:FeedGenerationConsumer;
  approvedSourceId:string;
}) {
  if(typeof options?.read!=="function" ||
     typeof options?.publish?.notifyFeed!=="function" ||
     !/^[A-Za-z0-9_-]{1,128}$/.test(options.approvedSourceId))
    throw new Error("CDC_SNAPSHOT_RELAY_CONFIG_INVALID");
  let baseline:DurableFeedGenerations|null=null;
  let pending:Promise<number>|null=null;

  async function poll():Promise<number>{
    if(pending)return pending;
    const operation=(async()=>{
      let current:DurableFeedGenerations;
      try{current=await options.read();}
      catch{throw new Error("CDC_SNAPSHOT_RELAY_READ_FAILED");}
      if(current?.sourceId!==options.approvedSourceId)
        throw new Error("CDC_SNAPSHOT_RELAY_SOURCE_MISMATCH");
      // Validate the first snapshot as well, but do not invent historical
      // notifications: it is a resumption baseline, not observed activity.
      const changes=diffCommittedFeedGenerations(
        baseline??current,current);
      if(!baseline){baseline=current;return 0;}
      let delivered=0;
      try{
        for(const event of changes)delivered+=options.publish.notifyFeed(current.sourceId,event);
      }catch{
        // Retry from the previous snapshot on the next poll.
        // Deliveries are generation-deduplicated by the hub.
        throw new Error("CDC_SNAPSHOT_RELAY_PUBLICATION_FAILED");
      }
      baseline=current;
      return delivered;
    })();
    pending=operation;
    try{return await operation;}
    finally{if(pending===operation)pending=null;}
  }

  return {poll};
}
