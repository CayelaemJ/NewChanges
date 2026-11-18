#!/usr/bin/env node
/**
 * Read-only reporting-view dependency audit for The Fixer staging RDS.
 * Uses existing staging admin credential only for SHOW CREATE VIEW metadata.\n * No grants or runtime CDC reader privileges are modified.
 * Dependency extraction is conservative: ambiguous SQL fails audit.
 * No data rows read, no checkpoint writes, no baseline.
 */
import mysql from "mysql2/promise";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";

const host="fixer-synthetic-mysql.cxeu8cgqwn8v.eu-north-1.rds.amazonaws.com";
const schema="ingest_stage";
const feeds=["debt_accounts","employees","employers","journeys","platform_users",
  "policies","ratings","referrals","salary_advances","workforce_snapshots"];
const run=args=>execFileSync("aws",args,{encoding:"utf8",timeout:20000,
  stdio:["ignore","pipe","pipe"]}).trimEnd();
let db;
try {
  if(process.env.AWS_DEFAULT_REGION!=="eu-north-1") throw Error("REGION_MISMATCH");
  const account=JSON.parse(run(["sts","get-caller-identity","--output","json"])).Account;
  if(account!=="805068224616")throw Error("ACCOUNT_MISMATCH");
  const pw=run(["ssm","get-parameter","--region","eu-north-1",
    "--name","/fixer/staging/mysql/admin-password",
    "--with-decryption","--query","Parameter.Value","--output","text"]);
  db=await mysql.createConnection({host,port:3306,user:"fixeradmin",
    password:pw,ssl:{ca:readFileSync(".local/certs/rds-global-bundle.pem"),
    rejectUnauthorized:true},connectTimeout:9000,multipleStatements:false});
  await db.query("SET SESSION TRANSACTION READ ONLY");
  const summaries=[];
  for(const feed of feeds){
    const view="v_"+feed;
    let sql="";
    let origin="";
    try {
      const [rows]=await db.query("SHOW CREATE VIEW `"+schema+"`.`"+view+"`");
      sql=String(rows[0]?.["Create View"]??"");
      origin="SHOW_CREATE_VIEW";
    } catch (err){
      // Do not widen the CDC reader grants; fail closed on missing metadata.
      throw Error("ADMIN_VIEW_DEFINITION_UNAVAILABLE_"+view+"_"+(err?.code??"UNKNOWN"));
    }
    if(!sql){
      summaries.push({view,source:origin,dependencies:"UNKNOWN",status:"UNVERIFIED"});
      continue;
    }
    // MySQL expands view references as qualified quoted identifiers.
    // Strip quoted strings to avoid mistaking literals for table names.
    const masked=sql.replace(/'(?:''|\\.|[^'\\])*'/g,"''");
    const refs=[...masked.matchAll(/\b(?:from|join)\s+(?:`?([a-zA-Z_][\w]*)`?\s*\.\s*)?`?([a-zA-Z_][\w]*)`?/gi)]
      .map(m=>({schema:m[1]??schema,table:m[2]}))
      .filter(x=>x.schema.toLowerCase()===schema);
    const dependencies=[...new Set(refs.map(r=>r.table))].sort();
    const known=dependencies.every(name=>feeds.includes(name));
    const oneToOne=dependencies.length===1&&dependencies[0]===feed;
    // Conservative reporting: SQL parser is heuristic and cannot certify
    // nested derived tables, CTEs, stored functions or cross-schema refs.
    const complex=/\bwith\b|\bunion\b|\blateral\b|\bselect\s*\(/i.test(masked);
    const status=known&&oneToOne&&!complex?"CANDIDATE_ONE_TO_ONE":"REVIEW_REQUIRED";
    summaries.push({view,source:origin,
      dependencies:dependencies.join(",")||"UNKNOWN",status});
  }
  console.table(summaries);
  const review=summaries.filter(r=>r.status!=="CANDIDATE_ONE_TO_ONE");
  console.log("VIEW_DEPENDENCY_AUDIT:",review.length?"REVIEW_REQUIRED":"CANDIDATES_FOUND");
  console.log("NOTE: regex-based inventory is not proof of full view dependency safety.");
  console.log("NO SOURCE ROWS READ. NO DATABASE WRITES. NO BASELINE OR WORKER ACTIVATION.");
  if(review.length)process.exitCode=2;
}catch(err){
  console.error("VIEW_DEPENDENCY_AUDIT_FAILED:",err?.code??err?.message??"UNKNOWN");
  process.exitCode=1;
}finally{try{await db?.end()}catch{}}
