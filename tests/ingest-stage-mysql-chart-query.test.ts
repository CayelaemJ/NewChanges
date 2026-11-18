import assert from "node:assert/strict";
import { test } from "node:test";
import { LOAD_ORDER } from "../src/services/reportFormats.js";
import { CHART_DIMENSIONS, buildMysqlChartQuery, readMysqlChart } from "../src/services/ingestStageMysqlChartQuery.js";
import type { CdcMysqlQueryConnection, CdcMysqlReaderSettings } from "../src/services/ingestStageCdcMysqlReader.js";

const settings:CdcMysqlReaderSettings={
  sourceId:"ingest_stage_rds",featureEnabled:true,accessReviewed:true,snapshotVerified:true,
  hostname:"fixture.abcdef.eu-north-1.rds.amazonaws.com",port:3306,
  username:"fixer_cdc_reader",password:"NOT_A_REAL_SECRET",
  caCertificatePath:"/fixture.pem",queryTimeoutMs:5000,maxRows:100,
};
const scope={sourceId:"ingest_stage_rds",tenantId:"tenant_one",authorizedEmployerRefs:["VIG"]};
function mocked(rows:unknown[],columns=["employer_ref","status"]) {
  const calls:Array<{sql:string;params:unknown[]}>=[];
  let closed=false;
  const conn:CdcMysqlQueryConnection={
    async query(input,params=[]) {
      const sql=typeof input==="string"?input:input.sql;
      calls.push({sql,params});
      if(sql.includes("information_schema.COLUMNS"))
        return [columns.map(COLUMN_NAME=>({COLUMN_NAME})),[]];
      if(sql.startsWith("SELECT ") && sql.includes(" AS bucket"))return [rows,[]];
      return [[],[]];
    },
    async end(){closed=true;},
  };
  return {conn,calls,closed:()=>closed};
}

test("all ten feeds have an explicitly selected bounded chart dimension",()=>{
  assert.deepEqual(new Set(Object.keys(CHART_DIMENSIONS)),new Set(LOAD_ORDER));
  for(const [feed,dims] of Object.entries(CHART_DIMENSIONS)){
    assert(dims.length>0);
    for(const dim of dims){
      const q=buildMysqlChartQuery(feed,dim,"VIG",new Set(["employer_ref",dim]));
      assert(q.sql.startsWith("SELECT "));
      assert.match(q.sql,/GROUP BY/);
      assert.match(q.sql,/WHERE `employer_ref` = \?/);
      assert(!q.sql.includes("VIG"));
      assert(!q.sql.includes(";"));
      assert.deepEqual(q.params,["VIG",21]);
    }
  }
});

test("MySQL completes aggregation, app only returns buckets, never raw source rows",async()=>{
  const m=mocked([{bucket:"COMPLETED",value:42},{bucket:"STARTED",value:"7"}]);
  const result=await readMysqlChart("journeys","status","VIG",scope,settings,async()=>m.conn);
  assert.deepEqual(result.buckets,[{bucket:"COMPLETED",value:42},{bucket:"STARTED",value:7}]);
  assert.equal(result.source,"MYSQL_AGGREGATED_READ_ONLY");
  assert.equal(result.tenantId,"tenant_one");
  assert(m.closed());
  assert.equal(m.calls.filter(c=>c.sql.startsWith("SELECT ") && c.sql.includes(" AS bucket")).length,1);
  assert(m.calls.every(c=>!/(?:INSERT|UPDATE|DELETE|CREATE|DROP|TRUNCATE)\s/i.test(c.sql)));
});

test("tenant, source and disabled feature gates reject before any connection",async()=>{
  let connects=0;
  const connect=async()=>{connects++;throw Error("SHOULD_NOT_CONNECT");};
  await assert.rejects(readMysqlChart("journeys","status","OTHER",scope,settings,connect));
  await assert.rejects(readMysqlChart("journeys","status","VIG",{...scope,sourceId:"other"},settings,connect));
  await assert.rejects(readMysqlChart("journeys","status","VIG",scope,{...settings,featureEnabled:false},connect));
  await assert.rejects(readMysqlChart("journeys","status","VIG",scope,{...settings,snapshotVerified:false},connect));
  await assert.rejects(readMysqlChart("journeys","status","VIG",scope,{...settings,accessReviewed:false},connect));
  await assert.rejects(readMysqlChart("journeys","status;DROP TABLE users","VIG",scope,settings,connect));
  assert.equal(connects,0);
});

test("view metadata controls missing column before query and always closes",async()=>{
  const m=mocked([],["employer_ref"]);
  await assert.rejects(readMysqlChart("journeys","status","VIG",scope,settings,async()=>m.conn),
    /CDC_METRIC_MYSQL_READ_FAILED/);
  assert(m.closed());
  assert(!m.calls.some(c=>c.sql.includes(" AS bucket")));
  assert.equal(m.calls.at(-1)?.sql,"ROLLBACK");
});

test("over-budget, malformed or sensitive results never publish",async()=>{
  for(const rows of [
    Array.from({length:21},()=>({bucket:"X",value:1})),
    [{bucket:"X",value:-2}],
    [{bucket:"X",value:1.5}],
    [{bucket:"X",value:999999999999999999}],
    [{bucket:"X",value:1,rawPayroll:"secret"},null],
  ]){
    const m=mocked(rows);
    await assert.rejects(readMysqlChart("journeys","status","VIG",scope,settings,async()=>m.conn),
      /CDC_METRIC_MYSQL_READ_FAILED/);
    assert(m.closed());
  }
});

test("failed connection is redacted, no reporting write",async()=>{
  await assert.rejects(readMysqlChart("journeys","status","VIG",scope,settings,
    async()=>{throw Error("PRIVATE_AWS_SQL_CREDENTIAL");}),error=>
    error instanceof Error && error.message==="CDC_METRIC_MYSQL_READ_FAILED" &&
    !error.message.includes("PRIVATE_AWS_SQL_CREDENTIAL"));
});
