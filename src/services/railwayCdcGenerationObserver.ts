/**
 * Read-only, explicitly opt-in shared MySQL CDC generation observer.
 *
 * This module does NOT consume binlogs, elect workers, or mutate MySQL.
 * Each Railway/web instance can poll the same committed metadata snapshot
 * and forward canonical feed invalidations to its own authenticated SSE hub.
 *
 * Never enable without separately verified, durable CDC producer metadata.
 */
import mysql from "mysql2/promise";
import {readCommittedFeedSnapshot} from "./mysqlSharedGenerationReader.js";
import {createCommittedFeedSnapshotRelay, type FeedGenerationConsumer} from "./mysqlCommittedFeedRelay.js";

const SOURCE=/^[a-z0-9][a-z0-9_-]{2,99}$/;
const HOST=/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/;

export interface RailwayCdcObserverConfig {
  sourceId:string;
  host:string;
  port:number;
  user:string;
  password:string;
  ca:string;
  intervalMs:number;
}

export function railwayCdcObserverConfig(env:NodeJS.ProcessEnv=process.env):RailwayCdcObserverConfig|null{
  if(env.FIXER_CDC_SHARED_OBSERVER_ENABLED!=="true")return null;
  // The observer must never become active in the main Railway project or
  // when its checked, stage-only environment identifiers are missing.
  if(env.RAILWAY_PROJECT_ID!=="f2f1bc4f-5de8-436e-9414-5dc125650e96" ||
     env.RAILWAY_ENVIRONMENT_ID!=="9ff830b6-24c3-4319-bee1-82b6a74db270")
    throw Error("CDC_OBSERVER_STAGING_ONLY");
  const sourceId=env.FIXER_CDC_SHARED_SOURCE_ID??"";
  const host=env.FIXER_CDC_SHARED_HOST??"";
  const user=env.FIXER_CDC_SHARED_READ_USER??"";
  const password=env.FIXER_CDC_SHARED_READ_PASSWORD??"";
  const ca=env.FIXER_CDC_SHARED_CA_PEM??"";
  const port=Number(env.FIXER_CDC_SHARED_PORT??"3306");
  const intervalMs=Number(env.FIXER_CDC_SHARED_INTERVAL_MS??"3000");
  if(!SOURCE.test(sourceId)||!HOST.test(host)||!user||!password||
     !ca.includes("BEGIN CERTIFICATE")||!Number.isSafeInteger(port)||port<1||port>65535||
     !Number.isSafeInteger(intervalMs)||intervalMs<1000||intervalMs>60_000)
    throw Error("CDC_OBSERVER_CONFIG_INVALID");
  return {sourceId,host,port,user,password,ca,intervalMs};
}

export function createRailwayCdcObserver(
  config:RailwayCdcObserverConfig,
  publish:FeedGenerationConsumer,
  overrides?:{read?:()=>ReturnType<typeof readCommittedFeedSnapshot>},
){
  const read=overrides?.read??(()=>readCommittedFeedSnapshot(async()=>{
    const db=await mysql.createConnection({
      host:config.host,port:config.port,user:config.user,
      password:config.password,connectTimeout:5000,
      ssl:{ca:config.ca,rejectUnauthorized:true},
      multipleStatements:false,bigNumberStrings:true,supportBigNumbers:true,
    });
    return {
      query:(command:{sql:string;timeout:number},parameters:unknown[])=>
        db.query({sql:command.sql,timeout:command.timeout},parameters),
      end:()=>db.end(),
    };
  },config.sourceId));
  const relay=createCommittedFeedSnapshotRelay({
    approvedSourceId:config.sourceId,read,publish,
  });
  let timer:ReturnType<typeof setInterval>|null=null;
  let running=false;
  let closed=false;
  let attempts=0;
  let failures=0;
  let lastSuccessAt:string|null=null;
  async function poll(){
    if(closed||running)return 0;
    running=true;attempts++;
    try{
      const count=await relay.poll();
      lastSuccessAt=new Date().toISOString();
      return count;
    }catch{
      failures++;
      // Never serialize the connector's hostname, SQL or credentials.
      throw Error("CDC_OBSERVER_READ_UNAVAILABLE");
    }finally{running=false;}
  }
  function start(onFailure?:(code:string)=>void){
    if(closed||timer)throw Error("CDC_OBSERVER_ALREADY_STARTED_OR_STOPPED");
    // The initial read is a baseline, not fabricated CDC activity.
    void poll().catch(()=>onFailure?.("CDC_OBSERVER_READ_UNAVAILABLE"));
    timer=setInterval(()=>{
      void poll().catch(()=>onFailure?.("CDC_OBSERVER_READ_UNAVAILABLE"));
    },config.intervalMs);
    timer.unref?.();
  }
  function stop(){
    closed=true;
    if(timer){clearInterval(timer);timer=null;}
  }
  function status(){return {enabled:!closed,attempts,failures,lastSuccessAt};}
  return {poll,start,stop,status};
}
