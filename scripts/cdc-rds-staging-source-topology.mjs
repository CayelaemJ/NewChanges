#!/usr/bin/env node
/**
 * Read-only inventory of the physical source tables behind CDC feeds.
 * Does not create baselines, persist binlog coordinates, or alter data.
 * Fail closed when any expected physical table or view is absent.
 */
import mysql from "mysql2/promise";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const host="fixer-synthetic-mysql.cxeu8cgqwn8v.eu-north-1.rds.amazonaws.com";
const expected=["debt_accounts","employees","employers","journeys","platform_users",
 "policies","ratings","referrals","salary_advances","workforce_snapshots"];
const cmd=args=>execFileSync("aws",args,{encoding:"utf8",timeout:20000,stdio:["ignore","pipe","pipe"]}).replace(/\r?\n$/,"");
const fail=code=>{throw Error(code)};
let db;
try {
 if(process.env.AWS_DEFAULT_REGION!=="eu-north-1")fail("WRONG_REGION");
 const identity=JSON.parse(cmd(["sts","get-caller-identity","--output","json"]));
 if(identity.Account!=="805068224616")fail("WRONG_ACCOUNT");
 const pw=cmd(["ssm","get-parameter","--region","eu-north-1",
  "--name","/fixer/staging/mysql/fixer-cdc-reader-password",
  "--with-decryption","--query","Parameter.Value","--output","text"]);
 db=await mysql.createConnection({host,port:3306,user:"fixer_cdc_reader",password:pw,
   ssl:{ca:readFileSync(".local/certs/rds-global-bundle.pem"),rejectUnauthorized:true},
   connectTimeout:9000,multipleStatements:false});
 const [tables]=await db.query(
  "SELECT TABLE_NAME,TABLE_TYPE,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA='ingest_stage' ORDER BY TABLE_NAME");
 const byName=new Map(tables.map(t=>[t.TABLE_NAME,t]));
 const result=expected.map(name=>{
  const physical=byName.get(name),view=byName.get("v_"+name);
  return {feed:name,physical:physical?.TABLE_TYPE??"MISSING",engine:physical?.ENGINE??"-",
   view:view?.TABLE_TYPE??"MISSING"};
 });
 console.table(result);
 if(result.some(x=>x.physical!=="BASE TABLE"||x.view!=="VIEW"||x.engine!=="InnoDB"))
   fail("CANONICAL_SOURCE_TOPOLOGY_MISMATCH");
 const [status]=await db.query("SHOW BINARY LOG STATUS");
 console.log("SOURCE_TOPOLOGY_PASS: all 10 physical InnoDB tables and 10 views exist.");
 console.log("OBSERVED_BINLOG:",status[0]?.File,status[0]?.Position,"(NOT A CHECKPOINT)");
 console.log("NEXT: check view-to-table dependencies and establish worker-owned baseline.");
} catch(e) {
 console.error("SOURCE_TOPOLOGY_FAILED:",e?.code??e?.message??"UNKNOWN");
 process.exitCode=1;
} finally {try{await db?.end()}catch{}}
