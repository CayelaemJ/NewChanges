import assert from "node:assert/strict";
import {prepareSourceFeed} from "../src/services/boundedSourceFeed.js";
import {getFormat} from "../src/services/reportFormats.js";
import {readSourceJson} from "../src/services/boundedSourceJson.js";
const format=getFormat("employers")!;
const through=new Date("2026-10-20T08:00:00Z");
const row=(i:number)=>({employer_ref:`E${i}`,name:`Synthetic employer ${i}`,source_updated_at:"2026-10-20T07:00:00Z"});
async function* pages(count:number){
  for(let offset=0;offset<count;offset+=1000)
    yield {records:Array.from({length:Math.min(1000,count-offset)},(_,i)=>row(offset+i)),location:"synthetic"};
}
const count=Number(process.env.SOURCE_TEST_ROWS??120_000);
const prepared=await prepareSourceFeed(format,pages(count),{through,authoritative:false});
try{
  assert.equal(prepared.rowCount,count);
  assert.equal(prepared.sample.length,Math.min(50_000,count));
  assert.equal(prepared.newest?.toISOString(),"2026-10-20T07:00:00.000Z");
  let replayed=0;
  for await(const page of prepared.rows()){
    assert(page.length<=1000);assert(page[0].source_updated_at instanceof Date);
    assert.equal(page[0].employer_ref,`E${replayed}`);replayed+=page.length;
  }
  assert.equal(replayed,count);
}finally{await prepared.close();}
async function* duplicate(){yield {records:[row(1)],location:"test"};yield {records:[row(1)],location:"test"};}
await assert.rejects(prepareSourceFeed(format,duplicate(),{through,authoritative:false}),/duplicate natural key/);
async function* invalidLate(){yield {records:[row(1)],location:"test"};yield {records:[{...row(2),name:null}],location:"test"};}
await assert.rejects(prepareSourceFeed(format,invalidLate(),{through,authoritative:false}),/validation failed before live writes/);
await assert.rejects(prepareSourceFeed(format,pages(10),{through,authoritative:false,maxBytes:5}),/disk budget/);
await assert.rejects(prepareSourceFeed(format,pages(10),{through,authoritative:false,maxRows:5}),/row budget/);
assert.deepEqual(await readSourceJson(new Response('{"records":[]}')), {records:[]});
await assert.rejects(readSourceJson(new Response('1234567890'),5),/byte budget/);
await assert.rejects(readSourceJson(new Response('[]',{headers:{'content-length':'100'}}),5),/exceeds/);
console.log(`Bounded source validation/replay passed: ${count} rows; duplicate, late-invalid, quota and HTTP bounds verified`);

const employeeFormat=getFormat("employees")!;
async function* employeePages(){
  for(let offset=0;offset<318_043;offset+=1000)
    yield {location:"synthetic employee history",records:Array.from({length:Math.min(1000,318_043-offset)},(_,i)=>({
      employer_ref:"SYNTHETIC",payroll_ref:`TOKEN-${offset+i}`,observed_at:"2026-09-30",
      site_name:"Synthetic site",income_band:"BAND_10_20K",eligible_from:"2025-01-01",active:true,
      source_updated_at:"2026-10-20T07:00:00Z",
    }))};
}
const employees=await prepareSourceFeed(employeeFormat,employeePages(),{through,authoritative:false});
try{
  assert.equal(employees.rowCount,318_043);
  let replayed=0;for await(const chunk of employees.rows())replayed+=chunk.length;
  assert.equal(replayed,318_043);
}finally{await employees.close();}
console.log("Employee history regression passed: 318,043 rows under constrained heap");
