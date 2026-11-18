#!/usr/bin/env node
/**
 * Manual, staging-only metadata-schema provisioning for RDS synthetic MySQL.
 * No reporting data copies, account changes, cursor initialization or worker activation.
 * Default: READ-ONLY PLAN. Apply: FIXER_CDC_META_BOOTSTRAP=I_APPROVE_METADATA_SCHEMA_ONLY.
 */
import mysql from "mysql2/promise";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";

const host="fixer-synthetic-mysql.cxeu8cgqwn8v.eu-north-1.rds.amazonaws.com";
const parameter="/fixer/staging/mysql/admin-password";
const approve=process.env.FIXER_CDC_META_BOOTSTRAP==="I_APPROVE_METADATA_SCHEMA_ONLY";
const env=process.env;
const cmd=(args)=>execFileSync("aws",args,{encoding:"utf8",timeout:15000,stdio:["ignore","pipe","pipe"]}).trim();
const fail=(message)=>{throw Error(message)};
const schema="fixer_cdc_meta";
const expected=["cdc_checkpoint","cdc_feed_generation","cdc_commit_digest"];
const ddl=[
  `CREATE DATABASE fixer_cdc_meta CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  `CREATE TABLE fixer_cdc_meta.cdc_checkpoint (
    source_id VARCHAR(100) PRIMARY KEY,
    binlog_file VARCHAR(128) NOT NULL,
    binlog_position BIGINT UNSIGNED NOT NULL,
    generation BIGINT UNSIGNED NOT NULL,
    fence_epoch BIGINT UNSIGNED NOT NULL,
    updated_at_utc DATETIME(6) NOT NULL
  ) ENGINE=InnoDB`,
  `CREATE TABLE fixer_cdc_meta.cdc_feed_generation (
    source_id VARCHAR(100) NOT NULL,
    feed VARCHAR(64) NOT NULL,
    generation BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY(source_id,feed),
    FOREIGN KEY(source_id) REFERENCES fixer_cdc_meta.cdc_checkpoint(source_id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE fixer_cdc_meta.cdc_commit_digest (
    source_id VARCHAR(100) NOT NULL,
    binlog_file VARCHAR(128) NOT NULL,
    binlog_position BIGINT UNSIGNED NOT NULL,
    digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY(source_id,binlog_file,binlog_position),
    FOREIGN KEY(source_id) REFERENCES fixer_cdc_meta.cdc_checkpoint(source_id)
  ) ENGINE=InnoDB`,
];
let db;
try{
  if(env.AWS_DEFAULT_REGION!=="eu-north-1")fail("CDC_META_EXPECTED_AWS_REGION_EU_NORTH_1");
  const identity=JSON.parse(cmd(["sts","get-caller-identity","--output","json"]));
  if(identity.Account!=="805068224616")fail("CDC_META_AWS_ACCOUNT_MISMATCH");
  const instance=JSON.parse(cmd(["rds","describe-db-instances","--region","eu-north-1",
    "--db-instance-identifier","fixer-synthetic-mysql","--query","DBInstances[0]",
    "--output","json"]));
  if(instance.Engine!=="mysql"||instance.DBInstanceStatus!=="available"||
      instance.Endpoint?.Address!==host||instance.Endpoint?.Port!==3306)
    fail("CDC_META_RDS_IDENTITY_MISMATCH");
  const pw=cmd(["ssm","get-parameter","--region","eu-north-1",
    "--name",parameter,"--with-decryption","--query","Parameter.Value","--output","text"]);
  db=await mysql.createConnection({
    host,port:3306,user:"fixeradmin",password:pw,
    ssl:{ca:readFileSync(".local/certs/rds-global-bundle.pem"),rejectUnauthorized:true},
    connectTimeout:8000,multipleStatements:false,
  });
  const [schemas]=await db.execute(
    "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?",[schema]);
  const [tables]=await db.execute(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=?",[schema]);
  const existing=tables.map(x=>x.TABLE_NAME);
  if(existing.some(x=>!expected.includes(x)))fail("CDC_META_UNRECOGNIZED_EXISTING_TABLES");
  console.log("RDS identity and TLS: verified.");
  console.log("Metadata schema:",schemas.length?"EXISTS":"ABSENT");
  console.log("Metadata tables:",existing.length?existing.join(", "):"NONE");
  console.log("Apply requested:",approve?"YES":"NO — READ-ONLY PLAN");
  if(schemas.length||tables.length){
    // Never overwrite or assume the correctness of an existing schema.
    console.log("Existing schema detected: no changes made. Compare DDL with PR #237 before proceeding.");
    process.exitCode=0;
  }else if(!approve){
    console.log("Plan: create 1 metadata schema and 3 empty InnoDB tables.");
    console.log("No users, checkpoints, reporting data or CDC workers will be changed.");
    console.log("To apply: FIXER_CDC_META_BOOTSTRAP=I_APPROVE_METADATA_SCHEMA_ONLY node scripts/cdc-rds-staging-metadata-bootstrap.mjs");
  }else{
    console.log("Creating empty CDC metadata schema and 3 contract tables...");
    for(const statement of ddl)await db.query(statement);
    const [verified]=await db.execute(
      "SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=?",[schema]);
    const actual=verified.map(x=>x.TABLE_NAME).sort();
    if(JSON.stringify(actual)!==JSON.stringify([...expected].sort()) ||
       verified.some(x=>x.ENGINE!=="InnoDB"))fail("CDC_META_SCHEMA_VERIFICATION_FAILED");
    console.log("PASS: metadata schema and 3 empty InnoDB contract tables created.");
    console.log("NOT DONE: worker baseline, binlog stream, MySQL service roles or Railway connection.");
  }
}catch(error){
  const message=error instanceof Error?error.message:"UNKNOWN";
  const safe=message.startsWith("CDC_META_")?message:"CDC_META_BOOTSTRAP_FAILED";
  console.error(safe);
  process.exitCode=1;
}finally{try{await db?.end();}catch{}}
