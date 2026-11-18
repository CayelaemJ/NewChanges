/**
 * Read-only shared MySQL CDC generation snapshot contract.
 *
 * This reader expects a separately approved fixer_cdc_meta schema written
 * transactionally by a future leader-elected binlog worker. No table creation,
 * CDC writes, PostgreSQL access, or automatic production activation.
 * The caller supplies a restricted TLS connector and approved source ID.
 */
import { LOAD_ORDER } from "./reportFormats.js";
import { type DurableFeedGenerations, diffCommittedFeedGenerations } from "./mysqlCommittedFeedGenerations.js";

export interface GenerationReadConnection {
  query(command: {sql:string; timeout:number}, parameters:unknown[]):Promise<[unknown,unknown]>;
  end():Promise<void>;
}
export type GenerationConnector=()=>Promise<GenerationReadConnection>;

const CHECKPOINT_SQL =
  "SELECT generation FROM fixer_cdc_meta.cdc_checkpoint WHERE source_id = ? LIMIT 2";
const FEEDS_SQL =
  "SELECT feed, generation FROM fixer_cdc_meta.cdc_feed_generation WHERE source_id = ? LIMIT 11";
const START_SQL = "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY";
const ROLLBACK_SQL = "ROLLBACK";
const SOURCE = /^[a-z0-9][a-z0-9_-]{2,99}$/;

function generation(value:unknown):number {
  if(typeof value!=="number" && typeof value!=="string" && typeof value!=="bigint")
    throw new Error("CDC_SHARED_GENERATION_INVALID");
  if(typeof value==="string" && !/^(0|[1-9][0-9]*)$/.test(value))
    throw new Error("CDC_SHARED_GENERATION_INVALID");
  if(typeof value==="number" && (!Number.isSafeInteger(value)||value<0))
    throw new Error("CDC_SHARED_GENERATION_INVALID");
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<0)
    throw new Error("CDC_SHARED_GENERATION_INVALID");
  return n;
}
function strictRows(value:unknown):Record<string,unknown>[] {
  if(!Array.isArray(value) || value.some(x=>
    !x || typeof x!=="object" || Array.isArray(x)))
    throw new Error("CDC_SHARED_ROWS_INVALID");
  return value as Record<string,unknown>[];
}

export async function readCommittedFeedSnapshot(
  connector:GenerationConnector,
  sourceId:string,
  timeoutMs=5000,
):Promise<DurableFeedGenerations> {
  if(typeof connector!=="function" ||
      !SOURCE.test(sourceId) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>10_000)
    throw new Error("CDC_SHARED_READER_CONFIG_INVALID");
  let connection:GenerationReadConnection|null=null;
  let transaction=false;
  try {
    connection=await connector();
    await connection.query({sql:START_SQL,timeout:timeoutMs},[]);
    transaction=true;
    const [checkpointRows]=await connection.query({
      sql:CHECKPOINT_SQL,timeout:timeoutMs,
    },[sourceId]);
    const checkpoint=strictRows(checkpointRows);
    if(checkpoint.length!==1 ||
       !Object.prototype.hasOwnProperty.call(checkpoint[0],"generation"))
      throw new Error("CDC_SHARED_CHECKPOINT_INCOMPLETE");
    const currentGeneration=generation(checkpoint[0].generation);
    const [feedRows]=await connection.query({
      sql:FEEDS_SQL,timeout:timeoutMs,
    },[sourceId]);
    const feeds=strictRows(feedRows);
    if(feeds.length!==LOAD_ORDER.length)
      throw new Error("CDC_SHARED_FEED_INVENTORY_INCOMPLETE");
    const inventory:Record<string,number>={};
    for(const row of feeds){
      const name=row.feed;
      if(typeof name!=="string" || !LOAD_ORDER.includes(name as typeof LOAD_ORDER[number]) ||
         Object.prototype.hasOwnProperty.call(inventory,name))
        throw new Error("CDC_SHARED_FEED_INVALID");
      inventory[name]=generation(row.generation);
    }
    const snapshot:DurableFeedGenerations={
      sourceId,checkpointGeneration:currentGeneration,feeds:inventory,
    };
    // Run the strict canonical inventory/generation validator even on the
    // initial baseline. No missing feed, cross-source state or future
    // generation can silently enter the relay.
    diffCommittedFeedGenerations(snapshot,snapshot);
    await connection.query({sql:ROLLBACK_SQL,timeout:timeoutMs},[]);
    transaction=false;
    await connection.end();
    connection=null;
    return snapshot;
  } catch {
    throw new Error("CDC_SHARED_GENERATION_READ_UNAVAILABLE");
  } finally {
    if(connection){
      if(transaction){
        try{await connection.query({sql:ROLLBACK_SQL,timeout:timeoutMs},[]);}
        catch{/* Connection will be destroyed/closed by the driver. */}
      }
      try{await connection.end();}catch{/* Do not leak driver diagnostics. */}
    }
  }
}

export const SHARED_GENERATION_SQL=Object.freeze({
  checkpoint:CHECKPOINT_SQL,feeds:FEEDS_SQL,
});
