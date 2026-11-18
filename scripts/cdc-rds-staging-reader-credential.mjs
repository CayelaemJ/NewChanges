#!/usr/bin/env node
/**
 * Existing CDC replication reader: preview by default, explicitly approved
 * one-time password rotation to AWS SSM SecureString. Synthetic RDS ONLY.
 * Existing external users of this MySQL login must be migrated first.
 * DOES NOT activate binlog consumption, write source rows, or change other users.
 */
import mysql from "mysql2/promise";
import {randomBytes} from "node:crypto";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync,execFileSync} from "node:child_process";

const host="fixer-synthetic-mysql.cxeu8cgqwn8v.eu-north-1.rds.amazonaws.com";
const name="/fixer/staging/mysql/fixer-cdc-reader-password";
const approved=process.env.FIXER_CDC_READER_ROTATION==="I_APPROVE_CDC_READER_ROTATION";
const run=args=>execFileSync("aws",args,{encoding:"utf8",timeout:18000,stdio:["ignore","pipe","pipe"]}).trimEnd();
const ssmLookup=()=>{
 const p=spawnSync("aws",["ssm","get-parameter","--name",name,"--region","eu-north-1",
  "--query","Parameter.Version","--output","text"],{encoding:"utf8",timeout:18000});
 if(p.status===0)return true;
 if(/ParameterNotFound/.test(p.stderr||""))return false;
 throw Error("SSM_LOOKUP_FAILED");
};
const store=value=>{
 const dir=mkdtempSync(join(tmpdir(),"fixer-reader-rotation-"));
 const file=join(dir,"input.json");
 try{
  chmodSync(dir,0o700);
  writeFileSync(file,JSON.stringify({Name:name,Type:"SecureString",Tier:"Standard",Value:value,
   Description:"The Fixer synthetic RDS MySQL CDC reader credential"}),{mode:0o600,flag:"wx"});
  const p=spawnSync("aws",["ssm","put-parameter","--region","eu-north-1",
   "--cli-input-json","file://"+file,"--output","json"],{encoding:"utf8",timeout:18000});
  if(p.status!==0)throw Error("SSM_PUT_FAILED");
 }finally{rmSync(dir,{recursive:true,force:true});}
};
let db,reader;
try{
 if(process.env.AWS_DEFAULT_REGION!=="eu-north-1")throw Error("AWS_REGION_MISMATCH");
 const identity=JSON.parse(run(["sts","get-caller-identity","--output","json"]));
 if(identity.Account!=="805068224616")throw Error("AWS_ACCOUNT_MISMATCH");
 const instance=JSON.parse(run(["rds","describe-db-instances",
  "--db-instance-identifier","fixer-synthetic-mysql",
  "--query","DBInstances[0]","--output","json"]));
 if(instance.Engine!=="mysql"||instance.DBInstanceStatus!=="available"||
  instance.Endpoint?.Address!==host||instance.Endpoint?.Port!==3306)
  throw Error("RDS_IDENTITY_MISMATCH");
 const ca=readFileSync(".local/certs/rds-global-bundle.pem");
 const adminPassword=run(["ssm","get-parameter","--name","/fixer/staging/mysql/admin-password",
  "--with-decryption","--query","Parameter.Value","--output","text"]);
 db=await mysql.createConnection({host,port:3306,user:"fixeradmin",password:adminPassword,
  ssl:{ca,rejectUnauthorized:true},connectTimeout:10000,multipleStatements:false});
 const [users]=await db.query("SELECT User,Host FROM mysql.user WHERE User='fixer_cdc_reader'");
 if(users.length!==1||users[0].Host!=="%")throw Error("READER_IDENTITY_MISMATCH");
 const [grants]=await db.query("SHOW GRANTS FOR 'fixer_cdc_reader'@'%'");
 const g=grants.map(x=>String(Object.values(x)[0])).join("\n");
 if(!/REPLICATION SLAVE/.test(g)||!/REPLICATION CLIENT/.test(g))
  throw Error("REPLICATION_PRIVILEGES_MISSING");
 const existing=ssmLookup();
 console.log("Synthetic RDS identity and existing reader privileges: verified.");
 console.log("SSM CDC reader credential:",existing?"PRESENT":"MISSING");
 console.log("Rotation approved:",approved?"YES":"NO (preview only)");
 if(existing){
  console.log("No change: SSM credential already exists; test using credential-smoke script.");
 }else if(!approved){
  console.log("Action required: confirm no other services depend on existing reader password.");
  console.log("Then apply: FIXER_CDC_READER_ROTATION=I_APPROVE_CDC_READER_ROTATION node scripts/cdc-rds-staging-reader-credential.mjs");
 }else{
  const secret=randomBytes(36).toString("base64url");
  // Parameter first: a failed DB ALTER leaves an unused secret and must be reconciled.
  store(secret);
  await db.query("ALTER USER 'fixer_cdc_reader'@'%' IDENTIFIED BY "+db.escape(secret)+" REQUIRE SSL");
  reader=await mysql.createConnection({host,port:3306,user:"fixer_cdc_reader",
   password:secret,ssl:{ca,rejectUnauthorized:true},connectTimeout:10000});
  const [auth]=await reader.query("SELECT CURRENT_USER() AS current_user");
  if(auth[0]?.current_user!=="fixer_cdc_reader@%")throw Error("READER_AUTH_CHECK_FAILED");
  const [status]=await reader.query("SHOW BINARY LOG STATUS");
  if(!status[0]?.File)throw Error("BINLOG_STATUS_CHECK_FAILED");
  console.log("PASS: reader password rotated, encrypted SSM credential saved, TLS binlog status verified.");
  console.log("No CDC stream or checkpoint initialized.");
 }
}catch(e){
 console.error("READER_CREDENTIAL_SETUP_FAILED:",e?.code||e?.message||"UNKNOWN");
 console.error("If an apply operation failed, inspect AWS SSM credential status and MySQL authentication before rerunning.");
 process.exitCode=1;
}finally{try{await reader?.end();}catch{} try{await db?.end();}catch{}}
