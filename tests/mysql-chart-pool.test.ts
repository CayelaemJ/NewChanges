import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMysqlChartPoolConnector,
  type ChartPoolConnection,
  type ChartPoolFactory,
  type ChartPoolOptions,
} from "../src/services/mysqlChartPool.js";
import { readMysqlChart } from "../src/services/ingestStageMysqlChartQuery.js";
import type {CdcMysqlReaderSettings} from "../src/services/ingestStageCdcMysqlReader.js";

const settings:CdcMysqlReaderSettings={
  sourceId:"reporting_rds",featureEnabled:true,accessReviewed:true,snapshotVerified:true,
  hostname:"fixture.abcdef.eu-north-1.rds.amazonaws.com",port:3306,
  username:"fixer_cdc_reader",password:"NOT_A_REAL_SECRET",
  caCertificatePath:"/fixture.pem",queryTimeoutMs:5000,maxRows:100,
};
const scope={sourceId:"reporting_rds",tenantId:"tenant_one",authorizedEmployerRefs:["VIG"]};
const CA="-----BEGIN CERTIFICATE-----\nSYNTHETIC_TEST\n-----END CERTIFICATE-----";
function fixtures(opts?:{queryFails?:boolean; rollbackFails?:boolean}) {
  const calls:string[]=[];
  let created=0, acquired=0, released=0, destroyed=0, loaded=0;
  let options:ChartPoolOptions|null=null;
  const conn:ChartPoolConnection={
    async query(command) {
      const sql=typeof command==="string"?command:command.sql;
      calls.push(sql);
      if(opts?.queryFails && sql.includes(" AS bucket"))throw Error("SECRET_QUERY_FAILED");
      if(opts?.rollbackFails && sql==="ROLLBACK")throw Error("SECRET_ROLLBACK_FAILED");
      if(sql.includes("information_schema.COLUMNS"))
        return [[{COLUMN_NAME:"employer_ref"},{COLUMN_NAME:"status"}],[]];
      if(sql.includes(" AS bucket"))return [[{bucket:"COMPLETED",value:8}],[]];
      return [[],[]];
    },
    release(){released++;},
    destroy(){destroyed++;},
  };
  const factory:ChartPoolFactory=(config)=>{
    created++; options=config;
    return {async getConnection(){acquired++;return conn;}};
  };
  const connect=createMysqlChartPoolConnector(factory,async()=>{loaded++;return CA;});
  return {connect,calls,values:()=>({created,acquired,released,destroyed,loaded,options})};
}

test("two chart reads reuse one TLS pool, releasing leases after rollback",async()=>{
  const m=fixtures();
  const a=await readMysqlChart("journeys","status","VIG",scope,settings,m.connect);
  const b=await readMysqlChart("journeys","status","VIG",scope,settings,m.connect);
  assert.deepEqual(a.buckets,b.buckets);
  assert.deepEqual(m.values().created,1);
  assert.equal(m.values().acquired,2);
  assert.equal(m.values().released,2);
  assert.equal(m.values().destroyed,0);
  assert.equal(m.values().loaded,1);
  assert.equal(m.values().options?.connectionLimit,4);
  assert.equal(m.values().options?.waitForConnections,false);
  assert.equal(m.values().options?.multipleStatements,false);
  assert.equal(m.values().options?.ssl.verifyIdentity,true);
  assert.equal(m.values().options?.ssl.rejectUnauthorized,true);
  assert.equal(m.calls.filter(s=>s==="ROLLBACK").length,2);
});

test("failed chart query destroys lease instead of poisoning shared pool",async()=>{
  const m=fixtures({queryFails:true});
  await assert.rejects(
    readMysqlChart("journeys","status","VIG",scope,settings,m.connect),
    /CDC_METRIC_MYSQL_READ_FAILED/,
  );
  assert.equal(m.values().released,0);
  assert.equal(m.values().destroyed,1);
});

test("failed rollback destroys lease instead of returning open transaction",async()=>{
  const m=fixtures({rollbackFails:true});
  await assert.rejects(
    readMysqlChart("journeys","status","VIG",scope,settings,m.connect),
    /CDC_METRIC_MYSQL_READ_FAILED/,
  );
  assert.equal(m.values().released,0);
  assert.equal(m.values().destroyed,1);
});

test("missing rollback on a checked-out connection never returns a dirty lease",async()=>{
  const m=fixtures();
  const db=await m.connect(settings);
  await db.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
  await db.end();
  assert.equal(m.values().released,0);
  assert.equal(m.values().destroyed,1);
});

test("disabled gate and changed credentials fail without opening another pool",async()=>{
  const m=fixtures();
  await assert.rejects(m.connect({...settings,featureEnabled:false}),/CDC_MYSQL_READ_GATE_CLOSED/);
  assert.equal(m.values().created,0);
  const db=await m.connect(settings);
  await db.query("ROLLBACK"); await db.end();
  await assert.rejects(m.connect({...settings,password:"SECRET_ROTATED"}),/CONFIG_CHANGED_RESTART_REQUIRED/);
  assert.equal(m.values().created,1);
});

test("concurrent first reads initialize one pool",async()=>{
  const m=fixtures();
  const leases=await Promise.all([m.connect(settings),m.connect(settings),m.connect(settings)]);
  assert.equal(m.values().created,1);
  assert.equal(m.values().acquired,3);
  await Promise.all(leases.map(async db=>{await db.query("ROLLBACK");await db.end();}));
  assert.equal(m.values().released,3);
});
