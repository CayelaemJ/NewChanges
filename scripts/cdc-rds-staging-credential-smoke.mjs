#!/usr/bin/env node
/**
 * Staging-only read-only credential and permission smoke tests.
 * Tests SSM stored credentials, real TLS connections and allowed SQL access.
 * Never updates schema, source rows, metadata rows or binlog state.
 */
import mysql from "mysql2/promise";
import {execFileSync, spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";

const host="fixer-synthetic-mysql.cxeu8cgqwn8v.eu-north-1.rds.amazonaws.com";
const ca=readFileSync(".local/certs/rds-global-bundle.pem");
const p=u=>"/fixer/staging/mysql/"+u.replaceAll("_","-")+"-password";
const cmd=(args)=>execFileSync("aws",args,{encoding:"utf8",timeout:18000,stdio:["ignore","pipe","pipe"]}).trimEnd();
const getSecret=(u)=>{
  const ret=spawnSync("aws",["ssm","get-parameter","--region","eu-north-1",
    "--name",p(u),"--with-decryption","--query","Parameter.Value","--output","text"],
    {encoding:"utf8",timeout:18000});
  if(ret.status!==0) {
    if(/ParameterNotFound/.test(ret.stderr||""))return null;
    throw Error("SSM_READ_FAILED_"+u);
  }
  return ret.stdout.replace(/\r?\n$/,"");
};
const connect=(u,password)=>mysql.createConnection({
  host,port:3306,user:u,password,
  ssl:{ca,rejectUnauthorized:true},connectTimeout:9000,
  multipleStatements:false,
});
let failure=false;
try{
  if(process.env.AWS_DEFAULT_REGION!=="eu-north-1")throw Error("AWS_REGION_MISMATCH");
  const identity=JSON.parse(cmd(["sts","get-caller-identity","--output","json"]));
  if(identity.Account!=="805068224616")throw Error("AWS_ACCOUNT_MISMATCH");
  for(const u of ["fixer_reporting_reader","fixer_cdc_writer","fixer_cdc_reader"]){
    const password=getSecret(u);
    if(password===null){
      console.log(u+": NO_SSM_CREDENTIAL");
      if(u!=="fixer_cdc_reader")failure=true;
      continue;
    }
    let db;
    try{
      db=await connect(u,password);
      const [auth]=await db.query("SELECT CURRENT_USER() AS login");
      if(auth[0]?.login!==u+"@%")throw Error("ACCOUNT_IDENTITY_MISMATCH");
      if(u==="fixer_reporting_reader"){
        const [views]=await db.query("SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA='ingest_stage'");
        if(views.length!==10)throw Error("REPORTING_VIEW_COUNT_MISMATCH");
        for(const view of views){
          if(!/^v_[a-z_]+$/.test(view.TABLE_NAME))throw Error("VIEW_NAME_INVALID");
          await db.query("SELECT 1 FROM "+db.escapeId("ingest_stage")+"."+db.escapeId(view.TABLE_NAME)+" LIMIT 0");
        }
        console.log(u+": PASS (TLS, login, 10 view SELECT LIMIT 0)");
      }else if(u==="fixer_cdc_writer"){
        await db.query("SELECT source_id FROM fixer_cdc_meta.cdc_checkpoint LIMIT 0");
        await db.query("SELECT source_id FROM fixer_cdc_meta.cdc_feed_generation LIMIT 0");
        await db.query("SELECT source_id FROM fixer_cdc_meta.cdc_commit_digest LIMIT 0");
        console.log(u+": PASS (TLS, login, 3 metadata reads)");
      }else{
        const [grants]=await db.query("SHOW GRANTS");
        const statement=grants.map(g=>Object.values(g)[0]).join("\n");
        if(!/REPLICATION SLAVE/.test(statement)||!/REPLICATION CLIENT/.test(statement))
          throw Error("REPLICATION_GRANTS_MISSING");
        const [status]=await db.query("SHOW BINARY LOG STATUS");
        if(!status[0]?.File)throw Error("BINARY_LOG_STATUS_UNAVAILABLE");
        console.log(u+": PASS (TLS, login, replication grants, status)");
      }
    }catch(e){
      failure=true;
      console.log(u+": FAIL ("+(e?.code||e?.message||"UNKNOWN")+")");
    }finally{try{await db?.end();}catch{}}
  }
  console.log("No state was modified; binlog reader still requires a verified independent worker.");
}catch(e){
  failure=true;console.log("CHECK_FAILED:",e?.message||"UNKNOWN");
}
if(failure)process.exitCode=1;
