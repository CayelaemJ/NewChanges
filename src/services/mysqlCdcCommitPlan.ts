/**
 * OFFLINE contract for a proposed durable MySQL CDC metadata writer.
 * This is an injected transaction plan, not a live replication consumer.
 * Production MUST supply a DB-enforced leader/fencing token, an approved
 * baseline and committed XID verification upstream. No AWS access here.
 */
import { LOAD_ORDER } from "./reportFormats.js";

const FEEDS=new Set<string>(LOAD_ORDER);
const SOURCE=/^[a-z0-9][a-z0-9_-]{2,99}$/;
const COORD=/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const DIGEST=/^[0-9a-f]{64}$/;

export interface CommittedCdcPlan {
  readonly sourceId:string;
  readonly binlogFile:string;
  readonly binlogPosition:number;
  readonly expectedGeneration:number;
  readonly affectedFeeds:readonly string[];
  readonly commitDigest:string;
  /** Proof must come from a verified XID boundary, never from user input. */
  readonly xidVerified:true;
  readonly leaderEpoch:number;
}
export interface PlannedCdcCommit {
  readonly sourceId:string;
  readonly binlogFile:string;
  readonly binlogPosition:number;
  readonly expectedGeneration:number;
  readonly nextGeneration:number;
  readonly affectedFeeds:readonly string[];
  readonly commitDigest:string;
  readonly leaderEpoch:number;
}

/** Validates the metadata-only commit intent before any DB connector opens. */
export function planCommittedCdcWrite(input:CommittedCdcPlan):PlannedCdcCommit{
  if(!input || !SOURCE.test(input.sourceId) ||
      !COORD.test(input.binlogFile) ||
      !Number.isSafeInteger(input.binlogPosition) ||
      input.binlogPosition<4 ||
      !Number.isSafeInteger(input.expectedGeneration) ||
      input.expectedGeneration<0 ||
      input.expectedGeneration>=Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(input.leaderEpoch) ||
      input.leaderEpoch<1 ||
      input.xidVerified!==true ||
      !DIGEST.test(input.commitDigest) ||
      !Array.isArray(input.affectedFeeds) ||
      input.affectedFeeds.length<1 ||
      input.affectedFeeds.length>FEEDS.size ||
      input.affectedFeeds.some(feed=>!FEEDS.has(feed)) ||
      new Set(input.affectedFeeds).size!==input.affectedFeeds.length)
    throw new Error("CDC_META_COMMIT_INTENT_INVALID");
  return Object.freeze({
    sourceId:input.sourceId,
    binlogFile:input.binlogFile,
    binlogPosition:input.binlogPosition,
    expectedGeneration:input.expectedGeneration,
    nextGeneration:input.expectedGeneration+1,
    affectedFeeds:Object.freeze([...input.affectedFeeds].sort()),
    commitDigest:input.commitDigest,
    leaderEpoch:input.leaderEpoch,
  });
}
