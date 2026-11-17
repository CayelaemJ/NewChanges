/**
 * Prepared-transaction CDC metadata writer (OFFLINE integration contract).
 * Requires DBA-approved schema with fence_epoch and digest table, plus an
 * external leader elector. Never connects to AWS by itself. Call ONLY after
 * authenticating a committed source XID, binlog lineage and leader epoch.
 *
 * The checkpoint, digest, and feed generations commit atomically in InnoDB.
 * PostgreSQL is not involved. A failed/ambiguous COMMIT must be reconciled
 * against the durable digest before retry or publication.
 */
import {type PlannedCdcCommit} from "./mysqlCdcCommitPlan.js";
import {LOAD_ORDER} from "./reportFormats.js";

export interface CdcMetadataConnection {
  query(command:{sql:string;timeout:number},params:unknown[]):Promise<[unknown,unknown]>;
  end():Promise<void>;
}
export type MetadataConnector=()=>Promise<CdcMetadataConnection>;
const SOURCE=/^[a-z0-9][a-z0-9_-]{2,99}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const FILE=/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const VALID=new Set<string>(LOAD_ORDER);
const START="START TRANSACTION";
const LOCK="SELECT binlog_file, binlog_position, generation, fence_epoch FROM fixer_cdc_meta.cdc_checkpoint WHERE source_id=? FOR UPDATE";
const FIND="SELECT digest FROM fixer_cdc_meta.cdc_commit_digest WHERE source_id=? AND binlog_file=? AND binlog_position=? LIMIT 2";
const INSERT="INSERT INTO fixer_cdc_meta.cdc_commit_digest (source_id,binlog_file,binlog_position,digest) VALUES (?,?,?,?)";
const BUMP="UPDATE fixer_cdc_meta.cdc_feed_generation SET generation=generation+1 WHERE source_id=? AND feed=?";
const CHECKPOINT="UPDATE fixer_cdc_meta.cdc_checkpoint SET binlog_file=?,binlog_position=?,generation=generation+1,updated_at_utc=UTC_TIMESTAMP(6) WHERE source_id=? AND generation=? AND fence_epoch=?";
const COMMIT="COMMIT", ROLLBACK="ROLLBACK";

const integer=(x:unknown)=>{
  if(typeof x!=="number" && typeof x!=="bigint" &&
     !(typeof x==="string" && /^(0|[1-9][0-9]*)$/.test(x)))return null;
  const n=Number(x);
  return Number.isSafeInteger(n)&&n>=0?n:null;
};
const rows=(value:unknown):Record<string,unknown>[]=>{
  if(!Array.isArray(value)||value.some(r=>!r||typeof r!=="object"||Array.isArray(r)))
    throw Error("CDC_META_ROWS_INVALID");
  return value as Record<string,unknown>[];
};
const affected=(value:unknown):number=>{
  if(!value||typeof value!=="object")return -1;
  const x=(value as {affectedRows?:unknown}).affectedRows;
  return typeof x==="number"&&Number.isSafeInteger(x)?x:-1;
};

export async function commitCdcMetadata(
  connector:MetadataConnector,
  plan:PlannedCdcCommit,
  timeoutMs=5000,
):Promise<"COMMITTED"|"REPLAYED">{
  if(typeof connector!=="function" || !plan ||
     !SOURCE.test(plan.sourceId) || !FILE.test(plan.binlogFile) ||
     !Number.isSafeInteger(plan.binlogPosition) || plan.binlogPosition<4 ||
     !DIGEST.test(plan.commitDigest) ||
     !Number.isSafeInteger(plan.leaderEpoch) || plan.leaderEpoch<1 ||
     !Number.isSafeInteger(plan.expectedGeneration) || plan.expectedGeneration<0 ||
     plan.nextGeneration!==plan.expectedGeneration+1 ||
     !Array.isArray(plan.affectedFeeds) || plan.affectedFeeds.length===0 ||
     plan.affectedFeeds.length>VALID.size ||
     plan.affectedFeeds.some(f=>!VALID.has(f)) ||
     new Set(plan.affectedFeeds).size!==plan.affectedFeeds.length ||
     !Number.isSafeInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>10000)
    throw Error("CDC_META_WRITE_CONFIG_INVALID");
  let db:CdcMetadataConnection|null=null,started=false;
  try {
    db=await connector();
    await db.query({sql:START,timeout:timeoutMs},[]);
    started=true;
    const [locked]=await db.query({sql:LOCK,timeout:timeoutMs},[plan.sourceId]);
    const checkpoint=rows(locked);
    if(checkpoint.length!==1)throw Error("CDC_META_CHECKPOINT_INVALID");
    const current=checkpoint[0];
    if(integer(current.fence_epoch)!==plan.leaderEpoch)
      throw Error("CDC_META_FENCE_REJECTED");
    const [digestResult]=await db.query({sql:FIND,timeout:timeoutMs},[
      plan.sourceId,plan.binlogFile,plan.binlogPosition,
    ]);
    const digests=rows(digestResult);
    if(digests.length>1)throw Error("CDC_META_DIGEST_DUPLICATE");
    if(digests.length===1){
      if(digests[0].digest!==plan.commitDigest)
        throw Error("CDC_META_REPLAY_CONFLICT");
      await db.query({sql:ROLLBACK,timeout:timeoutMs},[]);
      started=false;
      await db.end(); db=null;
      return "REPLAYED";
    }
    if(integer(current.generation)!==plan.expectedGeneration)
      throw Error("CDC_META_CHECKPOINT_STALE");
    // Fail closed on non-monotone coordinates. Source binlog retention/lineage
    // must be checked by the upstream reader, NOT guessed from filename alone.
    const oldFile=current.binlog_file,oldPos=integer(current.binlog_position);
    if(typeof oldFile!=="string"||!FILE.test(oldFile)||oldPos===null ||
       plan.binlogFile<oldFile ||
       (plan.binlogFile===oldFile&&plan.binlogPosition<=oldPos))
      throw Error("CDC_META_COORDINATE_REGRESSION");
    const [inserted]=await db.query({sql:INSERT,timeout:timeoutMs},[
      plan.sourceId,plan.binlogFile,plan.binlogPosition,plan.commitDigest,
    ]);
    if(affected(inserted)!==1)throw Error("CDC_META_DIGEST_WRITE_FAILED");
    for(const feed of plan.affectedFeeds){
      const [result]=await db.query({sql:BUMP,timeout:timeoutMs},[plan.sourceId,feed]);
      if(affected(result)!==1)throw Error("CDC_META_FEED_WRITE_FAILED");
    }
    const [updated]=await db.query({sql:CHECKPOINT,timeout:timeoutMs},[
      plan.binlogFile,plan.binlogPosition,plan.sourceId,
      plan.expectedGeneration,plan.leaderEpoch,
    ]);
    if(affected(updated)!==1)throw Error("CDC_META_CHECKPOINT_WRITE_FAILED");
    await db.query({sql:COMMIT,timeout:timeoutMs},[]);
    started=false;
    await db.end();db=null;
    return "COMMITTED";
  } catch {
    // Never reveal SQL, secrets, hostnames or connector errors to API callers.
    throw Error("CDC_META_WRITE_UNAVAILABLE_OR_UNCERTAIN");
  } finally {
    if(db){
      if(started)try{await db.query({sql:ROLLBACK,timeout:timeoutMs},[]);}catch{}
      try{await db.end();}catch{}
    }
  }
}

export const CDC_METADATA_SQL=Object.freeze({START,LOCK,FIND,INSERT,BUMP,CHECKPOINT,COMMIT,ROLLBACK});
