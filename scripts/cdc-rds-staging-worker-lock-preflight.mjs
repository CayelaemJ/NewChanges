#!/usr/bin/env node
/**
 * Staging worker lock and restricted metadata-writer readiness probe.
 * READ ONLY except transient MySQL advisory lock acquisition/release.
 * No checkpoints initialized, no data writes, no service enabled.
 */
import mysql from "mysql2/promise";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const host="fixer-synthetic-mysql.cxeu8cgqwn8v.eu-north-1.rds.amazonaws.com";
const source="fixer_synthetic_mysql";
const lockName="fixer_cdc_meta:"+source;
const call=(args)=>execFileSync("aws",args,{encoding:"utf8",timeout:18000,stdio:["ignore","pipe","pipe"]}).replace(/\r?\n$/,"");
let db,lockHeld=false;
try{
  if(process.env.AWS_DEFAULT_REGION!=="eu-north-1")throw Error("REGION_MISMATCH");
  const id=JSON.parse(call(["sts","get-caller-identity","--output","json"]));
  if(id.Account!=="805068224616")throw Error("ACCOUNT_MISMATCH");
  const password=call(["ssm","get-parameter","--region","eu-north-1",
    "--name","/fixer/staging/mysql/fixer-cdc-writer-password",
    "--with-decryption","--query","Parameter.Value","--output","text"]);
  db=await mysql.createConnection({
    host,port:3306,user:"fixer_cdc_writer",password,
    ssl:{ca:readFileSync(".local/certs/rds-global-bundle.pem"),rejectUnauthorized:true},
    connectTimeout:9000,multipleStatements:false,bigNumberStrings:true
  });
  const [identity]=await db.query("SELECT CURRENT_USER() AS login");
  if(identity[0]?.login!=="fixer_cdc_writer@%")throw Error("WRITER_IDENTITY_MISMATCH");
  const [grants]=await db.query("SHOW GRANTS");
  const g=grants.map(row=>String(Object.values(row)[0])).join("\n");
  for(const [table,verbs] of [
    ["cdc_checkpoint",["SELECT","UPDATE"]],
    ["cdc_feed_generation",["SELECT","UPDATE"]],
    ["cdc_commit_digest",["SELECT","INSERT"]],
  ]){
    if(!g.includes("`fixer_cdc_meta`.`"+table+"`") || !verbs.every(v=>g.includes(v)))
      throw Error("METADATA_WRITER_GRANTS_INCOMPLETE");
  }
  console.log("PASS: restricted metadata writer authenticates and its grants are present.");
  const [rows]=await db.execute("SELECT GET_LOCK(?, 0) AS acquired",[lockName]);
  if(Number(rows[0]?.acquired)!==1)throw Error("CDC_SOURCE_LOCK_UNAVAILABLE");
  lockHeld=true;
  console.log("PASS: exclusive MySQL advisory lock acquired.");
  const [state]=await db.execute(
    "SELECT source_id,binlog_file,binlog_position,generation,fence_epoch FROM fixer_cdc_meta.cdc_checkpoint WHERE source_id=?",
    [source]);
  console.log("EXISTING_SOURCE_CHECKPOINT:",state.length===0?"NONE":state.length===1?"PRESENT":"DUPLICATE");
  if(state.length>1)throw Error("DUPLICATE_SOURCE_CHECKPOINT");
  const [counts]=await db.query(
    "SELECT (SELECT COUNT(*) FROM fixer_cdc_meta.cdc_checkpoint) AS checkpoints, "+
    "(SELECT COUNT(*) FROM fixer_cdc_meta.cdc_feed_generation) AS feed_rows, "+
    "(SELECT COUNT(*) FROM fixer_cdc_meta.cdc_commit_digest) AS digests");
  console.table(counts);
  const [release]=await db.execute("SELECT RELEASE_LOCK(?) AS released",[lockName]);
  if(Number(release[0]?.released)!==1)throw Error("CDC_LOCK_RELEASE_FAILED");
  lockHeld=false;
  console.log("PASS: lock released; no MySQL records modified.");
  console.log("NOT DONE: worker runtime, baseline, replay or Railway relay.");
}catch(e){
  console.error("CDC_LOCK_PREFLIGHT_FAILED:",e?.code||e?.message||"UNKNOWN");
  process.exitCode=1;
}finally{
  if(db){
    if(lockHeld){
      try{await db.execute("SELECT RELEASE_LOCK(?)",[lockName]);}catch{}
    }
    try{await db.end();}catch{}
  }
}
