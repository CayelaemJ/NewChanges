#!/usr/bin/env node
/**
 * Recovery after partial CDC reader password rotation.
 * Reuses EXISTING SSM SecureString. Never generates/overwrites another secret.
 * Read-only by default. Explicit approval required before ALTER USER.
 * SQL is split into password change and REQUIRE SSL for easier failure isolation.
 */
import mysql from "mysql2/promise";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";

const region="eu-north-1",host="fixer-synthetic-mysql.cxeu8cgqwn8v.eu-north-1.rds.amazonaws.com";
const approval=process.env.FIXER_CDC_READER_RECOVER==="I_APPROVE_EXISTING_SSM_PASSWORD";
const exec=args=>execFileSync("aws",args,{encoding:"utf8",timeout:18000,stdio:["ignore","pipe","pipe"]}).replace(/\r?\n$/,"");
const ca=readFileSync(".local/certs/rds-global-bundle.pem");
let admin,reader;
const connect=(user,password)=>mysql.createConnection({
 host,port:3306,user,password,ssl:{ca,rejectUnauthorized:true},
 connectTimeout:10000,multipleStatements:false,
});
const errorCode=e=>e?.code||"UNKNOWN"; // Do not log SQL, sqlMessage, or secrets
try{
 if(process.env.AWS_DEFAULT_REGION!==region)throw Error("AWS_REGION_MISMATCH");
 const identity=JSON.parse(exec(["sts","get-caller-identity","--output","json"]));
 if(identity.Account!=="805068224616")throw Error("AWS_ACCOUNT_MISMATCH");
 const rds=JSON.parse(exec(["rds","describe-db-instances","--region",region,
  "--db-instance-identifier","fixer-synthetic-mysql","--query","DBInstances[0]","--output","json"]));
 if(rds.Engine!=="mysql"||rds.DBInstanceStatus!=="available"||
  rds.Endpoint?.Address!==host||rds.Endpoint?.Port!==3306)throw Error("RDS_MISMATCH");
 const secret=exec(["ssm","get-parameter","--region",region,
  "--name","/fixer/staging/mysql/fixer-cdc-reader-password",
  "--with-decryption","--query","Parameter.Value","--output","text"]);
 if(!secret||secret.length<30)throw Error("SSM_READER_CREDENTIAL_INVALID");
 const adminPassword=exec(["ssm","get-parameter","--region",region,
  "--name","/fixer/staging/mysql/admin-password",
  "--with-decryption","--query","Parameter.Value","--output","text"]);
 admin=await connect("fixeradmin",adminPassword);
 const [users]=await admin.query("SELECT User,Host,ssl_type FROM mysql.user WHERE User='fixer_cdc_reader'");
 if(users.length!==1||users[0].Host!=="%")throw Error("READER_ACCOUNT_NOT_UNIQUE");
 console.log("Reader account exists; TLS requirement:",users[0].ssl_type||"NONE");
 const [grants]=await admin.query("SHOW GRANTS FOR 'fixer_cdc_reader'@'%'");
 const combined=grants.map(x=>Object.values(x)[0]).join("\n");
 if(!/REPLICATION SLAVE/.test(combined)||!/REPLICATION CLIENT/.test(combined))
  throw Error("REPLICATION_GRANTS_MISSING");
 let alreadyWorks=false;
 try{
  reader=await connect("fixer_cdc_reader",secret);
  const [auth]=await reader.query("SELECT CURRENT_USER() AS login");
  alreadyWorks=auth[0]?.login==="fixer_cdc_reader@%";
 }catch(e){
  if(!["ER_ACCESS_DENIED_ERROR","ER_NOT_SUPPORTED_AUTH_MODE"].includes(errorCode(e)))
   throw Error("READER_LOGIN_UNEXPECTED_"+errorCode(e));
 }finally{try{await reader?.end();}catch{} reader=null;}
 console.log("Existing SSM credential authenticates:",alreadyWorks?"YES":"NO");
 if(alreadyWorks){
  if(users[0].ssl_type==="ANY") {
   console.log("PASS: existing secret logs in and account requires SSL. No changes needed.");
  } else if(!approval){
   console.log("SSL enforcement not yet verified; preview only.");
  } else{
   await admin.query("ALTER USER 'fixer_cdc_reader'@'%' REQUIRE SSL");
   console.log("PASS: require SSL applied; no password change.");
  }
 }else if(!approval){
  console.log("No changes made. To reconcile the saved password:");
  console.log("FIXER_CDC_READER_RECOVER=I_APPROVE_EXISTING_SSM_PASSWORD node scripts/cdc-rds-staging-reader-recover.mjs");
 }else{
  // Parameterized SQL prevents secret inclusion in generated SQL error output.
  // mysql2.query formatting is used, because many MySQL DDL statements cannot be prepared.
  await admin.query("ALTER USER 'fixer_cdc_reader'@'%' IDENTIFIED BY ?",[secret]);
  console.log("Existing SSM password applied to MySQL account.");
  await admin.query("ALTER USER 'fixer_cdc_reader'@'%' REQUIRE SSL");
  reader=await connect("fixer_cdc_reader",secret);
  const [auth]=await reader.query("SELECT CURRENT_USER() AS login");
  if(auth[0]?.login!=="fixer_cdc_reader@%")throw Error("READER_LOGIN_VERIFICATION_FAILED");
  const [status]=await reader.query("SHOW BINARY LOG STATUS");
  if(!status[0]?.File)throw Error("READER_BINLOG_STATUS_UNAVAILABLE");
  console.log("PASS: SSM credential authenticates over verified TLS; binlog status readable.");
 }
}catch(e){
 console.error("READER_RECOVERY_FAILED:",errorCode(e)==="UNKNOWN"?(e?.message||"UNKNOWN"):errorCode(e));
 console.error("Do not rerun the original rotation; reconcile current SSM and MySQL state.");
 process.exitCode=1;
}finally{try{await reader?.end();}catch{} try{await admin?.end();}catch{}}
