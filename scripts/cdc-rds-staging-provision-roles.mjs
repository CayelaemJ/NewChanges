#!/usr/bin/env node
/**
 * Explicit staging-only provisioning: existing CDC reader gets replication
 * rights; new reporting reader and metadata writer get scoped SQL rights.
 * Creates encrypted SSM credentials for new users without exposing them.
 * Default PREVIEW; no baseline, service deployment, or application data copy.
 */
import mysql from "mysql2/promise";
import {randomBytes} from "node:crypto";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync,spawnSync} from "node:child_process";

const host="fixer-synthetic-mysql.cxeu8cgqwn8v.eu-north-1.rds.amazonaws.com";
const approved=process.env.FIXER_CDC_ROLE_SETUP==="I_APPROVE_STAGING_MYSQL_ROLES";
const roleNames=["fixer_reporting_reader","fixer_cdc_writer"];
const viewNames=["v_debt_accounts","v_employees","v_employers","v_journeys",
"v_platform_users","v_policies","v_ratings","v_referrals",
"v_salary_advances","v_workforce_snapshots"];
const run=(args)=>execFileSync("aws",args,{encoding:"utf8",timeout:20000,stdio:["ignore","pipe","pipe"]}).trim();
const param=(u)=>"/fixer/staging/mysql/"+u.replaceAll("_","-")+"-password";
const store=(name,value)=>{
  // AWS CLI's --cli-input-json must come from a seekable file (stdin failed in WSL).
  const dir=mkdtempSync(join(tmpdir(),"fixer-cdc-ssm-"));
  const file=join(dir,"payload.json");
  try{
    chmodSync(dir,0o700);
    writeFileSync(file,JSON.stringify({Name:name,Type:"SecureString",Tier:"Standard",Value:value,
      Description:"The Fixer synthetic RDS staging least-privilege credential"}),{mode:0o600,flag:"wx"});
    const result=spawnSync("aws",["ssm","put-parameter","--region","eu-north-1",
      "--cli-input-json","file://"+file,"--output","json"],
      {encoding:"utf8",timeout:20000});
    if(result.status!==0)throw Error("SSM_SECRET_STORE_FAILED");
  }finally{rmSync(dir,{recursive:true,force:true});}
};
let db;
try{
  if(process.env.AWS_DEFAULT_REGION!=="eu-north-1")throw Error("REGION_MISMATCH");
  const identity=JSON.parse(run(["sts","get-caller-identity","--output","json"]));
  if(identity.Account!=="805068224616")throw Error("ACCOUNT_MISMATCH");
  const instance=JSON.parse(run(["rds","describe-db-instances","--db-instance-identifier",
    "fixer-synthetic-mysql","--query","DBInstances[0]","--output","json"]));
  if(instance.Engine!=="mysql"||instance.DBInstanceStatus!=="available"||
    instance.Endpoint?.Address!==host||instance.Endpoint?.Port!==3306)
    throw Error("RDS_IDENTITY_MISMATCH");
  const pw=run(["ssm","get-parameter","--region","eu-north-1",
    "--name","/fixer/staging/mysql/admin-password","--with-decryption",
    "--query","Parameter.Value","--output","text"]);
  db=await mysql.createConnection({host,port:3306,user:"fixeradmin",password:pw,
    ssl:{ca:readFileSync(".local/certs/rds-global-bundle.pem"),rejectUnauthorized:true},
    multipleStatements:false,connectTimeout:9000});
  const [accounts]=await db.query(
    "SELECT User,Host FROM mysql.user WHERE User IN ('fixer_cdc_reader','fixer_reporting_reader','fixer_cdc_writer')");
  if(!accounts.some(x=>x.User==="fixer_cdc_reader"&&x.Host==="%"))
    throw Error("EXPECTED_CDC_READER_MISSING");
  const [meta]=await db.query(
    "SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA='fixer_cdc_meta'");
  const expected=["cdc_checkpoint","cdc_commit_digest","cdc_feed_generation"];
  if(meta.length!==3||meta.some(x=>x.ENGINE!=="InnoDB")||
    JSON.stringify(meta.map(x=>x.TABLE_NAME).sort())!==JSON.stringify(expected))
    throw Error("METADATA_CONTRACT_ABSENT");
  for(const u of roleNames){
    if(accounts.some(x=>x.User===u))throw Error("ROLE_ALREADY_EXISTS_MANUAL_RECONCILIATION_"+u);
    try{
      run(["ssm","get-parameter","--region","eu-north-1","--name",param(u),
        "--query","Parameter.Version","--output","text"]);
      throw Error("SECRET_ALREADY_EXISTS_MANUAL_RECONCILIATION_"+u);
    }catch(e){
      if(String(e.message).startsWith("SECRET_ALREADY_EXISTS_"))throw e;
      // Don't treat transient AWS errors as 'not found'.
      const p=spawnSync("aws",["ssm","get-parameter","--region","eu-north-1",
        "--name",param(u),"--output","json"],{encoding:"utf8",timeout:15000});
      if(p.status===0)throw Error("SECRET_ALREADY_EXISTS_MANUAL_RECONCILIATION_"+u);
      if(!/ParameterNotFound/.test(p.stderr||""))throw Error("SSM_LOOKUP_FAILED_"+u);
    }
  }
  const [views]=await db.query(
    "SELECT TABLE_NAME,SECURITY_TYPE FROM information_schema.VIEWS WHERE TABLE_SCHEMA='ingest_stage'");
  if(views.length!==10||views.some(x=>!viewNames.includes(x.TABLE_NAME)||x.SECURITY_TYPE!=="DEFINER"))
    throw Error("REPORTING_VIEW_CONTRACT_MISMATCH");
  console.log("Staging source, account inventory, view inventory and metadata tables verified.");
  console.log("Plan: grant REPLICATION SLAVE, REPLICATION CLIENT to existing fixer_cdc_reader.");
  console.log("Plan: create restricted reporting reader (10 views) and metadata writer (3 tables).");
  console.log("Plan: save new passwords only in encrypted AWS SSM SecureString.");
  console.log("Warning: existing CDC reader has SELECT ON ingest_stage.*; this script preserves it.");
  console.log("Applied:",approved?"YES":"NO (preview)");
  if(!approved){
    console.log("Apply: FIXER_CDC_ROLE_SETUP=I_APPROVE_STAGING_MYSQL_ROLES node scripts/cdc-rds-staging-provision-roles.mjs");
  }else{
    await db.query("GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'fixer_cdc_reader'@'%'");
    console.log("CDC reader replication privileges granted.");
    for(const u of roleNames){
      const secret=randomBytes(36).toString("base64url");
      store(param(u),secret);
      await db.query("CREATE USER "+db.escapeId(u)+"@'%' IDENTIFIED BY "+db.escape(secret)+" REQUIRE SSL");
      if(u==="fixer_reporting_reader"){
        for(const v of viewNames)
          await db.query("GRANT SELECT ON "+db.escapeId("ingest_stage")+"."+db.escapeId(v)+
            " TO "+db.escapeId(u)+"@'%'");
      }else{
        await db.query("GRANT SELECT, UPDATE ON fixer_cdc_meta.cdc_checkpoint TO 'fixer_cdc_writer'@'%'");
        await db.query("GRANT SELECT, UPDATE ON fixer_cdc_meta.cdc_feed_generation TO 'fixer_cdc_writer'@'%'");
        await db.query("GRANT SELECT, INSERT ON fixer_cdc_meta.cdc_commit_digest TO 'fixer_cdc_writer'@'%'");
      }
      console.log("Created",u,"with encrypted SSM credential and scoped grants.");
    }
    console.log("PASS: accounts provisioned; NOT LIVE: baseline, leader election, binlog worker, Railway relay.");
  }
}catch(e){
  console.error("PROVISION_FAILED:",e?.code||e?.message||"UNKNOWN");
  console.error("If apply mode partially succeeded, do not rerun blindly; inspect SHOW GRANTS and SSM names.");
  process.exitCode=1;
}finally{try{await db?.end();}catch{}}
