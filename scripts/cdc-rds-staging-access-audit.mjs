#!/usr/bin/env node
/**
 * Read-only privilege/metadata inventory of the approved synthetic RDS instance.
 * Uses AWS SSM SecureString and pinned RDS CA; prints no passwords or secret values.
 * Does NOT infer CDC readiness from user existence.
 */
import mysql from "mysql2/promise";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";

const host="fixer-synthetic-mysql.cxeu8cgqwn8v.eu-north-1.rds.amazonaws.com";
const expected=new Set(["fixer_cdc_reader","fixer_reporting_reader","fixer_cdc_writer"]);
const exec=(args)=>execFileSync("aws",args,{encoding:"utf8",timeout:18000,stdio:["ignore","pipe","pipe"]}).trim();
let db;
try {
  if(process.env.AWS_DEFAULT_REGION!=="eu-north-1")throw Error("INVALID_REGION");
  const identity=JSON.parse(exec(["sts","get-caller-identity","--output","json"]));
  if(identity.Account!=="805068224616")throw Error("INVALID_ACCOUNT");
  const password=exec(["ssm","get-parameter","--region","eu-north-1",
    "--name","/fixer/staging/mysql/admin-password","--with-decryption",
    "--query","Parameter.Value","--output","text"]);
  db=await mysql.createConnection({host,port:3306,user:"fixeradmin",password,
    ssl:{ca:readFileSync(".local/certs/rds-global-bundle.pem"),rejectUnauthorized:true},
    connectTimeout:8000,multipleStatements:false});
  const [server]=await db.query("SELECT CURRENT_USER() AS account, @@global.log_bin AS log_bin, @@global.binlog_format AS binlog_format, @@global.binlog_row_image AS binlog_row_image");
  console.log("=== VERIFIED SOURCE ===");
  console.table(server);
  const [users]=await db.query("SELECT User,Host FROM mysql.user WHERE User IN ('fixer_cdc_reader','fixer_reporting_reader','fixer_cdc_writer') ORDER BY User,Host");
  console.log("=== CDC ACCOUNTS ===");
  console.table(users);
  for(const user of users) {
    if(!expected.has(user.User)||typeof user.Host!=="string"||!user.Host.length)throw Error("INVALID_ACCOUNT_INVENTORY");
    const sql="SHOW GRANTS FOR "+db.escapeId(user.User)+"@"+db.escapeId(user.Host);
    const [grants]=await db.query(sql);
    console.log("=== GRANTS: "+user.User+"@"+user.Host+" ===");
    for(const grant of grants)console.log(Object.values(grant)[0]);
  }
  const [meta]=await db.query("SELECT TABLE_NAME,ENGINE,TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA='fixer_cdc_meta' ORDER BY TABLE_NAME");
  console.log("=== CDC METADATA TABLES (ESTIMATED ROW COUNTS) ===");
  console.table(meta);
  const [views]=await db.query("SELECT TABLE_NAME,SECURITY_TYPE,DEFINER FROM information_schema.VIEWS WHERE TABLE_SCHEMA='ingest_stage' ORDER BY TABLE_NAME");
  console.log("=== REPORTING VIEW SECURITY ===");
  console.table(views);
  const [coordinates]=await db.query("SHOW BINARY LOG STATUS");
  console.log("=== CURRENT COORDINATES (OBSERVATION ONLY, NOT A CHECKPOINT) ===");
  console.table(coordinates.map(({File,Position})=>({File,Position})));
  console.log("READ_ONLY_INSPECTION_COMPLETE");
} catch(error){
  console.error("INSPECTION_FAILED:",error?.code||error?.message||"UNKNOWN");
  process.exitCode=1;
} finally {await db?.end();}
