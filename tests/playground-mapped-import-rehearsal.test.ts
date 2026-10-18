import assert from "node:assert/strict";
import {rehearseMappedMysqlImport} from "../src/services/playgroundMappedImportRehearsal.js";
import {LOAD_ORDER,getFormat} from "../src/services/reportFormats.js";
const mapping={sourceGeneration:"g1",feeds:LOAD_ORDER.map(feed=>({
 feed,sourceTable:"legacy."+feed,
 columns:Object.fromEntries(getFormat(feed)!.fields.filter(f=>f.required).map(f=>[f.name,f.name]))
}))};
const options={approvedForPlayground:true as const,
 source:{host:"mysql.example.org",database:"data",user:"readonly",password:"no-real-secret",
 ssl:true as const,rejectUnauthorized:true as const},
 mapping,stagingRoot:"/tmp/newchanges-mapped-test",upperWatermark:"2026-10-16T12:00:00Z",
 pageSize:20,maxRowsPerFeed:100,maxBytesPerFeed:2048,maxPagesPerFeed:10,
 maxTotalRows:1000,maxTotalBytes:20480,maxTotalPages:100};
await assert.rejects(rehearseMappedMysqlImport({...options,approvedForPlayground:false as true}),/approval/);
await assert.rejects(rehearseMappedMysqlImport({...options,stagingRoot:"relative/data"}),/Absolute isolated/);
await assert.rejects(rehearseMappedMysqlImport({...options,maxTotalBytes:100}),/cost reservation/);
await assert.rejects(rehearseMappedMysqlImport({...options,pageSize:251}),/feed budgets/);
console.log("Mapped MySQL rehearsal rejects unapproved or over-budget source connection attempts");
