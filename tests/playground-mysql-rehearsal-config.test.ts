import assert from "node:assert/strict";
import {LOAD_ORDER} from "../src/services/reportFormats.js";
import {guardedMappedMysqlRehearsal} from "../src/services/playgroundMysqlRehearsalConfig.js";
const mapping={sourceGeneration:"dryrun1",feeds:LOAD_ORDER.map(feed=>({feed,sourceTable:"legacy."+feed,columns:{}}))};
const env={PLAYGROUND_MAPPED_SOURCE_APPROVED:"yes",RAILWAY_ENVIRONMENT_NAME:"Testing",
 PLAYGROUND_SOURCE_WATERMARK:"2026-10-16T12:00:00Z",
 PLAYGROUND_MYSQL_HOST:"mysql.test.example",PLAYGROUND_MYSQL_DATABASE:"data",
 PLAYGROUND_MYSQL_USER:"reader",PLAYGROUND_MYSQL_PASSWORD:"synthetic"};
const config=guardedMappedMysqlRehearsal(env,mapping);
assert.equal(config.source.ssl,true);
assert.equal(config.pageSize,100);
assert.equal(config.maxTotalBytes,20*1024*1024);
assert.equal(config.approvedForPlayground,true);
assert.throws(()=>guardedMappedMysqlRehearsal({...env,RAILWAY_ENVIRONMENT_NAME:"Production"},mapping),/restricted/);
assert.throws(()=>guardedMappedMysqlRehearsal({...env,PLAYGROUND_MAPPED_SOURCE_APPROVED:"no"},mapping),/approval/);
assert.throws(()=>guardedMappedMysqlRehearsal({...env,PLAYGROUND_MYSQL_USER:"root"},mapping),/read-only/);
assert.throws(()=>guardedMappedMysqlRehearsal({...env,PLAYGROUND_STAGING_ROOT:"/var/lib/newchanges"},mapping),/Isolated/);
assert.throws(()=>guardedMappedMysqlRehearsal({...env,PLAYGROUND_PAGE_SIZE:"9999"},mapping),/limit/);
assert.throws(()=>guardedMappedMysqlRehearsal({...env,PLAYGROUND_BYTES_PER_FEED:String(8*1024*1024)},mapping),/64 MiB/);
assert.throws(()=>guardedMappedMysqlRehearsal({...env,PLAYGROUND_SOURCE_WATERMARK:"bad"},mapping),/watermark/);
console.log("Mapped operator rehearsal requires Testing/Playground, TLS, non-root and small cost budgets");
