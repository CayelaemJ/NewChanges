#!/usr/bin/env node
/**
 * READ ONLY staging preflight for live CDC baseline.
 * No persistence or replay; reported coordinates are observational only.
 * Never publish the resulting coordinate as a durable checkpoint.
 */
import mysql from "mysql2/promise";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";

const host="fixer-synthetic-mysql.cxeu8cgqwn8v.eu-north-1.rds.amazonaws.com";
const get=(args)=>execFileSync("aws",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:16000}).replace(/\r?\n$/,"");
const secrets={
 reader:"/fixer/staging/mysql/fixer-cdc-reader-password",
 writer:"/fixer/staging/mysql/fixer-cdc-writer-password"
};
const required=["cdc_checkpoint","cdc_commit_digest","cdc_feed_generation"];
const expect=(ok,code)=>{if(!ok)throw Error(code);};
const ca=readFileSync(".local/certs/rds-global-bundle.pem");
let reader,writer;
try{
 expect(process.env.AWS_DEFAULT_REGION==="eu-north-1","REGION_MISMATCH");
 const aws=JSON.parse(get(["sts","get-caller-identity","--output","json"]));
 expect(aws.Account==="805068224616","ACCOUNT_MISMATCH");
 const connect=async(user,name)=>mysql.createConnection({
  host,port:3306,user,password:get(["ssm","get-parameter","--region","eu-north-1",
   "--name",name,"--with-decryption","--query","Parameter.Value","--output","text"]),
  ssl:{ca,rejectUnauthorized:true},connectTimeout:8500,
  multipleStatements:false,bigNumberStrings:true
 });
 reader=await connect("fixer_cdc_reader",secrets.reader);
 writer=await connect("fixer_cdc_writer",secrets.writer);
 const [vars]=await reader.query("SELECT @@global.log_bin AS log_bin, @@global.binlog_format AS format, @@global.binlog_row_image AS image, @@global.server_id AS server_id");
 expect(Number(vars[0]?.log_bin)===1&&vars[0]?.format==="ROW"&&vars[0]?.image==="FULL","BINLOG_CONFIG_INVALID");
 const [logs]=await reader.query("SHOW BINARY LOGS");
 expect(logs.length>0,"BINLOGS_MISSING");
 const [status]=await reader.query("SHOW BINARY LOG STATUS");
 expect(status.length===1&&typeof status[0].File==="string"&&Number(status[0].Position)>=4,"STATUS_INVALID");
 const [schema]=await writer.query(
  "SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA='fixer_cdc_meta'");
 expect(schema.length===3&&schema.every(x=>x.ENGINE==="InnoDB")&&
  JSON.stringify(schema.map(x=>x.TABLE_NAME).sort())===JSON.stringify(required),"METADATA_TABLES_INVALID");
 const counts={};
 for(const table of required){
  const [rows]=await writer.query("SELECT COUNT(*) AS n FROM fixer_cdc_meta."+table);
  counts[table]=Number(rows[0]?.n);
  expect(counts[table]===0,"METADATA_NOT_EMPTY_FAIL_CLOSED");
 }
 const [feedViews]=await reader.query(
  "SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA='ingest_stage'");
 expect(feedViews.length===10,"REPORTING_VIEWS_INVALID");
 console.log("PASS: CDC reader authenticates with verified TLS; binlog config ROW/FULL.");
 console.log("PASS: current binlog exists in SHOW BINARY LOGS.");
 console.log("PASS: metadata writer can read all 3 empty InnoDB tables.");
 console.log("PASS: 10 approved reporting views listed.");
 console.log("CURRENT_BINLOG_OBSERVATION:",status[0].File,status[0].Position);
 console.log("NOT A CHECKPOINT. Do not initialize until verified reader and leader fencing are ready.");
 console.log("NEXT: build and test a bounded replication stream using existing reader and no metadata writes.");
}catch(e){
 console.error("CDC_PREFLIGHT_FAILED:",e?.code||e?.message||"UNKNOWN");
 process.exitCode=1;
}finally{try{await reader?.end();}catch{} try{await writer?.end();}catch{}}
